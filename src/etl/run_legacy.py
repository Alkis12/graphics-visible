from __future__ import annotations

import logging
import re
import sys
from argparse import Namespace
from pathlib import Path
from typing import Any, Callable


LEGACY_DIR = Path(__file__).resolve().parent / "legacy"
if str(LEGACY_DIR) not in sys.path:
    sys.path.insert(0, str(LEGACY_DIR))


Emit = Callable[[dict[str, Any]], None]


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _stage_error(stage: str, element: str, error: BaseException, emit: Emit) -> None:
    emit(
        {
            "type": "stage_error",
            "stage": stage,
            "element": element,
            "message": str(error),
        }
    )


def _stage_success(stage: str, *, element: str = "", detail: str = "", rows_read: int | None = None, emit: Emit) -> None:
    emit(
        {
            "type": "stage_success",
            "stage": stage,
            "element": element,
            "detail": detail,
            "rowsRead": rows_read,
        }
    )


def _extract_row_element(message: str) -> str:
    row_match = re.search(r"\brow\s+(\d+)\b", message, flags=re.IGNORECASE)
    field_match = re.search(r"\bfield\s+([a-zA-Z0-9_]+)", message, flags=re.IGNORECASE)
    parts = []
    if row_match:
        parts.append(f"строка {row_match.group(1)}")
    if field_match:
        parts.append(f"поле {field_match.group(1)}")
    return ", ".join(parts)


def run_google_data(script: dict[str, Any], emit: Emit) -> dict[str, Any]:
    import google_data as legacy

    legacy.setup_logging(_clean(script.get("logLevel")) or legacy.LOG_LEVEL)
    legacy.SPREADSHEET_ID = _clean(script.get("spreadsheetId")) or legacy.SPREADSHEET_ID
    legacy.PG_SCHEMA = _clean(script.get("targetSchema")) or legacy.PG_SCHEMA
    legacy.INSPECT_ONLY = bool(script.get("inspectOnly", False))

    only_sheet = _clean(script.get("sheetRange"))
    if "!" in only_sheet:
        only_sheet = only_sheet.split("!", 1)[0]
    legacy.ONLY_SHEET = only_sheet or None

    try:
        env_path = legacy.load_env_file()
        detail = f".env: {env_path}" if env_path else ".env не найден, используются переменные окружения"
        db_config = legacy.load_db_config_from_env()
        _stage_success("Подготовка окружения", detail=detail, emit=emit)
    except Exception as exc:
        _stage_error("Подготовка окружения", "PLANETRA_DB_*", exc, emit)
        raise

    try:
        tmp_dir = legacy.get_tmp_dir()
        workbook_path = tmp_dir / f"google_sheet_{legacy.SPREADSHEET_ID}.xlsx"
        legacy.download_spreadsheet_xlsx(legacy.SPREADSHEET_ID, workbook_path)
        _stage_success(
            "Подключение к Google Sheets",
            element=legacy.SPREADSHEET_ID,
            detail=f"XLSX скачан: {workbook_path.name}",
            emit=emit,
        )
    except Exception as exc:
        _stage_error("Подключение к Google Sheets", legacy.SPREADSHEET_ID, exc, emit)
        raise

    try:
        workbook = legacy.WorkbookLoader(workbook_path)
        _stage_success(
            "Чтение данных",
            detail=f"Листы workbook: {', '.join(workbook.sheet_names)}",
            emit=emit,
        )
    except Exception as exc:
        _stage_error("Чтение данных", workbook_path.name, exc, emit)
        raise

    total_rows = 0
    sheet_to_table_map = legacy.selected_sheet_map()

    try:
        import psycopg

        with psycopg.connect(
            host=db_config.host,
            port=db_config.port,
            dbname=db_config.dbname,
            user=db_config.user,
            password=db_config.password,
            autocommit=False,
            connect_timeout=15,
        ) as conn:
            for sheet_name, table_name in sheet_to_table_map.items():
                element = f"лист {sheet_name} -> {legacy.PG_SCHEMA}.{table_name}"

                try:
                    table_meta = legacy.get_table_meta(conn, legacy.PG_SCHEMA, table_name)
                    df_raw = workbook.load_sheet_as_dataframe(sheet_name)
                    total_rows += len(df_raw)
                    _stage_success(
                        "Чтение данных",
                        element=sheet_name,
                        detail=f"Считано строк: {len(df_raw)}",
                        rows_read=len(df_raw),
                        emit=emit,
                    )
                except Exception as exc:
                    _stage_error("Чтение данных", element, exc, emit)
                    raise

                try:
                    df_aligned = legacy.align_dataframe_to_table(df_raw, table_meta, sheet_name)
                    _stage_success(
                        "Трансформация",
                        element=element,
                        detail=f"Колонок к загрузке: {len(df_aligned.columns)}",
                        emit=emit,
                    )
                except Exception as exc:
                    _stage_error("Трансформация", element, exc, emit)
                    raise

                if legacy.INSPECT_ONLY:
                    continue

                try:
                    loaded = legacy.replace_dataframe(conn, table_meta, df_aligned)
                    conn.commit()
                    _stage_success(
                        "Запись в БД SCDO",
                        element=element,
                        detail=f"Загружено строк: {loaded}",
                        rows_read=loaded,
                        emit=emit,
                    )
                except Exception as exc:
                    conn.rollback()
                    _stage_error("Запись в БД SCDO", element, exc, emit)
                    raise
    except Exception:
        raise

    return {"rowsRead": total_rows}


def run_marketing_statistics(script: dict[str, Any], emit: Emit) -> dict[str, Any]:
    import load_marketing_statistics as legacy

    args = Namespace(
        sheet_url=_clean(script.get("sourceUrl")) or legacy.DEFAULT_SHEET_URL,
        csv_file=None,
        env_file=None,
        schema=_clean(script.get("targetSchema")) or legacy.DEFAULT_SCHEMA,
        table=_clean(script.get("targetTable")) or legacy.DEFAULT_TABLE,
        timezone=_clean(script.get("timezone")) or legacy.DEFAULT_TIMEZONE,
        mode=_clean(script.get("loadMode")) or "replace",
        conversion_mode=_clean(script.get("conversionMode")) or "percent-points",
        dry_run=bool(script.get("inspectOnly", False)),
        verbose=bool(script.get("verbose", False)),
    )

    legacy.setup_logging(args.verbose)

    try:
        env_path = legacy.find_env_file(args.env_file)
        legacy.load_env_file(env_path)
        _stage_success(
            "Подготовка окружения",
            detail=f".env: {env_path}" if env_path else ".env не найден, используются переменные окружения",
            emit=emit,
        )
    except Exception as exc:
        _stage_error("Подготовка окружения", "PLANETRA_DB_*", exc, emit)
        raise

    try:
        csv_text, source_desc = legacy.read_source_csv(args)
        _stage_success(
            "Подключение к Google Sheets",
            element=source_desc,
            detail="CSV скачан",
            emit=emit,
        )
        _stage_success(
            "Чтение данных",
            element=source_desc,
            detail=f"Получено символов CSV: {len(csv_text)}",
            emit=emit,
        )
    except Exception as exc:
        _stage_error("Подключение к Google Sheets", args.sheet_url, exc, emit)
        raise

    try:
        rows, skipped_blank_metric_rows = legacy.parse_csv_text(
            csv_text,
            timezone_name=args.timezone,
            conversion_mode=args.conversion_mode,
        )
        _stage_success(
            "Трансформация",
            detail=f"Строк к загрузке: {len(rows)}, пропущено пустых: {skipped_blank_metric_rows}",
            rows_read=len(rows),
            emit=emit,
        )
    except Exception as exc:
        _stage_error("Трансформация", _extract_row_element(str(exc)) or "CSV", exc, emit)
        raise

    if args.dry_run:
        return {"rowsRead": len(rows)}

    try:
        legacy.load_into_postgres(rows, args)
        _stage_success(
            "Запись в БД SCDO",
            element=f"{args.schema}.{args.table}",
            detail=f"Загружено строк: {len(rows)}",
            rows_read=len(rows),
            emit=emit,
        )
    except Exception as exc:
        _stage_error("Запись в БД SCDO", f"{args.schema}.{args.table}", exc, emit)
        raise

    return {"rowsRead": len(rows)}


def run_script(script: dict[str, Any], emit: Emit) -> dict[str, Any]:
    handler = _clean(script.get("handler")) or "google_data"
    if handler == "google_data":
        return run_google_data(script, emit)
    if handler == "marketing_statistics":
        return run_marketing_statistics(script, emit)
    raise ValueError(f"Неизвестный ETL handler: {handler}")


logging.getLogger("pymongo").setLevel(logging.WARNING)
