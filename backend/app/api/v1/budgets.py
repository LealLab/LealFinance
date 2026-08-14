"""Budget list/upsert/delete."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.budget import Budget
from app.schemas.budget import BudgetRead, BudgetUpsert
from app.services import budgets as budgets_service

router = APIRouter(prefix="/budgets", tags=["budgets"])


@router.get("", response_model=list[BudgetRead])
async def list_budgets(user: CurrentUser, db: DbSession) -> list[Budget]:
    return await budgets_service.list_budgets(db, user.id)


@router.put("", response_model=BudgetRead)
async def upsert_budget(payload: BudgetUpsert, user: CurrentUser, db: DbSession) -> Budget:
    return await budgets_service.upsert_budget(db, user.id, payload)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(budget_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await budgets_service.delete_budget(db, user.id, budget_id)
