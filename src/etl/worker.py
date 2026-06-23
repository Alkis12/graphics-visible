from __future__ import annotations

import logging
import os
import time
import traceback
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from pymongo import MongoClient, ReturnDocument

from run_legacy import run_script


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(message)s",
)
LOGGER = logging.getLogger("etl_worker")


def now() -> datetime:
    return datetime.now(timezone.utc)


def mongo_db():
    mongo_url = os.getenv("MONGO_URL", "mongodb://127.0.0.1:27017/planetra_dashboards")
    mongo_db_name = os.getenv("MONGO_DB", "planetra_dashboards")
    return MongoClient(mongo_url)[mongo_db_name]


def stage_doc(event: dict[str, Any]) -> dict[str, Any]:
    finished_at = now()
    doc = {
        "name": event["stage"],
        "status": "success" if event["type"] == "stage_success" else "error",
        "detail": event.get("detail", ""),
        "element": event.get("element", ""),
        "rowsRead": event.get("rowsRead"),
        "startedAt": finished_at,
        "finishedAt": finished_at,
    }
    if event["type"] == "stage_error":
        doc["error"] = {
            "stage": event["stage"],
            "element": event.get("element", ""),
            "message": event.get("message", ""),
        }
    return doc


def set_run_error(db, run_id: ObjectId, error: BaseException, last_event: dict[str, Any] | None) -> None:
    error_doc = {
        "stage": last_event.get("stage") if last_event else "Выполнение",
        "element": last_event.get("element") if last_event else "",
        "message": str(error),
        "stack": traceback.format_exc(),
    }
    db.etlRuns.update_one(
        {"_id": run_id},
        {
            "$set": {
                "status": "error",
                "error": error_doc,
                "finishedAt": now(),
                "updatedAt": now(),
            }
        },
    )


def process_run(db, run: dict[str, Any]) -> None:
    run_id = run["_id"]
    script = db.etlScripts.find_one({"_id": run["scriptId"]})
    if not script:
        raise RuntimeError(f"ETL script not found: {run.get('scriptId')}")

    last_event: dict[str, Any] | None = None

    def emit(event: dict[str, Any]) -> None:
        nonlocal last_event
        last_event = event
        LOGGER.info("%s | %s | %s", event["type"], event.get("stage"), event.get("element", ""))
        db.etlRuns.update_one(
            {"_id": run_id},
            {
                "$push": {"stages": stage_doc(event)},
                "$set": {"updatedAt": now()},
            },
        )
        if event.get("rowsRead") is not None:
            db.etlRuns.update_one({"_id": run_id}, {"$set": {"rowsRead": event["rowsRead"], "updatedAt": now()}})

    try:
        result = run_script(script, emit)
        db.etlRuns.update_one(
            {"_id": run_id},
            {
                "$set": {
                    "status": "success",
                    "rowsRead": result.get("rowsRead", run.get("rowsRead", 0)),
                    "finishedAt": now(),
                    "updatedAt": now(),
                }
            },
        )
    except Exception as exc:
        if last_event and last_event.get("type") == "stage_error":
            set_run_error(db, run_id, exc, last_event)
        else:
            emit(
                {
                    "type": "stage_error",
                    "stage": "Выполнение",
                    "element": "",
                    "message": str(exc),
                }
            )
            set_run_error(db, run_id, exc, last_event)
        LOGGER.exception("ETL run failed: %s", run_id)


def claim_next_run(db) -> dict[str, Any] | None:
    return db.etlRuns.find_one_and_update(
        {"status": "queued"},
        {
            "$set": {
                "status": "running",
                "startedAt": now(),
                "updatedAt": now(),
            }
        },
        sort=[("createdAt", 1)],
        return_document=ReturnDocument.AFTER,
    )


def main() -> None:
    db = mongo_db()
    poll_seconds = float(os.getenv("ETL_POLL_SECONDS", "3"))
    LOGGER.info("ETL worker started")

    while True:
        run = claim_next_run(db)
        if run:
            process_run(db, run)
            continue
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
