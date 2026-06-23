import { ObjectId } from "mongodb";
import { config } from "../config.js";
import { getDb } from "../db.js";

const STAGES = [
  "Подключение к источнику",
  "Чтение данных",
  "Трансформация",
  "Запись в БД SCDO",
];

const activeRuns = new Set();

function serializeError(error, stageName) {
  return {
    stage: error.stage || stageName,
    element: error.element || null,
    message: error.message || "Неизвестная ошибка",
    stack: error.stack || null,
  };
}

async function patchRun(db, runId, patch) {
  await db.collection("etlRuns").updateOne({ _id: runId }, { $set: patch });
}

async function appendStage(db, runId, stage) {
  await db.collection("etlRuns").updateOne({ _id: runId }, { $push: { stages: stage } });
}

async function runLegacyAdapter(script, stageName) {
  if (script.mockFailureStage && script.mockFailureStage === stageName) {
    const error = new Error(`Тестовая ошибка на этапе "${stageName}"`);
    error.stage = stageName;
    error.element = script.mockFailureElement || "строка 1";
    throw error;
  }

  if (stageName === "Чтение данных") {
    return {
      rowsRead: Number.parseInt(script.expectedRows || "0", 10) || 0,
      detail: script.spreadsheetId
        ? `Google Sheets ${script.spreadsheetId}, диапазон ${script.sheetRange || "не задан"}`
        : "Источник пока не подключен",
    };
  }

  return {};
}

export async function startEtlRun({ script, user, source = {} }) {
  const db = await getDb();
  const now = new Date();
  const run = {
    scriptId: script._id,
    clientId: script.clientId,
    scriptName: script.name,
    sourceType: source.type || script.sourceType || "googleSheets",
    sourceName: source.name || script.spreadsheetId || "",
    status: "queued",
    startedBy: {
      userId: new ObjectId(user.id),
      username: user.username,
      role: user.role,
    },
    rowsRead: 0,
    stages: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };

  const result = await db.collection("etlRuns").insertOne(run);
  run._id = result.insertedId;
  if (config.etlExecutionMode !== "external") {
    queueMicrotask(() => runEtlJob(result.insertedId, script).catch(console.error));
  }
  return run;
}

async function runEtlJob(runId, script) {
  const runKey = String(runId);
  if (activeRuns.has(runKey)) {
    return;
  }

  activeRuns.add(runKey);
  const db = await getDb();

  try {
    await patchRun(db, runId, {
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
    });

    for (const stageName of STAGES) {
      const startedAt = new Date();
      try {
        const result = await runLegacyAdapter(script, stageName);
        const finishedAt = new Date();
        await appendStage(db, runId, {
          name: stageName,
          status: "success",
          detail: result.detail || "",
          rowsRead: result.rowsRead ?? null,
          startedAt,
          finishedAt,
        });

        if (result.rowsRead !== undefined) {
          await patchRun(db, runId, { rowsRead: result.rowsRead, updatedAt: finishedAt });
        }
      } catch (error) {
        const serializedError = serializeError(error, stageName);
        const finishedAt = new Date();
        await appendStage(db, runId, {
          name: stageName,
          status: "error",
          detail: "",
          error: serializedError,
          startedAt,
          finishedAt,
        });
        await patchRun(db, runId, {
          status: "error",
          error: serializedError,
          finishedAt,
          updatedAt: finishedAt,
        });
        return;
      }
    }

    const finishedAt = new Date();
    await patchRun(db, runId, {
      status: "success",
      finishedAt,
      updatedAt: finishedAt,
    });
  } finally {
    activeRuns.delete(runKey);
  }
}
