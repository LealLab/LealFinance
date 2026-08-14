"""Small, dependency-free test data builders.

No factory_boy: the handful of helpers here are a few lines each and stay
more readable as plain functions than as declarative factory classes.
"""

import secrets

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, normalize_email
from app.models.user import ROLE_MEMBER, User

DEFAULT_PASSWORD = "correct horse battery staple"


async def make_user(
    db: AsyncSession,
    *,
    email: str | None = None,
    password: str = DEFAULT_PASSWORD,
    role: str = ROLE_MEMBER,
    is_active: bool = True,
    display_name: str = "Test User",
) -> tuple[User, str]:
    """Persists a user directly, bypassing the invite/register flow (which
    is exercised on its own in tests/test_invitations.py). Returns the user
    alongside its plaintext password, for use in a login request."""
    email = email or f"user-{secrets.token_hex(4)}@example.com"
    user = User(
        email=email,
        normalized_email=normalize_email(email),
        password_hash=hash_password(password),
        display_name=display_name,
        role=role,
        is_active=is_active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user, password


async def login_as(client: AsyncClient, *, email: str, password: str = DEFAULT_PASSWORD) -> None:
    """Logs in on the given client and primes it to send the CSRF header on
    every subsequent mutating request, mirroring what Angular's HttpClient
    does automatically by reading the XSRF-TOKEN cookie in the browser."""
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    client.headers["X-XSRF-TOKEN"] = client.cookies["XSRF-TOKEN"]
