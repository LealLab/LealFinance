"""Per-user Pluggy credentials."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.errors import NotFoundError, ValidationAppError
from app.models.open_finance import PLUGGY_ENVIRONMENTS, PluggyCredential
from app.schemas.open_finance import PluggyCredentialStatusRead


def _require_known_environment(environment: str) -> None:
    if environment not in PLUGGY_ENVIRONMENTS:
        raise ValidationAppError(code="pluggy_credential.environment_unknown")


async def get_user_row(db: AsyncSession, user_id: UUID) -> PluggyCredential | None:
    result = await db.execute(select(PluggyCredential).where(PluggyCredential.user_id == user_id))
    return result.scalars().first()


async def status(db: AsyncSession, user_id: UUID) -> PluggyCredentialStatusRead:
    row = await get_user_row(db, user_id)
    if row is None:
        return PluggyCredentialStatusRead(configured=False, environment=None)

    configured = (
        decrypt_secret(row.client_id_ciphertext) is not None
        and decrypt_secret(row.client_secret_ciphertext) is not None
    )
    return PluggyCredentialStatusRead(configured=configured, environment=row.environment)


async def get_credentials(db: AsyncSession, user_id: UUID) -> tuple[str, str, str]:
    row = await get_user_row(db, user_id)
    if row is None:
        raise ValidationAppError(code="pluggy.not_configured")
    client_id = decrypt_secret(row.client_id_ciphertext)
    client_secret = decrypt_secret(row.client_secret_ciphertext)
    if client_id is None or client_secret is None:
        raise ValidationAppError(code="pluggy.not_configured")
    return client_id, client_secret, row.environment


async def link(
    db: AsyncSession,
    user_id: UUID,
    client_id: str,
    client_secret: str,
    environment: str,
) -> PluggyCredentialStatusRead:
    _require_known_environment(environment)
    row = await get_user_row(db, user_id)
    if row is None:
        row = PluggyCredential(user_id=user_id)
        db.add(row)
    row.client_id_ciphertext = encrypt_secret(client_id)
    row.client_secret_ciphertext = encrypt_secret(client_secret)
    row.environment = environment
    await db.commit()
    return await status(db, user_id)


async def unlink(db: AsyncSession, user_id: UUID) -> None:
    row = await get_user_row(db, user_id)
    if row is None:
        raise NotFoundError(code="pluggy_credential.not_found")
    await db.delete(row)
    await db.commit()
