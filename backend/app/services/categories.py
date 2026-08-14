"""Category CRUD, one-level nesting, sibling ordering, and the delete/
kind-change guards that keep a category consistent with what references it.

`_category_in_use` currently checks children and budgets only - Phase 5
(transactions) extends it to also check transactions once that table
exists, per the frontend contract ("Category deletion fails when
referenced by transactions, budgets, or children").
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ValidationAppError
from app.models.budget import Budget
from app.models.category import Category
from app.schemas.category import CategoryCreate, CategoryUpdate
from app.services import ownership


async def _validate_parent(
    db: AsyncSession, user_id: UUID, parent_id: UUID | None, kind: str
) -> None:
    if parent_id is None:
        return
    parent = await ownership.get_owned(db, Category, parent_id, user_id)
    if parent.parent_id is not None:
        raise ValidationAppError(code="category.parent_not_top_level")
    if parent.kind != kind:
        raise ValidationAppError(code="category.parent_kind_mismatch")


async def _has_children(db: AsyncSession, category_id: UUID) -> bool:
    result = await db.execute(select(Category.id).where(Category.parent_id == category_id).limit(1))
    return result.scalar_one_or_none() is not None


async def _category_in_use(db: AsyncSession, category_id: UUID) -> bool:
    if await _has_children(db, category_id):
        return True
    result = await db.execute(select(Budget.id).where(Budget.category_id == category_id).limit(1))
    return result.scalar_one_or_none() is not None


async def _next_position(db: AsyncSession, user_id: UUID, kind: str, parent_id: UUID | None) -> int:
    result = await db.execute(
        select(func.max(Category.position)).where(
            Category.user_id == user_id, Category.kind == kind, Category.parent_id == parent_id
        )
    )
    current_max = result.scalar_one_or_none()
    return 0 if current_max is None else current_max + 1


async def list_categories(db: AsyncSession, user_id: UUID) -> list[Category]:
    return list(await ownership.list_owned(db, Category, user_id))


async def create_category(db: AsyncSession, user_id: UUID, data: CategoryCreate) -> Category:
    await _validate_parent(db, user_id, data.parent_id, data.kind)
    position = await _next_position(db, user_id, data.kind, data.parent_id)

    category = Category(
        user_id=user_id,
        name=data.name,
        kind=data.kind,
        parent_id=data.parent_id,
        color=data.color,
        icon=data.icon,
        archived=data.archived,
        position=position,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


async def update_category(
    db: AsyncSession, user_id: UUID, category_id: UUID, data: CategoryUpdate
) -> Category:
    category = await ownership.get_owned(db, Category, category_id, user_id)
    changes = data.model_dump(exclude_unset=True)

    new_kind = changes.get("kind", category.kind)
    new_parent_id = changes.get("parent_id", category.parent_id)
    kind_changing = "kind" in changes and changes["kind"] != category.kind
    parent_changing = "parent_id" in changes and changes["parent_id"] != category.parent_id

    if parent_changing and new_parent_id == category_id:
        raise ValidationAppError(code="category.parent_not_top_level")

    if parent_changing and new_parent_id is not None and await _has_children(db, category_id):
        # This category already has children of its own - giving it a
        # parent too would create a second level of nesting.
        raise ValidationAppError(code="category.parent_not_top_level")

    if kind_changing or parent_changing:
        await _validate_parent(db, user_id, new_parent_id, new_kind)

    if kind_changing and await _category_in_use(db, category_id):
        raise ConflictError(code="category.kind_immutable")

    for field, value in changes.items():
        setattr(category, field, value)
    await db.commit()
    await db.refresh(category)
    return category


async def set_category_archived(
    db: AsyncSession, user_id: UUID, category_id: UUID, archived: bool
) -> Category:
    category = await ownership.get_owned(db, Category, category_id, user_id)
    category.archived = archived
    await db.commit()
    await db.refresh(category)
    return category


async def delete_category(db: AsyncSession, user_id: UUID, category_id: UUID) -> None:
    category = await ownership.get_owned(db, Category, category_id, user_id)
    if await _category_in_use(db, category_id):
        raise ConflictError(code="category.in_use")
    await db.delete(category)
    await db.commit()


async def reorder_categories(
    db: AsyncSession,
    user_id: UUID,
    kind: str,
    parent_id: UUID | None,
    ordered_ids: list[UUID],
) -> None:
    """Assigns sequential 0-based positions in `ordered_ids` order, only to
    ids that actually belong to this `(kind, parent_id)` sibling group -
    matching the frontend mock store's `reorderCategories`. Ids outside the
    group, or siblings simply not listed, are left untouched."""
    result = await db.execute(
        select(Category).where(
            Category.user_id == user_id, Category.kind == kind, Category.parent_id == parent_id
        )
    )
    siblings = {category.id: category for category in result.scalars().all()}

    position = 0
    for category_id in ordered_ids:
        category = siblings.get(category_id)
        if category is None:
            continue
        category.position = position
        position += 1

    await db.commit()
