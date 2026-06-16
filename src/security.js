import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export async function hashPassword(password) {
  return bcrypt.hash(String(password), config.bcryptRounds);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(String(password), passwordHash);
}

export function generatePassword(length = 18) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join("");
}
