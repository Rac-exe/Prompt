"""
Prompt caching for Anthropic models.

Anthropic (and OpenRouter→Anthropic) support prefix caching via cache_control
breakpoints. In an agentic loop the system prompt + tool schema are large and
repeated every turn, so caching the static prefix cuts both input-token cost
and time-to-first-token on turns 2..N. No-op for models without cache support.
"""

from __future__ import annotations

_CACHEABLE_MODEL_HINTS = ("claude", "anthropic")


def supports_prompt_cache(model: str) -> bool:
    m = (model or "").lower()
    return any(hint in m for hint in _CACHEABLE_MODEL_HINTS)


def apply_prompt_cache(messages: list[dict], model: str) -> list[dict]:
    """Annotate the system message with an ephemeral cache breakpoint so the
    provider reuses the cached prefix across turns. Returns messages unchanged
    for models that don't support prompt caching."""
    if not supports_prompt_cache(model):
        return messages
    out: list[dict] = []
    for msg in messages:
        if msg.get("role") == "system" and isinstance(msg.get("content"), str):
            out.append({
                "role": "system",
                "content": [{
                    "type": "text",
                    "text": msg["content"],
                    "cache_control": {"type": "ephemeral"},
                }],
            })
        else:
            out.append(msg)
    return out
