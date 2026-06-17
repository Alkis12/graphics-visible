import path from "node:path";
import { fileURLToPath } from "node:url";
import MongoStore from "connect-mongo";
import express from "express";
import session from "express-session";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { ensureIndexes, getDb } from "./db.js";
import {
  asyncHandler,
  cleanString,
  objectIdFromParam,
  requireAdmin,
  requireAuth,
  slugify,
  toBoolean,
} from "./http.js";
import { hashPassword, normalizeUsername, verifyPassword } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

const app = express();

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "256kb" }));
app.use(
  session({
    name: "graphics_visible_sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      maxAge: 1000 * 60 * 60 * 12,
    },
    store: MongoStore.create({
      mongoUrl: config.mongoUrl,
      dbName: config.mongoDb,
      collectionName: "sessions",
      stringify: false,
    }),
  }),
);

app.use(express.static(publicDir, { extensions: ["html"] }));

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function publicUser(user, client = null) {
  return {
    id: String(user._id),
    username: user.username,
    role: user.role,
    clientId: user.clientId ? String(user.clientId) : null,
    clientName: client?.name || null,
  };
}

function serializeClient(client, user = null, dashboards = []) {
  return {
    id: String(client._id),
    name: client.name,
    slug: client.slug,
    isActive: client.isActive !== false,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    user: user
      ? {
          id: String(user._id),
          username: user.username,
          isActive: user.isActive !== false,
          updatedAt: user.updatedAt,
        }
      : null,
    dashboards: dashboards.map(serializeDashboard),
  };
}

function serializeDashboard(dashboard) {
  return {
    id: String(dashboard._id),
    clientId: String(dashboard.clientId),
    title: dashboard.title,
    description: dashboard.description || "",
    url: dashboard.url,
    filtersEnabled: dashboard.filtersEnabled === true,
    sortOrder: dashboard.sortOrder || 0,
    isActive: dashboard.isActive !== false,
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
  };
}

async function buildAdminState(db) {
  const [clients, users, dashboards] = await Promise.all([
    db.collection("clients").find().sort({ name: 1 }).toArray(),
    db.collection("users").find({ role: "client" }).sort({ username: 1 }).toArray(),
    db.collection("dashboards").find().sort({ sortOrder: 1, title: 1 }).toArray(),
  ]);

  const usersByClientId = new Map(users.map((user) => [String(user.clientId), user]));
  const dashboardsByClientId = dashboards.reduce((acc, dashboard) => {
    const key = String(dashboard.clientId);
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key).push(dashboard);
    return acc;
  }, new Map());

  return {
    clients: clients.map((client) =>
      serializeClient(
        client,
        usersByClientId.get(String(client._id)) || null,
        dashboardsByClientId.get(String(client._id)) || [],
      ),
    ),
    dashboards: dashboards.map(serializeDashboard),
  };
}

function normalizeDashboardUrl(value) {
  let url = cleanString(value);

  if (/^[a-z0-9]{8,}$/i.test(url)) {
    url = `https://datalens.yandex/${url}`;
  } else if (/^datalens\.yandex\//i.test(url)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    const error = new Error("Введите корректную ссылку");
    error.status = 400;
    throw error;
  }

  return url;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const username = normalizeUsername(req.body.username);
    const password = cleanString(req.body.password);

    if (!username || !password) {
      res.status(400).json({ error: "Введите логин и пароль" });
      return;
    }

    const user = await db.collection("users").findOne({ username });

    if (!user || user.isActive === false) {
      res.status(401).json({ error: "Неверный логин или пароль" });
      return;
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      res.status(401).json({ error: "Неверный логин или пароль" });
      return;
    }

    let client = null;
    if (user.role === "client") {
      client = await db.collection("clients").findOne({ _id: user.clientId });
      if (!client || client.isActive === false) {
        res.status(403).json({ error: "Доступ клиента отключен" });
        return;
      }
    }

    await regenerateSession(req);
    req.session.user = publicUser(user, client);
    await saveSession(req);
    res.json({ user: req.session.user });
  }),
);

app.post(
  "/api/auth/logout",
  asyncHandler(async (req, res) => {
    await destroySession(req);
    res.clearCookie("graphics_visible_sid");
    res.json({ ok: true });
  }),
);

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get(
  "/api/dashboards",
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = await getDb();

    if (req.session.user.role === "admin") {
      res.json(await buildAdminState(db));
      return;
    }

    const clientId = new ObjectId(req.session.user.clientId);
    const client = await db.collection("clients").findOne({ _id: clientId });
    const dashboards = await db
      .collection("dashboards")
      .find({ clientId, isActive: { $ne: false } })
      .sort({ sortOrder: 1, title: 1 })
      .toArray();

    res.json({
      client: client ? serializeClient(client) : null,
      dashboards: dashboards.map(serializeDashboard),
    });
  }),
);

app.get(
  "/api/admin/state",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const db = await getDb();
    res.json(await buildAdminState(db));
  }),
);

app.post(
  "/api/admin/clients",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const now = new Date();
    const name = cleanString(req.body.name);
    const slug = slugify(req.body.slug || name);
    const username = normalizeUsername(req.body.username);
    const password = cleanString(req.body.password);

    if (!name || !slug || !username || !password) {
      res.status(400).json({ error: "Заполните клиента, логин и пароль" });
      return;
    }

    const clientResult = await db.collection("clients").insertOne({
      name,
      slug,
      isActive: toBoolean(req.body.isActive, true),
      createdAt: now,
      updatedAt: now,
    });

    try {
      await db.collection("users").insertOne({
        username,
        passwordHash: await hashPassword(password),
        role: "client",
        clientId: clientResult.insertedId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      await db.collection("clients").deleteOne({ _id: clientResult.insertedId });
      throw error;
    }

    res.status(201).json(await buildAdminState(db));
  }),
);

app.patch(
  "/api/admin/clients/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const clientId = objectIdFromParam(req.params.id);
    const now = new Date();
    const clientPatch = { updatedAt: now };

    if (req.body.name !== undefined) {
      const name = cleanString(req.body.name);
      if (!name) {
        res.status(400).json({ error: "Название клиента не может быть пустым" });
        return;
      }
      clientPatch.name = name;
    }

    if (req.body.slug !== undefined) {
      const slug = slugify(req.body.slug);
      if (!slug) {
        res.status(400).json({ error: "Slug клиента не может быть пустым" });
        return;
      }
      clientPatch.slug = slug;
    }

    if (req.body.isActive !== undefined) {
      clientPatch.isActive = toBoolean(req.body.isActive);
    }

    const clientUpdate = await db.collection("clients").updateOne(
      { _id: clientId },
      {
        $set: clientPatch,
      },
    );

    if (!clientUpdate.matchedCount) {
      res.status(404).json({ error: "Клиент не найден" });
      return;
    }

    const userPatch = { updatedAt: now };
    let shouldUpdateUser = false;

    if (req.body.username !== undefined) {
      const username = normalizeUsername(req.body.username);
      if (!username) {
        res.status(400).json({ error: "Логин не может быть пустым" });
        return;
      }
      userPatch.username = username;
      shouldUpdateUser = true;
    }

    if (req.body.password) {
      userPatch.passwordHash = await hashPassword(req.body.password);
      shouldUpdateUser = true;
    }

    if (req.body.isActive !== undefined) {
      userPatch.isActive = toBoolean(req.body.isActive);
      shouldUpdateUser = true;
    }

    if (shouldUpdateUser) {
      await db.collection("users").updateOne(
        { role: "client", clientId },
        {
          $set: userPatch,
          $setOnInsert: {
            role: "client",
            clientId,
            createdAt: now,
          },
        },
        { upsert: true },
      );
    }

    res.json(await buildAdminState(db));
  }),
);

app.delete(
  "/api/admin/clients/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const clientId = objectIdFromParam(req.params.id);

    await Promise.all([
      db.collection("dashboards").deleteMany({ clientId }),
      db.collection("users").deleteMany({ role: "client", clientId }),
      db.collection("clients").deleteOne({ _id: clientId }),
    ]);

    res.json(await buildAdminState(db));
  }),
);

app.post(
  "/api/admin/dashboards",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const now = new Date();
    const clientId = objectIdFromParam(req.body.clientId);
    const title = cleanString(req.body.title);
    const url = normalizeDashboardUrl(req.body.url);

    if (!title) {
      res.status(400).json({ error: "Название дашборда не может быть пустым" });
      return;
    }

    const client = await db.collection("clients").findOne({ _id: clientId });
    if (!client) {
      res.status(404).json({ error: "Клиент не найден" });
      return;
    }

    await db.collection("dashboards").insertOne({
      clientId,
      title,
      description: cleanString(req.body.description),
      url,
      filtersEnabled: toBoolean(req.body.filtersEnabled, false),
      sortOrder: Number.parseInt(req.body.sortOrder || "0", 10) || 0,
      isActive: toBoolean(req.body.isActive, true),
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json(await buildAdminState(db));
  }),
);

app.patch(
  "/api/admin/dashboards/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const dashboardId = objectIdFromParam(req.params.id);
    const patch = { updatedAt: new Date() };

    if (req.body.clientId !== undefined) {
      patch.clientId = objectIdFromParam(req.body.clientId);
    }

    if (req.body.title !== undefined) {
      const title = cleanString(req.body.title);
      if (!title) {
        res.status(400).json({ error: "Название дашборда не может быть пустым" });
        return;
      }
      patch.title = title;
    }

    if (req.body.description !== undefined) {
      patch.description = cleanString(req.body.description);
    }

    if (req.body.url !== undefined) {
      patch.url = normalizeDashboardUrl(req.body.url);
    }

    if (req.body.filtersEnabled !== undefined) {
      patch.filtersEnabled = toBoolean(req.body.filtersEnabled, false);
    }

    if (req.body.sortOrder !== undefined) {
      patch.sortOrder = Number.parseInt(req.body.sortOrder || "0", 10) || 0;
    }

    if (req.body.isActive !== undefined) {
      patch.isActive = toBoolean(req.body.isActive);
    }

    const result = await db.collection("dashboards").updateOne({ _id: dashboardId }, { $set: patch });
    if (!result.matchedCount) {
      res.status(404).json({ error: "Дашборд не найден" });
      return;
    }

    res.json(await buildAdminState(db));
  }),
);

app.delete(
  "/api/admin/dashboards/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const dashboardId = objectIdFromParam(req.params.id);

    await db.collection("dashboards").deleteOne({ _id: dashboardId });
    res.json(await buildAdminState(db));
  }),
);

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  if (error?.code === 11000) {
    res.status(409).json({ error: "Такой логин или slug уже существует" });
    return;
  }

  const status = error.status || 500;
  res.status(status).json({
    error: status >= 500 ? "Внутренняя ошибка сервера" : error.message,
  });

  if (status >= 500) {
    console.error(error);
  }
});

const db = await getDb();
await ensureIndexes(db);

app.listen(config.port, () => {
  console.log(`graphics-visible listening on ${config.port}`);
});
