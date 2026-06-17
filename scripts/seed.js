import { ObjectId } from "mongodb";
import { DEFAULT_CLIENT, DEFAULT_DASHBOARDS } from "../src/defaultDashboards.js";
import { config } from "../src/config.js";
import { ensureIndexes, getDb } from "../src/db.js";
import { generatePassword, hashPassword, normalizeUsername } from "../src/security.js";

const RESET_PASSWORDS = process.env.RESET_PASSWORDS === "1" || process.argv.includes("--reset-passwords");
const now = new Date();

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

async function upsertAdmin(db) {
  const username = normalizeUsername(env("ADMIN_USERNAME", "admin"));
  const existing = await db.collection("users").findOne({ role: "admin" });
  const password = env("ADMIN_PASSWORD", existing && !RESET_PASSWORDS ? null : generatePassword());

  if (!existing) {
    await db.collection("users").insertOne({
      username,
      passwordHash: await hashPassword(password),
      role: "admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { login: username, password };
  }

  const patch = {
    username,
    isActive: true,
    updatedAt: now,
  };

  if (password) {
    patch.passwordHash = await hashPassword(password);
  }

  await db.collection("users").updateOne({ _id: existing._id }, { $set: patch });
  return { login: username, password: password || "(оставлен текущий пароль)" };
}

async function upsertOdeon(db) {
  const client = await db.collection("clients").findOneAndUpdate(
    { slug: DEFAULT_CLIENT.slug },
    {
      $set: {
        name: DEFAULT_CLIENT.name,
        slug: DEFAULT_CLIENT.slug,
        isActive: true,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  const clientId = client.value?._id || client._id || new ObjectId(client.lastErrorObject?.upserted);
  const username = normalizeUsername(env("ODEON_USERNAME", "odeon_show"));
  const existing = await db.collection("users").findOne({ role: "client", clientId });
  const password = env("ODEON_PASSWORD", existing && !RESET_PASSWORDS ? null : generatePassword());

  if (!existing) {
    await db.collection("users").insertOne({
      username,
      passwordHash: await hashPassword(password),
      role: "client",
      clientId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const patch = {
      username,
      clientId,
      isActive: true,
      updatedAt: now,
    };

    if (password) {
      patch.passwordHash = await hashPassword(password);
    }

    await db.collection("users").updateOne({ _id: existing._id }, { $set: patch });
  }

  for (const dashboard of DEFAULT_DASHBOARDS) {
    await db.collection("dashboards").updateOne(
      { clientId, key: dashboard.key },
      {
        $set: {
          clientId,
          key: dashboard.key,
        },
        $setOnInsert: {
          title: dashboard.title,
          description: dashboard.description,
          url: dashboard.url,
          filtersEnabled: dashboard.filtersEnabled === true,
          sortOrder: dashboard.sortOrder,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    await db.collection("dashboards").updateOne(
      { clientId, key: dashboard.key, filtersEnabled: { $exists: false } },
      { $set: { filtersEnabled: dashboard.filtersEnabled === true, updatedAt: now } },
    );
  }

  await db.collection("dashboards").deleteMany({
    clientId,
    key: {
      $exists: true,
      $nin: DEFAULT_DASHBOARDS.map((dashboard) => dashboard.key),
    },
  });

  return { login: username, password: password || "(оставлен текущий пароль)" };
}

async function upsertPublicMongoUser(db) {
  const username = env("PUBLIC_MONGO_USERNAME", "");
  const password = env("PUBLIC_MONGO_PASSWORD", "");

  if (!username || !password) {
    return null;
  }

  const user = {
    pwd: password,
    roles: [{ role: "readWrite", db: config.mongoDb }],
  };

  try {
    await db.command({
      updateUser: username,
      ...user,
    });
  } catch (error) {
    if (error.codeName !== "UserNotFound" && error.code !== 11) {
      throw error;
    }

    await db.command({
      createUser: username,
      ...user,
    });
  }

  return {
    username,
    authSource: config.mongoDb,
  };
}

const db = await getDb();
await ensureIndexes(db);

const admin = await upsertAdmin(db);
const odeon = await upsertOdeon(db);
const publicMongo = await upsertPublicMongoUser(db);

console.log("Seed completed.");
console.log(
  JSON.stringify(
    {
      admin,
      odeon,
      client: DEFAULT_CLIENT,
      dashboards: DEFAULT_DASHBOARDS.length,
      publicMongo,
    },
    null,
    2,
  ),
);

process.exit(0);
