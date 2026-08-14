"""Metadata layered on top of a goal-type Account. Balance stays derived
from the linked account's ledger (see the frontend's domain/calc/goals.ts)
- never stored here.
"""

import uuid
from datetime import date as date_type

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.recurring import RECURRING_FREQUENCIES
from app.models.types import CurrencyCode, MoneyAmount


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class Goal(UserOwnedModel):
    __tablename__ = "goals"
    __error_prefix__ = "goal"
    __table_args__ = (
        # One goal per account - account_id is globally unique, and an
        # account already belongs to exactly one user, so this also scopes
        # per-user.
        UniqueConstraint("account_id", name="uq_goals_account_id"),
        CheckConstraint("target_amount > 0", name="ck_goals_target_amount_positive"),
        CheckConstraint(
            _in_check("frequency", RECURRING_FREQUENCIES) + " OR frequency IS NULL",
            name="ck_goals_frequency",
        ),
        CheckConstraint('"interval" IS NULL OR "interval" >= 1', name="ck_goals_interval_positive"),
        # An interval without a frequency is meaningless.
        CheckConstraint(
            'frequency IS NOT NULL OR "interval" IS NULL',
            name="ck_goals_interval_requires_frequency",
        ),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_goals_account_id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    target_amount: Mapped[MoneyAmount] = mapped_column(nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_goals_currency"),
        nullable=False,
    )
    target_date: Mapped[date_type | None] = mapped_column(Date)
    frequency: Mapped[str | None] = mapped_column(String(20))
    interval: Mapped[int | None] = mapped_column(Integer)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
