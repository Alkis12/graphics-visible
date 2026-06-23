import { MongoClient } from "mongodb";
import { config } from "./config.js";

let clientPromise;

export function getMongoClient() {
  if (!clientPromise) {
    const client = new MongoClient(config.mongoUrl);
    clientPromise = client.connect();
  }

  return clientPromise;
}

export async function getDb() {
  const client = await getMongoClient();
  return client.db(config.mongoDb);
}

export async function ensureIndexes(db) {
  await Promise.all([
    db.collection("clients").createIndex({ slug: 1 }, { unique: true }),
    db.collection("users").createIndex({ username: 1 }, { unique: true }),
    db.collection("users").createIndex({ role: 1, clientId: 1 }),
    db.collection("dashboardTabs").createIndex({ clientId: 1, sortOrder: 1, title: 1 }),
    db
      .collection("dashboardTabs")
      .createIndex(
        { clientId: 1, key: 1 },
        { unique: true, partialFilterExpression: { key: { $exists: true } } },
      ),
    db.collection("dashboards").createIndex({ clientId: 1, sortOrder: 1 }),
    db.collection("dashboards").createIndex({ tabId: 1, sortOrder: 1 }),
    db.collection("etlScripts").createIndex({ clientId: 1, sortOrder: 1, name: 1 }),
    db.collection("etlScripts").createIndex({ clientId: 1, key: 1 }, { unique: true }),
    db.collection("etlRuns").createIndex({ clientId: 1, createdAt: -1 }),
    db.collection("etlRuns").createIndex({ "startedBy.userId": 1, createdAt: -1 }),
    db.collection("etlRuns").createIndex({ scriptId: 1, createdAt: -1 }),
    db
      .collection("dashboards")
      .createIndex(
        { clientId: 1, key: 1 },
        { unique: true, partialFilterExpression: { key: { $exists: true } } },
      ),
  ]);
}
