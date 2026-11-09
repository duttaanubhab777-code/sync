"""Security helpers: origin checks, client IP lookup and a tiny rate limiter.

Everything here is in-memory and dependency-free, which is what the
PythonAnywhere free plan (one small web process, no Redis) needs.
"""
from __future__ import annotations

import ipaddress
import threading
import time
from collections import deque
from typing import Callable, Deque, Dict, Optional, Tuple
from urllib.parse import urlparse

_LOCAL_HOSTS = {"localhost", "127.0.0.1"}


def normalize_origin(value) -> Optional[str]:
    """Return ``scheme://host[:port]`` in canonical form, or None if unacceptable.

    Rejected on purpose: wildcards, paths/queries, credentials, and plain http
    for anything that is not localhost (so production can never be downgraded).
    """
    if not isinstance(value, str):
        return None
    text = value.strip().rstrip("/")
    if not text or "*" in text:
        return None
    try:
        parsed = urlparse(text)
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https") or not host:
        return None
    if parsed.path or parsed.params or parsed.query or parsed.fragment:
        return None
    if parsed.username or parsed.password or ":" in host:
        return None
    if parsed.scheme == "http" and host.lower() not in _LOCAL_HOSTS:
        return None
    host = host.lower()
    return f"{parsed.scheme}://{host}" + (f":{port}" if port else "")


def is_origin_allowed(origin: Optional[str], allowed: Tuple[str, ...]) -> bool:
    normalized = normalize_origin(origin) if origin else None
    return normalized is not None and normalized in allowed


def get_client_ip(headers, remote_addr: Optional[str], header_name: str = "X-Real-IP") -> str:
    """Best-effort client IP. Falls back to the socket address when the header is absent/invalid."""
    candidate = (headers.get(header_name) or "").split(",")[0].strip()
    if candidate:
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            pass
    return remote_addr or "unknown"


class SlidingWindowLimiter:
    """Thread-safe sliding-window counter with bounded memory."""

    def __init__(
        self,
        limit: int,
        window_seconds: float = 60.0,
        max_keys: int = 5000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._clock = clock
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def _trim(self, key: str, now: float) -> Deque[float]:
        bucket = self._hits.setdefault(key, deque())
        while bucket and now - bucket[0] >= self.window:
            bucket.popleft()
        return bucket

    def _purge_if_large(self, now: float) -> None:
        if len(self._hits) <= self.max_keys:
            return
        for key in list(self._hits):
            bucket = self._hits[key]
            while bucket and now - bucket[0] >= self.window:
                bucket.popleft()
            if not bucket:
                del self._hits[key]
        # Still too big (a flood of distinct keys): drop the oldest half.
        if len(self._hits) > self.max_keys:
            for key in list(self._hits)[: len(self._hits) // 2]:
                del self._hits[key]

    def _retry_after(self, bucket: Deque[float], now: float) -> int:
        return max(1, int(self.window - (now - bucket[0])) + 1) if bucket else 1

    def is_blocked(self, key: str) -> Tuple[bool, int]:
        """Check without counting a hit."""
        with self._lock:
            now = self._clock()
            bucket = self._trim(key, now)
            blocked = len(bucket) >= self.limit
            retry = self._retry_after(bucket, now) if blocked else 0
            if not bucket:
                self._hits.pop(key, None)
            return blocked, retry

    def record(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            self._purge_if_large(now)
            self._trim(key, now).append(now)

    def allow(self, key: str) -> Tuple[bool, int]:
        """Count a hit if allowed. Returns (allowed, retry_after_seconds)."""
        with self._lock:
            now = self._clock()
            self._purge_if_large(now)
            bucket = self._trim(key, now)
            if len(bucket) >= self.limit:
                return False, self._retry_after(bucket, now)
            bucket.append(now)
            return True, 0
