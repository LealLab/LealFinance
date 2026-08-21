"""Reversible encryption for stored secrets.

Every other secret in this codebase is one-way (see app/core/security.py:
Argon2id passwords, HMAC-peppered session/invitation tokens). AI-provider
credentials (app/models/agent_credential.py) are the first exception - an
API key or OAuth token has to be read back to call the provider, so it
can't be hashed.

The Fernet key is derived from API_SECRET_KEY via HKDF rather than stored
separately: this repo already accepts "rotating API_SECRET_KEY invalidates
stored secrets" as the session/invitation failure mode
(.env.example's API section), so reusing it here is consistent rather than
a new surprise, and avoids a second secret to provision and rotate.
"""

from base64 import urlsafe_b64encode
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings

_HKDF_INFO = b"lealfinance.agents.creds.v1"


@lru_cache
def _fernet() -> Fernet:
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_HKDF_INFO).derive(
        get_settings().api_secret_key.encode("utf-8")
    )
    return Fernet(urlsafe_b64encode(key))


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str | None:
    """None on any decryption failure (wrong/rotated key, corrupt value) -
    callers treat that identically to "no credential stored" rather than
    raising, so a key rotation degrades instead of 500ing."""
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None
