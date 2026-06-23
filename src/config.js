import dotenv from "dotenv";

dotenv.config();

function integerFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: integerFromEnv("PORT", 3000),
  mongoUrl: process.env.MONGO_URL || "mongodb://127.0.0.1:27017/planetra_dashboards",
  mongoDb: process.env.MONGO_DB || "planetra_dashboards",
  sessionSecret:
    process.env.SESSION_SECRET ||
    "",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  bcryptRounds: integerFromEnv("BCRYPT_ROUNDS", 12),
  etlExecutionMode: process.env.ETL_EXECUTION_MODE || "inline",
};
