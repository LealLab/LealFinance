"""TOTP enrollment, the login challenge, trusted devices, and recovery.

See tests/test_auth.py for plain password login and tests/factories.py for
make_user/login_as.
"""

import base64
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import totp
from app.core.crypto import decrypt_secret
from app.core.security import verify_password
from app.models.totp import TrustedDevice
from app.models.user import User
from tests.factories import DEFAULT_PASSWORD, login_as, make_user

NEW_PASSWORD = "a brand new sufficiently long password"


def code_for(secret: str, *, at: datetime | None = None) -> str:
    """The code an authenticator app would be showing for `secret` now."""
    moment = at or datetime.now(UTC)
    inner = totp._totp(secret)
    return inner.generate(int(moment.timestamp())).decode("ascii")


async def enroll(client: AsyncClient, db: AsyncSession, user: User) -> tuple[str, list[str]]:
    """Runs a signed-in user through setup + enable. Returns the shared
    secret and the one-time backup codes."""
    setup = await client.post("/api/v1/auth/totp/setup")
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]

    enable = await client.post("/api/v1/auth/totp/enable", json={"code": code_for(secret)})
    assert enable.status_code == 200, enable.text

    await db.refresh(user)
    # Confirming burns the step it used. Real users enroll and then sign in
    # some time later, in a later window; clearing the floor puts the test
    # there without sleeping out the 30 seconds. The replay guard itself is
    # covered by test_a_code_cannot_be_replayed_inside_its_own_window.
    user.totp_last_step = None
    await db.commit()
    return secret, enable.json()["codes"]


# --- Enrollment -------------------------------------------------------------------


async def test_setup_returns_a_scannable_uri_and_stores_the_secret_encrypted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="enroll@example.com")
    await login_as(client, email=user.email)

    response = await client.post("/api/v1/auth/totp/setup")

    assert response.status_code == 200
    body = response.json()
    assert body["otpauth_uri"].startswith("otpauth://totp/LealFinance:")
    assert f"secret={body['secret']}" in body["otpauth_uri"]
    # Decodes as base32, which is what an authenticator app will try to do.
    assert len(base64.b32decode(body["secret"])) == 20

    await db_session.refresh(user)
    assert user.totp_secret_ciphertext is not None
    assert body["secret"] not in user.totp_secret_ciphertext
    assert decrypt_secret(user.totp_secret_ciphertext) == body["secret"]


async def test_setup_alone_does_not_enable_anything(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """An abandoned enrollment must not start gating logins."""
    user, password = await make_user(db_session, email="abandoned@example.com")
    await login_as(client, email=user.email)
    await client.post("/api/v1/auth/totp/setup")

    assert (await client.get("/api/v1/auth/totp")).json()["enabled"] is False

    await client.post("/api/v1/auth/logout")
    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )
    assert response.status_code == 200


async def test_enable_with_a_wrong_code_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="mistyped@example.com")
    await login_as(client, email=user.email)
    await client.post("/api/v1/auth/totp/setup")

    response = await client.post("/api/v1/auth/totp/enable", json={"code": "000000"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.totp_invalid"
    assert (await client.get("/api/v1/auth/totp")).json()["enabled"] is False


async def test_enable_issues_ten_backup_codes_and_reports_the_remaining_count(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="codes@example.com")
    await login_as(client, email=user.email)

    _secret, codes = await enroll(client, db_session, user)

    assert len(codes) == 10
    assert len(set(codes)) == 10
    status = await client.get("/api/v1/auth/totp")
    assert status.json() == {"enabled": True, "backup_codes_remaining": 10}


async def test_setup_is_refused_once_already_enabled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="twice@example.com")
    await login_as(client, email=user.email)
    await enroll(client, db_session, user)

    response = await client.post("/api/v1/auth/totp/setup")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "totp.already_enabled"


# --- Login challenge --------------------------------------------------------------


async def test_login_demands_a_code_once_enrolled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="gated@example.com")
    await login_as(client, email=user.email)
    await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.totp_required"
    assert "lf_session" not in response.cookies


async def test_login_challenge_is_not_raised_before_the_password_is_checked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A wrong password on an enrolled account must look exactly like a wrong
    password anywhere else - otherwise the challenge reveals who has 2FA on."""
    user, _password = await make_user(db_session, email="oracle@example.com")
    await login_as(client, email=user.email)
    await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": "not the password"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.invalid_credentials"


async def test_login_succeeds_with_a_valid_code(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="passes@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": code_for(secret)},
    )

    assert response.status_code == 200
    assert response.json()["email"] == user.email


async def test_a_code_cannot_be_replayed_inside_its_own_window(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A TOTP code stays arithmetically valid for its whole step; the stored
    step floor is what stops an observed code being reused."""
    user, password = await make_user(db_session, email="replay@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    code = code_for(secret)
    first = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": code},
    )
    assert first.status_code == 200
    await client.post("/api/v1/auth/logout")

    second = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": code},
    )

    assert second.status_code == 401
    assert second.json()["error"]["code"] == "auth.totp_invalid"


async def test_repeated_wrong_codes_lock_the_account_out(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="bruteforce@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    for _attempt in range(5):
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": password, "totp_code": "000000"},
        )
        assert response.json()["error"]["code"] == "auth.totp_invalid"

    # The correct code is now refused too - that is the point of the lockout.
    locked = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": code_for(secret)},
    )

    assert locked.status_code == 401
    assert locked.json()["error"]["code"] == "auth.totp_locked"


async def test_a_backup_code_works_exactly_once(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="backup@example.com")
    await login_as(client, email=user.email)
    _secret, codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    first = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": codes[0]},
    )
    assert first.status_code == 200
    assert (await client.get("/api/v1/auth/totp")).json()["backup_codes_remaining"] == 9
    await client.post("/api/v1/auth/logout")

    second = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": codes[0]},
    )

    assert second.status_code == 401
    assert second.json()["error"]["code"] == "auth.totp_invalid"


async def test_backup_codes_are_accepted_regardless_of_dashes_and_case(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="retyped@example.com")
    await login_as(client, email=user.email)
    _secret, codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    typed = codes[0].replace("-", " ").upper()
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": typed},
    )

    assert response.status_code == 200


async def test_regenerating_backup_codes_invalidates_the_old_set(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="regen@example.com")
    await login_as(client, email=user.email)
    secret, old_codes = await enroll(client, db_session, user)

    response = await client.post("/api/v1/auth/totp/backup-codes", json={"code": code_for(secret)})
    assert response.status_code == 200
    new_codes = response.json()["codes"]
    assert set(new_codes).isdisjoint(old_codes)
    assert (await client.get("/api/v1/auth/totp")).json()["backup_codes_remaining"] == 10

    await client.post("/api/v1/auth/logout")
    stale = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": old_codes[0]},
    )
    assert stale.status_code == 401


# --- Trusted devices --------------------------------------------------------------


async def test_without_the_trust_tick_the_next_login_is_challenged_again(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="untrusted@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    first = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": code_for(secret)},
    )
    assert first.status_code == 200
    assert "lf_trust" not in client.cookies
    await client.post("/api/v1/auth/logout")

    second = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )

    assert second.status_code == 401
    assert second.json()["error"]["code"] == "auth.totp_required"


async def test_trusting_the_device_skips_the_next_challenge(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="trusted@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    first = await client.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "password": password,
            "totp_code": code_for(secret),
            "trust_device": True,
        },
    )
    assert first.status_code == 200
    trust_cookie = next(
        c for c in first.headers.get_list("set-cookie") if c.startswith("lf_trust=")
    )
    assert "HttpOnly" in trust_cookie
    await client.post("/api/v1/auth/logout")

    second = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )

    assert second.status_code == 200


async def test_a_trust_cookie_does_not_carry_over_to_another_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Same browser, different account: the second account must still be
    challenged on its own."""
    trusted, password = await make_user(db_session, email="owner@example.com")
    await login_as(client, email=trusted.email)
    secret, _codes = await enroll(client, db_session, trusted)
    await client.post("/api/v1/auth/logout")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": trusted.email,
            "password": password,
            "totp_code": code_for(secret),
            "trust_device": True,
        },
    )
    await client.post("/api/v1/auth/logout")

    other, other_password = await make_user(db_session, email="other@example.com")
    await login_as(client, email=other.email)
    await enroll(client, db_session, other)
    await client.post("/api/v1/auth/logout")

    response = await client.post(
        "/api/v1/auth/login", json={"email": other.email, "password": other_password}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.totp_required"


async def test_an_expired_trust_no_longer_skips_the_challenge(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="expired@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "password": password,
            "totp_code": code_for(secret),
            "trust_device": True,
        },
    )
    await client.post("/api/v1/auth/logout")

    device = await db_session.scalar(select(TrustedDevice).where(TrustedDevice.user_id == user.id))
    assert device is not None
    device.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.totp_required"


# --- Disabling --------------------------------------------------------------------


async def test_disabling_requires_a_current_code(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A hijacked session must not be able to quietly strip the second factor."""
    user, _password = await make_user(db_session, email="strip@example.com")
    await login_as(client, email=user.email)
    await enroll(client, db_session, user)

    response = await client.post("/api/v1/auth/totp/disable", json={"code": "000000"})

    assert response.status_code == 401
    assert (await client.get("/api/v1/auth/totp")).json()["enabled"] is True


async def test_disabling_clears_the_secret_backup_codes_and_trusted_devices(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="off@example.com")
    await login_as(client, email=user.email)
    secret, codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "password": password,
            "totp_code": code_for(secret),
            "trust_device": True,
        },
    )
    client.headers["X-XSRF-TOKEN"] = client.cookies["XSRF-TOKEN"]

    # A backup code, not another TOTP code: the login above just burned this
    # window's step, and re-using it is exactly what the replay guard blocks.
    response = await client.post("/api/v1/auth/totp/disable", json={"code": codes[0]})

    assert response.status_code == 204
    await db_session.refresh(user)
    assert user.totp_secret_ciphertext is None
    assert user.totp_confirmed_at is None
    assert (await client.get("/api/v1/auth/totp")).json() == {
        "enabled": False,
        "backup_codes_remaining": 0,
    }
    device = await db_session.scalar(select(TrustedDevice).where(TrustedDevice.user_id == user.id))
    assert device is not None and device.revoked_at is not None


# --- Recovery ---------------------------------------------------------------------


async def test_recovery_resets_the_password_with_a_totp_code(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="forgot@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    response = await client.post(
        "/api/v1/auth/recover",
        json={
            "email": user.email,
            "code": code_for(secret),
            "new_password": NEW_PASSWORD,
        },
    )

    assert response.status_code == 204
    # The password check runs before the challenge, so totp_required is proof
    # the new password was accepted - and the old one is now rejected earlier.
    accepted = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": NEW_PASSWORD}
    )
    assert accepted.json()["error"]["code"] == "auth.totp_required"

    stale = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": DEFAULT_PASSWORD}
    )
    assert stale.json()["error"]["code"] == "auth.invalid_credentials"


async def test_recovery_works_with_a_backup_code(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The lost-phone path: the whole reason backup codes exist."""
    user, _password = await make_user(db_session, email="lostphone@example.com")
    await login_as(client, email=user.email)
    _secret, codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    response = await client.post(
        "/api/v1/auth/recover",
        json={"email": user.email, "code": codes[0], "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 204
    await db_session.refresh(user)
    assert verify_password(NEW_PASSWORD, user.password_hash)
    assert not verify_password(DEFAULT_PASSWORD, user.password_hash)


async def test_recovery_revokes_every_existing_session(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    """An attacker who already had a live session must not survive the reset
    the victim performs to lock them out."""
    user, _password = await make_user(db_session, email="hijacked@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    assert (await client.get("/api/v1/auth/me")).status_code == 200

    response = await other_client.post(
        "/api/v1/auth/recover",
        json={"email": user.email, "code": code_for(secret), "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 204

    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_recovery_revokes_every_trusted_device(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="untrust@example.com")
    await login_as(client, email=user.email)
    secret, codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "password": password,
            "totp_code": code_for(secret),
            "trust_device": True,
        },
    )
    await client.post("/api/v1/auth/logout")

    # Backup code: the trusted login above burned this window's TOTP step.
    await other_client.post(
        "/api/v1/auth/recover",
        json={"email": user.email, "code": codes[0], "new_password": NEW_PASSWORD},
    )

    # The browser still holds lf_trust, but the row behind it is revoked.
    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": NEW_PASSWORD}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.totp_required"


async def test_recovery_burns_the_code_it_used(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="burned@example.com")
    await login_as(client, email=user.email)
    _secret, codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    body = {"email": user.email, "code": codes[0], "new_password": NEW_PASSWORD}
    assert (await client.post("/api/v1/auth/recover", json=body)).status_code == 204

    replayed = await client.post(
        "/api/v1/auth/recover",
        json={"email": user.email, "code": codes[0], "new_password": "yet another long password"},
    )

    assert replayed.status_code == 401


async def test_recovery_answers_identically_for_unknown_and_unenrolled_accounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Recovery must not become an oracle for which addresses are registered
    or which of them have a second factor."""
    plain, _password = await make_user(db_session, email="noenrollment@example.com")
    enrolled, _password2 = await make_user(db_session, email="enrolled@example.com")
    await login_as(client, email=enrolled.email)
    await enroll(client, db_session, enrolled)
    await client.post("/api/v1/auth/logout")

    responses = [
        await client.post(
            "/api/v1/auth/recover",
            json={"email": email, "code": "000000", "new_password": NEW_PASSWORD},
        )
        for email in ("nobody@example.com", plain.email, enrolled.email)
    ]

    assert [r.status_code for r in responses] == [401, 401, 401]
    assert {r.json()["error"]["code"] for r in responses} == {"auth.invalid_credentials"}


async def test_recovery_leaves_the_password_alone_when_the_code_is_wrong(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="nochange@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    await client.post(
        "/api/v1/auth/recover",
        json={"email": user.email, "code": "000000", "new_password": NEW_PASSWORD},
    )

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password, "totp_code": code_for(secret)},
    )
    assert response.status_code == 200


async def test_recovery_enforces_the_registration_password_policy(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="weak@example.com")
    await login_as(client, email=user.email)
    secret, _codes = await enroll(client, db_session, user)
    await client.post("/api/v1/auth/logout")

    response = await client.post(
        "/api/v1/auth/recover",
        json={"email": user.email, "code": code_for(secret), "new_password": "short"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "error.validation"


# --- Unit-level guards ------------------------------------------------------------


def test_verify_code_rejects_a_step_at_or_below_the_floor() -> None:
    secret = totp.generate_secret()
    now = datetime.now(UTC)
    step = totp.verify_code(secret, code_for(secret, at=now), now=now)

    assert step is not None
    assert totp.verify_code(secret, code_for(secret, at=now), now=now, after_step=step) is None


def test_verify_code_tolerates_one_step_of_clock_drift() -> None:
    secret = totp.generate_secret()
    now = datetime.now(UTC)

    assert totp.verify_code(secret, code_for(secret, at=now - timedelta(seconds=30)), now=now)
    assert totp.verify_code(secret, code_for(secret, at=now + timedelta(seconds=30)), now=now)
    assert (
        totp.verify_code(secret, code_for(secret, at=now + timedelta(minutes=5)), now=now) is None
    )


def test_verify_code_rejects_malformed_input() -> None:
    secret = totp.generate_secret()
    now = datetime.now(UTC)

    for candidate in ("", "abcdef", "12345", "1234567", "   "):
        assert totp.verify_code(secret, candidate, now=now) is None
