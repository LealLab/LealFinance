"""WebAuthn passkey ceremonies and management.

See tests/test_totp.py for the matching second-factor coverage and shared
make_user/login_as builders.
"""

import json
import secrets
from datetime import UTC, datetime, timedelta
from hashlib import sha256

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn.helpers import bytes_to_base64url

from app.models.webauthn import WebAuthnChallenge, WebAuthnCredential
from tests.factories import login_as, make_user


class _SoftwareAuthenticator:
    """The smallest software authenticator needed by py_webauthn tests."""

    def __init__(self) -> None:
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self._credential_id = secrets.token_bytes(32)
        self.sign_count = 0
        self.force_sign_count: int | None = None
        self.user_verified = True

    @property
    def credential_id(self) -> str:
        return bytes_to_base64url(self._credential_id)

    @staticmethod
    def _client_data(kind: str, challenge: str) -> bytes:
        return json.dumps(
            {
                "type": kind,
                "challenge": challenge,
                "origin": "http://localhost",
                "crossOrigin": False,
            },
            separators=(",", ":"),
        ).encode()

    def create(self, options: dict) -> dict:
        client_data_json = self._client_data("webauthn.create", options["challenge"])
        numbers = self.private_key.public_key().public_numbers()
        cose_key = cbor2.dumps(
            {
                1: 2,
                3: -7,
                -1: 1,
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )
        auth_data = (
            sha256(options["rp"]["id"].encode()).digest()
            + bytes([0x01 | 0x04 | 0x40])
            + b"\x00\x00\x00\x00"
            + b"\x00" * 16
            + len(self._credential_id).to_bytes(2, "big")
            + self._credential_id
            + cose_key
        )
        attestation_object = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "id": self.credential_id,
            "rawId": self.credential_id,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data_json),
                "attestationObject": bytes_to_base64url(attestation_object),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
        }

    def get(self, options: dict) -> dict:
        client_data_json = self._client_data("webauthn.get", options["challenge"])
        counter = self.force_sign_count
        if counter is None:
            counter = self.sign_count + 1
        self.sign_count = counter
        flags = 0x01 | (0x04 if self.user_verified else 0)
        auth_data = (
            sha256(options["rpId"].encode()).digest() + bytes([flags]) + counter.to_bytes(4, "big")
        )
        signature = self.private_key.sign(
            auth_data + sha256(client_data_json).digest(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "id": self.credential_id,
            "rawId": self.credential_id,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data_json),
                "authenticatorData": bytes_to_base64url(auth_data),
                "signature": bytes_to_base64url(signature),
                "userHandle": bytes_to_base64url(b"\x00" * 16),
            },
            "clientExtensionResults": {},
        }


async def enroll(client: AsyncClient, db: AsyncSession) -> _SoftwareAuthenticator:
    options_response = await client.post("/api/v1/auth/passkeys/register/options")
    assert options_response.status_code == 200, options_response.text
    options = options_response.json()
    authenticator = _SoftwareAuthenticator()
    response = await client.post(
        "/api/v1/auth/passkeys/register",
        json={
            "name": "Test laptop",
            "challenge": options["challenge"],
            "credential": authenticator.create(options),
        },
    )
    assert response.status_code == 201, response.text
    return authenticator


async def passkey_login(client: AsyncClient, authenticator: _SoftwareAuthenticator):
    options_response = await client.post("/api/v1/auth/login/passkey/options")
    assert options_response.status_code == 200, options_response.text
    options = options_response.json()
    return await client.post(
        "/api/v1/auth/login/passkey",
        json={
            "challenge": options["challenge"],
            "credential": authenticator.get(options),
        },
    )


# --- Enrollment and login --------------------------------------------------------


async def test_enrolling_listing_and_deleting_a_passkey_round_trips_its_metadata(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)

    await enroll(client, db_session)
    listed = await client.get("/api/v1/auth/passkeys")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert len(body) == 1
    assert body[0]["name"] == "Test laptop"
    assert body[0]["created_at"]
    assert body[0]["last_used_at"] is None

    deleted = await client.delete(f"/api/v1/auth/passkeys/{body[0]['id']}")
    assert deleted.status_code == 204, deleted.text
    assert (await client.get("/api/v1/auth/passkeys")).json() == []


async def test_passkey_login_issues_normal_cookies_and_a_working_session(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    await client.post("/api/v1/auth/logout")

    response = await passkey_login(client, authenticator)

    assert response.status_code == 200, response.text
    assert response.json()["email"] == user.email
    assert client.cookies.get("lf_session")
    assert client.cookies.get("XSRF-TOKEN")
    assert (await client.get("/api/v1/auth/me")).status_code == 200


async def test_passkey_login_skips_totp_for_a_user_who_has_totp_enabled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    user.totp_confirmed_at = datetime.now(UTC)
    user.totp_secret_ciphertext = "already-encrypted-test-secret"
    await db_session.commit()
    await client.post("/api/v1/auth/logout")

    response = await passkey_login(client, authenticator)

    assert response.status_code == 200, response.text


# --- Challenge binding -----------------------------------------------------------


async def test_reusing_a_passkey_challenge_and_assertion_is_rejected_as_a_replay(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    await client.post("/api/v1/auth/logout")

    options = (await client.post("/api/v1/auth/login/passkey/options")).json()
    assertion = authenticator.get(options)
    payload = {"challenge": options["challenge"], "credential": assertion}
    first = await client.post("/api/v1/auth/login/passkey", json=payload)
    second = await client.post("/api/v1/auth/login/passkey", json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 401, second.text
    assert second.json()["error"]["code"] == "webauthn.challenge_invalid"


async def test_expired_passkey_challenges_are_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    await client.post("/api/v1/auth/logout")

    options = (await client.post("/api/v1/auth/login/passkey/options")).json()
    challenge = await db_session.scalar(
        select(WebAuthnChallenge).where(WebAuthnChallenge.challenge == options["challenge"])
    )
    assert challenge is not None
    challenge.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()
    response = await client.post(
        "/api/v1/auth/login/passkey",
        json={"challenge": options["challenge"], "credential": authenticator.get(options)},
    )

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "webauthn.challenge_invalid"


async def test_a_changed_origin_cannot_finish_a_challenge_issued_for_localhost(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    await client.post("/api/v1/auth/logout")

    options = (await client.post("/api/v1/auth/login/passkey/options")).json()
    assertion = authenticator.get(options)
    client.headers["Origin"] = "https://evil.example"
    response = await client.post(
        "/api/v1/auth/login/passkey",
        json={"challenge": options["challenge"], "credential": assertion},
    )

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "webauthn.challenge_invalid"


# --- Assertion verification ------------------------------------------------------


async def test_a_credential_bound_to_another_rp_id_cannot_authenticate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    stored = await db_session.scalar(
        select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id)
    )
    assert stored is not None
    stored.rp_id = "other.example"
    await db_session.commit()
    await client.post("/api/v1/auth/logout")

    response = await passkey_login(client, authenticator)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "webauthn.verification_failed"


async def test_a_non_increasing_authenticator_counter_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    await client.post("/api/v1/auth/logout")
    first = await passkey_login(client, authenticator)
    assert first.status_code == 200, first.text
    await client.post("/api/v1/auth/logout")
    authenticator.force_sign_count = 1

    response = await passkey_login(client, authenticator)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "webauthn.verification_failed"


async def test_an_assertion_without_user_verification_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    await client.post("/api/v1/auth/logout")
    authenticator.user_verified = False

    response = await passkey_login(client, authenticator)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "webauthn.verification_failed"


async def test_a_passkey_for_an_inactive_user_is_rejected_after_cryptographic_verification(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    user.is_active = False
    await db_session.commit()

    response = await passkey_login(client, authenticator)

    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "auth.account_inactive"


# --- Router boundaries -----------------------------------------------------------


async def test_another_users_passkey_cannot_be_deleted(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="owner@example.com")
    other, _other_password = await make_user(db_session, email="other@example.com")
    client.headers["Origin"] = "http://localhost"
    other_client.headers["Origin"] = "http://localhost"
    await login_as(client, email=user.email)
    authenticator = await enroll(client, db_session)
    stored = await db_session.scalar(
        select(WebAuthnCredential).where(
            WebAuthnCredential.credential_id == authenticator.credential_id
        )
    )
    assert stored is not None
    await login_as(other_client, email=other.email)

    response = await other_client.delete(f"/api/v1/auth/passkeys/{stored.id}")

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "webauthn.not_found"


async def test_plain_http_non_localhost_origin_is_refused(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session)
    await login_as(client, email=user.email)
    client.headers["Origin"] = "http://192.168.1.9:8081"

    response = await client.post("/api/v1/auth/passkeys/register/options")

    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "webauthn.insecure_context"


async def test_a_missing_origin_is_refused_for_public_passkey_options(
    client: AsyncClient,
) -> None:
    response = await client.post("/api/v1/auth/login/passkey/options")

    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "webauthn.origin_invalid"
