import { config } from "../src/config.js";
import { getDb } from "../src/db.js";
import { DEFAULT_CLIENT } from "../src/defaultDashboards.js";
import { normalizeUsername } from "../src/security.js";

const USERNAME = normalizeUsername(process.env.ODEON_PULSE_USERNAME || "odeon_pulse");
const DASHBOARD_KEYS = ["operational-failures", "daily-check"];

const db = await getDb();
const client = await db.collection("clients").findOne({ slug: DEFAULT_CLIENT.slug });

if (!client) {
  throw new Error(`Client ${DEFAULT_CLIENT.slug} not found in ${config.mongoDb}`);
}

const dashboards = await db
  .collection("dashboards")
  .find({ clientId: client._id, key: { $in: DASHBOARD_KEYS } })
  .toArray();

if (dashboards.length !== DASHBOARD_KEYS.length) {
  throw new Error(`Expected ${DASHBOARD_KEYS.length} dashboards, found ${dashboards.length}`);
}

const user = await db.collection("users").findOne({ username: USERNAME });
if (!user) {
  throw new Error(`User ${USERNAME} not found; create it in the admin interface first`);
}

const now = new Date();
await db.collection("users").updateOne(
  { _id: user._id },
  {
    $set: {
      username: USERNAME,
      role: "client",
      clientId: client._id,
      allowedDashboardIds: dashboards.map((dashboard) => dashboard._id),
      isActive: true,
      updatedAt: now,
    },
  },
);

console.log(
  JSON.stringify(
    {
      username: USERNAME,
      client: client.name,
      dashboardKeys: DASHBOARD_KEYS,
      passwordUpdated: false,
    },
    null,
    2,
  ),
);

process.exit(0);
