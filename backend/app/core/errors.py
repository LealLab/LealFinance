"""Machine-readable application errors.

The API never returns pre-translated error strings — only a stable `code`
plus structured `params`. The frontend maps codes to Transloco keys, which
keeps every translation in exactly one place. See docs/i18n.md.
"""

from typing import Any

from fastapi import Request, status
from fastapi.responses import JSONResponse


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


async def app_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    # FastAPI's add_exception_handler is keyed by the exact exception class at
    # registration time, so this handler only ever receives an AppError at
    # runtime — the broader Exception signature here is just to satisfy
    # Starlette's handler type, which isn't generic over the exception type.
    assert isinstance(exc, AppError)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "params": exc.params}},
    )
