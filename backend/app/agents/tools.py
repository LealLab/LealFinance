"""Financial agent tools.

Deferred tools: categorize_transactions, update/delete
transaction, goals, loans, investments, and recurring rules.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.events import ToolSpec
from app.core.errors import ValidationAppError
from app.schemas.account import AccountBalanceRead, AccountCreate, AccountRead
from app.schemas.category import CategoryRead
from app.schemas.institution import InstitutionCreate, InstitutionRead
from app.schemas.transaction import TransactionCreate, TransactionRead, TransactionType
from app.services import accounts as accounts_service
from app.services import analytics
from app.services import categories as categories_service
from app.services import institutions as institutions_service
from app.services import transactions as transactions_service


class _ToolArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _ListAccountsArgs(_ToolArgs):
    include_archived: bool = False


class _CreateInstitutionArgs(_ToolArgs):
    name: str
    icon: str | None = None
    color: str | None = None


class _CreateAccountArgs(_ToolArgs):
    name: str
    type: Literal["checking", "savings", "cash", "credit_card", "investment", "goal"]
    currency: str
    opening_balance: Decimal | None = None
    institution_id: UUID | None = None
    credit_limit: Decimal | None = None
    closing_day: int | None = None
    due_day: int | None = None


class _ListCategoriesArgs(_ToolArgs):
    kind: Literal["income", "expense"] | None = None


class _SearchTransactionsArgs(_ToolArgs):
    date_from: date | None = None
    date_to: date | None = None
    types: list[TransactionType] | None = None
    account_id: UUID | None = None
    category_id: UUID | None = None
    search: str | None = None
    amount_min: Decimal | None = None
    amount_max: Decimal | None = None
    limit: int = Field(default=25, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class _DateRangeArgs(_ToolArgs):
    date_from: date
    date_to: date
    currency: str | None = None


class _BudgetStatusArgs(_ToolArgs):
    month: str


def _validate[ModelT: BaseModel](model: type[ModelT], args: dict[str, Any]) -> ModelT:
    try:
        return model.model_validate(args)
    except ValidationError as exc:
        raise ValidationAppError(
            code="agents.tool_arguments_invalid",
            params={"detail": str(exc)},
        ) from exc


async def _list_accounts(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, Any]]:
    payload = _validate(_ListAccountsArgs, args)
    accounts = await accounts_service.list_accounts(db, user_id)
    balances = await accounts_service.account_balances(db, user_id)
    balance_by_account = {
        row.account_id: AccountBalanceRead.model_validate(row, from_attributes=True).model_dump(
            mode="json"
        )["balance"]
        for row in balances
    }
    return [
        {
            **AccountRead.model_validate(account, from_attributes=True).model_dump(mode="json"),
            "balance": balance_by_account.get(account.id, "0"),
        }
        for account in accounts
        if payload.include_archived or not account.archived
    ]


async def _list_categories(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, Any]]:
    payload = _validate(_ListCategoriesArgs, args)
    categories = await categories_service.list_categories(db, user_id)
    return [
        CategoryRead.model_validate(category, from_attributes=True).model_dump(mode="json")
        for category in categories
        if payload.kind is None or category.kind == payload.kind
    ]


async def _list_institutions(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, Any]]:
    _validate(_ToolArgs, args)
    rows = await institutions_service.list_institutions(db, user_id)
    return [
        InstitutionRead.model_validate(row, from_attributes=True).model_dump(mode="json")
        for row in rows
    ]


async def _search_transactions(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> dict[str, Any]:
    payload = _validate(_SearchTransactionsArgs, args)
    page = await transactions_service.list_transactions(
        db,
        user_id,
        date_from=payload.date_from,
        date_to=payload.date_to,
        types=payload.types,
        account_id=payload.account_id,
        category_id=payload.category_id,
        search=payload.search,
        amount_min=payload.amount_min,
        amount_max=payload.amount_max,
        limit=payload.limit,
        offset=payload.offset,
    )
    return {
        "total": page.total,
        "transactions": [
            TransactionRead.model_validate(row, from_attributes=True).model_dump(mode="json")
            for row in page.rows
        ],
    }


async def _spend_by_category(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, str]]:
    payload = _validate(_DateRangeArgs, args)
    rows = await analytics.spend_by_category_group(
        db,
        user_id,
        date_from=payload.date_from,
        date_to=payload.date_to,
        currency=payload.currency,
    )
    return [
        {"group_id": str(row.group_id), "currency": row.currency, "total": str(row.total)}
        for row in rows
    ]


async def _monthly_totals(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, str]]:
    payload = _validate(_DateRangeArgs, args)
    rows = await analytics.monthly_totals(
        db,
        user_id,
        date_from=payload.date_from,
        date_to=payload.date_to,
        currency=payload.currency,
    )
    return [
        {
            "month": row.month,
            "currency": row.currency,
            "income": str(row.income),
            "expense": str(row.expense),
            "net": str(row.net),
        }
        for row in rows
    ]


async def _budget_status(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, str | None]]:
    payload = _validate(_BudgetStatusArgs, args)
    rows = await analytics.budget_status(db, user_id, month=payload.month)
    return [
        {
            "group_id": str(row.group_id),
            "currency": row.currency,
            "budget": None if row.budget is None else str(row.budget),
            "spent": str(row.spent),
            "remaining": None if row.remaining is None else str(row.remaining),
        }
        for row in rows
    ]


async def _create_transaction(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> dict[str, Any]:
    payload = _validate(TransactionCreate, args)
    transaction = await transactions_service.create_transaction(db, user_id, payload)
    return TransactionRead.model_validate(transaction, from_attributes=True).model_dump(mode="json")


async def _create_institution(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> dict[str, Any]:
    parsed = _validate(_CreateInstitutionArgs, args)
    payload = _validate(
        InstitutionCreate,
        {
            "name": parsed.name,
            "icon": parsed.icon or "bank",
            **({"color": parsed.color} if parsed.color is not None else {}),
        },
    )
    institution = await institutions_service.create_institution(db, user_id, payload)
    return InstitutionRead.model_validate(institution, from_attributes=True).model_dump(mode="json")


async def _create_account(db: AsyncSession, user_id: UUID, args: dict[str, Any]) -> dict[str, Any]:
    parsed = _validate(_CreateAccountArgs, args)
    payload = _validate(AccountCreate, parsed.model_dump(exclude_none=True))
    account = await accounts_service.create_account(db, user_id, payload)
    return AccountRead.model_validate(account, from_attributes=True).model_dump(mode="json")


@dataclass(frozen=True, slots=True)
class ToolDef:
    name: str
    description: str
    schema: dict[str, Any]
    run: Callable[[AsyncSession, UUID, dict[str, Any]], Awaitable[Any]]
    writes: bool = False

    def provider_spec(self) -> ToolSpec:
        return ToolSpec(name=self.name, description=self.description, schema=self.schema)


SPECS: list[ToolDef] = [
    ToolDef(
        name="list_accounts",
        description="List the user's accounts and current balances.",
        schema={
            "type": "object",
            "properties": {"include_archived": {"type": "boolean", "default": False}},
            "required": [],
            "additionalProperties": False,
        },
        run=_list_accounts,
    ),
    ToolDef(
        name="list_institutions",
        description="List the user's institutions.",
        schema={
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
        run=_list_institutions,
    ),
    ToolDef(
        name="list_categories",
        description="List the user's transaction categories.",
        schema={
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": ["income", "expense"]}},
            "required": [],
            "additionalProperties": False,
        },
        run=_list_categories,
    ),
    ToolDef(
        name="search_transactions",
        description="Search the user's transactions with filters and pagination.",
        schema={
            "type": "object",
            "properties": {
                "date_from": {"type": "string", "format": "date"},
                "date_to": {"type": "string", "format": "date"},
                "types": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["income", "expense", "transfer", "interest"],
                    },
                },
                "account_id": {"type": "string", "format": "uuid"},
                "category_id": {"type": "string", "format": "uuid"},
                "search": {"type": "string"},
                "amount_min": {"type": "string"},
                "amount_max": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
            },
            "required": [],
            "additionalProperties": False,
        },
        run=_search_transactions,
    ),
    ToolDef(
        name="spend_by_category",
        description="Summarize expense spending by category group.",
        schema={
            "type": "object",
            "properties": {
                "date_from": {"type": "string", "format": "date"},
                "date_to": {"type": "string", "format": "date"},
                "currency": {"type": "string"},
            },
            "required": ["date_from", "date_to"],
            "additionalProperties": False,
        },
        run=_spend_by_category,
    ),
    ToolDef(
        name="monthly_totals",
        description="Summarize monthly income, expenses, and net totals.",
        schema={
            "type": "object",
            "properties": {
                "date_from": {"type": "string", "format": "date"},
                "date_to": {"type": "string", "format": "date"},
                "currency": {"type": "string"},
            },
            "required": ["date_from", "date_to"],
            "additionalProperties": False,
        },
        run=_monthly_totals,
    ),
    ToolDef(
        name="budget_status",
        description="Show budgets, spending, and remaining amounts for a month.",
        schema={
            "type": "object",
            "properties": {"month": {"type": "string", "pattern": r"^\d{4}-(0[1-9]|1[0-2])$"}},
            "required": ["month"],
            "additionalProperties": False,
        },
        run=_budget_status,
    ),
    ToolDef(
        name="create_transaction",
        description="Create a transaction in the user's ledger.",
        schema={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["income", "expense", "transfer", "interest"],
                },
                "date": {"type": "string", "format": "date"},
                "amount": {"type": "string"},
                "currency": {"type": "string"},
                "account_id": {"type": "string", "format": "uuid"},
                "description": {"type": "string"},
                "category_id": {"type": "string", "format": "uuid"},
                "to_account_id": {"type": "string", "format": "uuid"},
                "notes": {"type": "string"},
            },
            "required": ["type", "date", "amount", "currency", "account_id", "description"],
            "additionalProperties": False,
        },
        run=_create_transaction,
        writes=True,
    ),
    ToolDef(
        name="create_institution",
        description="Create an institution for the user.",
        schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "icon": {
                    "type": "string",
                    "description": (
                        "Icon name, e.g. bank, creditCard, wallet, piggy, building. "
                        "Defaults to bank."
                    ),
                },
                "color": {"type": "string"},
            },
            "required": ["name"],
            "additionalProperties": False,
        },
        run=_create_institution,
        writes=True,
    ),
    ToolDef(
        name="create_account",
        description="Create an account for the user.",
        schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "type": {
                    "type": "string",
                    "enum": [
                        "checking",
                        "savings",
                        "cash",
                        "credit_card",
                        "investment",
                        "goal",
                    ],
                    "description": (
                        "Account type. credit_limit, closing_day, and due_day only apply "
                        "to credit_card."
                    ),
                },
                "currency": {"type": "string"},
                "opening_balance": {"type": "string"},
                "institution_id": {"type": "string", "format": "uuid"},
                "credit_limit": {"type": "string"},
                "closing_day": {"type": "integer", "minimum": 1, "maximum": 31},
                "due_day": {"type": "integer", "minimum": 1, "maximum": 31},
            },
            "required": ["name", "type", "currency"],
            "additionalProperties": False,
        },
        run=_create_account,
        writes=True,
    ),
]

SPEC_BY_NAME: dict[str, ToolDef] = {spec.name: spec for spec in SPECS}


def provider_specs() -> list[ToolSpec]:
    return [spec.provider_spec() for spec in SPECS]
