"""Goal CRUD - metadata over a goal-type Account. No delete; archive only,
matching the frontend's GoalRepository. Balance stays derived from the
linked account's ledger; this service never computes one.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ValidationAppError
from app.models.account import ACCOUNT_TYPE_GOAL, Account
from app.models.goal import Goal
from app.schemas.goal import GoalCreate, GoalUpdate, GoalWithAccountCreate, GoalWithAccountUpdate
from app.services import accounts as accounts_service
from app.services import ownership
from app.services.currencies import get_active_currency
from app.services.exchange_rates import ensure_rates_cached


async def _validate_account(
    db: AsyncSession, user_id: UUID, account_id: UUID, currency: str
) -> None:
    account = await ownership.get_owned(db, Account, account_id, user_id)
    if account.type != ACCOUNT_TYPE_GOAL:
        raise ValidationAppError(code="goal.account_not_goal_type")
    # The frontend's balance/remaining math (domain/calc/goals.ts) subtracts
    # target from the account's own balance directly - a currency mismatch
    # there throws, so the two must always agree.
    if account.currency != currency:
        raise ValidationAppError(code="goal.currency_mismatch")


async def _check_account_available(
    db: AsyncSession, account_id: UUID, exclude_goal_id: UUID | None = None
) -> None:
    query = select(Goal.id).where(Goal.account_id == account_id)
    if exclude_goal_id is not None:
        query = query.where(Goal.id != exclude_goal_id)
    existing = await db.execute(query)
    if existing.scalar_one_or_none() is not None:
        raise ConflictError(code="goal.account_already_has_goal")


async def list_goals(db: AsyncSession, user_id: UUID) -> list[Goal]:
    return list(await ownership.list_owned(db, Goal, user_id))


async def create_goal(db: AsyncSession, user_id: UUID, data: GoalCreate) -> Goal:
    if data.interval is not None and data.frequency is None:
        raise ValidationAppError(code="goal.interval_requires_frequency")

    await get_active_currency(db, data.currency)
    await _validate_account(db, user_id, data.account_id, data.currency)
    await _check_account_available(db, data.account_id)

    goal = Goal(user_id=user_id, **data.model_dump())
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return goal


async def update_goal(db: AsyncSession, user_id: UUID, goal_id: UUID, data: GoalUpdate) -> Goal:
    goal = await ownership.get_owned(db, Goal, goal_id, user_id)
    changes = data.model_dump(exclude_unset=True)

    new_frequency = changes.get("frequency", goal.frequency)
    new_interval = changes.get("interval", goal.interval)
    if new_interval is not None and new_frequency is None:
        raise ValidationAppError(code="goal.interval_requires_frequency")

    if "currency" in changes:
        await get_active_currency(db, changes["currency"])

    effective_currency = changes.get("currency", goal.currency)
    effective_account_id = changes.get("account_id", goal.account_id)
    if "account_id" in changes or "currency" in changes:
        await _validate_account(db, user_id, effective_account_id, effective_currency)
    if "account_id" in changes and effective_account_id != goal.account_id:
        await _check_account_available(db, effective_account_id, exclude_goal_id=goal_id)

    for field, value in changes.items():
        setattr(goal, field, value)
    await db.commit()
    await db.refresh(goal)
    return goal


async def set_goal_archived(db: AsyncSession, user_id: UUID, goal_id: UUID, archived: bool) -> Goal:
    goal = await ownership.get_owned(db, Goal, goal_id, user_id)
    goal.archived = archived
    await db.commit()
    await db.refresh(goal)
    return goal


def _validate_schedule(frequency: str | None, interval: int | None) -> None:
    if interval is not None and frequency is None:
        raise ValidationAppError(code="goal.interval_requires_frequency")


async def create_goal_with_account(
    db: AsyncSession, user_id: UUID, data: GoalWithAccountCreate
) -> tuple[Goal, Account]:
    _validate_schedule(data.frequency, data.interval)
    await get_active_currency(db, data.currency)
    account = Account(
        user_id=user_id,
        name=data.name,
        type=ACCOUNT_TYPE_GOAL,
        currency=data.currency,
        opening_balance=0,
        institution_id=None,
        archived=data.archived,
    )
    db.add(account)
    try:
        await db.flush()
        goal = Goal(user_id=user_id, account_id=account.id, **data.model_dump())
        db.add(goal)
        await ensure_rates_cached(db)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(account)
    await db.refresh(goal)
    return goal, account


async def update_goal_with_account(
    db: AsyncSession, user_id: UUID, goal_id: UUID, data: GoalWithAccountUpdate
) -> tuple[Goal, Account]:
    goal = await ownership.get_owned(db, Goal, goal_id, user_id)
    account = await ownership.get_owned(db, Account, goal.account_id, user_id)
    changes = data.model_dump(exclude_unset=True)
    _validate_schedule(
        changes.get("frequency", goal.frequency), changes.get("interval", goal.interval)
    )
    currency = changes.get("currency", goal.currency)
    if "currency" in changes:
        await get_active_currency(db, currency)
    if currency != account.currency and await accounts_service.account_has_ledger_references(
        db, account.id
    ):
        raise ValidationAppError(code="account.currency_in_use")
    if "name" in changes:
        account.name = changes["name"]
    if "currency" in changes:
        account.currency = currency
    for field, value in changes.items():
        setattr(goal, field, value)
    if "currency" in changes:
        await ensure_rates_cached(db)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(account)
    await db.refresh(goal)
    return goal, account


async def set_goal_with_account_archived(
    db: AsyncSession, user_id: UUID, goal_id: UUID, archived: bool
) -> tuple[Goal, Account]:
    goal = await ownership.get_owned(db, Goal, goal_id, user_id)
    account = await ownership.get_owned(db, Account, goal.account_id, user_id)
    goal.archived = archived
    account.archived = archived
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(account)
    await db.refresh(goal)
    return goal, account
