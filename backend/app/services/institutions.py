"""Institution CRUD, archive/unarchive, and guarded delete modes.

Deleting an institution can detach or cascade its referencing accounts and
investment wallets in the same transaction.
"""

from enum import StrEnum
from uuid import UUID

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.account import Account
from app.models.institution import Institution
from app.models.investment import InvestmentTransaction, InvestmentWallet
from app.schemas.institution import InstitutionCreate, InstitutionUpdate
from app.services import accounts as accounts_service
from app.services import ownership
from app.services.ownership import get_owned, list_owned


class InstitutionDeleteMode(StrEnum):
    GUARD = "guard"
    DETACH = "detach"
    CASCADE = "cascade"


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
    db: AsyncSession,
    user_id: UUID,
    institution_id: UUID,
    mode: InstitutionDeleteMode = InstitutionDeleteMode.GUARD,
) -> None:
    institution = await get_owned(db, Institution, institution_id, user_id)

    accounts = list(
        (
            await db.scalars(
                ownership.owned(Account, user_id).where(Account.institution_id == institution_id)
            )
        ).all()
    )
    wallets = list(
        (
            await db.scalars(
                ownership.owned(InvestmentWallet, user_id).where(
                    InvestmentWallet.institution_id == institution_id
                )
            )
        ).all()
    )
    account_ids = [account.id for account in accounts]
    wallet_ids = [wallet.id for wallet in wallets]

    if mode == "guard" and (account_ids or wallet_ids):
        raise ConflictError(
            code="institution.has_accounts",
            params={"accounts": len(account_ids), "wallets": len(wallet_ids)},
        )

    if mode == "detach":
        await db.execute(
            update(Account).where(Account.id.in_(account_ids)).values(institution_id=None)
        )
        await db.execute(
            update(InvestmentWallet)
            .where(InvestmentWallet.id.in_(wallet_ids))
            .values(institution_id=None)
        )
    elif mode == "cascade":
        await accounts_service.cascade_delete_accounts(db, user_id, account_ids, commit=False)
        # A wallet may be linked to an institution without its account being
        # linked to it; remove those wallet-only references too.
        if wallet_ids:
            await db.execute(
                delete(InvestmentTransaction).where(
                    InvestmentTransaction.user_id == user_id,
                    InvestmentTransaction.wallet_id.in_(wallet_ids),
                )
            )
            await db.execute(
                delete(InvestmentWallet).where(
                    InvestmentWallet.user_id == user_id,
                    InvestmentWallet.id.in_(wallet_ids),
                )
            )

    await db.delete(institution)
    await db.commit()
