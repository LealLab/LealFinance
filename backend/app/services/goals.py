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
from app.schemas.goal import GoalCreate, GoalUpdate
from app.services import ownership
from app.services.currencies import get_active_currency


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
