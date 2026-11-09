"""Verify the access tokens issued by the Node.js backend.

Node signs tokens with jsonwebtoken's default algorithm (HS256) using
JWT_SECRET. Access tokens carry ``id`` and ``_id`` (the Mongo user id) and
have NO ``tokenType``; refresh tokens carry ``tokenType: "refresh"``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

import jwt

_OBJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")
_MAX_TOKEN_LENGTH = 4096
ALLOWED_ALGORITHMS = ["HS256"]  # never accept anything else (blocks alg=none / confusion attacks)


class AccessTokenError(Exception):
    """Raised for any reason an access token must be refused (always HTTP 401)."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason  # short machine code, safe to log


@dataclass(frozen=True)
class VerifiedToken:
    user_id: str
    issued_at: Optional[int]
    expires_at: int


def extract_bearer_token(authorization_header: Optional[str]) -> str:
    """Return the token from ``Authorization: Bearer <token>`` or raise AccessTokenError."""
    if not authorization_header:
        raise AccessTokenError("Authorization token is missing", "missing")
    parts = authorization_header.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AccessTokenError("Authorization header must be: Bearer <token>", "malformed_header")
    token = parts[1]
    if len(token) > _MAX_TOKEN_LENGTH or token.count(".") != 2:
        raise AccessTokenError("Invalid access token", "malformed_token")
    return token


def _user_id_from_payload(payload: dict) -> str:
    candidates = [payload.get("id"), payload.get("_id")]
    present = [c for c in candidates if c is not None]
    if not present:
        raise AccessTokenError("Invalid access token", "no_user_id")
    for value in present:
        if not isinstance(value, str) or not _OBJECT_ID_RE.match(value):
            raise AccessTokenError("Invalid access token", "bad_user_id")
    if len(set(present)) != 1:
        raise AccessTokenError("Invalid access token", "user_id_mismatch")
    return present[0].lower()


def verify_access_token(token: str, secret: str, leeway_seconds: int = 10) -> VerifiedToken:
    """Validate signature (HS256), expiry, token type and user id."""
    if not secret:
        raise AccessTokenError("Invalid access token", "no_secret")
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=ALLOWED_ALGORITHMS,
            leeway=leeway_seconds,
            options={"require": ["exp"], "verify_exp": True, "verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise AccessTokenError("Access token has expired", "expired") from None
    except jwt.InvalidSignatureError:
        raise AccessTokenError("Invalid access token", "bad_signature") from None
    except jwt.InvalidTokenError:
        raise AccessTokenError("Invalid access token", "invalid") from None

    if not isinstance(payload, dict):
        raise AccessTokenError("Invalid access token", "invalid_payload")

    # Refresh tokens (or any other special token type) must never open this endpoint.
    token_type = payload.get("tokenType")
    if token_type is not None and token_type != "access":
        raise AccessTokenError("Invalid access token", "wrong_token_type")

    user_id = _user_id_from_payload(payload)
    iat = payload.get("iat")
    return VerifiedToken(
        user_id=user_id,
        issued_at=int(iat) if isinstance(iat, (int, float)) else None,
        expires_at=int(payload["exp"]),
    )
