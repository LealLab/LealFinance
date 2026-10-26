"""Structured JSON logging configuration."""

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from starlette.types import ASGIApp, Receive, Scope, Send

# The address of whoever is making the current request. uvicorn resolves it
# from X-Forwarded-For (see the Dockerfile), and ClientIPMiddleware publishes
# it here so security_event() can include it without every caller passing it.
client_ip_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "client_ip", default=None
)

_security_logger = logging.getLogger("lealfinance.security")


def security_event(event: str, *, level: int = logging.WARNING, **fields: Any) -> None:
    """Writes one structured line for a security-relevant event (failed or
    successful sign-in, lockout, credential change, admin change).

    Failures and lockouts default to WARNING so they are easy to alert on;
    pass level=logging.INFO for routine successes. Never pass a password, a
    token, a one-time code, or an email address (people sometimes type a
    password into the email box); identify a known account by `user_id`.
    """
    _security_logger.log(
        level,
        event,
        extra={"extra_fields": {"event": event, "client_ip": client_ip_var.get(), **fields}},
    )


class ClientIPMiddleware:
    """Pure ASGI middleware (no BaseHTTPMiddleware, so streaming responses
    are untouched) that records the request's client address for logging."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        token = client_ip_var.set(client[0] if client else None)
        try:
            await self.app(scope, receive, send)
        finally:
            client_ip_var.reset(token)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        extra = getattr(record, "extra_fields", None)
        if extra:
            payload.update(extra)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Quiet noisy third-party loggers down to the app's chosen level. httpx and
    # httpcore log full request URLs at INFO, and some providers take their API
    # key as a query parameter, so those would end up in the logs.
    for noisy in ("uvicorn.access", "sqlalchemy.engine", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, root.level))
