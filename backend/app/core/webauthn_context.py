"""Derive the WebAuthn relying party from the browser-supplied Origin.

Origin is a browser-set forbidden header, so page script cannot forge it. The
application is self-hosted at arbitrary hostnames, so there is no configurable
RP ID to drift out of sync with the origin actually used by the browser.
"""

from urllib.parse import urlsplit

from fastapi import Request

from app.core.errors import ForbiddenError

_LOCALHOST_NAMES = {"localhost", "127.0.0.1", "::1"}


def relying_party(request: Request) -> tuple[str, str]:
    """Return the RP ID and origin for the current WebAuthn ceremony."""
    header = request.headers.get("Origin")
    if not header:
        raise ForbiddenError(code="webauthn.origin_invalid")

    try:
        parsed = urlsplit(header)
        hostname = parsed.hostname
    except ValueError as exc:
        raise ForbiddenError(code="webauthn.origin_invalid") from exc

    if not parsed.scheme or not parsed.netloc or not hostname:
        raise ForbiddenError(code="webauthn.origin_invalid")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and hostname in _LOCALHOST_NAMES):
        raise ForbiddenError(code="webauthn.insecure_context")

    return hostname, f"{parsed.scheme}://{parsed.netloc}"
