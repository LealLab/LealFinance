"""Category CRUD, sibling reordering, and a referentially-guarded delete."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.category import Category
from app.schemas.category import (
    CategoryCreate,
    CategoryRead,
    CategoryReorderRequest,
    CategoryUpdate,
)
from app.services import categories as categories_service

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
async def list_categories(user: CurrentUser, db: DbSession) -> list[Category]:
    return await categories_service.list_categories(db, user.id)


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(payload: CategoryCreate, user: CurrentUser, db: DbSession) -> Category:
    return await categories_service.create_category(db, user.id, payload)


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_categories(
    payload: CategoryReorderRequest, user: CurrentUser, db: DbSession
) -> None:
    await categories_service.reorder_categories(
        db, user.id, payload.kind, payload.group_id, payload.ordered_ids
    )


@router.patch("/{category_id}", response_model=CategoryRead)
async def update_category(
    category_id: UUID, payload: CategoryUpdate, user: CurrentUser, db: DbSession
) -> Category:
    return await categories_service.update_category(db, user.id, category_id, payload)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await categories_service.delete_category(db, user.id, category_id)
