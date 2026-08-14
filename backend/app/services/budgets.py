"""Budget CRUD. Upsert is keyed on (user, category, month), matching the
frontend's BudgetRepository.upsert."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import Budget
from app.models.category import Category
from app.schemas.budget import BudgetUpsert
from app.services import ownership
from app.services.currencies import get_active_currency


async def list_budgets(db: AsyncSession, user_id: UUID) -> list[Budget]:
    return list(await ownership.list_owned(db, Budget, user_id))


async def upsert_budget(db: AsyncSession, user_id: UUID, data: BudgetUpsert) -> Budget:
    await ownership.get_owned(db, Category, data.category_id, user_id)
    await get_active_currency(db, data.currency)

    result = await db.execute(
        select(Budget).where(
            Budget.user_id == user_id,
            Budget.category_id == data.category_id,
            Budget.month == data.month,
        )
    )
    budget = result.scalars().first()
    if budget is None:
        budget = Budget(user_id=user_id, category_id=data.category_id, month=data.month)
        db.add(budget)

    budget.amount = data.amount
    budget.currency = data.currency
    await db.commit()
    await db.refresh(budget)
    return budget


async def delete_budget(db: AsyncSession, user_id: UUID, budget_id: UUID) -> None:
    budget = await ownership.get_owned(db, Budget, budget_id, user_id)
    await db.delete(budget)
    await db.commit()
