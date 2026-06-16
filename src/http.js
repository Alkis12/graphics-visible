import { ObjectId } from "mongodb";

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }

  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session.user) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
    return;
  }

  if (req.session.user.role !== "admin") {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }

  next();
}

export function objectIdFromParam(value) {
  if (!ObjectId.isValid(value)) {
    const error = new Error("Invalid identifier");
    error.status = 400;
    throw error;
  }

  return new ObjectId(value);
}

export function cleanString(value) {
  return String(value || "").trim();
}

export function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function toBoolean(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value === "true" || value === "1" || value === 1;
}
