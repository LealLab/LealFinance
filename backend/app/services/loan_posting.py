"""Auto-posts due loan installments as real Transactions - the loan
equivalent of app/services/recurring_posting.py, driven by Celery beat
(app/workers/tasks/loans.py).

Only loans with `auto_post = true` are posted. The Nth installment
(0-based) falls on ``add_months_clamped(first_payment_date, N)``; an
installment is due once that date is on or before ``today`` and fewer than
``installment_count`` payments exist. "Payments so far" is
COUNT(transactions WHERE loan_id) - the same derived count the manual
"record payment" flow advances - so auto-post, manual payments and "pay
now" all share one notion of progress and can't double up.

Idempotency comes from that count, not a cursor: a rerun on the same day
sees the payment it already made and stops. Catch-up is capped per loan
per run; the remainder posts next run.
"""

import logging
from datetime import date as date_type
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loan import Loan
from app.schemas.loan import LoanPaymentCreate
from app.services import loans as loans_service
from app.services.recurrence import add_months_clamped

logger = logging.getLogger(__name__)

# Matches recurring_posting.MAX_CATCH_UP_OCCURRENCES: a long-dormant or
# backdated loan shouldn't post its whole schedule in one run.
MAX_CATCH_UP_INSTALLMENTS = 60


async def post_due_installments(db: AsyncSession, loan: Loan, *, today: date_type) -> list[UUID]:
    """Post every installment of ``loan`` due on or before ``today`` that
    isn't already covered by an existing payment. Each payment commits on
    its own (via loans_service.record_payment), so a failure partway
    through a catch-up leaves the earlier payments persisted."""
    if not loan.auto_post or loan.archived:
        return []

    created: list[UUID] = []
    for _ in range(MAX_CATCH_UP_INSTALLMENTS):
        paid = await loans_service.installments_paid(db, loan.id)
        if paid >= loan.installment_count:
            break
        due_date = add_months_clamped(loan.first_payment_date, paid)
        if due_date > today:
            break
        transaction = await loans_service.record_payment(
            db, loan.user_id, loan.id, LoanPaymentCreate(date=due_date), today=today
        )
        created.append(transaction.id)

    return created


async def post_all_due_installments(db: AsyncSession, *, today: date_type | None = None) -> int:
    """One posting pass over every user's auto-post loans. A single loan's
    failure (an archived payment account, a currency gone inactive) is
    logged and rolled back without aborting the rest of the run."""
    today = today or date_type.today()
    result = await db.execute(
        select(Loan).where(Loan.auto_post.is_(True), Loan.archived.is_(False))
    )
    loans = result.scalars().all()

    total = 0
    for loan in loans:
        try:
            total += len(await post_due_installments(db, loan, today=today))
        except Exception:
            logger.exception("Failed to post installments for loan %s", loan.id)
            await db.rollback()

    return total
