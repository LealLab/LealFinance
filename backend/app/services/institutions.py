"""Institution CRUD, archive/unarchive, and guarded delete with detach mode.

Deleting an institution can optionally detach its referencing accounts and
investment wallets in the same transaction.
"""

from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.account import Account
from app.models.institution import Institution
from app.models.investment import InvestmentWallet
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


async def delete_institution(
    db: AsyncSession, user_id: UUID, institution_id: UUID, detach: bool = False
) -> None:
    institution = await get_owned(db, Institution, institution_id, user_id)

    # An account can only reference institutions its own owner created (see
    # create_account's get_owned_or_none check), so no extra user_id filter
    # is needed here - any account referencing this id is already theirs. The
    # same ownership invariant is enforced for InvestmentWallet by
    # create_wallet's get_owned_or_none check.
    account_count = await db.scalar(
        select(func.count()).select_from(Account).where(Account.institution_id == institution_id)
    )
    wallet_count = await db.scalar(
        select(func.count())
        .select_from(InvestmentWallet)
        .where(InvestmentWallet.institution_id == institution_id)
    )
    account_count = int(account_count or 0)
    wallet_count = int(wallet_count or 0)

    if not detach and (account_count or wallet_count):
        raise ConflictError(
            code="institution.has_accounts",
            params={"accounts": account_count, "wallets": wallet_count},
        )

    if detach:
        await db.execute(
            update(Account)
            .where(Account.institution_id == institution_id)
            .values(institution_id=None)
        )
        await db.execute(
            update(InvestmentWallet)
            .where(InvestmentWallet.institution_id == institution_id)
            .values(institution_id=None)
        )

    await db.delete(institution)
    await db.commit()
