"""Login, logout, session lifecycle, CSRF, and admin/member authorization.

See tests/test_invitations.py for the invite -> register flow this doesn't
cover, and tests/factories.py for make_user/login_as.
"""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import ROLE_ADMIN
from app.models.user import Session as UserSession
from tests.factories import DEFAULT_PASSWORD, login_as, make_user


async def test_login_success_sets_httponly_session_and_readable_csrf_cookie(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="alice@example.com")

    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )

    assert response.status_code == 200
    assert response.json()["email"] == user.email
    assert "password" not in response.text and "password_hash" not in response.text

    set_cookie_headers = response.headers.get_list("set-cookie")
    session_cookie = next(c for c in set_cookie_headers if c.startswith("lf_session="))
    csrf_cookie = next(c for c in set_cookie_headers if c.startswith("XSRF-TOKEN="))

    assert "HttpOnly" in session_cookie
    assert "samesite=lax" in session_cookie.lower()
    assert "HttpOnly" not in csrf_cookie  # Angular's HttpClient must be able to read this one


async def test_login_wrong_password_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, _password = await make_user(db_session, email="bob@example.com")

    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": "wrong password entirely"}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.invalid_credentials"


async def test_login_unknown_email_is_rejected_with_the_same_code(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "whatever-password"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.invalid_credentials"


async def test_login_inactive_account_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="carol@example.com", is_active=False)

    response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.account_inactive"


async def test_me_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.unauthenticated"


async def test_me_returns_the_logged_in_user(client: AsyncClient, db_session: AsyncSession) -> None:
    user, password = await make_user(db_session, email="dave@example.com")
    await login_as(client, email=user.email, password=password)

    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == user.email


async def test_mutating_request_without_csrf_header_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="erin@example.com")
    login_response = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )
    assert login_response.status_code == 200
    # Deliberately not copying the XSRF-TOKEN cookie into the header, unlike
    # login_as() - this is exactly the request Angular's own interceptor
    # would never send, and it must be rejected.

    response = await client.post("/api/v1/auth/logout")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth.csrf_invalid"


async def test_logout_revokes_the_session(client: AsyncClient, db_session: AsyncSession) -> None:
    user, password = await make_user(db_session, email="frank@example.com")
    await login_as(client, email=user.email, password=password)

    logout_response = await client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204

    me_response = await client.get("/api/v1/auth/me")
    assert me_response.status_code == 401
    assert me_response.json()["error"]["code"] == "auth.unauthenticated"


async def test_expired_session_is_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    user, password = await make_user(db_session, email="grace@example.com")
    await login_as(client, email=user.email, password=password)

    result = await db_session.execute(select(UserSession).where(UserSession.user_id == user.id))
    session = result.scalars().one()
    session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()

    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.session_invalid"


async def test_revoked_session_token_cannot_be_reused(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A cookie captured before logout must not work afterward - simulates
    a stolen/cached cookie being replayed post-logout."""
    user, password = await make_user(db_session, email="heidi@example.com")
    await login_as(client, email=user.email, password=password)
    stolen_cookie = client.cookies.get("lf_session")
    assert stolen_cookie is not None

    logout_response = await client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204

    client.cookies.set("lf_session", stolen_cookie)
    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.session_invalid"


async def test_unknown_session_cookie_is_rejected(client: AsyncClient) -> None:
    client.cookies.set("lf_session", "totally-fake-token-value")

    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth.session_invalid"


async def test_member_cannot_access_admin_routes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="ivan@example.com")
    await login_as(client, email=user.email, password=password)

    list_users_response = await client.get("/api/v1/auth/users")
    assert list_users_response.status_code == 403
    assert list_users_response.json()["error"]["code"] == "auth.admin_required"

    create_invitation_response = await client.post(
        "/api/v1/auth/invitations", json={"email": "new@example.com", "role": "member"}
    )
    assert create_invitation_response.status_code == 403
    assert create_invitation_response.json()["error"]["code"] == "auth.admin_required"


async def test_admin_can_list_and_update_users(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin, admin_password = await make_user(db_session, email="admin@example.com", role=ROLE_ADMIN)
    member, _member_password = await make_user(db_session, email="member@example.com")
    await login_as(client, email=admin.email, password=admin_password)

    list_response = await client.get("/api/v1/auth/users")
    assert list_response.status_code == 200
    emails = {row["email"] for row in list_response.json()}
    assert {admin.email, member.email} <= emails

    update_response = await client.patch(
        f"/api/v1/auth/users/{member.id}", json={"display_name": "Renamed"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["display_name"] == "Renamed"


async def test_cannot_demote_the_last_admin(client: AsyncClient, db_session: AsyncSession) -> None:
    admin, password = await make_user(db_session, email="lastadmin@example.com", role=ROLE_ADMIN)
    await login_as(client, email=admin.email, password=password)

    response = await client.patch(f"/api/v1/auth/users/{admin.id}", json={"role": "member"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "auth.last_admin"


async def test_preferences_round_trip(client: AsyncClient, db_session: AsyncSession) -> None:
    user, password = await make_user(db_session, email="judy@example.com")
    await login_as(client, email=user.email, password=password)

    get_response = await client.get("/api/v1/auth/preferences")
    assert get_response.status_code == 200
    assert get_response.json()["display_currency"] == "BRL"

    update_response = await client.patch(
        "/api/v1/auth/preferences",
        json={"theme": "dark", "display_currency": "BRL", "balances_hidden": True},
    )
    assert update_response.status_code == 200
    body = update_response.json()
    assert body["theme"] == "dark"
    assert body["balances_hidden"] is True


async def test_two_users_have_independent_sessions(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    user_a, password_a = await make_user(db_session, email="kate@example.com")
    user_b, password_b = await make_user(db_session, email="leo@example.com")
    await login_as(client, email=user_a.email, password=password_a)
    await login_as(other_client, email=user_b.email, password=password_b)

    response_a = await client.get("/api/v1/auth/me")
    response_b = await other_client.get("/api/v1/auth/me")
    assert response_a.json()["email"] == user_a.email
    assert response_b.json()["email"] == user_b.email

    # Revoking A's session must not affect B's.
    logout_a = await client.post("/api/v1/auth/logout")
    assert logout_a.status_code == 204

    still_b = await other_client.get("/api/v1/auth/me")
    assert still_b.status_code == 200
    assert still_b.json()["email"] == user_b.email

    now_a = await client.get("/api/v1/auth/me")
    assert now_a.status_code == 401


async def test_default_password(db_session: AsyncSession) -> None:
    """Sanity check that make_user's default password is usable, so tests
    that don't care about the exact value can omit it."""
    user, password = await make_user(db_session)
    assert password == DEFAULT_PASSWORD
