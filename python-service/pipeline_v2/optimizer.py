"""
optimizer.py — Main LLM orchestrator for pipeline_v2.

Implements:
- Decision Taker (DT): classifies input as NEW / REFINEMENT / ADDITION
- Skill Selector (SF): via skills.py
- Prompt Optimizer (PO): sends full context to LLM and streams result
- Context Summarizer (LLM 1): compresses CC if token budget exceeded
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path
from typing import Tuple

import litellm

from .context import ChatContext
from .skills import load_selected_skills
from .usage_logger import log_usage

litellm.set_verbose = False

# ── System prompts ────────────────────────────────────────────────────────────
FILES_DIR = Path(__file__).parent.parent.parent / "files"


def _load_system_prompt(name: str) -> str:
    path = FILES_DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    raise FileNotFoundError(f"System prompt not found: {path}")


# ── Token budget ──────────────────────────────────────────────────────────────
SUMMARIZE_THRESHOLD = 3000   # compact CC when token count exceeds this
CC_KEEP_RECENT    = 4        # recent messages to keep after compaction
CC_FALLBACK_MSGS  = 6        # messages to use if summarizer fails

# Dedicated cheap/fast model for summarization (separate from the main optimizer)
SUMMARIZER_MODEL = "claude-haiku-4-5-20251001"


# ── Provider config ───────────────────────────────────────────────────────────
def _get_litellm_kwargs(provider: str, model: str) -> Tuple[str, dict]:
    """Return (resolved_model, extra_kwargs) for litellm."""
    if provider == "megallm":
        api_key = os.getenv("MEGALLM_API_KEY")
        api_base = os.getenv("MEGALLM_API_BASE", "https://ai.megallm.io/v1")
        if not api_key:
            print("❌  MEGALLM_API_KEY not set in .env")
            sys.exit(1)
        resolved = f"openai/{model}" if not model.startswith("openai/") else model
        return resolved, {"api_key": api_key, "api_base": api_base}
    return model, {}


# ── Output cleaner ────────────────────────────────────────────────────────────
def _extract_optimized_prompt(raw: str) -> str:
    """
    The system prompt formats output with **ANALYSIS**, **OPTIMIZED PROMPT**,
    **KEY IMPROVEMENTS**, **USAGE TIP** sections.
    Extract only the content inside **OPTIMIZED PROMPT** and drop the rest.
    Falls back to the full raw text if the marker is not found.
    """
    match = re.search(
        r'\*\*OPTIMIZED PROMPT\*\*\s*\n(.*?)(?=\n\*\*[A-Z]|\Z)',
        raw, re.DOTALL | re.IGNORECASE
    )
    if match:
        return match.group(1).strip()
    return raw.strip()


# ─────────────────────────────────────────────────────────────────────────────
# LLM 1 — Context Summarizer
# ─────────────────────────────────────────────────────────────────────────────

def summarize_context(cc: ChatContext, provider: str) -> str:
    """
    LLM 1: Compress full chat context into a compact summary.
    Always uses the cheap haiku model regardless of what model the optimizer uses.
    """
    system_prompt = _load_system_prompt("system_prompt_summarizer.md")
    resolved_model, extra = _get_litellm_kwargs(provider, SUMMARIZER_MODEL)

    user_prompt = f"""Chat History:
{cc.to_text(max_messages=50)}

Compress this conversation into the required JSON format."""

    t0 = time.perf_counter()
    response = litellm.completion(
        model=resolved_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=500,
        temperature=0.2,
        **extra,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    if response.usage:
        log_usage(
            call_type="summarizer",
            model=resolved_model,
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            total_tokens=response.usage.total_tokens,
            session_id=cc.session_id,
            latency_ms=latency_ms,
        )
    return response.choices[0].message.content.strip()


# ─────────────────────────────────────────────────────────────────────────────
# LLM 2 — Prompt Optimizer (DT + SF + PO)
# ─────────────────────────────────────────────────────────────────────────────

def optimize(
    user_input: str,
    cc: ChatContext,
    model: str = "gpt-4o-mini",
    provider: str = "auto",
    stream: bool = False,
) -> str:
    """
    Full pipeline: DT → SF → PO → optimized prompt (clean, no metadata).
    Automatically summarizes context if token budget exceeded.
    """
    system_prompt = _load_system_prompt("system_prompt_optimizer.md")
    resolved_model, extra = _get_litellm_kwargs(provider, model)

    # Select skills
    skill_names, skills_content = load_selected_skills(user_input)

    # Context management: compact if CC exceeds token budget
    if cc.token_estimate() > SUMMARIZE_THRESHOLD:
        print("🔄  Compacting context (haiku summarizer)...")
        try:
            summary_text = summarize_context(cc, provider)
            cc.compact_with_summary(summary_text, keep_recent=CC_KEEP_RECENT)
            # Persist compacted version — future runs read summary, not raw messages
            from .context import save_chat_context as _save
            _save(cc)
        except Exception as exc:
            # Summarizer failed — fall back to tail-trim, do not crash
            print(f"⚠️  Summarizer failed ({exc.__class__.__name__}: {exc}). Using tail-trim fallback.")
            # cc unchanged; to_text below will trim to CC_FALLBACK_MSGS

    cc_text = cc.to_text(max_messages=CC_FALLBACK_MSGS)

    user_prompt = f"""CHAT CONTEXT:
{cc_text}

LOADED SKILLS: {', '.join(skill_names)}
{skills_content}

USER REQUEST:
{user_input}

Analyze the request, classify it (NEW/REFINEMENT/ADDITION), apply the relevant skill techniques, and provide the fully optimized prompt."""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    # Collect response (stream or not) and output directly
    result = ""
    usage = None
    t0 = time.perf_counter()
    if stream:
        response = litellm.completion(
            model=resolved_model, messages=messages,
            max_tokens=1500, temperature=0.7, stream=True,
            stream_options={"include_usage": True}, **extra,
        )
        for chunk in response:
            delta = chunk.choices[0].delta.content or ""
            result += delta
            if hasattr(chunk, "usage") and chunk.usage:
                usage = chunk.usage
    else:
        response = litellm.completion(
            model=resolved_model, messages=messages,
            max_tokens=1500, temperature=0.7, **extra,
        )
        result = response.choices[0].message.content
        usage = response.usage

    latency_ms = int((time.perf_counter() - t0) * 1000)

    if usage:
        log_usage(
            call_type="optimizer",
            model=resolved_model,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            total_tokens=usage.total_tokens,
            session_id=cc.session_id,
            skills=skill_names,
            latency_ms=latency_ms,
        )

    print(result.strip())
    return result.strip()
