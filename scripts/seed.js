import { ObjectId } from "mongodb";
import { DEFAULT_CLIENT, DEFAULT_DASHBOARDS } from "../src/defaultDashboards.js";
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
          title: dashboard.title,
          description: dashboard.description,
          url: dashboard.url,
          kind: dashboard.kind || "embed",
          sortOrder: dashboard.sortOrder,
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );
  }

  return { login: username, password: password || "(оставлен текущий пароль)" };
}

const db = await getDb();
await ensureIndexes(db);

const admin = await upsertAdmin(db);
const odeon = await upsertOdeon(db);

console.log("Seed completed.");
console.log(
  JSON.stringify(
    {
      admin,
      odeon,
      client: DEFAULT_CLIENT,
      dashboards: DEFAULT_DASHBOARDS.length,
    },
    null,
    2,
  ),
);

process.exit(0);
