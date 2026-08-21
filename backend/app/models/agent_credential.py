"""A user's linked AI-provider credential (API key or subscription OAuth
tokens). See app/agents/credentials.py for how this is resolved against
the .env instance-wide fallback, and app/core/crypto.py for how the
secret columns are encrypted at rest.

One row per (user, provider) - no multi-account-per-provider.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel

PROVIDER_ANTHROPIC = "anthropic"
PROVIDER_OPENAI = "openai"
PROVIDER_OLLAMA = "ollama"
PROVIDERS = (PROVIDER_ANTHROPIC, PROVIDER_OPENAI, PROVIDER_OLLAMA)

AUTH_MODE_API_KEY = "api_key"
AUTH_MODE_OAUTH = "oauth"
AUTH_MODE_NONE = "none"
AUTH_MODES = (AUTH_MODE_API_KEY, AUTH_MODE_OAUTH, AUTH_MODE_NONE)

# Kept in sync with app.agents.providers.REASONING_EFFORTS by hand - that
# module can't be imported here without a circular import (it imports the
# PROVIDER_* constants from this file).
REASONING_EFFORTS = ("low", "medium", "high", "xhigh")


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


def _in_check_or_null(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IS NULL OR {_in_check(column, values)}"


class AgentCredential(UserOwnedModel):
    __tablename__ = "agent_credentials"
    __error_prefix__ = "agent_credential"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_agent_credentials_user_id_provider"),
        CheckConstraint(_in_check("provider", PROVIDERS), name="ck_agent_credentials_provider"),
        CheckConstraint(_in_check("auth_mode", AUTH_MODES), name="ck_agent_credentials_auth_mode"),
        CheckConstraint(
            _in_check_or_null("reasoning_effort", REASONING_EFFORTS),
            name="ck_agent_credentials_reasoning_effort",
        ),
    )

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    auth_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    # API key (api_key mode) or OAuth access token (oauth mode) - encrypted,
    # never the raw value. Null for Ollama, which needs no secret.
    secret_ciphertext: Mapped[str | None] = mapped_column(Text)
    refresh_ciphertext: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Codex's chatgpt-account-id header - not a secret, just routing.
    account_id: Mapped[str | None] = mapped_column(String(128))
    # Display-only label (email/plan) shown in the providers UI.
    account_label: Mapped[str | None] = mapped_column(String(255))
    base_url: Mapped[str | None] = mapped_column(String(255))
    model: Mapped[str | None] = mapped_column(String(128))
    # NULL = use the linked model's default (app.agents.providers.default_effort).
    reasoning_effort: Mapped[str | None] = mapped_column(String(16))
