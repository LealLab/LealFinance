"""Per-user market-data API keys and their instance-wide fallbacks."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.errors import NotFoundError, ValidationAppError
from app.models.investment import MARKET_DATA_PROVIDERS, MarketDataCredential
from app.schemas.investment import MarketDataCredentialStatusRead


def _require_known_provider(provider: str) -> None:
    if provider not in MARKET_DATA_PROVIDERS:
        raise ValidationAppError(code="market_data_credential.provider_unknown")


async def get_user_row(
    db: AsyncSession, user_id: UUID, provider: str
) -> MarketDataCredential | None:
    result = await db.execute(
        select(MarketDataCredential).where(
            MarketDataCredential.user_id == user_id,
            MarketDataCredential.provider == provider,
        )
    )
    return result.scalars().first()


async def resolve_api_key(
    user_row: MarketDataCredential | None, provider: str
) -> tuple[str | None, str]:
    """Return ``(api_key, source)`` using user, env, then no credential."""
    if user_row is not None:
        try:
            secret = decrypt_secret(user_row.secret_ciphertext)
        except Exception:
            secret = None
        if secret is not None:
            return secret, "user"

    settings = get_settings()
    env_key = {
        "twelve_data": settings.twelve_data_api_key,
        "brapi": settings.brapi_token,
    }.get(provider)
    if env_key:
        return env_key, "env"
    return None, "none"


async def _status(db: AsyncSession, user_id: UUID, provider: str) -> MarketDataCredentialStatusRead:
    row = await get_user_row(db, user_id, provider)
    api_key, source = await resolve_api_key(row, provider)
    return MarketDataCredentialStatusRead(
        provider=provider, configured=api_key is not None, source=source
    )


async def list_status(db: AsyncSession, user_id: UUID) -> list[MarketDataCredentialStatusRead]:
    return [await _status(db, user_id, provider) for provider in MARKET_DATA_PROVIDERS]


async def link(
    db: AsyncSession, user_id: UUID, provider: str, api_key: str
) -> MarketDataCredentialStatusRead:
    _require_known_provider(provider)
    row = await get_user_row(db, user_id, provider)
    if row is None:
        row = MarketDataCredential(
            user_id=user_id,
            provider=provider,
            secret_ciphertext=encrypt_secret(api_key),
        )
        db.add(row)
    else:
        row.secret_ciphertext = encrypt_secret(api_key)
    await db.commit()
    return await _status(db, user_id, provider)


async def unlink(db: AsyncSession, user_id: UUID, provider: str) -> None:
    _require_known_provider(provider)
    row = await get_user_row(db, user_id, provider)
    if row is None:
        raise NotFoundError(code="market_data_credential.not_found")
    await db.delete(row)
    await db.commit()
