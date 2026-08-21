"""Resolves which credential a provider call actually uses.

Precedence, matching app/services/exchange_rates.py's degrade-don't-raise
house style:

    active user row for (user, provider)  ->  .env key for provider  ->  None

A provider failure (expired OAuth token that fails to refresh, a stored
secret that no longer decrypts after an API_SECRET_KEY rotation) never
raises out of `resolve` - it falls through to the next step, exactly like
a broken exchange-rate lookup never fails the request that needed a rate.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import oauth
from app.agents.providers import PROVIDERS
from app.agents.providers import default_effort as _default_effort
from app.core.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.models.agent_credential import (
    AUTH_MODE_OAUTH,
    PROVIDER_ANTHROPIC,
    PROVIDER_OLLAMA,
    PROVIDER_OPENAI,
    AgentCredential,
)

logger = logging.getLogger(__name__)

_REFRESH_MARGIN = timedelta(seconds=60)


@dataclass(frozen=True)
class ResolvedCredential:
    provider: str
    auth_mode: str
    secret: str | None
    base_url: str | None
    model: str
    account_id: str | None
    account_label: str | None
    source: Literal["user", "env"]
    # None means the model's own default (app.agents.providers.default_effort)
    # applies - kept last/defaulted so existing keyword-arg construction
    # sites (tests included) that predate this field don't all need updating.
    reasoning_effort: str | None = None


async def get_user_row(db: AsyncSession, user_id: UUID, provider: str) -> AgentCredential | None:
    """Exposed (not module-private) for app/services/agent_providers.py,
    which needs the raw row - not just a resolved credential - to build
    the providers-page status list and to upsert/delete a link."""
    result = await db.execute(
        select(AgentCredential).where(
            AgentCredential.user_id == user_id, AgentCredential.provider == provider
        )
    )
    return result.scalars().first()


async def _refreshed(db: AsyncSession, row: AgentCredential) -> str | None:
    """Returns a usable access token for an OAuth row, refreshing first if
    it's expired or about to be. Clears the row and returns None on a
    failed refresh, so the caller falls through to the .env credential
    instead of surfacing a stale-link error mid-chat."""
    needs_refresh = row.expires_at is not None and row.expires_at <= datetime.now(UTC) + (
        _REFRESH_MARGIN
    )
    if not needs_refresh:
        return decrypt_secret(row.secret_ciphertext) if row.secret_ciphertext else None

    refresh_token = decrypt_secret(row.refresh_ciphertext) if row.refresh_ciphertext else None
    if refresh_token is None:
        await db.delete(row)
        await db.commit()
        return None

    try:
        tokens = await oauth.refresh(row.provider, refresh_token)
    except (httpx.HTTPError, KeyError):
        logger.warning("OAuth refresh failed for provider %s; clearing link", row.provider)
        await db.delete(row)
        await db.commit()
        return None

    row.secret_ciphertext = encrypt_secret(tokens.access_token)
    row.refresh_ciphertext = encrypt_secret(tokens.refresh_token) if tokens.refresh_token else None
    row.expires_at = tokens.expires_at
    if tokens.account_id:
        row.account_id = tokens.account_id
    await db.commit()
    return tokens.access_token


def _env_fallback(provider: str) -> ResolvedCredential | None:
    settings = get_settings()
    spec = PROVIDERS[provider]
    if provider == PROVIDER_ANTHROPIC:
        if not settings.anthropic_api_key:
            return None
        secret = settings.anthropic_api_key
    elif provider == PROVIDER_OPENAI:
        if not settings.openai_api_key:
            return None
        secret = settings.openai_api_key
    else:
        if not settings.ollama_base_url:
            return None
        return ResolvedCredential(
            provider=provider,
            auth_mode="none",
            secret=None,
            base_url=settings.ollama_base_url,
            model=spec.default_model,
            reasoning_effort=_default_effort(provider, spec.default_model),
            account_id=None,
            account_label=None,
            source="env",
        )

    return ResolvedCredential(
        provider=provider,
        auth_mode="api_key",
        secret=secret,
        base_url=None,
        model=spec.default_model,
        reasoning_effort=_default_effort(provider, spec.default_model),
        account_id=None,
        account_label=None,
        source="env",
    )


async def resolve(db: AsyncSession, user_id: UUID, provider: str) -> ResolvedCredential | None:
    if provider not in PROVIDERS:
        return None

    row = await get_user_row(db, user_id, provider)
    if row is not None:
        spec = PROVIDERS[provider]
        if row.auth_mode == AUTH_MODE_OAUTH:
            secret = await _refreshed(db, row)
            if secret is not None:
                model = row.model or spec.default_model
                return ResolvedCredential(
                    provider=provider,
                    auth_mode=row.auth_mode,
                    secret=secret,
                    base_url=row.base_url,
                    model=model,
                    reasoning_effort=row.reasoning_effort or _default_effort(provider, model),
                    account_id=row.account_id,
                    account_label=row.account_label,
                    source="user",
                )
            # Refresh failed and the row was cleared - fall through to env.
        else:
            secret = decrypt_secret(row.secret_ciphertext) if row.secret_ciphertext else None
            # A row that no longer decrypts (API_SECRET_KEY rotated since
            # it was stored) is treated as absent rather than an error -
            # left in place rather than deleted here, since this is a read
            # path; the user will see "not configured" and can re-link.
            if secret is not None or provider == PROVIDER_OLLAMA:
                model = row.model or spec.default_model
                return ResolvedCredential(
                    provider=provider,
                    auth_mode=row.auth_mode,
                    secret=secret,
                    base_url=row.base_url,
                    model=model,
                    reasoning_effort=row.reasoning_effort or _default_effort(provider, model),
                    account_id=row.account_id,
                    account_label=row.account_label,
                    source="user",
                )

    return _env_fallback(provider)
