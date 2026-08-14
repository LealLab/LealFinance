"""Machine-readable application errors.

The API never returns pre-translated error strings - only a stable `code`
plus structured `params`. The frontend maps codes to Transloco keys, which
keeps every translation in exactly one place. See docs/i18n.md.
"""

from typing import Any

from fastapi import Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """Base class for domain errors that should reach the client as JSON."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "error.generic"

    def __init__(self, code: str | None = None, params: dict[str, Any] | None = None) -> None:
        self.code = code or self.code
        self.params = params or {}
        super().__init__(self.code)


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "error.not_found"


class ValidationAppError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "error.validation"


class UnauthorizedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "auth.unauthenticated"


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "auth.forbidden"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "error.conflict"


async def app_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    # FastAPI's add_exception_handler is keyed by the exact exception class at
    # registration time, so this handler only ever receives an AppError at
    # runtime - the broader Exception signature here is just to satisfy
    # Starlette's handler type, which isn't generic over the exception type.
    assert isinstance(exc, AppError)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "params": exc.params}},
    )


async def validation_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Wraps FastAPI's default `{"detail": [...]}` payload in the same
    `{"error": {"code", "params"}}` envelope every other error uses, so the
    frontend's `isApiErrorBody`/`httpErrorInterceptor` can handle it too.

    `exc.errors()` can embed non-JSON-native values in `ctx` - e.g. a
    `Field(le=100)` constraint on a Decimal puts a raw `Decimal` in
    `ctx["le"]` - which the default encoder can't serialize. This is
    diagnostic metadata about a rejected request, not a monetary response
    value, so jsonable_encoder's float conversion here doesn't conflict
    with the "amounts are never JSON numbers" wire-format rule.
    """
    assert isinstance(exc, RequestValidationError)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={
            "error": {
                "code": "error.validation",
                "params": {"errors": jsonable_encoder(exc.errors())},
            }
        },
    )


async def http_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Wraps Starlette's own HTTPException (raised for things FastAPI itself
    detects, e.g. 404 route-not-found or a bare `raise HTTPException(...)`)
    in the same envelope as AppError, so every error response is uniform."""
    assert isinstance(exc, StarletteHTTPException)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": "error.generic", "params": {"detail": exc.detail}}},
        headers=exc.headers,
    )
