"""TOTP (RFC 6238) secret generation, provisioning URIs, and verification.

Built on cryptography's own TOTP primitive rather than a dedicated OTP
package: cryptography is already a direct dependency (see app/core/crypto.py),
and this module is the whole of what pyotp would have added.

Codes are SHA1/6-digit/30-second, which is not a choice so much as what every
authenticator app assumes when it scans a QR code. SHA1 here is an HMAC key
schedule, not a collision-resistance claim, so its weakness elsewhere doesn't
apply.
"""

import base64
import secrets
from datetime import datetime

from cryptography.hazmat.primitives.hashes import SHA1
from cryptography.hazmat.primitives.twofactor import InvalidToken
from cryptography.hazmat.primitives.twofactor.totp import TOTP

_DIGITS = 6
_TIME_STEP_SECONDS = 30
# Phone and server clocks drift. Accepting the immediately adjacent steps is
# the window RFC 6238 recommends; widening it multiplies the guess space a
# brute-force attempt gets for free.
_SKEW_STEPS = 1
_SECRET_BYTES = 20  # 160 bits, the size RFC 4226 specifies for HMAC-SHA1.

ISSUER = "LealFinance"


def generate_secret() -> str:
    """A fresh shared secret, base32-encoded - the encoding authenticator
    apps expect both in the otpauth:// URI and for manual entry."""
    return base64.b32encode(secrets.token_bytes(_SECRET_BYTES)).decode("ascii")


def _totp(secret: str) -> TOTP:
    return TOTP(base64.b32decode(secret), _DIGITS, SHA1(), _TIME_STEP_SECONDS)


def provisioning_uri(secret: str, *, account_name: str) -> str:
    """The otpauth:// URI encoded into the enrollment QR code."""
    return _totp(secret).get_provisioning_uri(account_name, ISSUER)


def verify_code(
    secret: str, code: str, *, now: datetime, after_step: int | None = None
) -> int | None:
    """The time step `code` matched, or None if it matched nothing.

    Steps at or below `after_step` are rejected even when the digits are
    correct. A TOTP code stays valid for its whole window plus the skew on
    either side, so without that floor a code seen once - over someone's
    shoulder, in a proxy log, in a phishing form - could be replayed for
    roughly another minute. Callers persist the returned step as the new
    floor, which is what "burning" a code means here.
    """
    digits = code.strip().replace(" ", "").replace("-", "")
    if len(digits) != _DIGITS or not digits.isdigit():
        return None

    totp = _totp(secret)
    timestamp = int(now.timestamp())
    for offset in range(-_SKEW_STEPS, _SKEW_STEPS + 1):
        candidate = timestamp + offset * _TIME_STEP_SECONDS
        step = candidate // _TIME_STEP_SECONDS
        if after_step is not None and step <= after_step:
            continue
        try:
            # Compares in constant time internally.
            totp.verify(digits.encode("ascii"), candidate)
        except InvalidToken:
            continue
        return step
    return None
