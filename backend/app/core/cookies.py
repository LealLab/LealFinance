"""Session and CSRF cookie names, flags, and set/clear helpers.

`SESSION_COOKIE_NAME` is HttpOnly and carries the opaque session token.
`CSRF_COOKIE_NAME`/`CSRF_HEADER_NAME` are the exact names Angular's
HttpClient reads and sends by default (XSRF-TOKEN / X-XSRF-TOKEN), so the
frontend needs no custom interceptor to participate in the double-submit
check in app/api/deps.py.
"""

from datetime import UTC, datetime

from fastapi import Response

from app.core.config import get_settings

SESSION_COOKIE_NAME = "lf_session"
CSRF_COOKIE_NAME = "XSRF-TOKEN"
CSRF_HEADER_NAME = "X-XSRF-TOKEN"


def set_session_cookies(
    response: Response, *, session_token: str, csrf_token: str, expires_at: datetime
) -> None:
    settings = get_settings()
    secure = settings.environment == "production"
    max_age = max(0, int((expires_at - datetime.now(UTC)).total_seconds()))

    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    # NOT httponly: Angular's HttpClient must be able to read this value in
    # JS to echo it back as the X-XSRF-TOKEN header on state-changing
    # requests. It is useless on its own - app/api/deps.py validates it
    # against the hash stored on the session row, not just cookie==header.
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")
