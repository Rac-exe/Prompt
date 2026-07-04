"""
OpenRouter account-usage reader.

The key insight: during a benchmark run, the coding agent (Claude/Codex) bills
through Anthropic/OpenAI, while PRMPT (indexing, optimizer, agentic loop) bills
through OpenRouter. So PRMPT's spend for a run == how much the OpenRouter key's
cumulative usage increased across that run's window.

This means we do NOT need any change to PRMPT's services to measure its cost:
snapshot the key's total usage before the run, again after, and take the delta.
The number is OpenRouter's own billed figure (authoritative).

Requires: runs are sequential, so each window only contains one run's PRMPT
spend. The harness runs sequentially by design.
"""

from __future__ import annotations

import time

import requests

_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
_KEY_URL = "https://openrouter.ai/api/v1/key"


def get_key_usage(api_key: str) -> float | None:
    """Return cumulative USD spent on this key, or None if unavailable."""
    if not api_key:
        return None
    headers = {"Authorization": f"Bearer {api_key}"}
    # Preferred: /credits -> data.total_usage (cumulative USD).
    try:
        r = requests.get(_CREDITS_URL, headers=headers, timeout=15)
        if r.ok:
            data = r.json().get("data") or {}
            if "total_usage" in data:
                return float(data["total_usage"])
    except (requests.RequestException, ValueError):
        pass
    # Fallback: /key -> data.usage.
    try:
        r = requests.get(_KEY_URL, headers=headers, timeout=15)
        if r.ok:
            data = r.json().get("data") or {}
            if data.get("usage") is not None:
                return float(data["usage"])
    except (requests.RequestException, ValueError):
        pass
    return None


def settled_usage(api_key: str, *, max_wait_s: float = 12.0, poll_s: float = 2.0) -> float | None:
    """Read usage, waiting for it to stop changing (OpenRouter is eventually
    consistent — a just-finished call may take a few seconds to post)."""
    last = get_key_usage(api_key)
    if last is None:
        return None
    waited = 0.0
    while waited < max_wait_s:
        time.sleep(poll_s)
        waited += poll_s
        cur = get_key_usage(api_key)
        if cur is None:
            return last
        if abs(cur - last) < 1e-9:
            return cur  # stable
        last = cur
    return last


def usage_delta(before: float | None, after: float | None) -> float:
    """PRMPT spend for the window. Clamped at 0 (never report negative)."""
    if before is None or after is None:
        return 0.0
    return round(max(0.0, after - before), 6)
