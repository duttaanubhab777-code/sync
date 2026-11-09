"""GET /health - public liveness check. Never returns secrets."""
from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify

from settings import SERVICE_NAME, SERVICE_VERSION

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    runtime = current_app.extensions["sync_media"]
    response = jsonify(
        {
            "ok": True,
            "status": "ok",
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            # A yes/no only: lets the owner see at a glance whether config.py was filled in.
            "configured": runtime.settings.is_configured,
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response
