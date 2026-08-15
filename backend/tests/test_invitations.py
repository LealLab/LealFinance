"""Invitation issuance, revocation, and the invite -> register flow.

See tests/test_auth.py for login/logout/session/CSRF/admin-authorization
coverage this file doesn't repeat.

test_bootstrap_* below cover the one exception to invite-only registration:
the very first user on an instance, who registers with no token at all.
"""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import ROLE_ADMIN, Invitation
from tests.factories import login_as, make_user


async def _admin_client(client: AsyncClient, db_session: AsyncSession) -> None:
    admin, password = await make_user(db_session, email="admin@example.com", role=ROLE_ADMIN)
    await login_as(client, email=admin.email, password=password)


async def test_admin_can_create_and_list_invitation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)

    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "newbie@example.com", "role": "member"}
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["email"] == "newbie@example.com"
    assert isinstance(body["token"], str) and len(body["token"]) > 20

    list_response = await client.get("/api/v1/auth/invitations")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert any(row["email"] == "newbie@example.com" for row in listed)
    # The raw token is exposed only from the create response, never again.
    assert all("token" not in row for row in listed)


async def test_inviting_an_email_with_a_pending_invitation_conflicts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)

    first = await client.post(
        "/api/v1/auth/invitations", json={"email": "dup@example.com", "role": "member"}
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/auth/invitations", json={"email": "dup@example.com", "role": "member"}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "invitation.already_pending"


async def test_inviting_an_existing_user_email_conflicts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    await make_user(db_session, email="already@example.com")

    response = await client.post(
        "/api/v1/auth/invitations", json={"email": "already@example.com", "role": "member"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "user.email_taken"


async def test_admin_can_revoke_a_pending_invitation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "revokeme@example.com", "role": "member"}
    )
    invitation_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/auth/invitations/{invitation_id}")
    assert delete_response.status_code == 204

    list_response = await client.get("/api/v1/auth/invitations")
    row = next(r for r in list_response.json() if r["id"] == invitation_id)
    assert row["revoked_at"] is not None


async def test_register_with_valid_invitation_succeeds_and_logs_in(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "newuser@example.com", "role": "member"}
    )
    token = create_response.json()["token"]

    register_response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "newuser@example.com",
            "token": token,
            "password": "a-perfectly-fine-password",
            "display_name": "New User",
        },
    )
    assert register_response.status_code == 201
    assert register_response.json()["email"] == "newuser@example.com"
    assert register_response.json()["role"] == "member"

    # register_with_invitation logs the new user in immediately.
    me_response = await other_client.get("/api/v1/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "newuser@example.com"


async def test_register_assigns_the_invited_role(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "newadmin@example.com", "role": "admin"}
    )
    token = create_response.json()["token"]

    register_response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "newadmin@example.com",
            "token": token,
            "password": "a-perfectly-fine-password",
            "display_name": "New Admin",
        },
    )
    assert register_response.status_code == 201
    assert register_response.json()["role"] == "admin"


async def test_register_token_is_single_use(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "oneshot@example.com", "role": "member"}
    )
    token = create_response.json()["token"]
    payload = {
        "email": "oneshot@example.com",
        "token": token,
        "password": "a-perfectly-fine-password",
        "display_name": "One Shot",
    }

    first = await other_client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201

    second = await other_client.post("/api/v1/auth/register", json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "invitation.already_accepted"


async def test_register_rejects_email_mismatch(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "intended@example.com", "role": "member"}
    )
    token = create_response.json()["token"]

    response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "someone-else@example.com",
            "token": token,
            "password": "a-perfectly-fine-password",
            "display_name": "Someone Else",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "invitation.not_found"


async def test_register_rejects_unknown_token(other_client: AsyncClient) -> None:
    response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "nobody@example.com",
            "token": "not-a-real-token",
            "password": "a-perfectly-fine-password",
            "display_name": "Nobody",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "invitation.not_found"


async def test_register_rejects_expired_invitation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "stale@example.com", "role": "member"}
    )
    token = create_response.json()["token"]

    result = await db_session.execute(
        select(Invitation).where(Invitation.normalized_email == "stale@example.com")
    )
    invitation = result.scalars().one()
    invitation.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()

    response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "stale@example.com",
            "token": token,
            "password": "a-perfectly-fine-password",
            "display_name": "Stale",
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "invitation.expired"


async def test_register_rejects_revoked_invitation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_client(client, db_session)
    create_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "gone@example.com", "role": "member"}
    )
    token = create_response.json()["token"]
    invitation_id = create_response.json()["id"]

    revoke_response = await client.delete(f"/api/v1/auth/invitations/{invitation_id}")
    assert revoke_response.status_code == 204

    response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "gone@example.com",
            "token": token,
            "password": "a-perfectly-fine-password",
            "display_name": "Gone",
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "invitation.revoked"


async def test_setup_status_reports_true_before_and_false_after_bootstrap(
    client: AsyncClient,
) -> None:
    before = await client.get("/api/v1/auth/setup-status")
    assert before.status_code == 200
    assert before.json()["needs_setup"] is True

    register_response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "first@example.com",
            "password": "a-perfectly-fine-password",
            "display_name": "First User",
        },
    )
    assert register_response.status_code == 201

    after = await client.get("/api/v1/auth/setup-status")
    assert after.json()["needs_setup"] is False


async def test_registering_with_no_token_on_an_empty_instance_becomes_admin(
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "bootstrap@example.com",
            "password": "a-perfectly-fine-password",
            "display_name": "Bootstrap Admin",
        },
    )
    assert response.status_code == 201
    assert response.json()["role"] == "admin"

    # Registering also logs the new admin in immediately.
    me_response = await client.get("/api/v1/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "bootstrap@example.com"


async def test_registering_with_no_token_once_a_user_exists_is_rejected(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await make_user(db_session, email="already-here@example.com")

    response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "late@example.com",
            "password": "a-perfectly-fine-password",
            "display_name": "Too Late",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "invitation.not_found"


async def test_register_rejects_short_password_with_unified_error_envelope(
    other_client: AsyncClient,
) -> None:
    """Not a 401/403/409 AppError - a plain Pydantic validation failure.
    Proves app/core/errors.py's validation_error_handler wraps FastAPI's
    default {"detail": [...]} in the same {"error": {"code", "params"}}
    envelope every other error uses."""
    response = await other_client.post(
        "/api/v1/auth/register",
        json={
            "email": "short@example.com",
            "token": "irrelevant",
            "password": "short",
            "display_name": "Short",
        },
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "error.validation"
    assert "params" in body["error"]
