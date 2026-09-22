"""Registry behind the generic create/read/update/delete agent tools.

Every entry binds an entity name to the service functions and Pydantic schemas
that already implement it, so the generic tools never reimplement domain logic
or bypass ownership scoping: they only choose which existing function to call.
Adding an entity is one entry in `ENTITIES`.

An operation set to `None` is one the application itself does not offer (for
example goals are archive-only); the generic tools report that instead of
inventing a delete the UI has never had.
"""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, get_args
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import UserOwnedModel
from app.models.budget import Budget, BudgetAllocation, ExpectedIncome
from app.models.categorization_rule import CategorizationRule
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.models.goal import Goal
from app.models.institution import Institution
from app.models.investment import InvestmentAsset, InvestmentTransaction, InvestmentWallet
from app.models.loan import Loan
from app.models.manual_rate import ManualRate
from app.models.reconciliation import Reconciliation
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
from app.schemas.account import AccountCreate, AccountRead, AccountUpdate
from app.schemas.budget import BudgetRead, BudgetUpsert
from app.schemas.budget_plan import (
    BudgetAllocationRead,
    BudgetAllocationUpsert,
    ExpectedIncomeRead,
    ExpectedIncomeUpsert,
)
from app.schemas.categorization_rule import (
    CategorizationRuleCreate,
    CategorizationRuleRead,
    CategorizationRuleUpdate,
)
from app.schemas.category import CategoryCreate, CategoryRead, CategoryUpdate
from app.schemas.category_group import CategoryGroupCreate, CategoryGroupRead, CategoryGroupUpdate
from app.schemas.common import IconName
from app.schemas.goal import GoalCreate, GoalRead, GoalUpdate
from app.schemas.institution import InstitutionCreate, InstitutionRead, InstitutionUpdate
from app.schemas.investment import (
    InvestmentAssetCreate,
    InvestmentAssetRead,
    InvestmentAssetUpdate,
    InvestmentTransactionCreate,
    InvestmentTransactionRead,
    InvestmentTransactionUpdate,
    InvestmentWalletCreate,
    InvestmentWalletRead,
    InvestmentWalletUpdate,
)
from app.schemas.loan import LoanCreate, LoanRead, LoanUpdate
from app.schemas.manual_rate import ManualRateRead
from app.schemas.reconciliation import ReconciliationCreate, ReconciliationRead
from app.schemas.recurring import RecurringRuleCreate, RecurringRuleRead, RecurringRuleUpdate
from app.schemas.transaction import TransactionCreate, TransactionRead, TransactionUpdate
from app.services import accounts as accounts_service
from app.services import budget_plan as budget_plan_service
from app.services import budgets as budgets_service
from app.services import categories as categories_service
from app.services import categorization_rules as categorization_rules_service
from app.services import category_groups as category_groups_service
from app.services import goals as goals_service
from app.services import institutions as institutions_service
from app.services import investments as investments_service
from app.services import loans as loans_service
from app.services import manual_rates as manual_rates_service
from app.services import ownership
from app.services import reconciliations as reconciliations_service
from app.services import recurring_rules as recurring_rules_service
from app.services import transactions as transactions_service

_ICON_NAMES = frozenset(get_args(IconName))

_ListFn = Callable[[AsyncSession, UUID], Awaitable[Sequence[Any]]]
_CreateFn = Callable[[AsyncSession, UUID, Any], Awaitable[Any]]
_UpdateFn = Callable[[AsyncSession, UUID, UUID, Any], Awaitable[Any]]
_DeleteFn = Callable[[AsyncSession, UUID, UUID], Awaitable[None]]
_PrepareCreateFn = Callable[[AsyncSession, UUID, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class EntitySpec:
    name: str
    model: type[UserOwnedModel]
    read: type[BaseModel]
    list_: _ListFn | None
    create: tuple[type[BaseModel], _CreateFn] | None = None
    update: tuple[type[BaseModel], _UpdateFn] | None = None
    delete: _DeleteFn | None = None
    # Applied to the model's raw payload before validation, so a slightly-off
    # icon or a derivable field does not cost the model a whole extra round trip.
    prepare_create: _PrepareCreateFn | None = None
    prepare_update: Callable[[dict[str, Any]], dict[str, Any]] | None = None
    # One line of guidance shown by describe_entity and in unsupported-operation errors.
    hint: str = ""


def icon_or(value: object, fallback: str) -> str:
    """Coerce an unknown icon name to a safe fallback rather than 422ing the call."""
    return value if isinstance(value, str) and value in _ICON_NAMES else fallback


def drop_unknown_icon(changes: dict[str, Any]) -> dict[str, Any]:
    """On an update, a typo'd icon name is a no-op, not an overwrite with the fallback."""
    if "icon" in changes and changes["icon"] not in _ICON_NAMES:
        return {key: value for key, value in changes.items() if key != "icon"}
    return changes


async def _prepare_institution(
    _db: AsyncSession, _user_id: UUID, data: dict[str, Any]
) -> dict[str, Any]:
    # Only a missing icon gets the default; a wrong one is reported, as before.
    return {**data, "icon": data.get("icon") or "bank"}


async def _prepare_category_group(
    _db: AsyncSession, _user_id: UUID, data: dict[str, Any]
) -> dict[str, Any]:
    return {
        **data,
        "color": data.get("color") or "#64748B",
        "icon": icon_or(data.get("icon"), "tag"),
    }


async def _prepare_category(
    db: AsyncSession, user_id: UUID, data: dict[str, Any]
) -> dict[str, Any]:
    """A category's kind is its group's kind and its colour defaults to the group's."""
    try:
        group_id = UUID(str(data.get("group_id")))
    except ValueError:
        return data  # let schema validation report the malformed id
    group = await ownership.get_owned(db, CategoryGroup, group_id, user_id)
    return {
        **data,
        "kind": group.kind,
        "color": data.get("color") or group.color,
        "icon": icon_or(data.get("icon"), "tag"),
    }


class ManualRateCreate(BaseModel):
    """A manual rate is keyed by its pair and date, which the HTTP API carries in
    the URL; here they travel in the payload."""

    base_code: str = Field(min_length=3, max_length=3)
    quote_code: str = Field(min_length=3, max_length=3)
    as_of: date
    rate: Decimal = Field(gt=0)


class InvestmentWalletChanges(InvestmentWalletUpdate):
    """Wallet edits plus archiving, which the services keep in a separate call."""

    non_nullable_fields = InvestmentWalletUpdate.non_nullable_fields | {"archived"}

    archived: bool | None = None


async def _delete_institution(db: AsyncSession, user_id: UUID, institution_id: UUID) -> None:
    # Default GUARD mode: refuses while accounts still use it. Never CASCADE from here.
    await institutions_service.delete_institution(db, user_id, institution_id)


async def _delete_loan(db: AsyncSession, user_id: UUID, loan_id: UUID) -> None:
    # Default DETACH mode: payments stay behind as plain expenses.
    await loans_service.delete_loan(db, user_id, loan_id)


async def _create_manual_rate(
    db: AsyncSession, user_id: UUID, data: ManualRateCreate
) -> ManualRate:
    return await manual_rates_service.upsert_manual_rate(
        db, user_id, data.base_code, data.quote_code, data.as_of, data.rate
    )


async def _create_wallet(
    db: AsyncSession, user_id: UUID, data: InvestmentWalletCreate
) -> InvestmentWallet:
    wallet, _account = await investments_service.create_wallet(db, user_id, data)
    return wallet


async def _update_goal(db: AsyncSession, user_id: UUID, goal_id: UUID, data: GoalUpdate) -> Goal:
    fields = data.model_dump(exclude_unset=True)
    archived = fields.pop("archived", None)
    goal = await ownership.get_owned(db, Goal, goal_id, user_id)
    if fields:
        goal = await goals_service.update_goal(db, user_id, goal_id, GoalUpdate(**fields))
    if archived is not None:
        goal, _account = await goals_service.set_goal_with_account_archived(
            db, user_id, goal_id, archived
        )
    return goal


async def _update_wallet(
    db: AsyncSession, user_id: UUID, wallet_id: UUID, data: InvestmentWalletChanges
) -> InvestmentWallet:
    fields = data.model_dump(exclude_unset=True)
    archived = fields.pop("archived", None)
    wallet = await investments_service.get_wallet(db, user_id, wallet_id)
    if fields:
        wallet = await investments_service.update_wallet(
            db, user_id, wallet_id, InvestmentWalletUpdate(**fields)
        )
    if archived is not None:
        wallet, _account = await investments_service.set_wallet_archived(
            db, user_id, wallet_id, archived
        )
    return wallet


async def _list_investment_transactions(
    db: AsyncSession, user_id: UUID
) -> list[InvestmentTransaction]:
    rows: list[InvestmentTransaction] = []
    for wallet in await investments_service.list_wallets(db, user_id):
        rows.extend(await investments_service.list_wallet_transactions(db, user_id, wallet.id))
    return rows


ENTITIES: dict[str, EntitySpec] = {
    spec.name: spec
    for spec in (
        EntitySpec(
            "institution",
            Institution,
            InstitutionRead,
            institutions_service.list_institutions,
            create=(InstitutionCreate, institutions_service.create_institution),
            update=(InstitutionUpdate, institutions_service.update_institution),
            delete=_delete_institution,
            prepare_create=_prepare_institution,
            hint="Delete fails while accounts still use the institution.",
        ),
        EntitySpec(
            "account",
            Account,
            AccountRead,
            accounts_service.list_accounts,
            create=(AccountCreate, accounts_service.create_account),
            update=(AccountUpdate, accounts_service.update_account),
            delete=accounts_service.delete_account,
            hint=(
                "Deleting an account also deletes its transactions, reconciliations, goal, "
                "loans and recurring rules. Prefer setting archived=true unless the user "
                "clearly wants it gone."
            ),
        ),
        EntitySpec(
            "category_group",
            CategoryGroup,
            CategoryGroupRead,
            category_groups_service.list_groups,
            create=(CategoryGroupCreate, category_groups_service.create_group),
            update=(CategoryGroupUpdate, category_groups_service.update_group),
            delete=category_groups_service.delete_group,
            prepare_create=_prepare_category_group,
            prepare_update=drop_unknown_icon,
            hint="Delete fails while the group has categories; it also drops its budgets.",
        ),
        EntitySpec(
            "category",
            Category,
            CategoryRead,
            categories_service.list_categories,
            create=(CategoryCreate, categories_service.create_category),
            update=(CategoryUpdate, categories_service.update_category),
            delete=categories_service.delete_category,
            prepare_create=_prepare_category,
            prepare_update=drop_unknown_icon,
            hint=(
                "Kind and colour come from the group. Delete fails while a transaction or "
                "recurring rule uses it."
            ),
        ),
        EntitySpec(
            "transaction",
            Transaction,
            TransactionRead,
            None,
            create=(TransactionCreate, transactions_service.create_transaction),
            update=(TransactionUpdate, transactions_service.update_transaction),
            delete=transactions_service.delete_transaction,
            hint="To find transactions use search_transactions; list_entities does not page them.",
        ),
        EntitySpec(
            "budget",
            Budget,
            BudgetRead,
            budgets_service.list_budgets,
            create=(BudgetUpsert, budgets_service.upsert_budget),
            delete=budgets_service.delete_budget,
            hint="create_entity creates or replaces the budget for that group and month.",
        ),
        EntitySpec(
            "budget_allocation",
            BudgetAllocation,
            BudgetAllocationRead,
            budget_plan_service.list_allocations,
            create=(BudgetAllocationUpsert, budget_plan_service.upsert_allocation),
            delete=budget_plan_service.delete_allocation,
            hint="create_entity creates or replaces the allocation for that group and month.",
        ),
        EntitySpec(
            "expected_income",
            ExpectedIncome,
            ExpectedIncomeRead,
            budget_plan_service.list_expected_income,
            create=(ExpectedIncomeUpsert, budget_plan_service.upsert_expected_income),
            hint=(
                "create_entity creates or replaces the month's expected income. It cannot be "
                "deleted; set the amount to 0 to clear it."
            ),
        ),
        EntitySpec(
            "goal",
            Goal,
            GoalRead,
            goals_service.list_goals,
            create=(GoalCreate, goals_service.create_goal),
            update=(GoalUpdate, _update_goal),
            hint="Goals are archive-only: use update_entity with archived=true.",
        ),
        EntitySpec(
            "recurring_rule",
            RecurringRule,
            RecurringRuleRead,
            recurring_rules_service.list_recurring_rules,
            create=(RecurringRuleCreate, recurring_rules_service.create_recurring_rule),
            update=(RecurringRuleUpdate, recurring_rules_service.update_recurring_rule),
            delete=recurring_rules_service.delete_recurring_rule,
        ),
        EntitySpec(
            "categorization_rule",
            CategorizationRule,
            CategorizationRuleRead,
            categorization_rules_service.list_rules,
            create=(CategorizationRuleCreate, categorization_rules_service.create_rule),
            update=(CategorizationRuleUpdate, categorization_rules_service.update_rule),
            delete=categorization_rules_service.delete_rule,
        ),
        EntitySpec(
            "reconciliation",
            Reconciliation,
            ReconciliationRead,
            reconciliations_service.list_,
            create=(ReconciliationCreate, reconciliations_service.create),
            delete=reconciliations_service.delete,
            hint="A reconciliation is opened and deleted here; its entries are not editable.",
        ),
        EntitySpec(
            "manual_rate",
            ManualRate,
            ManualRateRead,
            manual_rates_service.list_manual_rates,
            create=(ManualRateCreate, _create_manual_rate),
            delete=manual_rates_service.delete_manual_rate,
            hint="create_entity creates or replaces the rate for that pair and date.",
        ),
        EntitySpec(
            "loan",
            Loan,
            LoanRead,
            loans_service.list_loans,
            create=(LoanCreate, loans_service.create_loan),
            update=(LoanUpdate, loans_service.update_loan),
            delete=_delete_loan,
            hint="Deleting a loan keeps its payments as ordinary expenses.",
        ),
        EntitySpec(
            "investment_wallet",
            InvestmentWallet,
            InvestmentWalletRead,
            investments_service.list_wallets,
            create=(InvestmentWalletCreate, _create_wallet),
            update=(InvestmentWalletChanges, _update_wallet),
            hint="Wallets are archive-only: use update_entity with archived=true.",
        ),
        EntitySpec(
            "investment_asset",
            InvestmentAsset,
            InvestmentAssetRead,
            investments_service.list_assets,
            create=(InvestmentAssetCreate, investments_service.create_asset),
            update=(InvestmentAssetUpdate, investments_service.update_asset),
            hint="Assets are archive-only: use update_entity with archived=true.",
        ),
        EntitySpec(
            "investment_transaction",
            InvestmentTransaction,
            InvestmentTransactionRead,
            _list_investment_transactions,
            create=(InvestmentTransactionCreate, investments_service.create_investment_transaction),
            update=(InvestmentTransactionUpdate, investments_service.update_investment_transaction),
            delete=investments_service.delete_investment_transaction,
            hint=(
                "For buy/sell, `amount` is always derived from quantity * price - "
                "sending it alongside quantity and price has no effect. For a buy, "
                "you may instead omit quantity and price and send `amount` as the "
                "gross amount paid, fee included; the server resolves the quantity "
                "from the asset's price on that date. On update, sending `amount` "
                "alone (without quantity or price) reprices the buy the same way. "
                "`fee` is always separate: it adds to a buy's cost and reduces a "
                "sell's proceeds - never subtract it from `amount` yourself. If the "
                "wallet has a cash account, the matching transfer is created, "
                "updated, and deleted automatically - never create or edit it "
                "by hand."
            ),
        ),
    )
}

ENTITY_NAMES: tuple[str, ...] = tuple(sorted(ENTITIES))


def flatten_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Make a Pydantic JSON schema self-contained and compact for a model to read.

    Pydantic emits `$defs`/`$ref` for nested models and `anyOf: [X, null]` for
    optional fields; both are noise to an LLM, so refs are inlined and nullable
    unions collapsed to their one real type.
    """
    defs: dict[str, Any] = schema.get("$defs", {})

    def walk(node: Any, expanding: frozenset[str] = frozenset()) -> Any:
        if isinstance(node, list):
            return [walk(item, expanding) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            name = str(node["$ref"]).rsplit("/", 1)[-1]
            if name in expanding:
                return {"type": "object"}  # a model that contains itself: stop here
            return walk(defs.get(name, {}), expanding | {name})
        out: dict[str, Any] = {}
        for key, value in node.items():
            if key in ("$defs", "title"):
                continue
            if key == "properties":
                # Values are schemas, but the keys are field names - a field can
                # legitimately be called "title".
                out[key] = {name: walk(sub, expanding) for name, sub in value.items()}
            else:
                out[key] = walk(value, expanding)
        options = out.get("anyOf")
        if isinstance(options, list):
            real = [option for option in options if option != {"type": "null"}]
            if len(real) == 1:
                del out["anyOf"]
                out = {**real[0], **out}
        return out

    result: dict[str, Any] = walk(schema)
    return result
