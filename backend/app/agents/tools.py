"""Financial agent tools.

Reads and analytics are hand-written tools. Create, update, and delete for every
user-owned entity go through the generic `*_entity` tools, driven by the registry
in `app/agents/entities.py`. `create_category_group` and `delete_category_structure`
stay separate because they collapse many calls into one.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.entities import ENTITIES, ENTITY_NAMES, EntitySpec, flatten_schema, icon_or
from app.agents.events import ToolSpec
from app.core.errors import ConflictError, ValidationAppError
from app.models.agent_memory import AGENT_MEMORY_MAX_LENGTH
from app.models.budget import Budget, BudgetAllocation
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.schemas.account import AccountBalanceRead, AccountRead
from app.schemas.card_invoice import CardInvoiceRead
from app.schemas.category import CategoryCreate, CategoryRead
from app.schemas.category_group import (
    CategoryGroupCreate,
    CategoryGroupRead,
)
from app.schemas.institution import InstitutionRead
from app.schemas.investment import InvestmentTransactionCreate, InvestmentTransactionUpdate
from app.schemas.transaction import (
    MAX_BULK_IDS,
    TransactionRead,
    TransactionType,
)
from app.services import accounts as accounts_service
from app.services import agent_memories as agent_memories_service
from app.services import analytics, change_journal, ownership
from app.services import card_invoices as card_invoices_service
from app.services import categories as categories_service
from app.services import category_groups as category_groups_service
from app.services import institutions as institutions_service
from app.services import investments as investments_service
from app.services import transactions as transactions_service

_CATEGORY_ICON_HINT = (
    "Icon name, e.g. tag, home, cart, car, utensils, heart, gift, book, plane, "
    "coffee, phone, briefcase. On create an unknown name becomes tag; on update "
    "it is ignored."
)


class _ToolArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _ListAccountsArgs(_ToolArgs):
    include_archived: bool = False


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


class _ListCardInvoicesArgs(_ToolArgs):
    account_id: UUID
    months_back: int = Field(default=6, ge=0, le=36)
    months_ahead: int = Field(default=6, ge=0, le=36)


class _ListCategoryGroupsArgs(_ToolArgs):
    kind: Literal["income", "expense"] | None = None


class _CategoryChildArgs(_ToolArgs):
    name: str = Field(min_length=1, max_length=100)
    icon: str | None = None
    color: str | None = Field(default=None, min_length=1, max_length=9)


class _CreateCategoryGroupArgs(_ToolArgs):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["income", "expense"]
    icon: str | None = None
    color: str | None = None
    categories: list[_CategoryChildArgs] | None = None


class _DeleteCategoryStructureArgs(_ToolArgs):
    category_ids: list[UUID]
    group_ids: list[UUID]


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
    institutions = await institutions_service.list_institutions(db, user_id)
    balance_by_account = {
        row.account_id: AccountBalanceRead.model_validate(row, from_attributes=True).model_dump(
            mode="json"
        )["balance"]
        for row in balances
    }
    name_by_institution = {institution.id: institution.name for institution in institutions}
    return [
        {
            **AccountRead.model_validate(account, from_attributes=True).model_dump(mode="json"),
            "balance": balance_by_account.get(account.id, "0"),
            "institution_name": (
                name_by_institution.get(account.institution_id)
                if account.institution_id is not None
                else None
            ),
        }
        for account in accounts
        if payload.include_archived or not account.archived
    ]


async def _group_names(db: AsyncSession, user_id: UUID) -> dict[str, str]:
    groups = await category_groups_service.list_groups(db, user_id)
    return {str(group.id): group.name for group in groups}


async def _list_categories(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, Any]]:
    payload = _validate(_ListCategoriesArgs, args)
    categories = await categories_service.list_categories(db, user_id)
    group_names = await _group_names(db, user_id)
    return [
        {
            **CategoryRead.model_validate(category, from_attributes=True).model_dump(mode="json"),
            "group_name": group_names.get(str(category.group_id)),
        }
        for category in categories
        if payload.kind is None or category.kind == payload.kind
    ]


async def _list_category_groups(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, Any]]:
    payload = _validate(_ListCategoryGroupsArgs, args)
    groups = await category_groups_service.list_groups(db, user_id)
    return [
        CategoryGroupRead.model_validate(group, from_attributes=True).model_dump(mode="json")
        for group in groups
        if payload.kind is None or group.kind == payload.kind
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
) -> list[dict[str, str | None]]:
    payload = _validate(_DateRangeArgs, args)
    rows = await analytics.spend_by_category_group(
        db,
        user_id,
        date_from=payload.date_from,
        date_to=payload.date_to,
        currency=payload.currency,
    )
    group_names = await _group_names(db, user_id)
    return [
        {
            "group_id": str(row.group_id),
            "group_name": group_names.get(str(row.group_id)),
            "currency": row.currency,
            "total": str(row.total),
        }
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
    group_names = await _group_names(db, user_id)
    return [
        {
            "group_id": str(row.group_id),
            "group_name": group_names.get(str(row.group_id)),
            "currency": row.currency,
            "budget": None if row.budget is None else str(row.budget),
            "spent": str(row.spent),
            "remaining": None if row.remaining is None else str(row.remaining),
        }
        for row in rows
    ]


async def _create_category_group(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> dict[str, Any]:
    parsed = _validate(_CreateCategoryGroupArgs, args)
    color = parsed.color or "#64748B"
    # _CreateCategoryGroupArgs has already validated every child's name and
    # color, so nothing below can 422 after the group row is written.
    children = parsed.categories or []
    group_payload = _validate(
        CategoryGroupCreate,
        {
            "name": parsed.name,
            "kind": parsed.kind,
            "color": color,
            "icon": icon_or(parsed.icon, "tag"),
        },
    )
    group = await category_groups_service.create_group(db, user_id, group_payload)
    # ponytail: children are created one commit at a time; wrap in a single
    # transaction if partial groups ever show up in practice.
    created: list[dict[str, Any]] = []
    for child in children:
        payload = CategoryCreate(
            name=child.name,
            kind=parsed.kind,
            group_id=group.id,
            color=child.color or color,
            icon=icon_or(child.icon, "tag"),
        )
        category = await categories_service.create_category(db, user_id, payload)
        created.append(
            CategoryRead.model_validate(category, from_attributes=True).model_dump(mode="json")
        )
    return {
        "group": CategoryGroupRead.model_validate(group, from_attributes=True).model_dump(
            mode="json"
        ),
        "categories": created,
    }


async def _delete_category_structure(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> dict[str, Any]:
    parsed = _validate(_DeleteCategoryStructureArgs, args)
    category_ids = parsed.category_ids
    group_ids = parsed.group_ids

    if not category_ids and not group_ids:
        raise ValidationAppError(code="agents.category_structure_empty")
    if (
        len(category_ids) > MAX_BULK_IDS
        or len(group_ids) > MAX_BULK_IDS
        or len(category_ids) + len(group_ids) > MAX_BULK_IDS
    ):
        raise ValidationAppError(
            code="agents.category_structure_too_many_ids",
            params={"max": MAX_BULK_IDS},
        )

    for kind, ids in (("category", category_ids), ("group", group_ids)):
        if len(ids) != len(set(ids)):
            raise ValidationAppError(
                code="agents.category_structure_duplicate_ids", params={"kind": kind}
            )

    await ownership.get_many_owned(db, Category, category_ids, user_id)
    await ownership.get_many_owned(db, CategoryGroup, group_ids, user_id)

    if group_ids:
        result = await db.execute(
            select(Category.id, Category.group_id).where(
                Category.user_id == user_id, Category.group_id.in_(group_ids)
            )
        )
        selected_category_ids = set(category_ids)
        missing = next(
            (
                (group_id, category_id)
                for category_id, group_id in result.all()
                if category_id not in selected_category_ids
            ),
            None,
        )
        if missing is not None:
            group_id, category_id = missing
            raise ValidationAppError(
                code="agents.category_structure_group_not_empty",
                params={"group_id": str(group_id), "category_id": str(category_id)},
            )

    for category_id in category_ids:
        if await categories_service._category_in_use(db, category_id):
            raise ConflictError(code="category.in_use", params={"id": str(category_id)})

    if category_ids:
        await db.execute(
            delete(Category).where(Category.user_id == user_id, Category.id.in_(category_ids))
        )
    if group_ids:
        await db.execute(
            delete(Budget).where(Budget.user_id == user_id, Budget.group_id.in_(group_ids))
        )
        await db.execute(
            delete(BudgetAllocation).where(
                BudgetAllocation.user_id == user_id,
                BudgetAllocation.group_id.in_(group_ids),
            )
        )
        await db.execute(
            delete(CategoryGroup).where(
                CategoryGroup.user_id == user_id, CategoryGroup.id.in_(group_ids)
            )
        )
    await db.commit()
    return {
        "deleted": True,
        "category_ids": [str(category_id) for category_id in category_ids],
        "group_ids": [str(group_id) for group_id in group_ids],
    }


async def _list_card_invoices(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, Any]]:
    payload = _validate(_ListCardInvoicesArgs, args)
    invoices = await card_invoices_service.list_invoices(
        db,
        user_id,
        payload.account_id,
        today=date.today(),
        months_back=payload.months_back,
        months_ahead=payload.months_ahead,
    )
    return [
        CardInvoiceRead.model_validate(invoice, from_attributes=True).model_dump(mode="json")
        for invoice in invoices
    ]


class _EntityArgs(_ToolArgs):
    entity: str


class _ListEntitiesArgs(_EntityArgs):
    limit: int = Field(default=25, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class _EntityIdArgs(_EntityArgs):
    id: UUID


class _CreateEntityArgs(_EntityArgs):
    data: dict[str, Any]


class _UpdateEntityArgs(_EntityIdArgs):
    changes: dict[str, Any]


def _entity(name: str) -> EntitySpec:
    spec = ENTITIES.get(name)
    if spec is None:
        raise ValidationAppError(
            code="entity.unknown", params={"entity": name, "known": list(ENTITY_NAMES)}
        )
    return spec


def _unsupported(spec: EntitySpec, operation: str) -> ValidationAppError:
    return ValidationAppError(
        code="entity.operation_unsupported",
        params={"entity": spec.name, "operation": operation, "hint": spec.hint},
    )


def _dump(spec: EntitySpec, row: Any) -> dict[str, Any]:
    return spec.read.model_validate(row, from_attributes=True).model_dump(mode="json")


async def _describe_entity(db: AsyncSession, user_id: UUID, args: dict[str, Any]) -> dict[str, Any]:
    spec = _entity(_validate(_EntityArgs, args).entity)
    return {
        "entity": spec.name,
        "operations": [
            operation
            for operation, supported in (
                ("list", spec.list_ is not None),
                ("get", True),
                ("create", spec.create is not None),
                ("update", spec.update is not None),
                ("delete", spec.delete is not None),
            )
            if supported
        ],
        "fields": list(spec.read.model_fields),
        "create_schema": flatten_schema(spec.create[0].model_json_schema())
        if spec.create
        else None,
        "update_schema": flatten_schema(spec.update[0].model_json_schema())
        if spec.update
        else None,
        "hint": spec.hint,
        "notes": (
            "Money amounts are decimal strings. Ids are UUIDs taken from a list or get call, "
            "never invented. For update, send only the fields to change."
        ),
    }


async def _list_entities(db: AsyncSession, user_id: UUID, args: dict[str, Any]) -> dict[str, Any]:
    payload = _validate(_ListEntitiesArgs, args)
    spec = _entity(payload.entity)
    if spec.list_ is None:
        raise _unsupported(spec, "list")
    rows = await spec.list_(db, user_id)
    page = rows[payload.offset : payload.offset + payload.limit]
    return {"total": len(rows), "items": [_dump(spec, row) for row in page]}


async def _get_entity(db: AsyncSession, user_id: UUID, args: dict[str, Any]) -> dict[str, Any]:
    payload = _validate(_EntityIdArgs, args)
    spec = _entity(payload.entity)
    return _dump(spec, await ownership.get_owned(db, spec.model, payload.id, user_id))


async def _create_entity(
    db: AsyncSession,
    user_id: UUID,
    args: dict[str, Any],
    expected_preview: dict[str, object] | None = None,
) -> dict[str, Any]:
    payload = _validate(_CreateEntityArgs, args)
    spec = _entity(payload.entity)
    if spec.create is None:
        raise _unsupported(spec, "create")
    schema, create = spec.create
    data = payload.data
    if spec.prepare_create is not None:
        data = await spec.prepare_create(db, user_id, data)
    if payload.entity == "investment_transaction" and expected_preview is not None:
        return _dump(
            spec,
            await investments_service.create_investment_transaction(
                db,
                user_id,
                _validate(InvestmentTransactionCreate, data),
                expected_preview=expected_preview,
            ),
        )
    return _dump(spec, await create(db, user_id, _validate(schema, data)))


async def _preview_create_entity(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> dict[str, Any] | None:
    payload = _validate(_CreateEntityArgs, args)
    if payload.entity != "investment_transaction":
        return None
    _entity(payload.entity)
    data = _validate(InvestmentTransactionCreate, payload.data)
    return await investments_service.preview_create_investment_transaction(db, user_id, data)


async def _update_entity(
    db: AsyncSession,
    user_id: UUID,
    args: dict[str, Any],
    expected_preview: dict[str, object] | None = None,
) -> dict[str, Any]:
    payload = _validate(_UpdateEntityArgs, args)
    spec = _entity(payload.entity)
    if spec.update is None:
        raise _unsupported(spec, "update")
    schema, update = spec.update
    changes = payload.changes
    if spec.prepare_update is not None:
        changes = spec.prepare_update(changes)
    if payload.entity == "investment_transaction" and expected_preview is not None:
        return _dump(
            spec,
            await investments_service.update_investment_transaction(
                db,
                user_id,
                payload.id,
                _validate(InvestmentTransactionUpdate, changes),
                expected_preview=expected_preview,
            ),
        )
    return _dump(spec, await update(db, user_id, payload.id, _validate(schema, changes)))


async def _preview_update_entity(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> dict[str, Any] | None:
    payload = _validate(_UpdateEntityArgs, args)
    if payload.entity != "investment_transaction":
        return None
    _entity(payload.entity)
    changes = payload.changes
    return await investments_service.preview_update_investment_transaction(
        db, user_id, payload.id, _validate(InvestmentTransactionUpdate, changes)
    )


async def _delete_entity(db: AsyncSession, user_id: UUID, args: dict[str, Any]) -> dict[str, Any]:
    payload = _validate(_EntityIdArgs, args)
    spec = _entity(payload.entity)
    if spec.delete is None:
        raise _unsupported(spec, "delete")
    await spec.delete(db, user_id, payload.id)
    return {"deleted": True, "entity": spec.name, "id": str(payload.id)}


class _ListRecentChangesArgs(_ToolArgs):
    limit: int = Field(default=10, ge=1, le=50)


class _UndoChangesArgs(_ToolArgs):
    call_id: str = Field(min_length=1, max_length=128)


async def _list_recent_changes(
    db: AsyncSession, user_id: UUID, args: dict[str, Any]
) -> list[dict[str, Any]]:
    payload = _validate(_ListRecentChangesArgs, args)
    return await change_journal.list_recent(db, user_id, limit=payload.limit)


async def _undo_changes(db: AsyncSession, user_id: UUID, args: dict[str, Any]) -> dict[str, Any]:
    payload = _validate(_UndoChangesArgs, args)
    reverted = await change_journal.undo(db, user_id, payload.call_id)
    return {"call_id": payload.call_id, "reverted": reverted}


class _RememberArgs(_ToolArgs):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    fact: str = Field(min_length=1, max_length=AGENT_MEMORY_MAX_LENGTH)


async def _remember(db: AsyncSession, user_id: UUID, args: dict[str, Any]) -> dict[str, Any]:
    payload = _validate(_RememberArgs, args)
    memory = await agent_memories_service.remember(db, user_id, payload.fact)
    return {"remembered": memory.content}


@dataclass(frozen=True, slots=True)
class ToolDef:
    name: str
    description: str
    schema: dict[str, Any]
    run: Callable[[AsyncSession, UUID, dict[str, Any]], Awaitable[Any]]
    writes: bool = False
    preview: (
        Callable[[AsyncSession, UUID, dict[str, Any]], Awaitable[dict[str, Any] | None]] | None
    ) = None
    run_confirmed: (
        Callable[[AsyncSession, UUID, dict[str, Any], dict[str, object]], Awaitable[Any]] | None
    ) = None

    def provider_spec(self) -> ToolSpec:
        return ToolSpec(name=self.name, description=self.description, schema=self.schema)


_ENTITY_PROPERTY: dict[str, Any] = {
    "type": "string",
    "enum": list(ENTITY_NAMES),
    "description": "The kind of record.",
}

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
        name="list_category_groups",
        description=(
            "List the user's category groups. Categories belong to a group; a group is "
            "income or expense and a category takes its kind from its group."
        ),
        schema={
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": ["income", "expense"]}},
            "required": [],
            "additionalProperties": False,
        },
        run=_list_category_groups,
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
        name="list_card_invoices",
        description=(
            "List a credit-card account's invoices (faturas): past, current, and projected "
            "future billing cycles with their totals, due dates, and payment status."
        ),
        schema={
            "type": "object",
            "properties": {
                "account_id": {"type": "string", "format": "uuid"},
                "months_back": {"type": "integer", "minimum": 0, "maximum": 36, "default": 6},
                "months_ahead": {"type": "integer", "minimum": 0, "maximum": 36, "default": 6},
            },
            "required": ["account_id"],
            "additionalProperties": False,
        },
        run=_list_card_invoices,
    ),
    ToolDef(
        name="create_category_group",
        description=(
            "Create a category group and, optionally, its categories in one call. Prefer "
            "this over one create_category call per category when setting up a structure."
        ),
        schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "kind": {"type": "string", "enum": ["income", "expense"]},
                "icon": {"type": "string", "description": _CATEGORY_ICON_HINT},
                "color": {"type": "string", "description": "Hex like #64748B. Defaults to grey."},
                "categories": {
                    "type": "array",
                    "description": "Categories to create in the new group.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "icon": {"type": "string", "description": _CATEGORY_ICON_HINT},
                            "color": {
                                "type": "string",
                                "description": "Hex colour; defaults to the group's colour.",
                            },
                        },
                        "required": ["name"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["name", "kind"],
            "additionalProperties": False,
        },
        run=_create_category_group,
        writes=True,
    ),
    ToolDef(
        name="delete_category_structure",
        description=(
            "Delete a complete set of category structures in one confirmed action. Pass every "
            "category id inside each group id; validation happens before any deletion."
        ),
        schema={
            "type": "object",
            "properties": {
                "category_ids": {
                    "type": "array",
                    "items": {"type": "string", "format": "uuid"},
                    "maxItems": MAX_BULK_IDS,
                },
                "group_ids": {
                    "type": "array",
                    "items": {"type": "string", "format": "uuid"},
                    "maxItems": MAX_BULK_IDS,
                },
            },
            "required": ["category_ids", "group_ids"],
            "additionalProperties": False,
        },
        run=_delete_category_structure,
        writes=True,
    ),
    ToolDef(
        name="describe_entity",
        description=(
            "Show what can be done with one kind of record and exactly which fields its "
            "create and update calls accept. Call this before the first create_entity or "
            "update_entity on an entity you have not used yet."
        ),
        schema={
            "type": "object",
            "properties": {"entity": _ENTITY_PROPERTY},
            "required": ["entity"],
            "additionalProperties": False,
        },
        run=_describe_entity,
    ),
    ToolDef(
        name="list_entities",
        description=(
            "List the user's records of one kind, with total and paging. Use it to find real "
            "ids. Transactions are searched with search_transactions instead."
        ),
        schema={
            "type": "object",
            "properties": {
                "entity": _ENTITY_PROPERTY,
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
            },
            "required": ["entity"],
            "additionalProperties": False,
        },
        run=_list_entities,
    ),
    ToolDef(
        name="get_entity",
        description="Fetch one record of any kind by its id.",
        schema={
            "type": "object",
            "properties": {"entity": _ENTITY_PROPERTY, "id": {"type": "string", "format": "uuid"}},
            "required": ["entity", "id"],
            "additionalProperties": False,
        },
        run=_get_entity,
    ),
    ToolDef(
        name="create_entity",
        description=(
            "Create one record. `data` holds the fields shown by describe_entity. For budgets, "
            "budget allocations, expected income and manual rates this creates or replaces the "
            "record for its key."
        ),
        schema={
            "type": "object",
            "properties": {"entity": _ENTITY_PROPERTY, "data": {"type": "object"}},
            "required": ["entity", "data"],
            "additionalProperties": False,
        },
        run=_create_entity,
        writes=True,
        preview=_preview_create_entity,
        run_confirmed=_create_entity,
    ),
    ToolDef(
        name="update_entity",
        description=(
            "Change fields of one existing record. `changes` holds only the fields to change. "
            "Archive-only records (goals, investment wallets and assets) are archived here "
            "with archived=true."
        ),
        schema={
            "type": "object",
            "properties": {
                "entity": _ENTITY_PROPERTY,
                "id": {"type": "string", "format": "uuid"},
                "changes": {"type": "object"},
            },
            "required": ["entity", "id", "changes"],
            "additionalProperties": False,
        },
        run=_update_entity,
        writes=True,
        preview=_preview_update_entity,
        run_confirmed=_update_entity,
    ),
    ToolDef(
        name="delete_entity",
        description=(
            "Delete one record. Some kinds cannot be deleted (goals, investment wallets and "
            "assets are archived instead) and the call says so. Deleting an account also "
            "deletes its transactions; prefer archiving it unless the user clearly wants it "
            "gone."
        ),
        schema={
            "type": "object",
            "properties": {"entity": _ENTITY_PROPERTY, "id": {"type": "string", "format": "uuid"}},
            "required": ["entity", "id"],
            "additionalProperties": False,
        },
        run=_delete_entity,
        writes=True,
    ),
    ToolDef(
        name="list_recent_changes",
        description=(
            "List the changes the assistant recently made for the user, newest first, each "
            "with the call_id needed to undo it. Includes other conversations and external "
            "MCP clients."
        ),
        schema={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10}
            },
            "required": [],
            "additionalProperties": False,
        },
        run=_list_recent_changes,
    ),
    ToolDef(
        name="undo_changes",
        description=(
            "Undo everything one earlier assistant action changed, restoring the previous "
            "state. Get the call_id from list_recent_changes. Fails with "
            "agents.change_modified when the data was edited since; do not retry, tell the "
            "user."
        ),
        schema={
            "type": "object",
            "properties": {"call_id": {"type": "string"}},
            "required": ["call_id"],
            "additionalProperties": False,
        },
        run=_undo_changes,
        writes=True,
    ),
    ToolDef(
        name="remember",
        description=(
            "Save one durable fact about the user for future conversations: a habit, a "
            "preference, a recurring commitment. Write one short self-contained sentence. "
            "Do not save one-off questions, values you can read with a list tool, or "
            "anything the user asked you to keep private. Facts you have already saved are "
            "listed in the system prompt; do not save those again."
        ),
        schema={
            "type": "object",
            "properties": {"fact": {"type": "string", "maxLength": AGENT_MEMORY_MAX_LENGTH}},
            "required": ["fact"],
            "additionalProperties": False,
        },
        run=_remember,
    ),
]

SPEC_BY_NAME: dict[str, ToolDef] = {spec.name: spec for spec in SPECS}


def provider_specs() -> list[ToolSpec]:
    return [spec.provider_spec() for spec in SPECS]
