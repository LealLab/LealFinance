"""Category CRUD, group validation, sibling ordering, and the delete/
kind-change guards that keep a category consistent with what references it.

`_category_in_use` checks every model that still references a category
(transactions and recurring templates), so delete and kind changes fail with
a stable domain error instead of reaching a foreign-key violation or
corrupting a stored template. Budgets, allocations, and nesting are scoped
to category groups now.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ValidationAppError
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
from app.schemas.category import CategoryCreate, CategoryUpdate
from app.services import ownership


async def _validate_group(db: AsyncSession, user_id: UUID, group_id: UUID, kind: str) -> None:
    group = await ownership.get_owned(db, CategoryGroup, group_id, user_id)
    if group.kind != kind:
        raise ValidationAppError(code="category.group_kind_mismatch")


async def _category_in_use(db: AsyncSession, category_id: UUID) -> bool:
    transaction = await db.execute(
        select(Transaction.id).where(Transaction.category_id == category_id).limit(1)
    )
    if transaction.scalar_one_or_none() is not None:
        return True
    recurring_rule = await db.execute(
        select(RecurringRule.id).where(RecurringRule.template_category_id == category_id).limit(1)
    )
    return recurring_rule.scalar_one_or_none() is not None


async def _next_position(db: AsyncSession, user_id: UUID, kind: str, group_id: UUID) -> int:
    result = await db.execute(
        select(func.max(Category.position)).where(
            Category.user_id == user_id, Category.kind == kind, Category.group_id == group_id
        )
    )
    current_max = result.scalar_one_or_none()
    return 0 if current_max is None else current_max + 1


async def list_categories(db: AsyncSession, user_id: UUID) -> list[Category]:
    return list(await ownership.list_owned(db, Category, user_id))


async def create_category(db: AsyncSession, user_id: UUID, data: CategoryCreate) -> Category:
    await _validate_group(db, user_id, data.group_id, data.kind)
    position = await _next_position(db, user_id, data.kind, data.group_id)

    category = Category(
        user_id=user_id,
        name=data.name,
        kind=data.kind,
        group_id=data.group_id,
        color=data.color,
        icon=data.icon,
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
    new_group_id = changes.get("group_id", category.group_id)
    kind_changing = "kind" in changes and changes["kind"] != category.kind
    group_changing = "group_id" in changes and changes["group_id"] != category.group_id

    if kind_changing or group_changing:
        await _validate_group(db, user_id, new_group_id, new_kind)

    if kind_changing and await _category_in_use(db, category_id):
        raise ConflictError(code="category.kind_immutable")

    for field, value in changes.items():
        setattr(category, field, value)
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
    group_id: UUID,
    ordered_ids: list[UUID],
) -> None:
    """Assigns sequential 0-based positions in `ordered_ids` order, only to
    ids that actually belong to this `(kind, group_id)` sibling group -
    matching the frontend mock store's `reorderCategories`. Ids outside the
    group, or siblings simply not listed, are left untouched."""
    result = await db.execute(
        select(Category).where(
            Category.user_id == user_id, Category.kind == kind, Category.group_id == group_id
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
