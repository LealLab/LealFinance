"""Account CRUD and archive/unarchive - no delete, matching the frontend's
AccountRepository (accounts are archived, never removed).

Balances are always derived from opening_balance plus every transaction
that touches the account (Phase 5) - deliberately no stored balance column,
so the two can never drift apart.
"""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.account import ACCOUNT_TYPE_CREDIT_CARD, ACCOUNT_TYPE_GOAL, Account
from app.models.goal import Goal
from app.models.institution import Institution
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
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


async def account_has_ledger_references(db: AsyncSession, account_id: UUID) -> bool:
    """Return whether either a posted or projected ledger leg uses an account."""
    transaction_ref = exists().where(
        or_(Transaction.account_id == account_id, Transaction.to_account_id == account_id)
    )
    recurring_ref = exists().where(
        or_(
            RecurringRule.template_account_id == account_id,
            RecurringRule.template_to_account_id == account_id,
        )
    )
    return bool(await db.scalar(select(transaction_ref | recurring_ref)))


async def validate_account_identity_change(
    db: AsyncSession,
    account: Account,
    *,
    new_type: str,
    new_currency: str,
) -> None:
    if new_currency != account.currency and await account_has_ledger_references(db, account.id):
        raise ValidationAppError(code="account.currency_in_use")

    goal = await db.scalar(select(Goal).where(Goal.account_id == account.id))
    if goal is not None:
        if new_type != ACCOUNT_TYPE_GOAL:
            raise ValidationAppError(code="account.goal_requires_goal_type")
        if new_currency != goal.currency:
            raise ValidationAppError(code="account.goal_currency_mismatch")


async def update_account(
    db: AsyncSession, user_id: UUID, account_id: UUID, data: AccountUpdate
) -> Account:
    account = await ownership.get_owned(db, Account, account_id, user_id)
    changes = data.model_dump(exclude_unset=True)

    if "currency" in changes:
        await get_active_currency(db, changes["currency"])
    if "institution_id" in changes:
        await ownership.get_owned_or_none(db, Institution, changes["institution_id"], user_id)

    await validate_account_identity_change(
        db,
        account,
        new_type=changes.get("type", account.type),
        new_currency=changes.get("currency", account.currency),
    )

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
