"""Immutable audit rows for transaction changes."""

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel

HISTORY_OPERATION_CREATE = "create"
HISTORY_OPERATION_UPDATE = "update"
HISTORY_OPERATION_DELETE = "delete"
HISTORY_OPERATIONS = (
    HISTORY_OPERATION_CREATE,
    HISTORY_OPERATION_UPDATE,
    HISTORY_OPERATION_DELETE,
)

HISTORY_SOURCE_MANUAL = "manual"
HISTORY_SOURCE_IMPORT = "import"
HISTORY_SOURCE_IMPORT_UNDO = "import_undo"
HISTORY_SOURCE_RECURRING = "recurring"
HISTORY_SOURCE_LOAN = "loan"
HISTORY_SOURCE_CARD = "card"
HISTORY_SOURCE_INVESTMENT = "investment"
HISTORY_SOURCE_BULK = "bulk"
HISTORY_SOURCES = (
    HISTORY_SOURCE_MANUAL,
    HISTORY_SOURCE_IMPORT,
    HISTORY_SOURCE_IMPORT_UNDO,
    HISTORY_SOURCE_RECURRING,
    HISTORY_SOURCE_LOAN,
    HISTORY_SOURCE_CARD,
    HISTORY_SOURCE_INVESTMENT,
    HISTORY_SOURCE_BULK,
)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class TransactionHistory(UserOwnedModel):
    __tablename__ = "transaction_history"
    __error_prefix__ = "transaction_history"
    __table_args__ = (
        CheckConstraint(
            _in_check("operation", HISTORY_OPERATIONS),
            name="ck_transaction_history_operation",
        ),
        CheckConstraint(
            _in_check("source", HISTORY_SOURCES),
            name="ck_transaction_history_source",
        ),
        Index(
            "ix_transaction_history_user_id_transaction_id",
            "user_id",
            "transaction_id",
        ),
    )

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    operation: Mapped[str] = mapped_column(String(10), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "import_idempotency.id",
            ondelete="SET NULL",
            name="fk_transaction_history_batch_id",
        ),
        index=True,
    )
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
