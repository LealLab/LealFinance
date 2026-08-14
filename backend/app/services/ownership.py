"""The one place a `user_id` filter is applied to a user-owned query.

Every service function that touches a user-owned table (see
app/models/base.py's `UserOwnedModel`) should go through `get_owned()` /
`list_owned()` here rather than building `select(SomeModel)` directly -
that's the whole invariant that keeps one user from ever seeing, or
referencing, another user's data.
"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models.base import UserOwnedModel


def owned[T: UserOwnedModel](model: type[T], user_id: UUID) -> Select[tuple[T]]:
    """A SELECT already scoped to one owner - the starting point for every
    user-owned query."""
    return select(model).where(model.user_id == user_id)


async def get_owned[T: UserOwnedModel](
    db: AsyncSession, model: type[T], entity_id: UUID, user_id: UUID
) -> T:
    """Fetch by id, scoped to the owner, or raise 404.

    404 rather than 403 on a foreign object is deliberate: a 403 would
    confirm the id exists at all, which is an enumeration oracle across
    other users' data.
    """
    result = await db.execute(owned(model, user_id).where(model.id == entity_id))
    entity = result.scalars().first()
    if entity is None:
        raise NotFoundError(
            code=f"{model.__error_prefix__}.not_found", params={"id": str(entity_id)}
        )
    return entity


async def get_owned_or_none[T: UserOwnedModel](
    db: AsyncSession, model: type[T], entity_id: UUID | None, user_id: UUID
) -> T | None:
    """Same as get_owned, for optional references (e.g. an account's
    institution_id). None in, None out; a *supplied* id that isn't the
    caller's own still 404s, so a cross-user id can never be written into a
    foreign key by mistake."""
    if entity_id is None:
        return None
    return await get_owned(db, model, entity_id, user_id)


async def list_owned[T: UserOwnedModel](
    db: AsyncSession, model: type[T], user_id: UUID
) -> Sequence[T]:
    result = await db.execute(owned(model, user_id))
    return result.scalars().all()


async def get_many_owned[T: UserOwnedModel](
    db: AsyncSession, model: type[T], ids: Sequence[UUID], user_id: UUID
) -> dict[UUID, T]:
    """Batch variant of get_owned, for validating several references in one
    round trip (e.g. a transfer touches two accounts plus a category)."""
    unique_ids = set(ids)
    if not unique_ids:
        return {}
    result = await db.execute(owned(model, user_id).where(model.id.in_(unique_ids)))
    found = {row.id: row for row in result.scalars().all()}
    missing = unique_ids - found.keys()
    if missing:
        raise NotFoundError(
            code=f"{model.__error_prefix__}.not_found", params={"id": str(next(iter(missing)))}
        )
    return found
