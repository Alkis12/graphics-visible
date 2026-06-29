import path from "node:path";
import { fileURLToPath } from "node:url";
import MongoStore from "connect-mongo";
import express from "express";
import session from "express-session";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { buildDatalensUrl, normalizeDatalensId } from "./datalens.js";
import { ensureIndexes, getDb } from "./db.js";
import { DEFAULT_CLIENT, DEFAULT_DASHBOARD_TABS, DEFAULT_DASHBOARDS } from "./defaultDashboards.js";
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

const DEFAULT_CLIENT_DESIGN = {
  brandText: "Одеон",
  logoDataUrl: "",
  colors: {
    background: "#000000",
    surface: "#111111",
    surfaceSoft: "#1c1c1c",
    surfaceStrong: "#252525",
    text: "#ffffff",
    mutedText: "#adadad",
    primary: "#e8cd7d",
    primaryStrong: "#eba611",
    primaryText: "#111111",
    border: "#343434",
    frameBackground: "#151515",
  },
};

const DESIGN_COLOR_KEYS = Object.keys(DEFAULT_CLIENT_DESIGN.colors);
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const LOGO_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i;

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "2mb" }));
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

function normalizeHexColor(value, fallback) {
  const color = cleanString(value || fallback).toLowerCase();
  return HEX_COLOR_RE.test(color) ? color : fallback;
}

function serializeDesign(design = {}) {
  const savedColors = design.colors || {};
  const brandText = cleanString(design.brandText);

  return {
    brandText: /^odeon$/i.test(brandText) ? "Одеон" : brandText || DEFAULT_CLIENT_DESIGN.brandText,
    logoDataUrl: cleanString(design.logoDataUrl),
    colors: DESIGN_COLOR_KEYS.reduce(
      (acc, key) => ({
        ...acc,
        [key]: normalizeHexColor(savedColors[key], DEFAULT_CLIENT_DESIGN.colors[key]),
      }),
      {},
    ),
  };
}

function normalizeDesignInput(body = {}) {
  const design = serializeDesign(body);
  const logoDataUrl = cleanString(body.logoDataUrl);

  if (logoDataUrl && logoDataUrl.length > 1_200_000) {
    const error = new Error("Лого слишком большое, загрузите файл до 900 КБ");
    error.status = 400;
    throw error;
  }

  if (logoDataUrl && !LOGO_DATA_URL_RE.test(logoDataUrl)) {
    const error = new Error("Лого должно быть картинкой png, jpg, webp, gif или svg");
    error.status = 400;
    throw error;
  }

  design.logoDataUrl = logoDataUrl;
  const brandText = cleanString(body.brandText);
  design.brandText = /^odeon$/i.test(brandText) ? "Одеон" : brandText || DEFAULT_CLIENT_DESIGN.brandText;

  if (body.colors) {
    for (const key of DESIGN_COLOR_KEYS) {
      const color = cleanString(body.colors[key]);
      if (!HEX_COLOR_RE.test(color)) {
        const error = new Error("Цвета должны быть в формате #RRGGBB");
        error.status = 400;
        throw error;
      }
      design.colors[key] = color.toLowerCase();
    }
  }

  return design;
}

function serializeClient(client, user = null, tabs = []) {
  return {
    id: String(client._id),
    name: client.name,
    slug: client.slug,
    design: serializeDesign(client.design),
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
    tabs,
  };
}

function serializeDashboardTab(tab, dashboards = []) {
  return {
    id: String(tab._id),
    clientId: String(tab.clientId),
    key: tab.key || "",
    title: tab.title,
    sortOrder: tab.sortOrder || 0,
    isActive: tab.isActive !== false,
    createdAt: tab.createdAt,
    updatedAt: tab.updatedAt,
    dashboards: dashboards.map(serializeDashboard),
  };
}

function serializeDashboard(dashboard) {
  let datalensId = dashboard.datalensId || "";
  if (!datalensId && dashboard.url) {
    try {
      datalensId = normalizeDatalensId(dashboard.url);
    } catch {
      datalensId = "";
    }
  }
  return {
    id: String(dashboard._id),
    clientId: String(dashboard.clientId),
    tabId: dashboard.tabId ? String(dashboard.tabId) : null,
    title: dashboard.title,
    description: dashboard.description || "",
    datalensId,
    url: datalensId ? buildDatalensUrl(datalensId) : dashboard.url || "",
    sourceInput: dashboard.sourceInput || dashboard.url || "",
    filtersEnabled: dashboard.filtersEnabled === true,
    sortOrder: dashboard.sortOrder || 0,
    isActive: dashboard.isActive !== false,
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
  };
}

async function buildAdminState(db) {
  const [clients, users, tabs, dashboards] = await Promise.all([
    db.collection("clients").find().sort({ name: 1 }).toArray(),
    db.collection("users").find({ role: "client" }).sort({ username: 1 }).toArray(),
    db.collection("dashboardTabs").find().sort({ sortOrder: 1, title: 1 }).toArray(),
    db.collection("dashboards").find().sort({ sortOrder: 1, title: 1 }).toArray(),
  ]);

  const usersByClientId = new Map(users.map((user) => [String(user.clientId), user]));
  const dashboardsByTabId = dashboards.reduce((acc, dashboard) => {
    const key = String(dashboard.tabId);
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key).push(dashboard);
    return acc;
  }, new Map());
  const tabsByClientId = tabs.reduce((acc, tab) => {
    const key = String(tab.clientId);
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key).push(tab);
    return acc;
  }, new Map());

  return {
    clients: clients.map((client) =>
      serializeClient(
        client,
        usersByClientId.get(String(client._id)) || null,
        (tabsByClientId.get(String(client._id)) || []).map((tab) =>
          serializeDashboardTab(tab, dashboardsByTabId.get(String(tab._id)) || []),
        ),
      ),
    ),
    tabs: tabs.map((tab) => serializeDashboardTab(tab, dashboardsByTabId.get(String(tab._id)) || [])),
    dashboards: dashboards.map(serializeDashboard),
  };
}

function normalizeDashboardInput(value) {
  const sourceInput = cleanString(value);
  return {
    datalensId: normalizeDatalensId(sourceInput),
    sourceInput,
  };
}

async function upsertDashboardTab(db, clientId, tab) {
  const now = new Date();
  const result = await db.collection("dashboardTabs").findOneAndUpdate(
    { clientId, key: tab.key },
    {
      $set: {
        clientId,
        key: tab.key,
        updatedAt: now,
      },
      $setOnInsert: {
        title: tab.title,
        sortOrder: tab.sortOrder || 0,
        isActive: tab.isActive !== false,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  return result.value || (await db.collection("dashboardTabs").findOne({ clientId, key: tab.key }));
}

async function migrateDashboardTabs(db) {
  const now = new Date();
  const clients = await db.collection("clients").find().toArray();
  const odeonClient = clients.find((client) => client.slug === DEFAULT_CLIENT.slug);
  const odeonTabIdsByKey = new Map();

  if (odeonClient) {
    for (const tab of DEFAULT_DASHBOARD_TABS) {
      const savedTab = await upsertDashboardTab(db, odeonClient._id, tab);
      odeonTabIdsByKey.set(tab.key, savedTab._id);
    }

    for (const dashboard of DEFAULT_DASHBOARDS) {
      const tabId = odeonTabIdsByKey.get(dashboard.tabKey);
      if (!tabId) {
        continue;
      }

      await db.collection("dashboards").updateOne(
        { clientId: odeonClient._id, key: dashboard.key },
        {
          $set: {
            clientId: odeonClient._id,
            tabId,
            key: dashboard.key,
            updatedAt: now,
          },
          $setOnInsert: {
            title: dashboard.title,
            description: dashboard.description || "",
            datalensId: dashboard.datalensId,
            sourceInput: dashboard.datalensId,
            filtersEnabled: dashboard.filtersEnabled === true,
            sortOrder: dashboard.sortOrder || 0,
            isActive: true,
            createdAt: now,
          },
        },
        { upsert: true },
      );
    }
  }

  for (const client of clients) {
    let fallbackTab = await db.collection("dashboardTabs").findOne({ clientId: client._id }, { sort: { sortOrder: 1 } });
    if (!fallbackTab) {
      fallbackTab = await upsertDashboardTab(db, client._id, {
        key: "dashboards",
        title: "Дашборды",
        sortOrder: 10,
      });
    }

    const dashboards = await db.collection("dashboards").find({ clientId: client._id }).toArray();
    for (const dashboard of dashboards) {
      const patch = { updatedAt: now };

      if (!dashboard.tabId) {
        patch.tabId =
          client.slug === DEFAULT_CLIENT.slug && dashboard.key
            ? odeonTabIdsByKey.get(DEFAULT_DASHBOARDS.find((item) => item.key === dashboard.key)?.tabKey) || fallbackTab._id
            : fallbackTab._id;
      }

      if (!dashboard.datalensId) {
        const source = dashboard.url || dashboard.sourceInput || "";
        if (source) {
          try {
            patch.datalensId = normalizeDatalensId(source);
            patch.sourceInput = dashboard.sourceInput || source;
            patch.url = "";
          } catch {
            // Invalid legacy links stay untouched so the admin can fix them manually.
          }
        }
      }

      if (Object.keys(patch).length > 1) {
        await db.collection("dashboards").updateOne({ _id: dashboard._id }, { $set: patch });
      }
    }
  }
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
    const tabs = await db
      .collection("dashboardTabs")
      .find({ clientId, isActive: { $ne: false } })
      .sort({ sortOrder: 1, title: 1 })
      .toArray();
    const tabIds = tabs.map((tab) => tab._id);
    const dashboards = await db
      .collection("dashboards")
      .find({ clientId, tabId: { $in: tabIds }, isActive: { $ne: false } })
      .sort({ sortOrder: 1, title: 1 })
      .toArray();
    const dashboardsByTabId = dashboards.reduce((acc, dashboard) => {
      const key = String(dashboard.tabId);
      if (!acc.has(key)) {
        acc.set(key, []);
      }
      acc.get(key).push(dashboard);
      return acc;
    }, new Map());

    res.json({
      client: client ? serializeClient(client) : null,
      tabs: tabs.map((tab) => serializeDashboardTab(tab, dashboardsByTabId.get(String(tab._id)) || [])),
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
      design: serializeDesign(),
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

app.patch(
  "/api/admin/clients/:id/design",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const clientId = objectIdFromParam(req.params.id);
    const design = normalizeDesignInput(req.body);

    const result = await db.collection("clients").updateOne(
      { _id: clientId },
      {
        $set: {
          design,
          updatedAt: new Date(),
        },
      },
    );

    if (!result.matchedCount) {
      res.status(404).json({ error: "Клиент не найден" });
      return;
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
      db.collection("dashboardTabs").deleteMany({ clientId }),
      db.collection("dashboards").deleteMany({ clientId }),
      db.collection("users").deleteMany({ role: "client", clientId }),
      db.collection("clients").deleteOne({ _id: clientId }),
    ]);

    res.json(await buildAdminState(db));
  }),
);

app.post(
  "/api/admin/dashboard-tabs",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const now = new Date();
    const clientId = objectIdFromParam(req.body.clientId);
    const title = cleanString(req.body.title);

    if (!title) {
      res.status(400).json({ error: "Название вкладки не может быть пустым" });
      return;
    }

    const client = await db.collection("clients").findOne({ _id: clientId });
    if (!client) {
      res.status(404).json({ error: "Клиент не найден" });
      return;
    }

    await db.collection("dashboardTabs").insertOne({
      clientId,
      title,
      sortOrder: Number.parseInt(req.body.sortOrder || "0", 10) || 0,
      isActive: toBoolean(req.body.isActive, true),
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json(await buildAdminState(db));
  }),
);

app.patch(
  "/api/admin/dashboard-tabs/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const tabId = objectIdFromParam(req.params.id);
    const patch = { updatedAt: new Date() };

    if (req.body.title !== undefined) {
      const title = cleanString(req.body.title);
      if (!title) {
        res.status(400).json({ error: "Название вкладки не может быть пустым" });
        return;
      }
      patch.title = title;
    }

    if (req.body.sortOrder !== undefined) {
      patch.sortOrder = Number.parseInt(req.body.sortOrder || "0", 10) || 0;
    }

    if (req.body.isActive !== undefined) {
      patch.isActive = toBoolean(req.body.isActive);
    }

    const result = await db.collection("dashboardTabs").updateOne({ _id: tabId }, { $set: patch });
    if (!result.matchedCount) {
      res.status(404).json({ error: "Вкладка не найдена" });
      return;
    }

    res.json(await buildAdminState(db));
  }),
);

app.delete(
  "/api/admin/dashboard-tabs/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const db = await getDb();
    const tabId = objectIdFromParam(req.params.id);

    await Promise.all([
      db.collection("dashboards").deleteMany({ tabId }),
      db.collection("dashboardTabs").deleteOne({ _id: tabId }),
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
    const tabId = objectIdFromParam(req.body.tabId);
    const title = cleanString(req.body.title);
    const dashboardInput = normalizeDashboardInput(req.body.url || req.body.datalensId || req.body.sourceInput);

    if (!title) {
      res.status(400).json({ error: "Название дашборда не может быть пустым" });
      return;
    }

    const tab = await db.collection("dashboardTabs").findOne({ _id: tabId });
    if (!tab) {
      res.status(404).json({ error: "Вкладка не найдена" });
      return;
    }

    await db.collection("dashboards").insertOne({
      clientId: tab.clientId,
      tabId,
      title,
      description: cleanString(req.body.description),
      datalensId: dashboardInput.datalensId,
      sourceInput: dashboardInput.sourceInput,
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

    if (req.body.tabId !== undefined) {
      const tabId = objectIdFromParam(req.body.tabId);
      const tab = await db.collection("dashboardTabs").findOne({ _id: tabId });
      if (!tab) {
        res.status(404).json({ error: "Вкладка не найдена" });
        return;
      }
      patch.tabId = tabId;
      patch.clientId = tab.clientId;
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

    if (req.body.url !== undefined || req.body.datalensId !== undefined || req.body.sourceInput !== undefined) {
      const dashboardInput = normalizeDashboardInput(req.body.url || req.body.datalensId || req.body.sourceInput);
      patch.datalensId = dashboardInput.datalensId;
      patch.sourceInput = dashboardInput.sourceInput;
      patch.url = "";
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
await migrateDashboardTabs(db);

app.listen(config.port, () => {
  console.log(`graphics-visible listening on ${config.port}`);
});
