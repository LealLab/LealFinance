"""Accounts - a holding of money in one currency, optionally grouped under
an Institution. Balance is always derived from opening_balance plus every
transaction that touches the account (see app/models/transaction.py,
Phase 5) - never stored here, so the two can't drift apart.
"""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.types import CurrencyCode, MoneyAmount

ACCOUNT_TYPE_CHECKING = "checking"
ACCOUNT_TYPE_SAVINGS = "savings"
ACCOUNT_TYPE_CASH = "cash"
ACCOUNT_TYPE_CREDIT_CARD = "credit_card"
ACCOUNT_TYPE_INVESTMENT = "investment"
ACCOUNT_TYPE_GOAL = "goal"
ACCOUNT_TYPES = (
    ACCOUNT_TYPE_CHECKING,
    ACCOUNT_TYPE_SAVINGS,
    ACCOUNT_TYPE_CASH,
    ACCOUNT_TYPE_CREDIT_CARD,
    ACCOUNT_TYPE_INVESTMENT,
    ACCOUNT_TYPE_GOAL,
)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class Account(UserOwnedModel):
    __tablename__ = "accounts"
    __error_prefix__ = "account"
    __table_args__ = (
        CheckConstraint(_in_check("type", ACCOUNT_TYPES), name="ck_accounts_type"),
        CheckConstraint(
            "closing_day IS NULL OR closing_day BETWEEN 1 AND 31",
            name="ck_accounts_closing_day_range",
        ),
        CheckConstraint(
            "due_day IS NULL OR due_day BETWEEN 1 AND 31", name="ck_accounts_due_day_range"
        ),
        CheckConstraint(
            "credit_limit IS NULL OR credit_limit >= 0",
            name="ck_accounts_credit_limit_non_negative",
        ),
        # Card-only fields must be absent on every other account type.
        CheckConstraint(
            "type = 'credit_card' OR ("
            "credit_limit IS NULL AND closing_day IS NULL AND due_day IS NULL "
            "AND payment_account_id IS NULL AND NOT auto_pay)",
            name="ck_accounts_credit_card_fields_only",
        ),
        # Mirrors ck_loans_auto_post_requires_account: the invoice can't be
        # auto-paid without a source account to pay it from.
        CheckConstraint(
            "NOT auto_pay OR payment_account_id IS NOT NULL",
            name="ck_accounts_auto_pay_requires_account",
        ),
        CheckConstraint(
            "payment_account_id IS NULL OR payment_account_id <> id",
            name="ck_accounts_payment_account_distinct",
        ),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_accounts_currency"),
        nullable=False,
    )
    opening_balance: Mapped[MoneyAmount] = mapped_column(nullable=False, default=0)
    # RESTRICT is the DB backstop for the "can't delete an institution
    # while accounts reference it" guard - app/services/institutions.py
    # raises the friendly error first; this guarantees the invariant even
    # if a future code path forgets to check.
    institution_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("institutions.id", ondelete="RESTRICT", name="fk_accounts_institution_id"),
    )
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    credit_limit: Mapped[MoneyAmount | None] = mapped_column()
    closing_day: Mapped[int | None] = mapped_column(SmallInteger)
    due_day: Mapped[int | None] = mapped_column(SmallInteger)
    # Credit-card only: the account whose money pays this card's invoices,
    # both for the manual "pay now" action and (when auto_pay is on) for the
    # nightly posting in app/services/card_invoice_posting.py. RESTRICT
    # mirrors fk_loans_payment_account_id.
    payment_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_accounts_payment_account_id"),
    )
    auto_pay: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
