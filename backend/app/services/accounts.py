"""Account CRUD and archive/unarchive - no delete, matching the frontend's
AccountRepository (accounts are archived, never removed).

Balances are always derived from opening_balance plus every transaction
that touches the account (Phase 5) - deliberately no stored balance column,
so the two can never drift apart.
"""

from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.account import ACCOUNT_TYPE_CREDIT_CARD, Account
from app.models.institution import Institution
from app.schemas.account import AccountCreate, AccountUpdate
from app.services import ownership
from app.services.currencies import get_active_currency


def _check_credit_card_fields(
    account_type: str,
    credit_limit: Decimal | None,
    closing_day: int | None,
    due_day: int | None,
) -> None:
    if account_type != ACCOUNT_TYPE_CREDIT_CARD and (
        credit_limit is not None or closing_day is not None or due_day is not None
    ):
        raise ValidationAppError(code="account.credit_fields_not_applicable")


async def list_accounts(db: AsyncSession, user_id: UUID) -> list[Account]:
    return list(await ownership.list_owned(db, Account, user_id))


async def get_account(db: AsyncSession, user_id: UUID, account_id: UUID) -> Account:
    return await ownership.get_owned(db, Account, account_id, user_id)


async def create_account(db: AsyncSession, user_id: UUID, data: AccountCreate) -> Account:
    await get_active_currency(db, data.currency)
    await ownership.get_owned_or_none(db, Institution, data.institution_id, user_id)
    _check_credit_card_fields(data.type, data.credit_limit, data.closing_day, data.due_day)

    account = Account(user_id=user_id, **data.model_dump())
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


async def update_account(
    db: AsyncSession, user_id: UUID, account_id: UUID, data: AccountUpdate
) -> Account:
    account = await ownership.get_owned(db, Account, account_id, user_id)
    changes = data.model_dump(exclude_unset=True)

    if "currency" in changes:
        await get_active_currency(db, changes["currency"])
    if "institution_id" in changes:
        await ownership.get_owned_or_none(db, Institution, changes["institution_id"], user_id)

    _check_credit_card_fields(
        changes.get("type", account.type),
        changes.get("credit_limit", account.credit_limit),
        changes.get("closing_day", account.closing_day),
        changes.get("due_day", account.due_day),
    )

    for field, value in changes.items():
        setattr(account, field, value)
    await db.commit()
    await db.refresh(account)
    return account


async def set_account_archived(
    db: AsyncSession, user_id: UUID, account_id: UUID, archived: bool
) -> Account:
    account = await ownership.get_owned(db, Account, account_id, user_id)
    account.archived = archived
    await db.commit()
    await db.refresh(account)
    return account
