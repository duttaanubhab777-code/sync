"""Shared test helpers (standard library unittest, so no extra packages are needed)."""
from __future__ import annotations

import hashlib
import sys
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import jwt  # noqa: E402

TEST_JWT_SECRET = "unit-test-jwt-secret-0123456789abcdef-0123456789"
TEST_CLOUD = "demo-cloud"
TEST_API_KEY = "123456789012345"
TEST_API_SECRET = "unit-test-cloudinary-api-secret"
TEST_ORIGIN = "https://sync-5lfm.onrender.com"
USER_ID = "64b7f0c2a1b2c3d4e5f60718"


def reference_signature(params: dict, api_secret: str) -> str:
    """Cloudinary's documented algorithm, written independently of our code and of the SDK:
    sort params by name, join as name=value with '&', append the API secret, SHA-1 hex."""
    pieces = []
    for key in sorted(params):
        value = params[key]
        if value is None or value == "":
            continue
        pieces.append(f"{key}={value}")
    return hashlib.sha1(("&".join(pieces) + api_secret).encode("utf-8")).hexdigest()


def _install_reference_sdk_stub() -> None:
    """Used ONLY when the real `cloudinary` package cannot be imported (e.g. offline sandbox).
    It mimics cloudinary.utils.api_sign_request with the documented algorithm."""
    package = types.ModuleType("cloudinary")
    utils = types.ModuleType("cloudinary.utils")

    def api_sign_request(params_to_sign, api_secret, algorithm=None, signature_version=None):
        return reference_signature(dict(params_to_sign), api_secret)

    utils.api_sign_request = api_sign_request
    package.utils = utils
    sys.modules["cloudinary"] = package
    sys.modules["cloudinary.utils"] = utils


try:
    import cloudinary.utils  # noqa: F401

    SDK_MODE = "REAL Cloudinary SDK"
except ImportError:
    _install_reference_sdk_stub()
    SDK_MODE = "reference stub (real Cloudinary SDK not installed here)"

from app import create_app  # noqa: E402
from settings import load_settings  # noqa: E402

NO_CONFIG_FILE = ROOT / "tests" / "__no_such_config__.py"


def good_environ(**overrides) -> dict:
    env = {
        "JWT_SECRET": TEST_JWT_SECRET,
        "CLOUDINARY_CLOUD_NAME": TEST_CLOUD,
        "CLOUDINARY_API_KEY": TEST_API_KEY,
        "CLOUDINARY_API_SECRET": TEST_API_SECRET,
        "ALLOWED_ORIGINS": TEST_ORIGIN,
    }
    env.update(overrides)
    return env


def make_settings(**overrides):
    return load_settings(environ=good_environ(**overrides), config_file=NO_CONFIG_FILE)


def make_client(**overrides):
    app = create_app(make_settings(**overrides))
    app.testing = False  # keep production-like error handling
    return app.test_client()


def make_token(
    secret: str = TEST_JWT_SECRET,
    *,
    expires_in: int = 900,
    algorithm: str = "HS256",
    user_id: str = USER_ID,
    claims: dict | None = None,
    include_exp: bool = True,
) -> str:
    """Build a token shaped like Node's user.generateAccessToken()."""
    now = int(time.time())
    payload = {
        "id": user_id,
        "_id": user_id,
        "email": "a@example.com",
        "username": "alice",
        "fullName": "Alice Example",
        "iat": now,
    }
    if include_exp:
        payload["exp"] = now + expires_in
    if claims:
        payload.update(claims)
    return jwt.encode(payload, secret, algorithm=algorithm)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
