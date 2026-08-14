"""Institution CRUD, archive/unarchive, and the delete guard that blocks
removing an institution while any account still references it.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.account import Account
from app.models.institution import Institution
from app.schemas.institution import InstitutionCreate, InstitutionUpdate
from app.services.ownership import get_owned, list_owned


async def list_institutions(db: AsyncSession, user_id: UUID) -> list[Institution]:
    return list(await list_owned(db, Institution, user_id))


async def get_institution(db: AsyncSession, user_id: UUID, institution_id: UUID) -> Institution:
    return await get_owned(db, Institution, institution_id, user_id)


async def create_institution(
    db: AsyncSession, user_id: UUID, data: InstitutionCreate
) -> Institution:
    institution = Institution(user_id=user_id, **data.model_dump())
    db.add(institution)
    await db.commit()
    await db.refresh(institution)
    return institution


async def update_institution(
    db: AsyncSession, user_id: UUID, institution_id: UUID, data: InstitutionUpdate
) -> Institution:
    institution = await get_owned(db, Institution, institution_id, user_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(institution, field, value)
    await db.commit()
    await db.refresh(institution)
    return institution


async def set_institution_archived(
    db: AsyncSession, user_id: UUID, institution_id: UUID, archived: bool
) -> Institution:
    institution = await get_owned(db, Institution, institution_id, user_id)
    institution.archived = archived
    await db.commit()
    await db.refresh(institution)
    return institution


async def delete_institution(db: AsyncSession, user_id: UUID, institution_id: UUID) -> None:
    institution = await get_owned(db, Institution, institution_id, user_id)

    # An account can only reference institutions its own owner created (see
    # create_account's get_owned_or_none check), so no extra user_id filter
    # is needed here - any account referencing this id is already theirs.
    has_accounts = await db.execute(
        select(Account.id).where(Account.institution_id == institution_id).limit(1)
    )
    if has_accounts.scalar_one_or_none() is not None:
        raise ConflictError(code="institution.has_accounts")

    await db.delete(institution)
    await db.commit()
