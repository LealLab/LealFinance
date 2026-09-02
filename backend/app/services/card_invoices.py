"""Credit-card invoices (faturas), derived from the ledger - there is no
invoice table.

An invoice is one billing cycle of a `credit_card` account, identified by
its **close date**. Its total is a signed SUM over the card's transactions
in the cycle's date window, exactly the way
`app/services/accounts.py::account_balances` sums a balance and
`app/services/loans.py::installments_paid` counts installments. Deleting a
charge or a payment, or moving a date, re-derives every number with
nothing to reconcile.

Cycle math (`closing_day`, `due_day`, both 1-31, clamped to short months):

- The close date of a month is `closing_day` of that month.
- A charge dated `d` belongs to the cycle whose close date is the
  smallest one `>= d` (a charge on the close day itself is in that cycle).
- The due date is the first `due_day` strictly after the close date - the
  same month when `due_day > closing_day`, otherwise the next.

A card without both `closing_day` and `due_day` has no invoices; callers
get an empty list.

Future cycles ("faturas futuras") add, on top of charges already booked
(this is where installments land), the projected occurrences of every
`RecurringRule` whose template posts to the card - reusing
`app/services/recurrence.py::project_occurrence_dates`, the same projector
the recurring worker uses. Projections are never persisted.
"""

import calendar
from dataclasses import dataclass
from datetime import date as date_type
from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.models.account import ACCOUNT_TYPE_CREDIT_CARD, Account
from app.models.recurring import RecurringRule
from app.models.transaction import (
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_INTEREST,
    TRANSACTION_TYPE_TRANSFER,
    Transaction,
)
from app.schemas.card_invoice import CardInvoicePaymentCreate
from app.schemas.transaction import TransactionCreate
from app.services import ownership
from app.services import transactions as transactions_service
from app.services.recurrence import project_occurrence_dates

CARD_INVOICE_STATUS_OPEN = "open"
CARD_INVOICE_STATUS_CLOSED = "closed"
CARD_INVOICE_STATUS_OVERDUE = "overdue"
CARD_INVOICE_STATUS_PAID = "paid"
CARD_INVOICE_STATUS_PROJECTED = "projected"

DEFAULT_MONTHS_BACK = 6
DEFAULT_MONTHS_AHEAD = 6


# --- pure cycle-date helpers (no DB) ---------------------------------------


def _clamp_day(year: int, month: int, day: int) -> date_type:
    last = calendar.monthrange(year, month)[1]
    return date_type(year, month, min(day, last))


def _add_months(anchor: date_type, months: int, day: int) -> date_type:
    total = anchor.year * 12 + (anchor.month - 1) + months
    year, month0 = divmod(total, 12)
    return _clamp_day(year, month0 + 1, day)


def cycle_close_for(charge: date_type, closing_day: int) -> date_type:
    """The close date of the cycle a charge dated `charge` belongs to: the
    smallest close date on or after `charge`."""
    this_month = _clamp_day(charge.year, charge.month, closing_day)
    if this_month >= charge:
        return this_month
    return _add_months(this_month, 1, closing_day)


def due_date_for(close: date_type, due_day: int) -> date_type:
    """First `due_day` strictly after the close date."""
    same_month = _clamp_day(close.year, close.month, due_day)
    if same_month > close:
        return same_month
    return _add_months(close, 1, due_day)


# --- the invoice --------------------------------------------------------------


@dataclass
class CardInvoice:
    close_date: date_type
    due_date: date_type
    period_start: date_type
    period_end: date_type
    currency: str
    total: Decimal
    paid: Decimal
    remaining: Decimal
    status: str


def _effective(amount: Decimal, conversion_amount: Decimal | None) -> Decimal:
    """Amount in the card's own currency - the converted figure when the
    charge was cross-currency, same coalesce as account_balances."""
    return conversion_amount if conversion_amount is not None else amount


def _owed_delta(tx: Transaction, card_id: UUID) -> Decimal:
    """How much `tx` adds to what the card owes (positive) - the sign-
    flipped twin of the balance delta in account_balances. Incoming
    payments are handled separately as `paid`, so they return 0 here."""
    if tx.account_id == card_id:
        value = _effective(tx.amount, tx.conversion_amount)
        if tx.type in (TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_INTEREST):
            return -value  # a refund/chargeback lowers the bill
        if tx.type == TRANSACTION_TYPE_EXPENSE:
            return value
        if tx.type == TRANSACTION_TYPE_TRANSFER:
            return tx.amount  # cash advance out of the card raises the bill
    return Decimal(0)


def _is_payment(tx: Transaction, card_id: UUID) -> bool:
    return tx.type == TRANSACTION_TYPE_TRANSFER and tx.to_account_id == card_id


async def list_invoices(
    db: AsyncSession,
    user_id: UUID,
    account_id: UUID,
    *,
    today: date_type,
    months_back: int = DEFAULT_MONTHS_BACK,
    months_ahead: int = DEFAULT_MONTHS_AHEAD,
) -> list[CardInvoice]:
    account = await ownership.get_owned(db, Account, account_id, user_id)
    if account.type != ACCOUNT_TYPE_CREDIT_CARD:
        raise ValidationAppError(code="card_invoice.account_not_credit_card")
    if account.closing_day is None or account.due_day is None:
        return []

    card_id = account.id  # a real UUID, not whatever the caller passed
    closing_day = account.closing_day
    due_day = account.due_day

    current_close = cycle_close_for(today, closing_day)
    first_close = _add_months(current_close, -max(months_back, 0), closing_day)
    last_close = _add_months(current_close, max(months_ahead, 0), closing_day)

    closes: list[date_type] = []
    cursor = first_close
    while cursor <= last_close:
        closes.append(cursor)
        cursor = _add_months(cursor, 1, closing_day)
    window_start = _add_months(first_close, -1, closing_day) + timedelta(days=1)

    # Every transaction that touches the card, bucketed in Python - personal-
    # finance scale. ponytail: fetches the whole card ledger; add a date
    # filter if a single card's history ever gets large.
    result = await db.execute(
        ownership.owned(Transaction, user_id).where(
            or_(Transaction.account_id == card_id, Transaction.to_account_id == card_id)
        )
    )
    transactions = list(result.scalars().all())

    totals: dict[date_type, Decimal] = {c: Decimal(0) for c in closes}
    paid: dict[date_type, Decimal] = {c: Decimal(0) for c in closes}

    # opening_balance (negative == pre-existing debt) lands in the card's
    # genuine first cycle; if that predates the returned window it is simply
    # not shown - a windowed view, not a lifetime reconciliation.
    dated = [tx.date for tx in transactions]
    first_activity_close = cycle_close_for(min(dated), closing_day) if dated else current_close
    if account.opening_balance != 0 and first_activity_close in totals:
        totals[first_activity_close] += -account.opening_balance

    for tx in transactions:
        if tx.date <= window_start - timedelta(days=1) or tx.date > last_close:
            continue
        bucket = cycle_close_for(tx.date, closing_day)
        if _is_payment(tx, card_id):
            target = tx.card_invoice_close_date or bucket
            if target in paid:
                paid[target] += _effective(tx.amount, tx.conversion_amount)
            continue
        if bucket in totals:
            totals[bucket] += _owed_delta(tx, card_id)

    # Projected recurring occurrences for cycles not yet fully in the past.
    rules_result = await db.execute(
        ownership.owned(RecurringRule, user_id).where(RecurringRule.template_account_id == card_id)
    )
    rules = [
        rule
        for rule in rules_result.scalars().all()
        if rule.template_type in (TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME)
    ]
    for close in closes:
        if close < today:
            continue
        period_start = _add_months(close, -1, closing_day) + timedelta(days=1)
        range_start = max(period_start, today + timedelta(days=1))
        for rule in rules:
            occurrences = project_occurrence_dates(
                start_date=rule.start_date,
                frequency=rule.frequency,
                interval=rule.interval,
                end_date=rule.end_date,
                range_start=range_start,
                range_end=close,
            )
            if not occurrences:
                continue
            amount = rule.template_conversion_amount or rule.template_amount
            sign = 1 if rule.template_type == TRANSACTION_TYPE_EXPENSE else -1
            totals[close] += sign * amount * len(occurrences)

    invoices: list[CardInvoice] = []
    for close in closes:
        period_start = _add_months(close, -1, closing_day) + timedelta(days=1)
        due = due_date_for(close, due_day)
        total = totals[close]
        paid_amount = paid[close]
        remaining = total - paid_amount
        if today <= period_start - timedelta(days=1):
            status = CARD_INVOICE_STATUS_PROJECTED
        elif today <= close:
            status = CARD_INVOICE_STATUS_OPEN
        elif remaining <= 0:
            status = CARD_INVOICE_STATUS_PAID
        elif today <= due:
            status = CARD_INVOICE_STATUS_CLOSED
        else:
            status = CARD_INVOICE_STATUS_OVERDUE
        invoices.append(
            CardInvoice(
                close_date=close,
                due_date=due,
                period_start=period_start,
                period_end=close,
                currency=account.currency,
                total=total,
                paid=paid_amount,
                remaining=remaining,
                status=status,
            )
        )
    return invoices


def _months_between(a: date_type, b: date_type) -> int:
    return abs((b.year - a.year) * 12 + (b.month - a.month))


async def pay_invoice(
    db: AsyncSession,
    user_id: UUID,
    account_id: UUID,
    close_date: date_type,
    data: CardInvoicePaymentCreate,
    *,
    today: date_type,
) -> Transaction:
    """Settle an invoice with a transfer from the card's payment account
    (or an explicit `data.account_id`), tagged with `close_date` so the
    invoice's `paid` picks it up. Mirrors
    app/services/loans.py::record_payment: builds a TransactionCreate and
    delegates, so the same transfer + cross-currency validation applies.

    An open (current) invoice may be paid early; a projected (future) one
    may not.
    """
    account = await ownership.get_owned(db, Account, account_id, user_id)
    if account.type != ACCOUNT_TYPE_CREDIT_CARD:
        raise ValidationAppError(code="card_invoice.account_not_credit_card")
    if account.closing_day is None or account.due_day is None:
        raise ValidationAppError(code="card_invoice.cycle_not_configured")

    span = _months_between(close_date, today) + 2
    invoices = await list_invoices(
        db, user_id, account_id, today=today, months_back=span, months_ahead=span
    )
    invoice = next((inv for inv in invoices if inv.close_date == close_date), None)
    if invoice is None:
        raise NotFoundError(
            code="card_invoice.not_found", params={"close_date": close_date.isoformat()}
        )
    if invoice.status == CARD_INVOICE_STATUS_PROJECTED:
        raise ValidationAppError(code="card_invoice.not_closed")
    if invoice.remaining <= 0:
        raise ValidationAppError(code="card_invoice.already_paid")

    source_id = data.account_id or account.payment_account_id
    if source_id is None:
        raise ValidationAppError(code="card_invoice.payment_account_required")

    source = await ownership.get_owned(db, Account, source_id, user_id)
    if source.id == account.id:
        raise ValidationAppError(code="card_invoice.payment_account_is_self")
    if source.archived:
        raise ValidationAppError(code="card_invoice.payment_account_archived")
    if source.type == ACCOUNT_TYPE_CREDIT_CARD:
        raise ValidationAppError(code="card_invoice.payment_account_is_credit_card")
    if source.currency != account.currency:
        raise ValidationAppError(code="card_invoice.payment_account_currency_mismatch")

    amount = data.amount if data.amount is not None else invoice.remaining
    if amount <= 0:
        raise ValidationAppError(code="card_invoice.amount_not_positive")
    if amount > invoice.remaining:
        raise ValidationAppError(code="card_invoice.amount_exceeds_remaining")

    payload = TransactionCreate(
        type=TRANSACTION_TYPE_TRANSFER,
        date=data.date or today,
        amount=amount,
        currency=account.currency,
        account_id=source_id,
        to_account_id=account.id,
        description=data.description or account.name,
        card_invoice_close_date=close_date,
    )
    return await transactions_service.create_transaction(db, user_id, payload)
