"""Category group CRUD, ordering, and referential-use guards.

Groups contain categories, budgets, and budget allocations. A group cannot be
deleted while any of those models still references it, and its kind cannot
change while those references exist.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.budget import Budget, BudgetAllocation
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.schemas.category_group import CategoryGroupCreate, CategoryGroupUpdate
from app.services import ownership


async def list_groups(db: AsyncSession, user_id: UUID) -> list[CategoryGroup]:
    return list(await ownership.list_owned(db, CategoryGroup, user_id))


async def _next_position(db: AsyncSession, user_id: UUID, kind: str) -> int:
    result = await db.execute(
        select(func.max(CategoryGroup.position)).where(
            CategoryGroup.user_id == user_id, CategoryGroup.kind == kind
        )
    )
    current_max = result.scalar_one_or_none()
    return 0 if current_max is None else current_max + 1


async def create_group(db: AsyncSession, user_id: UUID, data: CategoryGroupCreate) -> CategoryGroup:
    position = await _next_position(db, user_id, data.kind)
    group = CategoryGroup(user_id=user_id, **data.model_dump(), position=position)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


async def _has_categories(db: AsyncSession, group_id: UUID) -> bool:
    result = await db.execute(select(Category.id).where(Category.group_id == group_id).limit(1))
    return result.scalar_one_or_none() is not None


async def _has_budget(db: AsyncSession, group_id: UUID) -> bool:
    result = await db.execute(select(Budget.id).where(Budget.group_id == group_id).limit(1))
    return result.scalar_one_or_none() is not None


async def _has_allocation(db: AsyncSession, group_id: UUID) -> bool:
    result = await db.execute(
        select(BudgetAllocation.id).where(BudgetAllocation.group_id == group_id).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _group_in_use(db: AsyncSession, group_id: UUID) -> bool:
    if await _has_categories(db, group_id):
        return True
    if await _has_budget(db, group_id):
        return True
    return await _has_allocation(db, group_id)


async def update_group(
    db: AsyncSession, user_id: UUID, group_id: UUID, data: CategoryGroupUpdate
) -> CategoryGroup:
    group = await ownership.get_owned(db, CategoryGroup, group_id, user_id)
    changes = data.model_dump(exclude_unset=True)

    kind_changing = "kind" in changes and changes["kind"] != group.kind
    if kind_changing and await _group_in_use(db, group_id):
        raise ConflictError(code="category_group.kind_immutable")

    for field, value in changes.items():
        setattr(group, field, value)
    await db.commit()
    await db.refresh(group)
    return group


async def delete_group(db: AsyncSession, user_id: UUID, group_id: UUID) -> None:
    group = await ownership.get_owned(db, CategoryGroup, group_id, user_id)
    if await _group_in_use(db, group_id):
        raise ConflictError(code="category_group.in_use")
    await db.delete(group)
    await db.commit()


async def reorder_groups(
    db: AsyncSession,
    user_id: UUID,
    kind: str,
    ordered_ids: list[UUID],
) -> None:
    """Assign sequential 0-based positions in `ordered_ids` order, only to
    ids that belong to this `(kind)` group set. Ids outside the set, or groups
    simply not listed, are left untouched."""
    result = await db.execute(
        select(CategoryGroup).where(CategoryGroup.user_id == user_id, CategoryGroup.kind == kind)
    )
    groups = {group.id: group for group in result.scalars().all()}

    position = 0
    for group_id in ordered_ids:
        group = groups.get(group_id)
        if group is None:
            continue
        group.position = position
        position += 1

    await db.commit()
