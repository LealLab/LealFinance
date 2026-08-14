"""Budget allocations and expected income - two resources, one file,
mirroring the frontend's single BudgetPlanRepository grouping at the
service layer (app/services/budget_plan.py) while keeping each its own
RESTful URL prefix."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.budget import BudgetAllocation, ExpectedIncome
from app.schemas.budget_plan import (
    BudgetAllocationRead,
    BudgetAllocationUpsert,
    ExpectedIncomeRead,
    ExpectedIncomeUpsert,
)
from app.services import budget_plan as budget_plan_service

allocations_router = APIRouter(prefix="/budget-allocations", tags=["budget-plan"])
expected_income_router = APIRouter(prefix="/expected-income", tags=["budget-plan"])


@allocations_router.get("", response_model=list[BudgetAllocationRead])
async def list_allocations(user: CurrentUser, db: DbSession) -> list[BudgetAllocation]:
    return await budget_plan_service.list_allocations(db, user.id)


@allocations_router.put("", response_model=BudgetAllocationRead)
async def upsert_allocation(
    payload: BudgetAllocationUpsert, user: CurrentUser, db: DbSession
) -> BudgetAllocation:
    return await budget_plan_service.upsert_allocation(db, user.id, payload)


@allocations_router.delete("/{allocation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_allocation(allocation_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await budget_plan_service.delete_allocation(db, user.id, allocation_id)


@expected_income_router.get("", response_model=list[ExpectedIncomeRead])
async def list_expected_income(user: CurrentUser, db: DbSession) -> list[ExpectedIncome]:
    return await budget_plan_service.list_expected_income(db, user.id)


@expected_income_router.put("", response_model=ExpectedIncomeRead)
async def upsert_expected_income(
    payload: ExpectedIncomeUpsert, user: CurrentUser, db: DbSession
) -> ExpectedIncome:
    return await budget_plan_service.upsert_expected_income(db, user.id, payload)
