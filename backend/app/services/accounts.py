"""Account CRUD and archive/unarchive - no delete, matching the frontend's
AccountRepository (accounts are archived, never removed).

Balances are always derived from opening_balance plus every transaction
that touches the account (Phase 5) - deliberately no stored balance column,
so the two can never drift apart.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date as date_type
from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, delete, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.account import ACCOUNT_TYPE_CREDIT_CARD, ACCOUNT_TYPE_GOAL, Account
from app.models.goal import Goal
from app.models.institution import Institution
from app.models.investment import InvestmentTransaction, InvestmentWallet
from app.models.loan import Loan
from app.models.recurring import RecurringRule
from app.models.transaction import (
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_INTEREST,
    TRANSACTION_TYPE_TRANSFER,
    Transaction,
)
from app.schemas.account import AccountCreate, AccountUpdate
from app.services import card_invoices, ownership
from app.services.currencies import get_active_currency
from app.services.exchange_rates import ensure_rates_cached


def _check_credit_card_fields(
    account_type: str,
    credit_limit: Decimal | None,
    closing_day: int | None,
    due_day: int | None,
    payment_account_id: UUID | None,
    auto_pay: bool,
) -> None:
    if account_type != ACCOUNT_TYPE_CREDIT_CARD and (
        credit_limit is not None
        or closing_day is not None
        or due_day is not None
        or payment_account_id is not None
        or auto_pay
    ):
        raise ValidationAppError(code="account.credit_fields_not_applicable")
    if auto_pay and payment_account_id is None:
        raise ValidationAppError(code="account.auto_pay_requires_account")


async def _validate_payment_account(
    db: AsyncSession,
    user_id: UUID,
    card_id: UUID | None,
    payment_account_id: UUID,
    card_currency: str,
) -> None:
    """The account that pays a card's invoices: owned, not archived, same
    currency as the card, and not the card itself. Mirrors
    app/services/loans.py::_validate_payment_account."""
    account = await ownership.get_owned(db, Account, payment_account_id, user_id)
    if account.id == card_id:
        raise ValidationAppError(code="account.payment_account_is_self")
    if account.archived:
        raise ValidationAppError(code="account.payment_account_archived")
    if account.type == ACCOUNT_TYPE_CREDIT_CARD:
        raise ValidationAppError(code="account.payment_account_is_credit_card")
    if account.currency != card_currency:
        raise ValidationAppError(code="account.payment_account_currency_mismatch")


async def list_accounts(db: AsyncSession, user_id: UUID) -> list[Account]:
    return list(await ownership.list_owned(db, Account, user_id))


@dataclass
class AccountBalance:
    account_id: UUID
    currency: str
    balance: Decimal


async def account_balances(
    db: AsyncSession, user_id: UUID, *, as_of: date_type | None = None
) -> list[AccountBalance]:
    """Every owned account's balance = opening_balance + every transaction
    that touches it, computed as SQL aggregates rather than by loading the
    whole ledger into Python. Ports the exact signed formula documented on
    the frontend's domain/calc/balances.ts::accountBalance - keep the two in
    sync. Not a literal shared fixture (no such cross-language harness
    exists in this repo - see balances.ts's ponytail note), but both sides
    carry matching coverage per leg type, including the transfer +
    cross-currency-conversion combination that a past bug was in (see
    test_account_balances_use_converted_amount_for_cross_currency_transfer
    here and balances.spec.ts's "debits the source ... credits the
    destination" test).

    `as_of` (inclusive) restricts the ledger to transactions on or before
    that date - the transactions calendar anchors each month on the balance
    the day before it starts.
    """
    accounts = list(await ownership.list_owned(db, Account, user_id))
    if not accounts:
        return []

    effective = func.coalesce(Transaction.conversion_amount, Transaction.amount)
    # The leg posted on Transaction.account_id: full signed delta for
    # income/expense/interest, and the (always unconverted) outgoing debit
    # for a transfer's source leg.
    own_leg_delta = case(
        (Transaction.type.in_((TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_INTEREST)), effective),
        (Transaction.type == TRANSACTION_TYPE_EXPENSE, -effective),
        (Transaction.type == TRANSACTION_TYPE_TRANSFER, -Transaction.amount),
        else_=0,
    )
    own_leg = select(
        Transaction.account_id.label("account_id"), own_leg_delta.label("delta")
    ).where(Transaction.user_id == user_id)
    # A transfer's incoming leg, credited to to_account_id instead.
    incoming_leg = select(
        Transaction.to_account_id.label("account_id"), effective.label("delta")
    ).where(
        Transaction.user_id == user_id,
        Transaction.type == TRANSACTION_TYPE_TRANSFER,
    )
    if as_of is not None:
        own_leg = own_leg.where(Transaction.date <= as_of)
        incoming_leg = incoming_leg.where(Transaction.date <= as_of)
    legs = own_leg.union_all(incoming_leg).subquery()
    deltas_query = select(legs.c.account_id, func.sum(legs.c.delta).label("delta")).group_by(
        legs.c.account_id
    )
    result = await db.execute(deltas_query)
    delta_by_account = {row.account_id: row.delta for row in result}

    return [
        AccountBalance(
            account_id=account.id,
            currency=account.currency,
            balance=account.opening_balance + delta_by_account.get(account.id, Decimal(0)),
        )
        for account in accounts
    ]


async def real_balance_contributions(
    db: AsyncSession, user_id: UUID, *, today: date_type
) -> list[AccountBalance]:
    """Return each active account's contribution to the cash-position view.

    A configured credit card contributes only the residual of invoices due by
    ``today``; its raw ledger balance is deliberately excluded so an open
    cycle does not reduce available cash. Cards without a complete cycle
    configuration fall back to their raw balance because there is no due date
    at which their debt can become a cash obligation.
    """
    accounts = list(await ownership.list_owned(db, Account, user_id))
    balances = {row.account_id: row for row in await account_balances(db, user_id)}
    contributions: list[AccountBalance] = []

    for account in accounts:
        if account.archived:
            continue
        balance = balances[account.id]
        contribution = balance.balance
        if (
            account.type == ACCOUNT_TYPE_CREDIT_CARD
            and account.closing_day is not None
            and account.due_day is not None
        ):
            transaction_scope = (
                ownership.owned(Transaction, user_id)
                .where(
                    or_(
                        Transaction.account_id == account.id,
                        Transaction.to_account_id == account.id,
                    )
                )
                .subquery()
            )
            oldest = await db.scalar(select(func.min(transaction_scope.c.date)))
            months_back = (
                max((today.year - oldest.year) * 12 + today.month - oldest.month + 1, 0)
                if oldest is not None
                else 0
            )
            invoices = await card_invoices.list_invoices(
                db,
                user_id,
                account.id,
                today=today,
                months_back=months_back,
                months_ahead=0,
            )
            contribution = -sum(
                (invoice.remaining for invoice in invoices if invoice.due_date <= today),
                Decimal(0),
            )
        contributions.append(
            AccountBalance(
                account_id=account.id,
                currency=account.currency,
                balance=contribution,
            )
        )

    return contributions


async def get_account(db: AsyncSession, user_id: UUID, account_id: UUID) -> Account:
    return await ownership.get_owned(db, Account, account_id, user_id)


async def create_account(db: AsyncSession, user_id: UUID, data: AccountCreate) -> Account:
    await get_active_currency(db, data.currency)
    await ownership.get_owned_or_none(db, Institution, data.institution_id, user_id)
    _check_credit_card_fields(
        data.type,
        data.credit_limit,
        data.closing_day,
        data.due_day,
        data.payment_account_id,
        data.auto_pay,
    )
    if data.payment_account_id is not None:
        await _validate_payment_account(db, user_id, None, data.payment_account_id, data.currency)

    account = Account(user_id=user_id, **data.model_dump())
    db.add(account)
    await ensure_rates_cached(db)
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

    effective_type = changes.get("type", account.type)
    effective_currency = changes.get("currency", account.currency)
    effective_payment_account_id = changes.get("payment_account_id", account.payment_account_id)
    effective_auto_pay = changes.get("auto_pay", account.auto_pay)
    _check_credit_card_fields(
        effective_type,
        changes.get("credit_limit", account.credit_limit),
        changes.get("closing_day", account.closing_day),
        changes.get("due_day", account.due_day),
        effective_payment_account_id,
        effective_auto_pay,
    )
    if effective_payment_account_id is not None:
        await _validate_payment_account(
            db, user_id, account.id, effective_payment_account_id, effective_currency
        )

    for field, value in changes.items():
        setattr(account, field, value)
    if "currency" in changes:
        await ensure_rates_cached(db)
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


async def cascade_delete_accounts(
    db: AsyncSession,
    user_id: UUID,
    account_ids: Sequence[UUID],
    *,
    commit: bool = True,
) -> None:
    """Delete owned accounts and their dependent financial data atomically."""
    accounts = await ownership.get_many_owned(db, Account, account_ids, user_id)
    if not accounts:
        if commit:
            await db.commit()
        return

    target_ids = tuple(accounts)
    target_account_ids = (
        ownership.owned(Account, user_id)
        .where(Account.id.in_(target_ids))
        .with_only_columns(Account.id)
    )
    target_wallet_ids = (
        ownership.owned(InvestmentWallet, user_id)
        .where(
            or_(
                InvestmentWallet.account_id.in_(target_account_ids),
                InvestmentWallet.cash_account_id.in_(target_account_ids),
            )
        )
        .with_only_columns(InvestmentWallet.id)
    )
    target_transaction_ids = (
        ownership.owned(Transaction, user_id)
        .where(
            or_(
                Transaction.account_id.in_(target_account_ids),
                Transaction.to_account_id.in_(target_account_ids),
            )
        )
        .with_only_columns(Transaction.id)
    )

    # 1. Investment transactions reference both wallets and transactions.
    await db.execute(
        delete(InvestmentTransaction).where(
            InvestmentTransaction.id.in_(
                ownership.owned(InvestmentTransaction, user_id)
                .where(
                    or_(
                        InvestmentTransaction.wallet_id.in_(target_wallet_ids),
                        InvestmentTransaction.transaction_id.in_(target_transaction_ids),
                    )
                )
                .with_only_columns(InvestmentTransaction.id)
            )
        )
    )
    # 2. Investment wallets reference accounts through either account leg.
    await db.execute(delete(InvestmentWallet).where(InvestmentWallet.id.in_(target_wallet_ids)))
    # 3. Transactions reference accounts through either ledger leg.
    await db.execute(delete(Transaction).where(Transaction.id.in_(target_transaction_ids)))
    # 4. Goals reference their account directly.
    await db.execute(
        delete(Goal).where(
            Goal.id.in_(
                ownership.owned(Goal, user_id)
                .where(Goal.account_id.in_(target_account_ids))
                .with_only_columns(Goal.id)
            )
        )
    )
    # 5. Loans reference their optional payment account.
    await db.execute(
        delete(Loan).where(
            Loan.id.in_(
                ownership.owned(Loan, user_id)
                .where(Loan.payment_account_id.in_(target_account_ids))
                .with_only_columns(Loan.id)
            )
        )
    )
    # 6. Recurring rules reference one or both template accounts.
    await db.execute(
        delete(RecurringRule).where(
            RecurringRule.id.in_(
                ownership.owned(RecurringRule, user_id)
                .where(
                    or_(
                        RecurringRule.template_account_id.in_(target_account_ids),
                        RecurringRule.template_to_account_id.in_(target_account_ids),
                    )
                )
                .with_only_columns(RecurringRule.id)
            )
        )
    )
    # 7. Clear surviving accounts' self-referential payment links.
    await db.execute(
        update(Account)
        .where(
            Account.id.in_(
                ownership.owned(Account, user_id)
                .where(
                    Account.id.not_in(target_ids),
                    Account.payment_account_id.in_(target_ids),
                )
                .with_only_columns(Account.id)
            )
        )
        .values(payment_account_id=None)
    )
    # 8. Delete the accounts themselves.
    await db.execute(delete(Account).where(Account.id.in_(target_account_ids)))

    if commit:
        await db.commit()
