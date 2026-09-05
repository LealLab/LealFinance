"""Ingests Pluggy account snapshots and transactions into the ledger."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from datetime import date as date_type
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.account import (
    ACCOUNT_TYPE_CHECKING,
    ACCOUNT_TYPE_CREDIT_CARD,
    ACCOUNT_TYPE_INVESTMENT,
    ACCOUNT_TYPE_SAVINGS,
    Account,
)
from app.models.category import Category
from app.models.open_finance import PluggyAccount, PluggyItem
from app.models.transaction import (
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    Transaction,
)
from app.schemas.account import AccountCreate
from app.schemas.transaction import TransactionCreate
from app.services import accounts as accounts_service
from app.services import categorization_rules, ownership, pluggy_client, pluggy_credentials
from app.services import transactions as transactions_service
from app.services.rule_engine import RuleInput, first_match

MAX_TRANSACTIONS_PER_SYNC = 2000
_MAX_TRANSACTION_PAGE_SIZE = 500


@dataclass(frozen=True, slots=True)
class SyncResult:
    transactions_imported: int
    accounts_synced: int
    error: str | None = None


def map_account_type(account_type: str, subtype: str) -> str:
    kind = account_type.upper()
    detail = subtype.upper()
    if kind == "BANK" and detail == "CHECKING":
        return ACCOUNT_TYPE_CHECKING
    if kind == "BANK" and detail == "SAVINGS":
        return ACCOUNT_TYPE_SAVINGS
    if kind == "CREDIT":
        return ACCOUNT_TYPE_CREDIT_CARD
    if kind == "INVESTMENT":
        return ACCOUNT_TYPE_INVESTMENT
    if kind == "LOAN":
        # Loans use checking because the ledger has no liability account type;
        # the UI flags this linked account as a liability.
        return ACCOUNT_TYPE_CHECKING
    raise ValidationAppError(code="pluggy.request_failed")


def normalize_synced_balance(balance: Decimal, account_type: str) -> Decimal:
    """Convert Pluggy's positive credit-card debt to LealFinance's negative debt."""
    return -balance if account_type == ACCOUNT_TYPE_CREDIT_CARD else balance


def map_transaction_amount(
    raw_amount: Decimal, transaction_type: str, account_type: str
) -> tuple[Decimal, str, Decimal]:
    """Return positive ledger amount, ledger type, and signed balance delta."""
    if not raw_amount.is_finite() or raw_amount == 0:
        raise ValidationAppError(code="pluggy.request_failed")

    kind = transaction_type.upper()
    if kind == "DEBIT":
        ledger_type = TRANSACTION_TYPE_EXPENSE
        expected_signed = -abs(raw_amount)
    elif kind == "CREDIT":
        ledger_type = TRANSACTION_TYPE_INCOME
        expected_signed = abs(raw_amount)
    else:
        raise ValidationAppError(code="pluggy.request_failed")

    pluggy_signed = -raw_amount if account_type == ACCOUNT_TYPE_CREDIT_CARD else raw_amount
    signed = pluggy_signed if (pluggy_signed > 0) == (expected_signed > 0) else expected_signed
    return abs(signed), ledger_type, signed


def reconcile_opening_balance(
    synced_balance: Decimal, signed_amounts: Iterable[Decimal]
) -> Decimal:
    return synced_balance - sum(signed_amounts, Decimal(0))


def _value(payload: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in payload and payload[key] is not None:
            return payload[key]
    return None


def _required_string(payload: dict[str, Any], *keys: str) -> str:
    value = _value(payload, *keys)
    if not isinstance(value, str) or not value:
        raise ValidationAppError(code="pluggy.request_failed")
    return value


def _decimal(payload: dict[str, Any], *keys: str, required: bool = True) -> Decimal | None:
    value = _value(payload, *keys)
    if value is None:
        if required:
            raise ValidationAppError(code="pluggy.request_failed")
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValidationAppError(code="pluggy.request_failed") from exc
    if not result.is_finite():
        raise ValidationAppError(code="pluggy.request_failed")
    return result


def _date(value: Any) -> date_type:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date_type):
        return value
    if isinstance(value, str):
        try:
            return date_type.fromisoformat(value[:10])
        except ValueError as exc:
            raise ValidationAppError(code="pluggy.request_failed") from exc
    raise ValidationAppError(code="pluggy.request_failed")


def _currency(payload: dict[str, Any]) -> str:
    value = _value(payload, "currency", "currencyCode", "currency_code")
    if isinstance(value, dict):
        value = value.get("code")
    if not isinstance(value, str) or not value:
        raise ValidationAppError(code="pluggy.request_failed")
    return value


def _description(payload: dict[str, Any]) -> str:
    value = _value(payload, "description", "descriptionRaw", "merchantName", "merchant_name")
    if not isinstance(value, str) or not value:
        raise ValidationAppError(code="pluggy.request_failed")
    return value[:200]


async def _api_key(db: AsyncSession, user_id: UUID) -> str:
    client_id, client_secret, _environment = await pluggy_credentials.get_credentials(db, user_id)
    return await pluggy_client.authenticate(client_id, client_secret)


def _transaction_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("results")
    if rows is None:
        rows = payload.get("data")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValidationAppError(code="pluggy.request_failed")
    return rows


def _has_next_page(payload: dict[str, Any], page: int, row_count: int) -> bool:
    for key in ("hasNextPage", "has_next_page", "hasNext"):
        value = payload.get(key)
        if isinstance(value, bool):
            return value

    total_pages = payload.get("totalPages", payload.get("total_pages"))
    if isinstance(total_pages, int):
        return page < total_pages

    total = payload.get("total")
    if isinstance(total, int) and row_count:
        return page * row_count < total

    page_size = payload.get("pageSize", payload.get("page_size"))
    if isinstance(page_size, int):
        return row_count >= page_size
    return row_count >= _MAX_TRANSACTION_PAGE_SIZE


async def _fetch_transactions(
    api_key: str,
    account: PluggyAccount,
    from_date: date_type,
    to_date: date_type,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 1
    while len(rows) < MAX_TRANSACTIONS_PER_SYNC:
        payload = await pluggy_client.get_transactions(
            api_key, account.external_id, from_date, to_date, page
        )
        page_rows = _transaction_rows(payload)
        remaining = MAX_TRANSACTIONS_PER_SYNC - len(rows)
        rows.extend(page_rows[:remaining])
        if not page_rows or len(rows) >= MAX_TRANSACTIONS_PER_SYNC:
            break
        if not _has_next_page(payload, page, len(page_rows)):
            break
        page += 1
    return rows


async def _upsert_account(
    db: AsyncSession,
    user_id: UUID,
    item: PluggyItem,
    payload: dict[str, Any],
    investment_snapshot: dict[str, Any] | None,
    loan_snapshot: dict[str, Any] | None,
) -> tuple[PluggyAccount, Account | None, bool, str]:
    external_id = _required_string(payload, "id", "accountId", "account_id")
    pluggy_type = _required_string(payload, "type", "accountType", "account_type")
    subtype = str(_value(payload, "subtype", "subType", "sub_type") or "")
    ledger_type = map_account_type(pluggy_type, subtype)
    currency = _currency(payload)
    balance = _decimal(payload, "balance")
    assert balance is not None
    credit_limit = _decimal(payload, "creditLimit", "credit_limit", required=False)
    available_credit_limit = _decimal(
        payload, "availableCreditLimit", "available_credit_limit", required=False
    )
    if credit_limit is not None and credit_limit < 0:
        raise ValidationAppError(code="pluggy.request_failed")

    raw = dict(payload)
    if investment_snapshot is not None and pluggy_type.upper() == "INVESTMENT":
        raw["investments"] = investment_snapshot
    if loan_snapshot is not None and pluggy_type.upper() == "LOAN":
        raw["loans"] = loan_snapshot

    row = await db.scalar(
        ownership.owned(PluggyAccount, user_id).where(PluggyAccount.external_id == external_id)
    )
    if row is None:
        row = PluggyAccount(user_id=user_id, external_id=external_id)
        db.add(row)

    row.pluggy_item_id = item.id
    row.type = pluggy_type
    row.subtype = subtype
    row.name = _required_string(payload, "name")
    number = _value(payload, "number", "maskedNumber", "masked_number")
    row.number = str(number) if number is not None else None
    row.currency = currency
    row.synced_balance = normalize_synced_balance(balance, ledger_type)
    row.credit_limit = credit_limit
    row.available_credit_limit = available_credit_limit
    row.raw = raw

    account: Account | None = None
    first_sync = row.account_id is None
    if first_sync:
        await db.flush()
        account = await accounts_service.create_account(
            db,
            user_id,
            AccountCreate(
                name=row.name,
                type=ledger_type,
                currency=currency,
                institution_id=item.institution_id,
                credit_limit=credit_limit if ledger_type == ACCOUNT_TYPE_CREDIT_CARD else None,
            ),
        )
        row.account_id = account.id
    return row, account, first_sync, ledger_type


async def _sync_account_transactions(
    db: AsyncSession,
    user_id: UUID,
    api_key: str,
    account: PluggyAccount,
    ledger_account: Account | None,
    ledger_type: str,
    rules: list[Any],
    fallback_categories: dict[str, UUID],
    today: date_type,
) -> int:
    from_date = account.last_transaction_date or today - timedelta(days=365)
    rows = await _fetch_transactions(api_key, account, from_date, today)
    if account.account_id is None:
        raise ValidationAppError(code="pluggy.request_failed")
    signed_amounts: list[Decimal] = []
    imported = 0
    seen_ids: set[str] = set()

    for payload in rows:
        external_id = _required_string(payload, "id", "transactionId", "transaction_id")
        if external_id in seen_ids:
            continue
        if (
            await db.scalar(
                select(Transaction.id).where(
                    Transaction.user_id == user_id,
                    Transaction.pluggy_transaction_id == external_id,
                )
            )
            is not None
        ):
            seen_ids.add(external_id)
            continue

        raw_amount = _decimal(payload, "amount")
        assert raw_amount is not None
        amount, transaction_type, signed_amount = map_transaction_amount(
            raw_amount,
            _required_string(payload, "type", "transactionType", "transaction_type"),
            ledger_type,
        )
        description = _description(payload)
        matched = first_match(
            rules,
            RuleInput(
                description=description,
                notes=_value(payload, "notes", "note", "memo"),
                amount=amount,
                type=transaction_type,
            ),
        )
        category_id = matched.category_id if matched else fallback_categories.get(transaction_type)
        transaction = await transactions_service.build_transaction(
            db,
            user_id,
            TransactionCreate(
                type=transaction_type,
                date=_date(_value(payload, "date", "transactionDate", "transaction_date")),
                amount=amount,
                currency=account.currency,
                account_id=account.account_id,
                category_id=category_id,
                description=description,
                notes=_value(payload, "notes", "note", "memo"),
            ),
        )
        transaction.pluggy_transaction_id = external_id
        seen_ids.add(external_id)
        imported += 1
        signed_amounts.append(signed_amount)

    if ledger_account is not None:
        ledger_account.opening_balance = reconcile_opening_balance(
            account.synced_balance, signed_amounts
        )
    account.last_transaction_date = today
    await db.commit()
    return imported


async def sync_item(db: AsyncSession, user_id: UUID, item_id: UUID) -> SyncResult:
    item = await ownership.get_owned(db, PluggyItem, item_id, user_id)
    api_key = await _api_key(db, user_id)
    today = date_type.today()
    account_payloads = await pluggy_client.list_accounts(api_key, item.external_id)
    account_types = {
        str(_value(payload, "type", "accountType", "account_type") or "").upper()
        for payload in account_payloads
    }
    investment_snapshot = (
        await pluggy_client.get_investments(api_key, item.external_id)
        if "INVESTMENT" in account_types
        else None
    )
    loan_snapshot = (
        await pluggy_client.get_loans(api_key, item.external_id)
        if "LOAN" in account_types
        else None
    )
    rules = await categorization_rules.load_active_rules(db, user_id)
    categories = await ownership.list_owned(db, Category, user_id)
    fallback_categories: dict[str, UUID] = {}
    for category in categories:
        fallback_categories.setdefault(category.kind, category.id)

    imported = 0
    for payload in account_payloads:
        row, ledger_account, first_sync, ledger_type = await _upsert_account(
            db,
            user_id,
            item,
            payload,
            investment_snapshot,
            loan_snapshot,
        )
        imported += await _sync_account_transactions(
            db,
            user_id,
            api_key,
            row,
            ledger_account if first_sync else None,
            ledger_type,
            rules,
            fallback_categories,
            today,
        )

    item.last_synced_at = datetime.now(UTC)
    item.last_sync_error = None
    await db.commit()
    return SyncResult(transactions_imported=imported, accounts_synced=len(account_payloads))
