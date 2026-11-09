"""Cloudinary signed-upload parameters.

This module only *signs* parameters locally with the official Cloudinary
Python SDK. It never contacts Cloudinary and never receives file data: the
browser uploads the file straight to Cloudinary using what we return.
"""
from __future__ import annotations

import time
from typing import Dict, Optional

from settings import Settings

# What the browser says the upload is for -> sub-folder under MEDIA_FOLDER_ROOT.
# "chat" is the default and matches the folder named in the project README (sync/chat).
PURPOSE_FOLDERS: Dict[str, str] = {
    "chat": "chat",        # chat images, videos and other attachments
    "voice": "voice",      # recorded voice messages
    "avatar": "avatars",   # profile pictures
    "story": "stories",    # story images and videos
    "group": "groups",     # group icons
}
DEFAULT_PURPOSE = "chat"

_IMAGE_FORMATS = "jpg,jpeg,png,webp,gif,heic,heif,avif"
_VIDEO_FORMATS = "mp4,mov,webm,m4v,3gp,ogv"
_AUDIO_FORMATS = "webm,ogg,oga,opus,mp3,m4a,aac,wav,mp4,weba"

# Only used when ENFORCE_ALLOWED_FORMATS is switched on. "chat" is deliberately
# absent because the app lets people attach any kind of file in chat.
ALLOWED_FORMATS_BY_PURPOSE: Dict[str, str] = {
    "avatar": _IMAGE_FORMATS,
    "group": _IMAGE_FORMATS,
    "story": f"{_IMAGE_FORMATS},{_VIDEO_FORMATS}",
    "voice": _AUDIO_FORMATS,
}


class SigningUnavailableError(RuntimeError):
    """The Cloudinary SDK is not installed or failed to sign."""


def normalize_purpose(value) -> str:
    """Return a known purpose or raise ValueError. ``None`` means the default."""
    if value is None:
        return DEFAULT_PURPOSE
    if not isinstance(value, str) or value.strip().lower() not in PURPOSE_FOLDERS:
        raise ValueError("purpose must be one of: " + ", ".join(sorted(PURPOSE_FOLDERS)))
    return value.strip().lower()


def folder_for(settings: Settings, purpose: str) -> str:
    return f"{settings.folder_root}/{PURPOSE_FOLDERS[purpose]}"


def sign_params(params: Dict[str, object], api_secret: str) -> str:
    """Sign with the official SDK. Local computation only, no network access."""
    try:
        from cloudinary import utils as cloudinary_utils  # imported lazily on purpose
    except ImportError as exc:
        raise SigningUnavailableError("cloudinary package is not installed") from exc
    try:
        return cloudinary_utils.api_sign_request(params, api_secret)
    except Exception as exc:  # noqa: BLE001
        raise SigningUnavailableError("cloudinary signing failed") from exc


def build_signed_upload(settings: Settings, purpose: str, now: Optional[float] = None) -> Dict[str, object]:
    """Create the exact fields the frontend expects, plus a few informational ones.

    The signature covers ``folder`` (and ``allowed_formats`` when enforced) and
    ``timestamp``. Cloudinary rejects any upload whose folder differs from the
    signed one, and rejects timestamps older than about an hour.
    """
    timestamp = int(time.time() if now is None else now)
    folder = folder_for(settings, purpose)
    params: Dict[str, object] = {"folder": folder, "timestamp": timestamp}

    allowed_formats = None
    if settings.enforce_allowed_formats:
        allowed_formats = ALLOWED_FORMATS_BY_PURPOSE.get(purpose)
        if allowed_formats:
            params["allowed_formats"] = allowed_formats

    signature = sign_params(params, settings.api_secret)

    data: Dict[str, object] = {
        "cloudName": settings.cloud_name,
        "apiKey": settings.api_key,
        "timestamp": timestamp,
        "folder": folder,
        "signature": signature,
        "purpose": purpose,
    }
    if allowed_formats:
        data["allowedFormats"] = allowed_formats
    return data
