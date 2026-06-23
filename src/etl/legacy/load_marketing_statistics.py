#!/usr/bin/env python3
"""
Load the public Google Sheets tab with Odeon marketing statistics into PostgreSQL.

Source format handled by this script:
- CSV exported from a public Google Sheets tab, without using the Google API.
- Dates in DD.MM.YYYY format.
- Numeric values with regular spaces / non-breaking spaces as thousands separators.
- Comma decimals.
- Conversion values shown as percentages, for example: 3,19%.

Default behavior:
- Downloads the configured public Google Sheets tab as CSV.
- Skips future/blank metric rows where only the date is filled.
- Replaces sdco."Marketing_Statistics" inside one transaction.

Required environment variables:
PLANETRA_DB_HOST, PLANETRA_DB_PORT, PLANETRA_DB_NAME, PLANETRA_DB_USER, PLANETRA_DB_PASSWORD
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1YD5InDyu3oKeE6bCp-FR95TdAw_307QfsmxZ6ZKsyHE/edit?pli=1&gid=1430528172#gid=1430528172"
DEFAULT_SCHEMA = "sdco"
DEFAULT_TABLE = "Marketing_Statistics"
DEFAULT_TIMEZONE = "Europe/Moscow"

REQUIRED_COLUMNS = [
    "date",
    "sales",
    "revenue",
    "avg_check",
    "conversions",
    "ad_budget",
    "price_per_sale",
]
METRIC_COLUMNS = [c for c in REQUIRED_COLUMNS if c != "date"]
REQUIRED_ENV_VARS = [
    "PLANETRA_DB_HOST",
    "PLANETRA_DB_PORT",
    "PLANETRA_DB_NAME",
    "PLANETRA_DB_USER",
    "PLANETRA_DB_PASSWORD",
]


@dataclass(frozen=True)
class ParsedRow:
    date: datetime
    sales: int
    revenue: Decimal
    avg_check: Decimal
    conversions: Decimal
    ad_budget: Decimal
    price_per_sale: Decimal


def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(message)s",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load the public Odeon marketing statistics Google Sheets tab into PostgreSQL."
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--sheet-url",
        default=DEFAULT_SHEET_URL,
        help="Public Google Sheets URL. The script converts it to /export?format=csv&gid=... automatically.",
    )
    source.add_argument(
        "--csv-file",
        type=Path,
        help="Use an already downloaded CSV file instead of downloading the public Google Sheet.",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        help="Path to .env. If omitted, the script looks for .env next to itself, in its parent directory, in the current working directory, and in the current working directory's parent.",
    )
    parser.add_argument("--schema", default=DEFAULT_SCHEMA, help="Target PostgreSQL schema.")
    parser.add_argument("--table", default=DEFAULT_TABLE, help="Target PostgreSQL table name.")
    parser.add_argument(
        "--timezone",
        default=DEFAULT_TIMEZONE,
        help="Timezone used for date-only CSV values before inserting into the timestamptz column.",
    )
    parser.add_argument(
        "--mode",
        choices=("replace", "delete-insert", "append"),
        default="replace",
        help=(
            "Load mode. replace = TRUNCATE target table then insert all parsed rows. "
            "delete-insert = delete matching incoming dates then insert, preserving other dates. "
            "append = insert only and may create duplicates because the table has no unique key."
        ),
    )
    parser.add_argument(
        "--conversion-mode",
        choices=("percent-points", "fraction"),
        default="percent-points",
        help=(
            "How to store values like 3,19%% from the CSV. "
            "percent-points stores 3.19. fraction stores 0.0319."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate the source, print a summary, but do not connect to PostgreSQL.",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging.")
    return parser.parse_args()


def find_env_file(explicit_path: Path | None) -> Path | None:
    if explicit_path:
        return explicit_path

    script_dir = Path(__file__).resolve().parent
    cwd = Path.cwd().resolve()
    candidates = [
        script_dir / ".env",
        script_dir.parent / ".env",
        cwd / ".env",
        cwd.parent / ".env",
    ]

    seen: set[Path] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            resolved = candidate
        if resolved in seen:
            continue
        seen.add(resolved)
        if candidate.is_file():
            return candidate
    return None


def load_env_file(path: Path | None) -> None:
    if path is None:
        logging.info("No .env file found next to script/current directory or parent; using existing environment variables")
        return
    if not path.is_file():
        raise FileNotFoundError(f".env file not found: {path}")

    logging.info("Loaded .env from %s", path)
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def require_env() -> dict[str, str]:
    missing = [key for key in REQUIRED_ENV_VARS if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Missing required environment variables: " + ", ".join(missing))
    return {key: os.environ[key] for key in REQUIRED_ENV_VARS}


def google_sheet_export_csv_url(sheet_url: str) -> str:
    match = re.search(r"/spreadsheets/d/([^/]+)", sheet_url)
    if not match:
        raise ValueError(f"Could not find spreadsheet id in URL: {sheet_url}")
    spreadsheet_id = match.group(1)

    parsed = urlparse(sheet_url)
    query_gid = parse_qs(parsed.query).get("gid", [None])[0]
    fragment_gid_match = re.search(r"gid=(\d+)", parsed.fragment or "")
    fragment_gid = fragment_gid_match.group(1) if fragment_gid_match else None
    gid = query_gid or fragment_gid
    if not gid:
        raise ValueError(f"Could not find gid in URL: {sheet_url}")

    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={gid}"


def download_public_sheet_csv(sheet_url: str) -> str:
    export_url = google_sheet_export_csv_url(sheet_url)
    logging.info("Downloading public Google Sheet CSV export")
    logging.debug("CSV export URL: %s", export_url)

    request = Request(
        export_url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; marketing-statistics-loader/1.0)",
        },
    )
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
            logging.debug("Downloaded %s bytes; Content-Type=%s", len(body), content_type)
    except HTTPError as exc:
        raise RuntimeError(f"Google Sheets CSV download failed with HTTP {exc.code}: {exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"Google Sheets CSV download failed: {exc.reason}") from exc

    text = body.decode("utf-8-sig")
    if text.lstrip().startswith("<!doctype html") or text.lstrip().startswith("<html"):
        raise RuntimeError(
            "Google returned an HTML page instead of CSV. Check that the spreadsheet/tab is publicly accessible."
        )
    return text


def normalize_numeric_text(value: str) -> str:
    return (
        value.strip()
        .replace("\u00a0", "")
        .replace("\u202f", "")
        .replace(" ", "")
        .replace(",", ".")
    )


def parse_decimal(value: str, *, field_name: str, row_number: int) -> Decimal:
    cleaned = normalize_numeric_text(value)
    if cleaned == "":
        raise ValueError(f"Empty numeric value in row {row_number}, field {field_name}")
    try:
        return Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid numeric value in row {row_number}, field {field_name}: {value!r}") from exc


def parse_int(value: str, *, field_name: str, row_number: int) -> int:
    dec = parse_decimal(value, field_name=field_name, row_number=row_number)
    if dec != dec.to_integral_value():
        raise ValueError(f"Expected integer in row {row_number}, field {field_name}: {value!r}")
    return int(dec)


def parse_percent_value(
    value: str,
    *,
    field_name: str,
    row_number: int,
    conversion_mode: str,
) -> Decimal:
    stripped = value.strip()
    is_percent = stripped.endswith("%")
    if is_percent:
        stripped = stripped[:-1]
    number = parse_decimal(stripped, field_name=field_name, row_number=row_number)
    if is_percent and conversion_mode == "fraction":
        return number / Decimal("100")
    return number


def parse_date(value: str, *, row_number: int, timezone: ZoneInfo) -> datetime:
    try:
        return datetime.strptime(value.strip(), "%d.%m.%Y").replace(tzinfo=timezone)
    except ValueError as exc:
        raise ValueError(f"Invalid date in row {row_number}: {value!r}. Expected DD.MM.YYYY") from exc


def parse_csv_text(csv_text: str, *, timezone_name: str, conversion_mode: str) -> tuple[list[ParsedRow], int]:
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone: {timezone_name}") from exc

    reader = csv.DictReader(io.StringIO(csv_text), delimiter=",")
    if reader.fieldnames is None:
        raise ValueError("CSV has no header row")

    header = [name.strip() for name in reader.fieldnames]
    if header != REQUIRED_COLUMNS:
        missing = [col for col in REQUIRED_COLUMNS if col not in header]
        extra = [col for col in header if col not in REQUIRED_COLUMNS]
        raise ValueError(
            "Unexpected CSV header. "
            f"Expected exactly: {REQUIRED_COLUMNS}. Got: {header}. Missing: {missing}. Extra: {extra}"
        )

    rows: list[ParsedRow] = []
    skipped_blank_metric_rows = 0
    seen_dates: set[datetime] = set()

    # row_number is spreadsheet-like: header is row 1, first data row is row 2.
    for row_number, raw in enumerate(reader, start=2):
        raw = {key.strip(): (value or "").strip() for key, value in raw.items() if key is not None}
        if not raw.get("date") and all(not raw.get(col) for col in METRIC_COLUMNS):
            skipped_blank_metric_rows += 1
            continue

        metric_values = [raw.get(col, "") for col in METRIC_COLUMNS]
        if all(value == "" for value in metric_values):
            skipped_blank_metric_rows += 1
            continue
        if any(value == "" for value in metric_values):
            empty_columns = [col for col in METRIC_COLUMNS if raw.get(col, "") == ""]
            raise ValueError(f"Incomplete row {row_number}; empty metric columns: {empty_columns}")

        parsed_date = parse_date(raw["date"], row_number=row_number, timezone=timezone)
        if parsed_date in seen_dates:
            raise ValueError(f"Duplicate date in source CSV: {raw['date']!r} at row {row_number}")
        seen_dates.add(parsed_date)

        rows.append(
            ParsedRow(
                date=parsed_date,
                sales=parse_int(raw["sales"], field_name="sales", row_number=row_number),
                revenue=parse_decimal(raw["revenue"], field_name="revenue", row_number=row_number),
                avg_check=parse_decimal(raw["avg_check"], field_name="avg_check", row_number=row_number),
                conversions=parse_percent_value(
                    raw["conversions"],
                    field_name="conversions",
                    row_number=row_number,
                    conversion_mode=conversion_mode,
                ),
                ad_budget=parse_decimal(raw["ad_budget"], field_name="ad_budget", row_number=row_number),
                price_per_sale=parse_decimal(raw["price_per_sale"], field_name="price_per_sale", row_number=row_number),
            )
        )

    if not rows:
        raise ValueError("No loadable rows found in source CSV")
    return rows, skipped_blank_metric_rows


def read_source_csv(args: argparse.Namespace) -> tuple[str, str]:
    if args.csv_file:
        logging.info("Reading CSV file %s", args.csv_file)
        return args.csv_file.read_text(encoding="utf-8-sig"), str(args.csv_file)
    return download_public_sheet_csv(args.sheet_url), args.sheet_url


def row_tuples(rows: Iterable[ParsedRow]) -> list[tuple[datetime, int, Decimal, Decimal, Decimal, Decimal, Decimal]]:
    return [
        (
            row.date,
            row.sales,
            row.revenue,
            row.avg_check,
            row.conversions,
            row.ad_budget,
            row.price_per_sale,
        )
        for row in rows
    ]


def load_into_postgres(rows: list[ParsedRow], args: argparse.Namespace) -> None:
    try:
        import psycopg
        from psycopg import sql
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency: psycopg. Install it with: pip install 'psycopg[binary]'"
        ) from exc

    env = require_env()
    try:
        port = int(env["PLANETRA_DB_PORT"])
    except ValueError as exc:
        raise RuntimeError("PLANETRA_DB_PORT must be an integer") from exc

    table_ident = sql.Identifier(args.schema, args.table)
    date_ident = sql.Identifier("date")
    columns_sql = sql.SQL(", ").join(sql.Identifier(col) for col in REQUIRED_COLUMNS)
    placeholders_sql = sql.SQL(", ").join(sql.Placeholder() for _ in REQUIRED_COLUMNS)
    insert_sql = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
        table_ident,
        columns_sql,
        placeholders_sql,
    )

    values = row_tuples(rows)

    logging.info("Connecting to PostgreSQL %s:%s/%s", env["PLANETRA_DB_HOST"], port, env["PLANETRA_DB_NAME"])
    with psycopg.connect(
        host=env["PLANETRA_DB_HOST"],
        port=port,
        dbname=env["PLANETRA_DB_NAME"],
        user=env["PLANETRA_DB_USER"],
        password=env["PLANETRA_DB_PASSWORD"],
    ) as conn:
        with conn.cursor() as cur:
            if args.mode == "replace":
                logging.info('Truncating %s."%s"', args.schema, args.table)
                cur.execute(sql.SQL("TRUNCATE TABLE {}").format(table_ident))
            elif args.mode == "delete-insert":
                incoming_dates = [row.date for row in rows]
                delete_placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in incoming_dates)
                delete_sql = sql.SQL("DELETE FROM {} WHERE {} IN ({})").format(
                    table_ident,
                    date_ident,
                    delete_placeholders,
                )
                logging.info("Deleting %s existing rows with incoming dates", len(incoming_dates))
                cur.execute(delete_sql, incoming_dates)
                logging.info("Deleted %s existing rows", cur.rowcount)
            elif args.mode == "append":
                logging.warning("Append mode can create duplicates because the target table has no unique key")

            logging.info("Inserting %s rows into %s.%s", len(values), args.schema, args.table)
            cur.executemany(insert_sql, values)

    logging.info("Load committed successfully")


def print_summary(rows: list[ParsedRow], skipped_blank_metric_rows: int, source_desc: str, args: argparse.Namespace) -> None:
    first_date = min(row.date for row in rows)
    last_date = max(row.date for row in rows)
    total_sales = sum(row.sales for row in rows)
    total_revenue = sum((row.revenue for row in rows), Decimal("0"))
    total_ad_budget = sum((row.ad_budget for row in rows), Decimal("0"))

    logging.info("Source: %s", source_desc)
    logging.info("Parsed rows: %s", len(rows))
    logging.info("Skipped blank metric rows: %s", skipped_blank_metric_rows)
    logging.info("Date range: %s to %s", first_date.date().isoformat(), last_date.date().isoformat())
    logging.info("Total sales: %s", total_sales)
    logging.info("Total revenue: %s", total_revenue)
    logging.info("Total ad budget: %s", total_ad_budget)
    logging.info("Conversion mode: %s", args.conversion_mode)
    logging.info("Target: %s.%s; mode=%s", args.schema, args.table, args.mode)


def main() -> int:
    args = parse_args()
    setup_logging(args.verbose)

    try:
        load_env_file(find_env_file(args.env_file))
        csv_text, source_desc = read_source_csv(args)
        rows, skipped_blank_metric_rows = parse_csv_text(
            csv_text,
            timezone_name=args.timezone,
            conversion_mode=args.conversion_mode,
        )
        print_summary(rows, skipped_blank_metric_rows, source_desc, args)
        if args.dry_run:
            logging.info("Dry run requested; PostgreSQL was not modified")
            return 0
        load_into_postgres(rows, args)
        return 0
    except Exception as exc:
        logging.error("Failed: %s", exc)
        if args.verbose:
            logging.exception("Full traceback")
        return 1


if __name__ == "__main__":
    sys.exit(main())
