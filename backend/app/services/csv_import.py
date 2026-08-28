"""CSV transaction import: parsing a bank-statement export into candidate
transactions for review, with no writes.

Split in two layers so the fiddly parsing rules stay unit-testable without a
database: `parse_csv`/`guess_mapping`/`parse_date`/`parse_amount`/
`parse_rows` are pure. `preview_import` is the only DB-touching piece - it
resolves the target account, matches categories by name, and flags rows that
look like they're already in the ledger.

The actual write lives in app/services/transactions.py::import_transactions,
which reuses the exact same per-transaction validation as a normal create -
this module never constructs a Transaction.
"""

import csv
import io
import re
from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.account import Account
from app.models.category import Category
from app.schemas.transaction_import import ImportOptions
from app.services import ownership
from app.services.categorization_rules import load_active_rules
from app.services.rule_engine import RuleInput, first_match
from app.services.transactions import list_transactions

MAX_CONTENT_BYTES = 2 * 1024 * 1024
MAX_ROWS = 2000

TARGET_FIELDS = ("date", "description", "amount", "category", "notes")
REQUIRED_FIELDS = ("date", "description", "amount")

# English + Portuguese only, matching the two locales the project ships
# hand-written (see docs/i18n.md) - every other language still works via
# manual mapping.
_HEADER_KEYWORDS: dict[str, tuple[str, ...]] = {
    "date": ("date", "data"),
    "description": ("description", "descricao", "descrição", "historico", "histórico", "memo"),
    "amount": ("amount", "valor", "montante"),
    "category": ("category", "categoria"),
    "notes": ("notes", "observacoes", "observações", "obs"),
}


def _normalize_header(header: str) -> str:
    return header.strip().casefold()


def guess_mapping(headers: list[str]) -> dict[str, str | None]:
    """Best-effort column guess by header keyword - the frontend pre-fills
    its mapping selects with this and lets the user override."""
    normalized = {header: _normalize_header(header) for header in headers}
    return {
        field: next((h for h, norm in normalized.items() if norm in keywords), None)
        for field, keywords in _HEADER_KEYWORDS.items()
    }


def sniff_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t").delimiter
    except csv.Error:
        return ","


def parse_csv(content: str) -> tuple[list[str], list[dict[str, str]]]:
    """BOM-stripped, delimiter-sniffed CSV -> (headers, raw string rows)."""
    content = content.lstrip("﻿")
    delimiter = sniff_delimiter(content[:2048])
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    headers = list(reader.fieldnames or [])
    rows = [{key: (value or "") for key, value in row.items() if key is not None} for row in reader]
    return headers, rows


def parse_date(raw: str, date_format: str) -> date_type | None:
    raw = raw.strip()
    if not raw:
        return None
    if date_format == "iso":
        return _try_iso(raw)
    if date_format == "dmy":
        return _try_strptime(raw, "%d/%m/%Y")
    if date_format == "mdy":
        return _try_strptime(raw, "%m/%d/%Y")
    return _try_iso(raw) or _try_strptime(raw, "%d/%m/%Y")


def _try_iso(raw: str) -> date_type | None:
    try:
        return date_type.fromisoformat(raw)
    except ValueError:
        return None


def _try_strptime(raw: str, fmt: str) -> date_type | None:
    try:
        return datetime.strptime(raw, fmt).date()
    except ValueError:
        return None


_AMOUNT_JUNK = re.compile(r"[^0-9,.\-]")


def parse_amount(raw: str, decimal_separator: str) -> Decimal | None:
    """Signed amount - strips currency symbols/spaces, resolves the decimal
    separator, and returns None (never raises) on anything unparseable."""
    cleaned = _AMOUNT_JUNK.sub("", raw.strip())
    if not cleaned:
        return None
    negative = cleaned.startswith("-")
    cleaned = cleaned.lstrip("-")

    sep = decimal_separator
    if sep == "auto":
        if "," in cleaned and "." in cleaned:
            sep = "," if cleaned.rfind(",") > cleaned.rfind(".") else "."
        else:
            sep = "," if "," in cleaned else "."

    cleaned = cleaned.replace(".", "").replace(",", ".") if sep == "," else cleaned.replace(",", "")

    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    return -value if negative else value


@dataclass
class ParsedRow:
    index: int
    date: date_type | None
    description: str
    type: str | None
    amount: Decimal | None
    category_name: str | None
    notes: str | None
    error: str | None


def parse_rows(
    raw_rows: list[dict[str, str]],
    mapping: dict[str, str | None],
    *,
    date_format: str,
    decimal_separator: str,
    invert_sign: bool,
) -> list[ParsedRow]:
    date_col = mapping.get("date")
    desc_col = mapping.get("description")
    amount_col = mapping.get("amount")
    category_col = mapping.get("category")
    notes_col = mapping.get("notes")

    rows: list[ParsedRow] = []
    for index, raw in enumerate(raw_rows):
        parsed_date = parse_date(raw.get(date_col, ""), date_format) if date_col else None
        description = raw.get(desc_col, "").strip() if desc_col else ""
        category_name = (raw.get(category_col, "").strip() or None) if category_col else None
        notes = (raw.get(notes_col, "").strip() or None) if notes_col else None
        signed_amount = (
            parse_amount(raw.get(amount_col, ""), decimal_separator) if amount_col else None
        )

        error: str | None = None
        if parsed_date is None:
            error = "import.row.invalid_date"
        elif not description:
            error = "import.row.missing_description"
        elif signed_amount is None:
            error = "import.row.invalid_amount"
        elif signed_amount == 0:
            error = "import.row.zero_amount"

        tx_type: str | None = None
        amount: Decimal | None = None
        if error is None:
            assert signed_amount is not None
            effective = -signed_amount if invert_sign else signed_amount
            tx_type = "expense" if effective < 0 else "income"
            amount = abs(effective)

        rows.append(
            ParsedRow(
                index=index,
                date=parsed_date,
                description=description,
                type=tx_type,
                amount=amount,
                category_name=category_name,
                notes=notes,
                error=error,
            )
        )
    return rows


@dataclass
class ImportRowResult:
    index: int
    date: date_type | None
    description: str
    type: str | None
    amount: Decimal | None
    category_id: UUID | None
    category_name: str | None
    rule_name: str | None
    notes: str | None
    error: str | None
    duplicate: bool


@dataclass
class ImportPreview:
    headers: list[str]
    mapping: dict[str, str | None]
    rows: list[ImportRowResult]


async def preview_import(
    db: AsyncSession,
    user_id: UUID,
    *,
    content: str,
    account_id: UUID,
    mapping: dict[str, str] | None,
    options: ImportOptions,
) -> ImportPreview:
    if len(content.encode("utf-8")) > MAX_CONTENT_BYTES:
        raise ValidationAppError(code="import.file_too_large")

    await ownership.get_owned(db, Account, account_id, user_id)

    headers, raw_rows = parse_csv(content)
    if not raw_rows:
        raise ValidationAppError(code="import.no_rows")
    if len(raw_rows) > MAX_ROWS:
        raise ValidationAppError(code="import.too_many_rows", params={"max": MAX_ROWS})

    effective_mapping: dict[str, str | None] = dict(mapping) if mapping else guess_mapping(headers)
    missing_fields = [field for field in REQUIRED_FIELDS if not effective_mapping.get(field)]
    if missing_fields:
        raise ValidationAppError(code="import.column_required", params={"fields": missing_fields})

    parsed = parse_rows(
        raw_rows,
        effective_mapping,
        date_format=options.date_format,
        decimal_separator=options.decimal_separator,
        invert_sign=options.invert_sign,
    )

    categories = await ownership.list_owned(db, Category, user_id)
    category_index = {
        (category.kind, category.name.strip().casefold()): category.id for category in categories
    }
    rules = await load_active_rules(db, user_id)

    valid_dates = [row.date for row in parsed if row.date is not None]
    existing_keys: set[tuple[date_type, Decimal, str]] = set()
    if valid_dates:
        existing = await list_transactions(
            db,
            user_id,
            account_id=account_id,
            date_from=min(valid_dates),
            date_to=max(valid_dates),
        )
        existing_keys = {
            (tx.date, tx.amount, tx.description.strip().casefold()) for tx in existing.rows
        }

    results: list[ImportRowResult] = []
    for row in parsed:
        matched = (
            first_match(
                rules,
                RuleInput(
                    description=row.description,
                    notes=row.notes,
                    amount=row.amount or Decimal(0),
                    type=row.type,
                ),
            )
            if row.error is None and row.type is not None
            else None
        )
        category_id = (
            matched.category_id
            if matched
            else (
                category_index.get((row.type, row.category_name.casefold()))
                if row.category_name and row.type is not None
                else None
            )
        )
        results.append(
            ImportRowResult(
                index=row.index,
                date=row.date,
                description=row.description,
                type=row.type,
                amount=row.amount,
                category_id=category_id,
                category_name=row.category_name,
                rule_name=matched.name if matched else None,
                notes=row.notes,
                error=row.error,
                duplicate=(
                    row.error is None
                    and row.date is not None
                    and (row.date, row.amount, row.description.strip().casefold()) in existing_keys
                ),
            )
        )

    return ImportPreview(headers=headers, mapping=effective_mapping, rows=results)
