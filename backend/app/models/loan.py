"""A loan the user is repaying. Standalone metadata - unlike Goal it does
not sit on top of an Account and it never appears in a balance or net
worth. What ties a loan to the ledger is `Transaction.loan_id`: every
payment recorded against a loan is an ordinary expense transaction
carrying the loan's own `category_id`, so the debt shows up in the user's
spending and budgets under whatever category the loan was filed as (a car
loan -> "Comfort", etc.).

`installment_amount` is derived from `amount_borrowed + fees`,
`interest_rate` and `installment_count` by app/services/loans.py and is
recomputed on every write - it is never accepted from the client. The
number of installments already paid is COUNT(transactions WHERE loan_id),
not a stored cursor, so manual payments, auto-posted payments and advance
("pay now") payments all advance the same count and deleting a payment
self-heals.
"""

import uuid
from datetime import date as date_type

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.types import CurrencyCode, MoneyAmount, PercentageValue

LOAN_RATE_PERIOD_ANNUAL = "annual"
LOAN_RATE_PERIOD_MONTHLY = "monthly"
LOAN_RATE_PERIODS = (LOAN_RATE_PERIOD_ANNUAL, LOAN_RATE_PERIOD_MONTHLY)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class Loan(UserOwnedModel):
    __tablename__ = "loans"
    __error_prefix__ = "loan"
    __table_args__ = (
        CheckConstraint("amount_borrowed > 0", name="ck_loans_amount_borrowed_positive"),
        CheckConstraint("fees >= 0", name="ck_loans_fees_non_negative"),
        CheckConstraint("interest_rate >= 0", name="ck_loans_interest_rate_non_negative"),
        CheckConstraint(_in_check("rate_period", LOAN_RATE_PERIODS), name="ck_loans_rate_period"),
        CheckConstraint("installment_count >= 1", name="ck_loans_installment_count_positive"),
        CheckConstraint("installment_amount > 0", name="ck_loans_installment_amount_positive"),
        CheckConstraint(
            "contracted_installment_amount IS NULL OR contracted_installment_amount > 0",
            name="ck_loans_contracted_installment_amount_positive",
        ),
        CheckConstraint(
            "NOT auto_post OR payment_account_id IS NOT NULL",
            name="ck_loans_auto_post_requires_account",
        ),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="RESTRICT", name="fk_loans_category_id"),
        nullable=False,
    )
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_loans_currency"),
        nullable=False,
    )
    amount_borrowed: Mapped[MoneyAmount] = mapped_column(nullable=False)
    fees: Mapped[MoneyAmount] = mapped_column(nullable=False, default=0)
    interest_rate: Mapped[PercentageValue] = mapped_column(nullable=False, default=0)
    rate_period: Mapped[str] = mapped_column(String(10), nullable=False)
    installment_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # Effective value: the contract amount below, or the computed estimate.
    installment_amount: Mapped[MoneyAmount] = mapped_column(nullable=False)
    contracted_installment_amount: Mapped[MoneyAmount | None] = mapped_column()
    first_payment_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    auto_post: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Source of funds for an auto-posted (or "pay now") installment.
    # Required whenever auto_post is on - enforced by the CHECK above and by
    # app/services/loans.py, which also checks the currency matches.
    payment_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_loans_payment_account_id"),
    )
    notes: Mapped[str | None] = mapped_column(Text)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Not a column: the number of installments already recorded is
    # COUNT(transactions WHERE loan_id). app/services/loans.py sets this on
    # the instance before it is serialized into LoanRead; it has no
    # meaning on a bare ORM row.
    installments_paid = 0
