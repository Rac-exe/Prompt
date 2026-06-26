"""
Optional LLM usage logger for benchmarking PRMPT's *own* model spend.

When the env var ``PRMPT_LLM_USAGE_LOG`` points at a file path, every litellm
completion the service makes (summaries, concept/decomposition, query analysis,
answer generation, agentic-retrieval hops) is appended as one JSON line with its
token counts and cost. Embeddings and reranking are local (no token cost) and
are not litellm completions, so they don't appear here.

This exists purely so the 3-arm benchmark can fold PRMPT's retrieval/indexing
cost into the comparison — otherwise the "PRMPT brain" spend is invisible and
the agent-only numbers understate the true cost. It is a no-op in normal product
use (env unset), and never raises into the request path.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger("code-intel.usage")

_LOCK = threading.Lock()


def log_path() -> str:
    return os.environ.get("PRMPT_LLM_USAGE_LOG", "").strip()


def is_enabled() -> bool:
    return bool(log_path())


def _write(record: dict) -> None:
    path = log_path()
    if not path:
        return
    try:
        with _LOCK:
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:  # never break a request because logging failed
        logger.debug("usage log write failed: %s", e)


def _usage_field(usage, key: str) -> int:
    if usage is None:
        return 0
    if isinstance(usage, dict):
        return int(usage.get(key) or 0)
    return int(getattr(usage, key, 0) or 0)


def _record(kwargs: dict, response_obj, start_time, end_time) -> None:
    try:
        usage = getattr(response_obj, "usage", None)
        if usage is None and isinstance(response_obj, dict):
            usage = response_obj.get("usage")
        rec = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "ts_epoch": time.time(),
            "model": kwargs.get("model"),
            "call_type": kwargs.get("call_type"),
            "prompt_tokens": _usage_field(usage, "prompt_tokens"),
            "completion_tokens": _usage_field(usage, "completion_tokens"),
            "total_tokens": _usage_field(usage, "total_tokens"),
            "cost_usd": float(kwargs.get("response_cost") or 0.0),
        }
        _write(rec)
    except Exception as e:
        logger.debug("usage record failed: %s", e)


try:
    from litellm.integrations.custom_logger import CustomLogger

    class _UsageHandler(CustomLogger):
        def log_success_event(self, kwargs, response_obj, start_time, end_time):
            _record(kwargs, response_obj, start_time, end_time)

        async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
            _record(kwargs, response_obj, start_time, end_time)

    _HANDLER = _UsageHandler()
except Exception:  # litellm not importable for some reason
    _HANDLER = None


def install() -> bool:
    """Register the litellm success callback if enabled. Idempotent."""
    if not is_enabled() or _HANDLER is None:
        return False
    try:
        import litellm

        existing = list(litellm.callbacks or [])
        if _HANDLER not in existing:
            litellm.callbacks = existing + [_HANDLER]
        logger.warning("[Usage] PRMPT LLM usage logging ENABLED -> %s", log_path())
        return True
    except Exception as e:
        logger.warning("[Usage] could not install usage logger: %s", e)
        return False
