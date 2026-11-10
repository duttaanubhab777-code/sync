"""Configuration loading for the Sync Media Service.

Values are read from environment variables first, then from ``config.py``
(which lives next to this file and is never committed to git).

Nothing in this module ever logs or returns a secret value.
"""
from __future__ import annotations

import importlib.util
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Optional

from utils.security import normalize_origin

SERVICE_NAME = "sync-media-service"
SERVICE_VERSION = "1.1.0"

# Used only when ALLOWED_ORIGINS is not configured at all.
DEFAULT_ALLOWED_ORIGINS = ("https://sync-5lfm.onrender.com",)

BASE_DIR = Path(__file__).resolve().parent

log = logging.getLogger("sync.media.settings")

_CLOUD_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,98}$")
_API_KEY_RE = re.compile(r"^\d{6,20}$")
_FOLDER_ROOT_RE = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$")
_PLACEHOLDER_PREFIXES = ("PASTE_", "CHANGE_ME", "YOUR_", "<")
_EMAIL_RE = re.compile(r"^[^\s@<>\",;]+@[^\s@<>\",;]+\.[^\s@<>\",;]{2,}$")
_TRUE_VALUES = {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # Secrets are excluded from repr() so they can never leak into logs by accident.
    jwt_secret: str = field(default="", repr=False)
    cloud_name: str = ""
    api_key: str = field(default="", repr=False)
    api_secret: str = field(default="", repr=False)
    allowed_origins: tuple = DEFAULT_ALLOWED_ORIGINS
    rate_limit_per_minute: int = 30
    auth_failure_limit_per_minute: int = 20
    jwt_leeway_seconds: int = 10
    folder_root: str = "sync"
    enforce_allowed_formats: bool = False
    client_ip_header: str = "X-Real-IP"
    problems: tuple = ()
    warnings: tuple = ()
    # ---- mail relay (OTP emails). Separate from the media settings above, so a missing
    # ---- Gmail setting never breaks uploads and a missing Cloudinary setting never breaks mail.
    gmail_user: str = ""
    gmail_app_password: str = field(default="", repr=False)
    mail_relay_secret: str = field(default="", repr=False)
    mail_from_name: str = "Sync"
    smtp_host: str = "smtp.gmail.com"
    smtp_mode: str = "auto"  # auto | 465 | 587
    mail_per_recipient_limit: int = 6  # max mails to one address per 10 minutes
    mail_problems: tuple = ()

    @property
    def is_configured(self) -> bool:
        """True only when every required secret is present and well-formed (media signing)."""
        return not self.problems

    @property
    def mail_configured(self) -> bool:
        """True only when the mail relay can work."""
        return not self.mail_problems


def _load_file_values(path: Path) -> dict:
    """Read UPPERCASE names from config.py without needing it on sys.path."""
    if not path.is_file():
        return {}
    try:
        spec = importlib.util.spec_from_file_location("sync_media_local_config", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[union-attr]
    except Exception as exc:  # noqa: BLE001 - never echo file content
        log.error("config.py could not be loaded (%s). Check it for typos.", type(exc).__name__)
        return {}
    return {name: getattr(module, name) for name in dir(module) if name.isupper()}


def _clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.upper().startswith(_PLACEHOLDER_PREFIXES):
        return ""
    return text


def _bounded_int(value: Any, default: int, low: int, high: int, name: str, warnings: list) -> int:
    if value is None or str(value).strip() == "":
        return default
    try:
        number = int(str(value).strip())
    except ValueError:
        warnings.append(f"{name} is not a number; using {default}")
        return default
    if number < low or number > high:
        warnings.append(f"{name} must be between {low} and {high}; using {default}")
        return default
    return number


def _parse_origins(value: Any, warnings: list) -> tuple:
    if value is None or (isinstance(value, str) and not value.strip()):
        return DEFAULT_ALLOWED_ORIGINS
    if isinstance(value, str):
        parts = value.split(",")
    elif isinstance(value, (list, tuple, set)):
        parts = list(value)
    else:
        warnings.append("ALLOWED_ORIGINS has an unsupported type; no browser origin will be allowed")
        return ()
    origins = []
    for part in parts:
        text = str(part).strip()
        if not text:
            continue
        normalized = normalize_origin(text)
        if normalized is None:
            warnings.append(
                "An ALLOWED_ORIGINS entry was ignored (wildcards, paths and plain http "
                "for non-localhost addresses are not allowed)"
            )
            continue
        if normalized not in origins:
            origins.append(normalized)
    if not origins:
        warnings.append("ALLOWED_ORIGINS has no valid entry; every browser origin will be rejected")
    return tuple(origins)


def load_settings(
    environ: Optional[Mapping[str, str]] = None,
    config_file: Optional[Path] = None,
) -> Settings:
    """Build a Settings object. Never raises for missing configuration."""
    env = os.environ if environ is None else environ
    file_values = _load_file_values(Path(config_file) if config_file else BASE_DIR / "config.py")

    def raw(name: str) -> Any:
        from_env = env.get(name)
        if from_env is not None and str(from_env).strip():
            return from_env
        return file_values.get(name)

    problems: list = []
    warnings: list = []

    jwt_secret = _clean(raw("JWT_SECRET"))
    if not jwt_secret:
        problems.append("JWT_SECRET is missing")
    elif len(jwt_secret) < 32:
        warnings.append("JWT_SECRET is shorter than 32 characters; a longer random secret is safer")

    cloud_name = _clean(raw("CLOUDINARY_CLOUD_NAME"))
    if not cloud_name:
        problems.append("CLOUDINARY_CLOUD_NAME is missing")
    elif not _CLOUD_NAME_RE.match(cloud_name):
        problems.append("CLOUDINARY_CLOUD_NAME has invalid characters")

    api_key = _clean(raw("CLOUDINARY_API_KEY"))
    if not api_key:
        problems.append("CLOUDINARY_API_KEY is missing")
    elif not _API_KEY_RE.match(api_key):
        problems.append("CLOUDINARY_API_KEY must contain digits only")

    api_secret = _clean(raw("CLOUDINARY_API_SECRET"))
    if not api_secret:
        problems.append("CLOUDINARY_API_SECRET is missing")
    elif re.search(r"\s", api_secret):
        problems.append("CLOUDINARY_API_SECRET must not contain spaces")

    folder_root = _clean(raw("MEDIA_FOLDER_ROOT")) or "sync"
    if not _FOLDER_ROOT_RE.match(folder_root):
        warnings.append("MEDIA_FOLDER_ROOT is invalid; using 'sync'")
        folder_root = "sync"

    enforce = str(raw("ENFORCE_ALLOWED_FORMATS") or "").strip().lower() in _TRUE_VALUES

    ip_header = _clean(raw("CLIENT_IP_HEADER")) or "X-Real-IP"
    if not re.match(r"^[A-Za-z0-9-]+$", ip_header):
        warnings.append("CLIENT_IP_HEADER is invalid; using X-Real-IP")
        ip_header = "X-Real-IP"

    # ---------- mail relay ----------
    mail_problems: list = []
    gmail_user = _clean(raw("GMAIL_USER")).lower()
    if not gmail_user:
        mail_problems.append("GMAIL_USER is missing")
    elif not _EMAIL_RE.match(gmail_user):
        mail_problems.append("GMAIL_USER is not a valid email address")

    # Google shows the app password as 4 groups of 4 letters; copying it with spaces is fine.
    gmail_app_password = re.sub(r"\s+", "", _clean(raw("GMAIL_APP_PASSWORD")))
    if not gmail_app_password:
        mail_problems.append("GMAIL_APP_PASSWORD is missing")
    elif len(gmail_app_password) != 16:
        warnings.append("GMAIL_APP_PASSWORD is usually exactly 16 characters; check you copied all of it")

    mail_relay_secret = _clean(raw("MAIL_RELAY_SECRET"))
    if not mail_relay_secret:
        mail_problems.append("MAIL_RELAY_SECRET is missing")
    elif len(mail_relay_secret) < 24:
        mail_problems.append("MAIL_RELAY_SECRET must be at least 24 characters (use a long random text)")

    smtp_mode = (_clean(raw("SMTP_MODE")) or "auto").lower()
    if smtp_mode not in ("auto", "465", "587"):
        warnings.append("SMTP_MODE must be auto, 465 or 587; using auto")
        smtp_mode = "auto"

    mail_from_name = " ".join((_clean(raw("MAIL_FROM_NAME")) or "Sync").split())[:80] or "Sync"

    return Settings(
        jwt_secret=jwt_secret,
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        allowed_origins=_parse_origins(raw("ALLOWED_ORIGINS"), warnings),
        rate_limit_per_minute=_bounded_int(
            raw("RATE_LIMIT_PER_MINUTE"), 30, 1, 600, "RATE_LIMIT_PER_MINUTE", warnings
        ),
        auth_failure_limit_per_minute=_bounded_int(
            raw("AUTH_FAILURE_LIMIT_PER_MINUTE"), 20, 1, 600, "AUTH_FAILURE_LIMIT_PER_MINUTE", warnings
        ),
        jwt_leeway_seconds=_bounded_int(
            raw("JWT_LEEWAY_SECONDS"), 10, 0, 60, "JWT_LEEWAY_SECONDS", warnings
        ),
        folder_root=folder_root,
        enforce_allowed_formats=enforce,
        client_ip_header=ip_header,
        problems=tuple(problems),
        warnings=tuple(warnings),
        gmail_user=gmail_user,
        gmail_app_password=gmail_app_password,
        mail_relay_secret=mail_relay_secret,
        mail_from_name=mail_from_name,
        smtp_host=_clean(raw("SMTP_HOST")) or "smtp.gmail.com",
        smtp_mode=smtp_mode,
        mail_per_recipient_limit=_bounded_int(
            raw("MAIL_PER_RECIPIENT_LIMIT"), 6, 1, 60, "MAIL_PER_RECIPIENT_LIMIT", warnings
        ),
        mail_problems=tuple(mail_problems),
    )
