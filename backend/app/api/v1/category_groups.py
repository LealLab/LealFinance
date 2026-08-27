"""Category group CRUD and sibling reordering."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.category_group import CategoryGroup
from app.schemas.category_group import (
    CategoryGroupCreate,
    CategoryGroupRead,
    CategoryGroupReorderRequest,
    CategoryGroupUpdate,
)
from app.services import category_groups as category_groups_service

router = APIRouter(prefix="/category-groups", tags=["category-groups"])


@router.get("", response_model=list[CategoryGroupRead])
async def list_groups(user: CurrentUser, db: DbSession) -> list[CategoryGroup]:
    return await category_groups_service.list_groups(db, user.id)


@router.post("", response_model=CategoryGroupRead, status_code=status.HTTP_201_CREATED)
async def create_group(
    payload: CategoryGroupCreate, user: CurrentUser, db: DbSession
) -> CategoryGroup:
    return await category_groups_service.create_group(db, user.id, payload)


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_groups(
    payload: CategoryGroupReorderRequest, user: CurrentUser, db: DbSession
) -> None:
    await category_groups_service.reorder_groups(db, user.id, payload.kind, payload.ordered_ids)


@router.patch("/{group_id}", response_model=CategoryGroupRead)
async def update_group(
    group_id: UUID, payload: CategoryGroupUpdate, user: CurrentUser, db: DbSession
) -> CategoryGroup:
    return await category_groups_service.update_group(db, user.id, group_id, payload)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await category_groups_service.delete_group(db, user.id, group_id)
