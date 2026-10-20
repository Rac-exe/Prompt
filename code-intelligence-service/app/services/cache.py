"""
Simple in-process TTL cache for frequently-read, rarely-changing data.

Keyed by arbitrary string. Values expire after `ttl` seconds from the time
they were set. Invalidation is explicit (call `invalidate` after writes).

This is intentionally single-process only — suitable for the local desktop
deployment and a single-worker Render instance. If the service ever runs with
multiple workers behind a load balancer, swap this for Redis or a shared store.
"""

import time
import threading
from typing import Any

_store: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()


def get(key: str, ttl: float) -> Any | None:
    """Return the cached value if it exists and has not expired, else None."""
    with _lock:
        entry = _store.get(key)
    if entry is None:
        return None
    stored_at, value = entry
    if time.monotonic() - stored_at < ttl:
        return value
    return None


def set(key: str, value: Any) -> None:
    """Store a value under key, stamped with the current monotonic time."""
    with _lock:
        _store[key] = (time.monotonic(), value)


def invalidate(key: str) -> None:
    """Remove a key from the cache immediately (e.g. after a write)."""
    with _lock:
        _store.pop(key, None)


def clear() -> None:
    """Purge the entire cache (useful in tests)."""
    with _lock:
        _store.clear()
