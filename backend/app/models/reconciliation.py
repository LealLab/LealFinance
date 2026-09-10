"""Bank reconciliation records and per-account cleared transaction legs."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.types import CurrencyCode, MoneyAmount

RECONCILIATION_STATUS_OPEN = "open"
RECONCILIATION_STATUS_COMPLETED = "completed"
RECONCILIATION_STATUSES = (RECONCILIATION_STATUS_OPEN, RECONCILIATION_STATUS_COMPLETED)


class Reconciliation(UserOwnedModel):
    __tablename__ = "reconciliations"
    __error_prefix__ = "reconciliation"
    __table_args__ = (
        CheckConstraint("status IN ('open', 'completed')", name="ck_reconciliations_status"),
        Index("ix_reconciliations_account_id", "account_id"),
        Index(
            "ux_reconciliations_open_per_account",
            "user_id",
            "account_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_reconciliations_account_id"),
        nullable=False,
    )
    statement_date: Mapped[date] = mapped_column(Date, nullable=False)
    statement_balance: Mapped[MoneyAmount] = mapped_column(nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_reconciliations_currency"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default=RECONCILIATION_STATUS_OPEN, server_default="open"
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReconciliationEntry(UserOwnedModel):
    __tablename__ = "reconciliation_entries"
    __error_prefix__ = "reconciliation_entry"
    __table_args__ = (
        UniqueConstraint(
            "transaction_id", "account_id", name="uq_reconciliation_entries_txn_account"
        ),
        Index("ix_reconciliation_entries_reconciliation_id", "reconciliation_id"),
    )

    reconciliation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "reconciliations.id",
            ondelete="CASCADE",
            name="fk_reconciliation_entries_reconciliation_id",
        ),
        nullable=False,
    )
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "transactions.id", ondelete="CASCADE", name="fk_reconciliation_entries_transaction_id"
        ),
        nullable=False,
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_reconciliation_entries_account_id"),
        nullable=False,
    )
