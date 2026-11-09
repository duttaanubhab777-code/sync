"""POST /media/sign - hand out a Cloudinary signed-upload signature to logged-in users."""
from __future__ import annotations

import logging

from flask import Blueprint, current_app, request

from services.cloudinary_service import (
    SigningUnavailableError,
    build_signed_upload,
    normalize_purpose,
)
from utils.jwt_utils import AccessTokenError, extract_bearer_token, verify_access_token
from utils.responses import error_response, success_response
from utils.security import get_client_ip, is_origin_allowed

log = logging.getLogger("sync.media")

media_bp = Blueprint("media", __name__)

_ALLOWED_BODY_KEYS = {"purpose"}


def _parse_body():
    """Return (purpose_value, error_response_or_None).

    The existing frontend posts ``{}``. A future/optional ``{"purpose": "..."}``
    is accepted; anything else is rejected.
    """
    if not request.get_data(cache=True):
        return None, None
    body = request.get_json(silent=True, force=True)
    if not isinstance(body, dict):
        return None, error_response(400, "Request body must be a JSON object")
    unknown = sorted(set(body) - _ALLOWED_BODY_KEYS)
    if unknown:
        return None, error_response(
            400,
            "Unknown field in request body",
            [{"field": name, "message": "not allowed"} for name in unknown[:5]],
        )
    return body.get("purpose"), None


@media_bp.post("/media/sign")
def sign_media_upload():
    runtime = current_app.extensions["sync_media"]
    settings = runtime.settings

    # 1. Browser origin must be on the allow-list (non-browser callers send no Origin).
    origin = request.headers.get("Origin")
    if origin and not is_origin_allowed(origin, settings.allowed_origins):
        log.warning("Rejected /media/sign from a non-allowed origin")
        return error_response(403, "Origin not allowed")

    # 2. Refuse to run half-configured instead of signing with wrong values.
    if not settings.is_configured:
        log.error("/media/sign called but configuration is incomplete: %s", "; ".join(settings.problems))
        return error_response(503, "Media service is not configured")

    client_ip = get_client_ip(request.headers, request.remote_addr, settings.client_ip_header)

    # 3. Slow down repeated bad-token attempts from one address.
    blocked, retry_after = runtime.failure_limiter.is_blocked(client_ip)
    if blocked:
        return error_response(
            429, "Too many failed attempts. Please wait and try again.",
            headers={"Retry-After": str(retry_after)},
        )

    # 4. Authenticate: Bearer access token signed by the Node backend.
    try:
        token = extract_bearer_token(request.headers.get("Authorization"))
        verified = verify_access_token(token, settings.jwt_secret, settings.jwt_leeway_seconds)
    except AccessTokenError as exc:
        runtime.failure_limiter.record(client_ip)
        log.info("Auth rejected: %s", exc.reason)
        # 401 (not 403) so the frontend refreshes its access token and retries once.
        return error_response(401, exc.message, headers={"WWW-Authenticate": "Bearer"})

    # 5. Per-user rate limit (counts only successful authentications).
    allowed, retry_after = runtime.user_limiter.allow(verified.user_id)
    if not allowed:
        return error_response(
            429, "Too many upload requests. Please wait a moment.",
            headers={"Retry-After": str(retry_after)},
        )

    # 6. Validate the (optional) body.
    purpose_value, body_error = _parse_body()
    if body_error is not None:
        return body_error
    try:
        purpose = normalize_purpose(purpose_value)
    except ValueError as exc:
        return error_response(400, "Invalid purpose", [{"field": "purpose", "message": str(exc)}])

    # 7. Sign locally. No outgoing network request is made.
    try:
        data = build_signed_upload(settings, purpose)
    except SigningUnavailableError as exc:
        log.error("Signing unavailable: %s", exc)
        return error_response(503, "Upload signing is temporarily unavailable")

    log.info("Signed upload for user %s (purpose=%s)", verified.user_id, purpose)
    return success_response(data, "Upload signature created")
