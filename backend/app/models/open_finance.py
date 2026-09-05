"""Pluggy credentials and linked account snapshots."""

import uuid
from datetime import date as date_type
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.types import CurrencyCode, MoneyAmount

PLUGGY_ENVIRONMENT_SANDBOX = "sandbox"
PLUGGY_ENVIRONMENT_PRODUCTION = "production"
PLUGGY_ENVIRONMENTS = (PLUGGY_ENVIRONMENT_SANDBOX, PLUGGY_ENVIRONMENT_PRODUCTION)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class PluggyCredential(UserOwnedModel):
    __tablename__ = "pluggy_credentials"
    __error_prefix__ = "pluggy_credential"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_pluggy_credentials_user_id"),
        CheckConstraint(
            _in_check("environment", PLUGGY_ENVIRONMENTS),
            name="ck_pluggy_credentials_environment",
        ),
    )

    client_id_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    client_secret_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    environment: Mapped[str] = mapped_column(String(20), nullable=False)


class PluggyItem(UserOwnedModel):
    __tablename__ = "pluggy_items"
    __error_prefix__ = "pluggy_item"
    __table_args__ = (
        UniqueConstraint("user_id", "external_id", name="uq_pluggy_items_user_id_external_id"),
    )

    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    connector_id: Mapped[int] = mapped_column(Integer, nullable=False)
    connector_name: Mapped[str] = mapped_column(String(100), nullable=False)
    connector_image_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    execution_status: Mapped[str | None] = mapped_column(String(50))
    status_detail: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    institution_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("institutions.id", ondelete="SET NULL", name="fk_pluggy_items_institution_id"),
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_error: Mapped[str | None] = mapped_column(String(200))
    consent_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PluggyAccount(UserOwnedModel):
    __tablename__ = "pluggy_accounts"
    __error_prefix__ = "pluggy_account"
    __table_args__ = (
        UniqueConstraint("user_id", "external_id", name="uq_pluggy_accounts_user_id_external_id"),
    )

    pluggy_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pluggy_items.id", ondelete="CASCADE", name="fk_pluggy_accounts_pluggy_item_id"),
        nullable=False,
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="SET NULL", name="fk_pluggy_accounts_account_id"),
    )
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    subtype: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    number: Mapped[str | None] = mapped_column(String(100))
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_pluggy_accounts_currency"),
        nullable=False,
    )
    synced_balance: Mapped[MoneyAmount] = mapped_column(nullable=False)
    credit_limit: Mapped[MoneyAmount | None] = mapped_column()
    available_credit_limit: Mapped[MoneyAmount | None] = mapped_column()
    raw: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    last_transaction_date: Mapped[date_type | None] = mapped_column(Date)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
