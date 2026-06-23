from __future__ import annotations

import logging
import os
import re
import sys
import urllib.error
import urllib.request
from collections import OrderedDict, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg
from psycopg import sql


LOGGER = logging.getLogger("gsheets_pg_sync")

EXIT_CODE_SUCCESS = 0
EXIT_CODE_ERROR = 49

SPREADSHEET_ID = "1x-ET0-UJxwXlSWh9cubA2y__QvIPKUupX50VLIUnMQs"
PG_SCHEMA = "sdco"
LOG_LEVEL = "INFO"
INSPECT_ONLY = False
ONLY_SHEET: str | None = None
TMP_SUBDIR_NAME = "tmp"
DOWNLOAD_TIMEOUT_SECONDS = 120

DEFAULT_SHEET_TO_TABLE_MAP = OrderedDict(
    [
        ("Client", "client"),
        ("Company", "company"),
        ("dbe", "dbe"),
        ("Visibility", "visibility"),
        ("Elasticity", "elasticity"),
        ("Category", "category"),
        ("DateCategory", "datecategory"),
        ("PriceMatrix", "pricematrix"),
        ("Subcategory", "subcategory"),
        ("Seat", "dco_seat"),
        ("Event", "event"),
        ("TypeOfPlace", "typeofplace"),
        ("PriceStep", "pricestep"),
        ("MarketSalesWeek", "market_sales_week"),
        ("relative_price_constraints", "relative_price_constraints"),
        ("category_tree", "category_tree"),
    ]
)

# Add sheet-specific header fixes here if a worksheet header differs from the DB column name.
COLUMN_RENAMES: dict[str, dict[str, str]] = {
    "Seat": {},
}


@dataclass(frozen=True)
class ColumnMeta:
    column_name: str
    data_type: str
    udt_name: str
    is_nullable: bool
    ordinal_position: int


@dataclass(frozen=True)
class TableMeta:
    schema: str
    table_name: str
    columns: OrderedDict[str, ColumnMeta]
    conflict_columns: list[str]


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: int
    dbname: str
    user: str
    password: str


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(message)s",
    )


def normalize_name(value: Any) -> str:
    value = str(value).strip().lower()
    value = value.replace("№", "no")
    value = value.replace("%", "pct")
    value = re.sub(r"[\s\-/\\.]+", "_", value)
    value = re.sub(r"[^0-9a-zа-яё_]", "", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    try:
        return bool(pd.isna(value))
    except Exception:
        return False


def clean_string(value: Any) -> str | None:
    if is_blank(value):
        return None
    return str(value).strip()


def parse_bool(value: Any) -> bool | None:
    if is_blank(value):
        return None
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    true_values = {"1", "true", "t", "yes", "y", "да", "истина"}
    false_values = {"0", "false", "f", "no", "n", "нет", "ложь"}
    if s in true_values:
        return True
    if s in false_values:
        return False
    raise ValueError(f"cannot parse boolean value: {value!r}")


NUMERIC_RE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")


def parse_decimal(value: Any) -> Decimal | None:
    if is_blank(value):
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)) and not pd.isna(value):
        return Decimal(str(value))
    s = str(value).strip().replace(" ", "")
    s = s.replace(",", ".")
    if not NUMERIC_RE.match(s):
        raise ValueError(f"cannot parse numeric value: {value!r}")
    try:
        return Decimal(s)
    except InvalidOperation as exc:
        raise ValueError(f"cannot parse numeric value: {value!r}") from exc


INTEGER_UDTS = {"int2", "int4", "int8", "smallint", "integer", "bigint"}
NUMERIC_UDTS = {"numeric", "float4", "float8", "real", "double precision", "money"}
DATE_UDTS = {"date"}
TIMESTAMP_UDTS = {"timestamp", "timestamptz"}
BOOL_UDTS = {"bool", "boolean"}
TEXT_UDTS = {"text", "varchar", "bpchar", "char", "name"}


def parse_date_like(value: Any, *, want_date: bool) -> date | datetime | None:
    if is_blank(value):
        return None
    if isinstance(value, datetime):
        return value.date() if want_date else value
    if isinstance(value, date):
        if want_date:
            return value
        return datetime.combine(value, datetime.min.time())

    parsed = pd.to_datetime(value, errors="raise", dayfirst=True)
    if pd.isna(parsed):
        return None
    py_value = parsed.to_pydatetime()
    return py_value.date() if want_date else py_value


def convert_value(value: Any, meta: ColumnMeta) -> Any:
    if is_blank(value):
        return None

    udt = meta.udt_name.lower()
    data_type = meta.data_type.lower()

    if udt in BOOL_UDTS or data_type == "boolean":
        return parse_bool(value)

    if udt in INTEGER_UDTS or data_type in {"smallint", "integer", "bigint"}:
        dec = parse_decimal(value)
        if dec is None:
            return None
        return int(dec)

    if udt in NUMERIC_UDTS or data_type in {"numeric", "real", "double precision", "money"}:
        return parse_decimal(value)

    if udt in DATE_UDTS or data_type == "date":
        return parse_date_like(value, want_date=True)

    if udt in TIMESTAMP_UDTS or data_type.startswith("timestamp"):
        return parse_date_like(value, want_date=False)

    if udt in TEXT_UDTS or "character" in data_type or data_type == "text":
        return clean_string(value)

    return clean_string(value)


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def candidate_env_paths() -> list[Path]:
    current_dir = script_dir()
    return [current_dir / ".env", current_dir.parent / ".env"]


def load_env_file() -> Path | None:
    for env_path in candidate_env_paths():
        if env_path.is_file():
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and ((value[0] == value[-1]) and value[0] in {"'", '"'}):
                    value = value[1:-1]
                os.environ.setdefault(key, value)
            return env_path
    return None


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable is missing or empty: {name}")
    return value


def load_db_config_from_env() -> DbConfig:
    return DbConfig(
        host=require_env("PLANETRA_DB_HOST"),
        port=int(require_env("PLANETRA_DB_PORT")),
        dbname=require_env("PLANETRA_DB_NAME"),
        user=require_env("PLANETRA_DB_USER"),
        password=require_env("PLANETRA_DB_PASSWORD"),
    )


def get_tmp_dir() -> Path:
    path = script_dir() / TMP_SUBDIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_export_url(spreadsheet_id: str) -> str:
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx"


def download_spreadsheet_xlsx(spreadsheet_id: str, target_path: Path) -> None:
    url = build_export_url(spreadsheet_id)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            content_type = response.headers.get("Content-Type", "")
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Failed to download spreadsheet: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to download spreadsheet: {exc}") from exc

    if not body:
        raise RuntimeError("Downloaded spreadsheet is empty")

    if "text/html" in content_type.lower():
        preview = body[:300].decode("utf-8", errors="replace")
        raise RuntimeError(
            "Spreadsheet download returned HTML instead of XLSX. "
            f"Response preview: {preview!r}"
        )

    target_path.write_bytes(body)


class WorkbookLoader:
    def __init__(self, workbook_path: Path) -> None:
        self.workbook_path = workbook_path
        self.excel_file = pd.ExcelFile(workbook_path, engine="openpyxl")
        self.sheet_names = list(self.excel_file.sheet_names)

    def load_sheet_as_dataframe(self, sheet_name: str) -> pd.DataFrame:
        if sheet_name not in self.sheet_names:
            raise RuntimeError(
                f"Worksheet '{sheet_name}' not found in downloaded workbook. Available sheets: {self.sheet_names}"
            )

        df = self.excel_file.parse(sheet_name=sheet_name, dtype=object)
        if df.empty and len(df.columns) == 0:
            return pd.DataFrame()

        df.columns = [normalize_name(col) for col in df.columns]

        blank_mask = df.apply(lambda row: all(is_blank(v) for v in row), axis=1)
        df = df.loc[~blank_mask].copy()

        rename_map = {
            normalize_name(k): normalize_name(v)
            for k, v in COLUMN_RENAMES.get(sheet_name, {}).items()
        }
        if rename_map:
            df = df.rename(columns=rename_map)

        return df



def get_table_meta(conn: psycopg.Connection, schema: str, table_name: str) -> TableMeta:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, data_type, udt_name, is_nullable, ordinal_position
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, table_name),
        )
        rows = cur.fetchall()

    if not rows:
        raise RuntimeError(f"Table {schema}.{table_name} not found in information_schema.columns")

    columns: OrderedDict[str, ColumnMeta] = OrderedDict()
    for column_name, data_type, udt_name, is_nullable, ordinal_position in rows:
        columns[column_name] = ColumnMeta(
            column_name=column_name,
            data_type=data_type,
            udt_name=udt_name,
            is_nullable=(is_nullable == "YES"),
            ordinal_position=ordinal_position,
        )

    conflict_columns = get_conflict_columns(conn, schema, table_name)
    return TableMeta(schema=schema, table_name=table_name, columns=columns, conflict_columns=conflict_columns)



def get_conflict_columns(conn: psycopg.Connection, schema: str, table_name: str) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                tc.constraint_name,
                tc.constraint_type,
                kcu.column_name,
                kcu.ordinal_position
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
             AND tc.table_name = kcu.table_name
            WHERE tc.table_schema = %s
              AND tc.table_name = %s
              AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
            ORDER BY
              CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 0 ELSE 1 END,
              tc.constraint_name,
              kcu.ordinal_position
            """,
            (schema, table_name),
        )
        rows = cur.fetchall()

    grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
    for constraint_name, constraint_type, column_name, _ordinal in rows:
        grouped[(constraint_name, constraint_type)].append(column_name)

    if not grouped:
        return []

    return next(iter(grouped.values()))



def align_dataframe_to_table(df: pd.DataFrame, table_meta: TableMeta, sheet_name: str) -> pd.DataFrame:
    db_columns = list(table_meta.columns.keys())
    sheet_columns = list(df.columns)

    extra_columns = [c for c in sheet_columns if c not in table_meta.columns]
    missing_columns = [c for c in db_columns if c not in df.columns]

    if extra_columns:
        LOGGER.warning(
            "Лист '%s' -> %s.%s: лишние колонки будут пропущены: %s",
            sheet_name,
            table_meta.schema,
            table_meta.table_name,
            extra_columns,
        )

    missing_required = [
        c
        for c in missing_columns
        if not table_meta.columns[c].is_nullable and c not in table_meta.conflict_columns
    ]
    if missing_required:
        LOGGER.warning(
            "Лист '%s' -> %s.%s: отсутствуют обязательные ненулевые колонки: %s",
            sheet_name,
            table_meta.schema,
            table_meta.table_name,
            missing_required,
        )

    kept_columns = [c for c in sheet_columns if c in table_meta.columns]
    aligned = df[kept_columns].copy()

    conversion_errors: list[str] = []
    for column in kept_columns:
        meta = table_meta.columns[column]
        converted_values = []
        for row_idx, raw_value in enumerate(aligned[column].tolist(), start=2):
            try:
                converted_values.append(convert_value(raw_value, meta))
            except Exception as exc:
                conversion_errors.append(
                    f"sheet={sheet_name}, row={row_idx}, column={column}, value={raw_value!r}, target_type={meta.data_type}/{meta.udt_name}, error={exc}"
                )
                converted_values.append(None)
        aligned[column] = converted_values

    if conversion_errors:
        preview = conversion_errors[:20]
        for item in preview:
            LOGGER.warning("Ошибка конвертации: %s", item)
        if len(conversion_errors) > len(preview):
            LOGGER.warning("Еще %s ошибок конвертации скрыто в логе", len(conversion_errors) - len(preview))

    return aligned



def inspect_table(table_meta: TableMeta) -> None:
    LOGGER.info("Таблица %s.%s", table_meta.schema, table_meta.table_name)
    LOGGER.info("  conflict columns: %s", table_meta.conflict_columns)
    for col in table_meta.columns.values():
        LOGGER.info(
            "  - %s | %s (%s) | nullable=%s",
            col.column_name,
            col.data_type,
            col.udt_name,
            col.is_nullable,
        )





def sanitize_sql_value(value: Any) -> Any:
    if is_blank(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.to_pydatetime()
    return value

def replace_dataframe(conn: psycopg.Connection, table_meta: TableMeta, df: pd.DataFrame) -> int:
    truncate_sql = sql.SQL("TRUNCATE TABLE {}.{} RESTART IDENTITY").format(
        sql.Identifier(table_meta.schema),
        sql.Identifier(table_meta.table_name),
    )

    with conn.cursor() as cur:
        cur.execute(truncate_sql)

    if df.empty:
        return 0

    columns = list(df.columns)
    if not columns:
        LOGGER.warning(
            "Таблица %s.%s: после выравнивания не осталось колонок для загрузки",
            table_meta.schema,
            table_meta.table_name,
        )
        return 0

    insert_sql = sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
        sql.Identifier(table_meta.schema),
        sql.Identifier(table_meta.table_name),
        sql.SQL(", ").join(sql.Identifier(c) for c in columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
    )

    records = [
        tuple(sanitize_sql_value(value) for value in row)
        for row in df.itertuples(index=False, name=None)
    ]

    with conn.cursor() as cur:
        cur.executemany(insert_sql, records)

    return len(records)



def selected_sheet_map() -> OrderedDict[str, str]:
    if ONLY_SHEET is None:
        return DEFAULT_SHEET_TO_TABLE_MAP

    filtered = OrderedDict(
        (sheet, table)
        for sheet, table in DEFAULT_SHEET_TO_TABLE_MAP.items()
        if sheet == ONLY_SHEET
    )
    if not filtered:
        raise RuntimeError(f"Unknown sheet name in ONLY_SHEET: {ONLY_SHEET}")
    return filtered



def main() -> int:
    setup_logging(LOG_LEVEL)

    env_path = load_env_file()
    if env_path is not None:
        LOGGER.info("Loaded .env from %s", env_path)
    else:
        LOGGER.info(".env not found next to the script or in the parent directory; using current process environment")

    db_config = load_db_config_from_env()
    sheet_to_table_map = selected_sheet_map()

    tmp_dir = get_tmp_dir()
    workbook_path = tmp_dir / f"google_sheet_{SPREADSHEET_ID}.xlsx"
    download_spreadsheet_xlsx(SPREADSHEET_ID, workbook_path)
    LOGGER.info("Downloaded spreadsheet to %s", workbook_path)

    workbook = WorkbookLoader(workbook_path)
    LOGGER.info("Workbook sheets: %s", workbook.sheet_names)

    LOGGER.info(
        "Подключение к PostgreSQL %s:%s / db=%s / schema=%s",
        db_config.host,
        db_config.port,
        db_config.dbname,
        PG_SCHEMA,
    )

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
            LOGGER.info("\n=== %s -> %s.%s ===", sheet_name, PG_SCHEMA, table_name)

            table_meta = get_table_meta(conn, PG_SCHEMA, table_name)

            df_raw = workbook.load_sheet_as_dataframe(sheet_name)
            LOGGER.info("Лист '%s': считано %s строк(и)", sheet_name, len(df_raw))

            df_aligned = align_dataframe_to_table(df_raw, table_meta, sheet_name)

            if INSPECT_ONLY:
                continue

            loaded = replace_dataframe(conn, table_meta, df_aligned)
            conn.commit()
            LOGGER.info("Таблица заменена, загружено строк: %s", loaded)

    return EXIT_CODE_SUCCESS


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        LOGGER.error("Interrupted by user")
        sys.exit(EXIT_CODE_ERROR)
    except Exception:
        LOGGER.exception("Script failed")
        sys.exit(EXIT_CODE_ERROR)
