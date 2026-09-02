"""Auto-pays due credit-card invoices as real transfer Transactions - the
card equivalent of app/services/loan_posting.py, driven by Celery beat
(app/workers/tasks/cards.py).

Only cards with ``auto_pay = true`` (which the DB guarantees implies a
``payment_account_id``) are paid. An invoice is paid once its due date is
on or before ``today`` and it still has a positive ``remaining`` - and
only within ``AUTO_PAY_WINDOW_DAYS`` of the due date, so turning auto-pay
on today never triggers a cascade of months-old overdue invoices; those
stay ``overdue`` in the UI for the user to settle with the button.

Idempotency is derived, not a cursor: the payment
app/services/card_invoices.py::pay_invoice posts is a transfer tagged with
the cycle's close date, so the next run sees ``remaining <= 0`` and skips
it. Deleting that payment reopens the invoice on its own.
"""

import logging
from datetime import date as date_type
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.account import ACCOUNT_TYPE_CREDIT_CARD, Account
from app.schemas.card_invoice import CardInvoicePaymentCreate
from app.services import card_invoices as card_invoices_service

logger = logging.getLogger(__name__)

# Matches loan_posting's spirit: a dormant/backdated card shouldn't have
# its whole history auto-paid in one run.
AUTO_PAY_WINDOW_DAYS = 7


async def post_due_invoice_payments(
    db: AsyncSession, account: Account, *, today: date_type
) -> list[str]:
    """Pay every invoice of ``account`` that is due on or before ``today``,
    still owes money, and fell due within the last AUTO_PAY_WINDOW_DAYS.
    Each payment commits on its own (via pay_invoice)."""
    if not account.auto_pay or account.archived:
        return []
    if account.closing_day is None or account.due_day is None:
        return []

    earliest_due = today - timedelta(days=AUTO_PAY_WINDOW_DAYS)
    invoices = await card_invoices_service.list_invoices(
        db, account.user_id, account.id, today=today, months_back=2, months_ahead=0
    )

    paid: list[str] = []
    for invoice in invoices:
        if invoice.remaining <= 0:
            continue
        if invoice.due_date > today or invoice.due_date < earliest_due:
            continue
        await card_invoices_service.pay_invoice(
            db,
            account.user_id,
            account.id,
            invoice.close_date,
            CardInvoicePaymentCreate(),
            today=today,
        )
        paid.append(invoice.close_date.isoformat())

    return paid


async def post_all_due_invoice_payments(db: AsyncSession, *, today: date_type | None = None) -> int:
    """One posting pass over every user's auto-pay cards. A single card's
    failure (archived payment account, currency gone inactive) is logged
    and rolled back without aborting the run."""
    today = today or date_type.today()
    result = await db.execute(
        select(Account).where(
            Account.type == ACCOUNT_TYPE_CREDIT_CARD,
            Account.auto_pay.is_(True),
            Account.archived.is_(False),
        )
    )
    cards = result.scalars().all()

    total = 0
    for card in cards:
        try:
            total += len(await post_due_invoice_payments(db, card, today=today))
        except AppError:
            logger.exception("Failed to auto-pay invoices for card %s", card.id)
            await db.rollback()
        except Exception:
            logger.exception("Unexpected error auto-paying invoices for card %s", card.id)
            await db.rollback()

    return total
