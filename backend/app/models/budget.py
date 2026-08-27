"""Monthly budgets and the budget-planning inputs (allocations, expected
income) they're derived from.

`month` is a plain `'YYYY-MM'` string, validated with a CHECK, rather than
a `Date` pinned to the 1st: it's directly sortable/range-queryable and
matches the wire format exactly, avoiding reformatting (and timezone
boundary bugs) at every layer. The unique constraints below double as the
conflict target for each entity's upsert.
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.types import CurrencyCode, MoneyAmount, PercentageValue

_MONTH_CHECK = r"month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'"


class Budget(UserOwnedModel):
    __tablename__ = "budgets"
    __error_prefix__ = "budget"
    __table_args__ = (
        UniqueConstraint("user_id", "group_id", "month", name="uq_budgets_user_group_month"),
        CheckConstraint(_MONTH_CHECK, name="ck_budgets_month_format"),
        CheckConstraint("amount >= 0", name="ck_budgets_amount_non_negative"),
    )

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("category_groups.id", ondelete="RESTRICT", name="fk_budgets_group_id"),
        nullable=False,
    )
    month: Mapped[str] = mapped_column(String(7), nullable=False)
    amount: Mapped[MoneyAmount] = mapped_column(nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_budgets_currency"),
        nullable=False,
    )


class BudgetAllocation(UserOwnedModel):
    """A reusable percentage allocation for an expense group -
    the base for auto-generated budgets (see app/services/budget_plan.py)."""

    __tablename__ = "budget_allocations"
    __error_prefix__ = "budget_allocation"
    __table_args__ = (
        UniqueConstraint("user_id", "group_id", name="uq_budget_allocations_user_group"),
        CheckConstraint(
            "percentage >= 0 AND percentage <= 100", name="ck_budget_allocations_percentage_range"
        ),
    )

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "category_groups.id",
            ondelete="RESTRICT",
            name="fk_budget_allocations_group_id",
        ),
        nullable=False,
    )
    percentage: Mapped[PercentageValue] = mapped_column(nullable=False)


class ExpectedIncome(UserOwnedModel):
    __tablename__ = "expected_income"
    __error_prefix__ = "expected_income"
    __table_args__ = (
        UniqueConstraint("user_id", "month", name="uq_expected_income_user_month"),
        CheckConstraint(_MONTH_CHECK, name="ck_expected_income_month_format"),
        CheckConstraint("amount >= 0", name="ck_expected_income_amount_non_negative"),
    )

    month: Mapped[str] = mapped_column(String(7), nullable=False)
    amount: Mapped[MoneyAmount] = mapped_column(nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_expected_income_currency"),
        nullable=False,
    )
