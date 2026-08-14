"""Budget allocations and expected income - the two inputs
domain/calc/budget-plan.ts derives auto-generated budgets from, grouped
here the way the frontend's single BudgetPlanRepository groups them.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BudgetAllocation, ExpectedIncome
from app.models.category import Category
from app.schemas.budget_plan import BudgetAllocationUpsert, ExpectedIncomeUpsert
from app.services import ownership
from app.services.currencies import get_active_currency

# --- Allocations ---------------------------------------------------------------


async def list_allocations(db: AsyncSession, user_id: UUID) -> list[BudgetAllocation]:
    return list(await ownership.list_owned(db, BudgetAllocation, user_id))


async def upsert_allocation(
    db: AsyncSession, user_id: UUID, data: BudgetAllocationUpsert
) -> BudgetAllocation:
    await ownership.get_owned(db, Category, data.category_id, user_id)

    result = await db.execute(
        select(BudgetAllocation).where(
            BudgetAllocation.user_id == user_id,
            BudgetAllocation.category_id == data.category_id,
        )
    )
    allocation = result.scalars().first()
    if allocation is None:
        allocation = BudgetAllocation(user_id=user_id, category_id=data.category_id)
        db.add(allocation)

    allocation.percentage = data.percentage
    await db.commit()
    await db.refresh(allocation)
    return allocation


async def delete_allocation(db: AsyncSession, user_id: UUID, allocation_id: UUID) -> None:
    allocation = await ownership.get_owned(db, BudgetAllocation, allocation_id, user_id)
    await db.delete(allocation)
    await db.commit()


# --- Expected income -------------------------------------------------------------


async def list_expected_income(db: AsyncSession, user_id: UUID) -> list[ExpectedIncome]:
    return list(await ownership.list_owned(db, ExpectedIncome, user_id))


async def upsert_expected_income(
    db: AsyncSession, user_id: UUID, data: ExpectedIncomeUpsert
) -> ExpectedIncome:
    await get_active_currency(db, data.currency)

    result = await db.execute(
        select(ExpectedIncome).where(
            ExpectedIncome.user_id == user_id, ExpectedIncome.month == data.month
        )
    )
    income = result.scalars().first()
    if income is None:
        income = ExpectedIncome(user_id=user_id, month=data.month)
        db.add(income)

    income.amount = data.amount
    income.currency = data.currency
    await db.commit()
    await db.refresh(income)
    return income
