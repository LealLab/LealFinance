"""Recurring rules describe a repeating transaction; a Celery beat task
(app/workers/tasks/recurring.py, via app/services/recurring_posting.py)
posts each due occurrence as a real Transaction, linked back via
Transaction.recurring_rule_id. `last_posted_date` is that task's cursor -
the last occurrence date actually posted, so a rerun never posts the same
occurrence twice (also enforced at the DB level, see
Transaction.__table_args__'s partial unique index).

`template_*` columns mirror Transaction minus id/date/recurring_rule_id,
as real FKs rather than JSONB - the referenced account/category/currency
must actually exist and belong to the same user, and the exact same
transaction-shape and conversion validation applies (see
app/services/transactions.py::validate_transaction_shape, reused here).

The frontend still projects *upcoming* occurrences on demand for display
(domain/calc/recurrence.ts) - those projections are never persisted and
are distinct from what this module actually posts.
"""

import uuid
from dataclasses import dataclass
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models._conversion import ConversionValue, conversion_constraints
from app.models.base import UserOwnedModel
from app.models.transaction import TRANSACTION_TYPES
from app.models.types import CurrencyCode, ExchangeRateValue, MoneyAmount

RECURRING_FREQUENCY_WEEKLY = "weekly"
RECURRING_FREQUENCY_MONTHLY = "monthly"
RECURRING_FREQUENCY_YEARLY = "yearly"
RECURRING_FREQUENCIES = (
    RECURRING_FREQUENCY_WEEKLY,
    RECURRING_FREQUENCY_MONTHLY,
    RECURRING_FREQUENCY_YEARLY,
)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


@dataclass(frozen=True)
class TemplateValue:
    """The read-side shape of the template_* columns, matching the
    frontend's `Omit<Transaction, 'id' | 'date' | 'recurringRuleId'>`."""

    type: str
    amount: Decimal
    currency: str
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    description: str
    notes: str | None
    conversion: ConversionValue | None


class RecurringRule(UserOwnedModel):
    __tablename__ = "recurring_rules"
    __error_prefix__ = "recurring_rule"
    __table_args__ = (
        CheckConstraint(
            _in_check("frequency", RECURRING_FREQUENCIES), name="ck_recurring_rules_frequency"
        ),
        # "interval" is a reserved word in Postgres - must be quoted in
        # hand-written SQL text (SQLAlchemy quotes it automatically in
        # generated column DDL, but not inside a CheckConstraint string).
        CheckConstraint('"interval" >= 1', name="ck_recurring_rules_interval_positive"),
        CheckConstraint(
            "end_date IS NULL OR end_date >= start_date", name="ck_recurring_rules_date_order"
        ),
        CheckConstraint(
            _in_check("template_type", TRANSACTION_TYPES), name="ck_recurring_rules_template_type"
        ),
        CheckConstraint("template_amount > 0", name="ck_recurring_rules_template_amount_positive"),
        CheckConstraint(
            "(template_type = 'transfer') = (template_to_account_id IS NOT NULL)",
            name="ck_recurring_rules_template_transfer_shape",
        ),
        CheckConstraint(
            "template_to_account_id IS NULL OR template_to_account_id <> template_account_id",
            name="ck_recurring_rules_template_distinct_accounts",
        ),
        CheckConstraint(
            "template_type NOT IN ('transfer', 'interest') OR template_category_id IS NULL",
            name="ck_recurring_rules_template_category_absent",
        ),
        *conversion_constraints("recurring_rules", "template_conversion_"),
    )

    frequency: Mapped[str] = mapped_column(String(20), nullable=False)
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    start_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    end_date: Mapped[date_type | None] = mapped_column(Date)
    # Posting cursor: the last occurrence date actually posted by
    # app/services/recurring_posting.py. NULL means nothing has posted yet
    # (posting starts from start_date). Existing rules are backfilled to
    # CURRENT_DATE by the migration that introduced this column, so
    # deploying the posting feature doesn't retroactively post years of
    # history for rules that predate it.
    last_posted_date: Mapped[date_type | None] = mapped_column(Date)

    template_type: Mapped[str] = mapped_column(String(20), nullable=False)
    template_amount: Mapped[MoneyAmount] = mapped_column(nullable=False)
    template_currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey(
            "currencies.code", ondelete="RESTRICT", name="fk_recurring_rules_template_currency"
        ),
        nullable=False,
    )
    template_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "accounts.id", ondelete="RESTRICT", name="fk_recurring_rules_template_account_id"
        ),
        nullable=False,
    )
    template_to_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "accounts.id",
            ondelete="RESTRICT",
            name="fk_recurring_rules_template_to_account_id",
        ),
    )
    template_category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "categories.id",
            ondelete="RESTRICT",
            name="fk_recurring_rules_template_category_id",
        ),
    )
    template_description: Mapped[str] = mapped_column(String(200), nullable=False)
    template_notes: Mapped[str | None] = mapped_column(Text)

    template_conversion_amount: Mapped[MoneyAmount | None] = mapped_column()
    template_conversion_currency: Mapped[CurrencyCode | None] = mapped_column(
        ForeignKey(
            "currencies.code",
            ondelete="RESTRICT",
            name="fk_recurring_rules_template_conversion_currency",
        )
    )
    template_conversion_fee: Mapped[MoneyAmount | None] = mapped_column()
    template_conversion_rate: Mapped[ExchangeRateValue | None] = mapped_column()
    template_conversion_source: Mapped[str | None] = mapped_column(String(20))

    @property
    def template_conversion(self) -> ConversionValue | None:
        if self.template_conversion_amount is None:
            return None
        assert self.template_conversion_currency is not None
        assert self.template_conversion_rate is not None
        assert self.template_conversion_source is not None
        return ConversionValue(
            amount=self.template_conversion_amount,
            currency=self.template_conversion_currency,
            fee=self.template_conversion_fee,
            rate=self.template_conversion_rate,
            source=self.template_conversion_source,
        )

    @property
    def template(self) -> TemplateValue:
        """Read-only: the flat template_* columns as the nested object the
        frontend contract specifies. Writes go through
        app/services/recurring_rules.py, which validates the template with
        the same rules a real transaction is validated against."""
        return TemplateValue(
            type=self.template_type,
            amount=self.template_amount,
            currency=self.template_currency,
            account_id=self.template_account_id,
            to_account_id=self.template_to_account_id,
            category_id=self.template_category_id,
            description=self.template_description,
            notes=self.template_notes,
            conversion=self.template_conversion,
        )
