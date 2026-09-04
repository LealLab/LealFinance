"""WebAuthn registration, authentication, and passkey management."""

import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.errors import ConflictError, NotFoundError, UnauthorizedError
from app.models.user import User
from app.models.webauthn import WebAuthnChallenge, WebAuthnCredential
from app.services.auth import IssuedSession, _mint_session

_CHALLENGE_TTL = timedelta(minutes=5)
_RP_NAME = "LealFinance"


async def _purge_expired(db: AsyncSession) -> None:
    await db.execute(
        delete(WebAuthnChallenge).where(WebAuthnChallenge.expires_at < datetime.now(UTC))
    )


async def _new_challenge(
    db: AsyncSession,
    *,
    purpose: str,
    rp_id: str,
    origin: str,
    user_id: UUID | None = None,
) -> bytes:
    raw = secrets.token_bytes(32)
    db.add(
        WebAuthnChallenge(
            challenge=bytes_to_base64url(raw),
            purpose=purpose,
            rp_id=rp_id,
            origin=origin,
            user_id=user_id,
            expires_at=datetime.now(UTC) + _CHALLENGE_TTL,
        )
    )
    await db.flush()
    return raw


async def _consume_challenge(
    db: AsyncSession, *, challenge_b64: str, purpose: str, rp_id: str
) -> WebAuthnChallenge:
    row = await db.scalar(
        select(WebAuthnChallenge).where(WebAuthnChallenge.challenge == challenge_b64)
    )
    if (
        row is None
        or row.consumed_at is not None
        or row.expires_at < datetime.now(UTC)
        or row.purpose != purpose
        or row.rp_id != rp_id
    ):
        raise UnauthorizedError(code="webauthn.challenge_invalid")
    row.consumed_at = datetime.now(UTC)
    return row


async def begin_registration(
    db: AsyncSession, *, user: User, rp_id: str, origin: str
) -> dict[str, Any]:
    await _purge_expired(db)
    result = await db.execute(
        select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id)
    )
    exclude_credentials = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(credential.credential_id))
        for credential in result.scalars()
    ]
    raw = await _new_challenge(
        db, purpose="registration", rp_id=rp_id, origin=origin, user_id=user.id
    )
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=_RP_NAME,
        user_name=user.email,
        user_id=user.id.bytes,
        user_display_name=user.display_name,
        challenge=raw,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=exclude_credentials,
    )
    await db.commit()
    return cast(dict[str, Any], json.loads(options_to_json(options)))


async def finish_registration(
    db: AsyncSession,
    *,
    user: User,
    rp_id: str,
    origin: str,
    name: str,
    challenge: str,
    credential: dict[str, Any],
) -> WebAuthnCredential:
    row = await _consume_challenge(db, challenge_b64=challenge, purpose="registration", rp_id=rp_id)
    if row.user_id != user.id:
        raise UnauthorizedError(code="webauthn.challenge_invalid")
    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(row.challenge),
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
    except (InvalidRegistrationResponse, ValueError, KeyError) as exc:
        raise UnauthorizedError(code="webauthn.verification_failed") from exc

    credential_id = bytes_to_base64url(verification.credential_id)
    if await db.scalar(
        select(WebAuthnCredential).where(WebAuthnCredential.credential_id == credential_id)
    ):
        raise ConflictError(code="webauthn.credential_exists")

    response = credential.get("response", {})
    transports = response.get("transports") if isinstance(response, dict) else None
    transport_hint = (
        ",".join(transports)[:255]
        if isinstance(transports, list) and all(isinstance(item, str) for item in transports)
        else None
    )
    row_new = WebAuthnCredential(
        user_id=user.id,
        credential_id=credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
        rp_id=rp_id,
        transports=transport_hint,
        name=name.strip(),
    )
    db.add(row_new)
    await db.commit()
    await db.refresh(row_new)
    return row_new


async def list_credentials(db: AsyncSession, *, user: User) -> list[WebAuthnCredential]:
    result = await db.execute(
        select(WebAuthnCredential)
        .where(WebAuthnCredential.user_id == user.id)
        .order_by(WebAuthnCredential.created_at)
    )
    return list(result.scalars())


async def delete_credential(db: AsyncSession, *, user: User, credential_id: UUID) -> None:
    credential = await db.scalar(
        select(WebAuthnCredential).where(
            WebAuthnCredential.id == credential_id,
            WebAuthnCredential.user_id == user.id,
        )
    )
    if credential is None:
        raise NotFoundError(code="webauthn.not_found")
    await db.delete(credential)
    await db.commit()


async def begin_authentication(db: AsyncSession, *, rp_id: str, origin: str) -> dict[str, Any]:
    await _purge_expired(db)
    raw = await _new_challenge(
        db, purpose="authentication", rp_id=rp_id, origin=origin, user_id=None
    )
    options = generate_authentication_options(
        rp_id=rp_id,
        challenge=raw,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    await db.commit()
    return cast(dict[str, Any], json.loads(options_to_json(options)))


async def finish_authentication(
    db: AsyncSession,
    *,
    rp_id: str,
    origin: str,
    challenge: str,
    credential: dict[str, Any],
) -> IssuedSession:
    row = await _consume_challenge(
        db, challenge_b64=challenge, purpose="authentication", rp_id=rp_id
    )
    raw_id = credential.get("rawId") or credential.get("id")
    if not isinstance(raw_id, str):
        raise UnauthorizedError(code="webauthn.verification_failed")

    credential_row = await db.scalar(
        select(WebAuthnCredential).where(WebAuthnCredential.credential_id == raw_id)
    )
    if credential_row is None or credential_row.rp_id != rp_id:
        raise UnauthorizedError(code="webauthn.verification_failed")
    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(row.challenge),
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=credential_row.public_key,
            credential_current_sign_count=credential_row.sign_count,
            require_user_verification=True,
        )
    except (InvalidAuthenticationResponse, ValueError, KeyError) as exc:
        raise UnauthorizedError(code="webauthn.verification_failed") from exc

    if credential_row.sign_count != 0 and verification.new_sign_count <= credential_row.sign_count:
        raise UnauthorizedError(code="webauthn.verification_failed")

    user = await db.get(User, credential_row.user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError(code="auth.account_inactive")

    credential_row.sign_count = verification.new_sign_count
    credential_row.last_used_at = datetime.now(UTC)
    # User verification combines possession with a PIN or biometric, so it is already MFA.
    issued = await _mint_session(db, user=user)
    await db.commit()
    return issued
