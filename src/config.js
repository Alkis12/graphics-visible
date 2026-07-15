import dotenv from "dotenv";

dotenv.config();

function integerFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: integerFromEnv("PORT", 3000),
  mongoUrl: requiredEnv("MONGO_URL"),
  mongoDb: process.env.MONGO_DB || "graphics_visible",
  sessionSecret: requiredEnv("SESSION_SECRET"),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  trustProxy: process.env.TRUST_PROXY === "true",
  bcryptRounds: integerFromEnv("BCRYPT_ROUNDS", 12),
  etlExecutionMode: process.env.ETL_EXECUTION_MODE || "inline",
};
