"""JSON response helpers that mirror the Node backend's ApiResponse/ApiError shape."""
from __future__ import annotations

from flask import jsonify


def success_response(data, message: str = "success", status: int = 200):
    body = {"success": True, "statusCode": status, "data": data, "message": message}
    return jsonify(body), status


def error_response(status: int, message: str, errors=None, headers=None):
    body = {
        "success": False,
        "statusCode": status,
        "message": message,
        "errors": errors or [],
    }
    response = jsonify(body)
    response.status_code = status
    for name, value in (headers or {}).items():
        response.headers[name] = value
    return response
