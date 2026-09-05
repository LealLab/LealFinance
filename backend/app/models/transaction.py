"""Transactions - the ledger. Amount is always positive; `type` carries
direction. Cross-currency transactions carry a recorded conversion in the
`conversion_*` columns - flat columns rather than JSONB so the currency
FK, NUMERIC typing, and CHECK constraints below all still apply - exposed
as the nested `{amount, currency, fee, rate, source}` object the frontend
expects via the `conversion` property. See docs/money-and-currency.md and
app/services/conversion.py for the validation this shape supports.
"""

import uuid
from datetime import date as date_type

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models._conversion import ConversionValue, conversion_constraints
from app.models.base import UserOwnedModel
from app.models.types import CurrencyCode, ExchangeRateValue, MoneyAmount

TRANSACTION_TYPE_INCOME = "income"
TRANSACTION_TYPE_EXPENSE = "expense"
TRANSACTION_TYPE_TRANSFER = "transfer"
TRANSACTION_TYPE_INTEREST = "interest"
TRANSACTION_TYPES = (
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_TRANSFER,
    TRANSACTION_TYPE_INTEREST,
)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class Transaction(UserOwnedModel):
    __tablename__ = "transactions"
    __error_prefix__ = "transaction"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        CheckConstraint(_in_check("type", TRANSACTION_TYPES), name="ck_transactions_type"),
        # A destination account exists iff this is a transfer.
        CheckConstraint(
            "(type = 'transfer') = (to_account_id IS NOT NULL)",
            name="ck_transactions_transfer_shape",
        ),
        CheckConstraint(
            "to_account_id IS NULL OR to_account_id <> account_id",
            name="ck_transactions_transfer_distinct_accounts",
        ),
        # Transfers and interest never carry a category.
        CheckConstraint(
            "type NOT IN ('transfer', 'interest') OR category_id IS NULL",
            name="ck_transactions_category_absent_for_transfer_interest",
        ),
        # Card purchases carry all three fields. Loan payments reuse only
        # number/count so the UI does not treat them as a card installment
        # series; SET NULL on loan deletion leaves that harmless provenance.
        CheckConstraint(
            "(installment_group_id IS NULL AND installment_number IS NULL "
            "AND installment_count IS NULL) OR "
            "(installment_group_id IS NOT NULL AND loan_id IS NULL "
            "AND installment_count >= 2 "
            "AND installment_number BETWEEN 1 AND installment_count) OR "
            "(installment_group_id IS NULL AND installment_count >= 1 "
            "AND installment_number BETWEEN 1 AND installment_count)",
            name="ck_transactions_installment_shape",
        ),
        *conversion_constraints("transactions", "conversion_"),
        Index("ix_transactions_user_id_date", "user_id", "date"),
        Index("ix_transactions_loan_id", "loan_id"),
        Index("ix_transactions_card_invoice_close_date", "card_invoice_close_date"),
        Index("ix_transactions_installment_group_id", "installment_group_id"),
        Index(
            "ux_transactions_loan_installment_number",
            "loan_id",
            "installment_number",
            unique=True,
            postgresql_where=text("loan_id IS NOT NULL AND installment_number IS NOT NULL"),
        ),
        # Idempotency guard for recurring posting (see
        # app/services/recurring_posting.py): the same rule can never post
        # two transactions on the same occurrence date. Partial, since
        # ordinary (non-recurring) transactions freely share a date.
        Index(
            "ux_transactions_recurring_rule_id_date",
            "recurring_rule_id",
            "date",
            unique=True,
            postgresql_where=text("recurring_rule_id IS NOT NULL"),
        ),
        Index(
            "ux_transactions_pluggy_transaction_id",
            "user_id",
            "pluggy_transaction_id",
            unique=True,
            postgresql_where=text("pluggy_transaction_id IS NOT NULL"),
        ),
    )

    type: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    amount: Mapped[MoneyAmount] = mapped_column(nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_transactions_currency"),
        nullable=False,
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_transactions_account_id"),
        nullable=False,
    )
    to_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_transactions_to_account_id"),
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="RESTRICT", name="fk_transactions_category_id"),
    )
    description: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    # SET NULL, not RESTRICT: deleting a recurring rule must not delete the
    # transactions it generated - only the provenance link is lost.
    recurring_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "recurring_rules.id",
            ondelete="SET NULL",
            name="fk_transactions_recurring_rule_id",
        ),
    )
    # SET NULL, same reasoning as recurring_rule_id: deleting a loan must
    # not delete the payments it generated - only the provenance link is
    # lost. Set on every transaction recorded as a loan installment (see
    # app/services/loans.py); the count of these is what "installments
    # paid" is derived from.
    loan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loans.id", ondelete="SET NULL", name="fk_transactions_loan_id"),
    )
    # Set only on a transfer that pays a credit-card invoice: the close date
    # of the cycle it settles. This is what makes invoice "paid" a derived
    # SUM (app/services/card_invoices.py) rather than stored state, and what
    # makes the nightly auto-pay idempotent without a cursor - deleting the
    # payment reopens the invoice on its own. Same provenance pattern as
    # loan_id / recurring_rule_id.
    card_invoice_close_date: Mapped[date_type | None] = mapped_column(Date)

    pluggy_transaction_id: Mapped[str | None] = mapped_column(String(64))

    # A purchase split into equal monthly installments on a credit card.
    # `installment_group_id` ties the rows together; `number`/`count`
    # ("3/10") are stored, not derived - they are immutable facts of the
    # purchase and save a window function on every ledger read. See
    # app/services/transactions.py::create_transaction for the split.
    installment_group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    installment_number: Mapped[int | None] = mapped_column(SmallInteger)
    installment_count: Mapped[int | None] = mapped_column(SmallInteger)

    conversion_amount: Mapped[MoneyAmount | None] = mapped_column()
    conversion_currency: Mapped[CurrencyCode | None] = mapped_column(
        ForeignKey(
            "currencies.code", ondelete="RESTRICT", name="fk_transactions_conversion_currency"
        )
    )
    conversion_fee: Mapped[MoneyAmount | None] = mapped_column()
    conversion_rate: Mapped[ExchangeRateValue | None] = mapped_column()
    conversion_source: Mapped[str | None] = mapped_column(String(20))

    @property
    def conversion(self) -> ConversionValue | None:
        """Read-only: the flat conversion_* columns as the nested object
        the frontend contract specifies. Writes go through
        app/services/conversion.py::resolve_conversion, which is where the
        arithmetic is validated."""
        if self.conversion_amount is None:
            return None
        assert self.conversion_currency is not None
        assert self.conversion_rate is not None
        assert self.conversion_source is not None
        return ConversionValue(
            amount=self.conversion_amount,
            currency=self.conversion_currency,
            fee=self.conversion_fee,
            rate=self.conversion_rate,
            source=self.conversion_source,
        )
