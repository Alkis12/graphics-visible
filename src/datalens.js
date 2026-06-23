import { cleanString } from "./http.js";

const DATALENS_HOSTS = new Set(["datalens.yandex", "datalens.ru"]);

function datalensError() {
  const error = new Error("Введите ссылку, iframe-код или id DataLens");
  error.status = 400;
  return error;
}

export function normalizeDatalensId(value) {
  const input = cleanString(value);

  if (!input) {
    throw datalensError();
  }

  const iframeSrc = input.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  const candidate = cleanString(iframeSrc || input);

  let id = "";
  try {
    const parsed = new URL(candidate);
    if (!DATALENS_HOSTS.has(parsed.hostname)) {
      throw datalensError();
    }
    id = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } catch (error) {
    if (candidate.includes("://") || candidate.includes("<")) {
      throw datalensError();
    }
    id = candidate.replace(/^datalens\.(?:yandex|ru)\//i, "").split(/[/?#]/)[0] || "";
  }

  id = id.split("-")[0];
  if (!/^[a-z0-9]{8,}$/i.test(id)) {
    throw datalensError();
  }

  return id;
}

export function buildDatalensUrl(datalensId) {
  return `https://datalens.yandex/${normalizeDatalensId(datalensId)}`;
}
