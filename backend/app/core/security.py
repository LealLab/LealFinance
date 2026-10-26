"""Password hashing and session/invitation token primitives.

Passwords are hashed with Argon2id (via argon2-cffi, the maintained
low-level binding - passlib, the more commonly reached-for wrapper, is
effectively unmaintained). Session and invitation tokens are opaque
256-bit random values: only a keyed (HMAC) hash of the value is ever
persisted, so neither a stolen cookie/link alone nor a stolen database
dump alone is enough to produce a valid token - replaying a hash requires
also knowing API_SECRET_KEY, the HMAC key.
"""

import asyncio
import hmac
import secrets
from hashlib import sha256

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings

_password_hasher = PasswordHasher()

# Argon2 is deliberately slow and uses ~64 MiB per hash. Running it on the
# event loop freezes every other request, so request handlers use the async
# wrappers below, which hash in a worker thread. The semaphore caps how many
# hashes run at once so a login flood cannot also exhaust memory.
# ponytail: fixed cap of 4; make it a setting if one box needs more throughput.
_hash_slots = asyncio.Semaphore(4)


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        _password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerificationError):
        return False
    return True


async def hash_password_async(password: str) -> str:
    async with _hash_slots:
        return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password: str, password_hash: str) -> bool:
    async with _hash_slots:
        return await asyncio.to_thread(verify_password, password, password_hash)


def generate_token() -> str:
    """An opaque, URL-safe random value - the raw token handed to a client
    once (as a cookie value or an invitation link) and never persisted
    as-is; only hash_token's digest of it is stored."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Keyed (HMAC-SHA256) hash of an opaque token, for at-rest storage and
    equality lookup. API_SECRET_KEY is the key, which is what makes this a
    pepper rather than a plain digest - see the module docstring."""
    key = get_settings().api_secret_key.encode("utf-8")
    return hmac.new(key, token.encode("utf-8"), sha256).hexdigest()


def normalize_email(email: str) -> str:
    """Trim + casefold, applied consistently before every lookup or
    uniqueness check. Deliberately does not strip Gmail-style dots or
    +tags - collapsing distinct-looking addresses together is surprising
    and provider-specific."""
    return email.strip().casefold()
