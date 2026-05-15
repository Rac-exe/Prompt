"""
Line pinpointing: given a ranked chunk and a query, narrow a wide
[start_line, end_line] envelope down to a smaller window that's more
likely to contain the answer.

Three sources, in this precedence order:

  1. Stack-trace override — if the query contained "file.py:42" and line 42
     falls inside this chunk, we already know the answer (free, highest
     precision, source="stacktrace").
  2. Lexical pinpoint — score each line in the chunk body by token overlap
     with the query and return a window around the best match (free,
     source="lexical").
  3. LLM pinpoint — optional, flag-gated. One gpt-4.1-nano call for the top
     N chunks returning JSON {relevant, start, end, reason}. When relevant
     is true, the LLM window + reason override lexical (source="llm").

All three write to chunk dict fields:
  _probable_line_start, _probable_line_end, _probable_line_source
  _probable_issue (only LLM path populates this here; the template path is
                   in routes/context.py._build_probable_issue)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Optional

import litellm
import sentry_sdk

from app.config import (
    LLM_PINPOINT_MODEL,
    LLM_PINPOINT_TOP_N,
    OPENROUTER_API_KEY,
    PINPOINT_WINDOW,
)
from app.services.query_preprocessor import QuerySignals

logger = logging.getLogger("code-intel.line_pinpoint")


# Token splitter for lexical pinpointing — we split on anything that isn't
# a word char so camelCase/PascalCase/snake_case are all handled together.
_TOKEN_SPLIT_RE = re.compile(r"[^\w]+")

# Words we never want to score on — they match every code file.
_STOP_TOKENS: frozenset[str] = frozenset({
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "to", "of", "in", "on", "at", "by", "for", "with", "from", "as",
    "this", "that", "these", "those", "it", "its", "there", "here",
    "and", "or", "but", "not", "no",
    "bug", "issue", "problem", "error", "fix", "fixing", "broken",
    "function", "method", "class", "file", "code", "line",
    "why", "how", "what", "when", "where", "which",
})


def _query_tokens(query: str, signals: QuerySignals | None, concepts: list[str] | None) -> set[str]:
    """Build the bag of tokens we'll score lines against.

    We give structured signals (function names, error types)
    higher implicit weight by including them verbatim in addition to the
    tokenized raw query; the lexical scorer is a simple count so repetition
    = weight.
    """
    raw_tokens = {
        t.lower() for t in _TOKEN_SPLIT_RE.split(query or "")
        if len(t) >= 3 and t.lower() not in _STOP_TOKENS
    }

    # Also split camelCase identifiers into parts so "useCart" also matches "use" and "cart".
    def _split_camel(s: str) -> list[str]:
        return [p.lower() for p in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", s) if len(p) >= 3]

    if signals:
        for fn in signals.function_names:
            raw_tokens.add(fn.lower())
            raw_tokens.update(_split_camel(fn))
        for err in signals.error_types:
            raw_tokens.add(err.lower())

    for c in concepts or []:
        raw_tokens.add(c.lower().replace("-", ""))

    return {t for t in raw_tokens if len(t) >= 3 and t not in _STOP_TOKENS}


def lexical_pinpoint(
    code_body: str,
    start_line: int,
    query_tokens: set[str],
    window: int = PINPOINT_WINDOW,
) -> tuple[int, int, int] | None:
    """
    Score each line by how many query tokens appear in it; return a window
    centered on the best-scoring line. Tie-breaks on earliest line.

    Returns (abs_start_line, abs_end_line, match_score) or None if no line
    in the body contained any query token.

    `start_line` is the absolute line number in the source file where the
    chunk begins (1-indexed, matching how we store chunks).
    """
    if not code_body or not query_tokens:
        return None
    lines = code_body.splitlines()
    if not lines:
        return None

    best_score = 0
    best_idx = -1
    for i, line in enumerate(lines):
        line_lower = line.lower()
        # `in` check is cheap and gives substring matching, which is what
        # we want for PascalCase / camelCase identifiers typed verbatim.
        score = sum(1 for t in query_tokens if t in line_lower)
        if score > best_score:
            best_score = score
            best_idx = i
    if best_score == 0 or best_idx < 0:
        return None

    lo_idx = max(0, best_idx - window)
    hi_idx = min(len(lines) - 1, best_idx + window)
    return (start_line + lo_idx, start_line + hi_idx, best_score)


def _apply_stacktrace_override(
    chunk: dict,
    signals: QuerySignals | None,
) -> bool:
    """
    C1: if any line from the stack trace falls inside this chunk's envelope,
    use that directly. Returns True if we set fields (so later stages skip).
    """
    if not signals or not signals.line_numbers:
        return False
    file_path = chunk.get("file_path") or ""
    # line_numbers may key on any of several forms (full path, basename, etc.)
    # so try all of them.
    candidates: list[int] = []
    for key, lines in signals.line_numbers.items():
        if key == file_path or file_path.endswith(key) or key.endswith(file_path):
            candidates.extend(lines)

    start, end = chunk.get("start_line", 0), chunk.get("end_line", 0)
    for line in candidates:
        if start <= line <= end:
            lo = max(start, line - PINPOINT_WINDOW)
            hi = min(end, line + PINPOINT_WINDOW)
            chunk["_probable_line_start"] = lo
            chunk["_probable_line_end"] = hi
            chunk["_probable_line_source"] = "stacktrace"
            logger.info(
                f"[PINPOINT] {chunk.get('name')}: source=stacktrace, "
                f"line={line} -> window {lo}-{hi}"
            )
            return True
    return False


def apply_line_pinpoint(
    ranked_chunks: list[dict],
    query: str,
    signals: QuerySignals | None,
    query_concepts: list[str] | None,
) -> None:
    """
    Populate probable_line_* on each ranked chunk in place.

    Mutates each chunk dict by setting `_probable_line_start`,
    `_probable_line_end`, and `_probable_line_source` when we can narrow
    the envelope. Leaves them unset when we can't — consumers should
    treat absent values as "no narrower signal than start_line/end_line".
    """
    if not ranked_chunks:
        return

    tokens = _query_tokens(query, signals, query_concepts)
    n_stack = n_lex = n_skip = 0

    for chunk in ranked_chunks:
        # (1) stack-trace override
        if _apply_stacktrace_override(chunk, signals):
            n_stack += 1
            continue

        # (2) lexical pinpoint
        code_body = chunk.get("code_body")
        start = chunk.get("start_line")
        if not code_body or start is None or not tokens:
            n_skip += 1
            continue

        result = lexical_pinpoint(code_body, start, tokens)
        if result is None:
            n_skip += 1
            continue
        lo, hi, score = result
        chunk["_probable_line_start"] = lo
        chunk["_probable_line_end"] = hi
        chunk["_probable_line_source"] = "lexical"
        n_lex += 1
        logger.info(
            f"[PINPOINT] {chunk.get('name')}: source=lexical, "
            f"envelope={chunk.get('start_line')}-{chunk.get('end_line')} "
            f"-> {lo}-{hi} (score={score})"
        )

    logger.info(
        f"[PINPOINT] summary: stacktrace={n_stack}, lexical={n_lex}, "
        f"skipped={n_skip}, total={len(ranked_chunks)}, "
        f"tokens={len(tokens)}"
    )


# ── LLM pinpoint (C5, flag-gated) ───────────────────────────────────────────

_LLM_PINPOINT_SYSTEM = (
    "You are a code triage assistant. Given a user question and a code "
    "snippet with line numbers, decide whether the snippet is relevant. "
    "If yes, return the narrowest line range inside the snippet that "
    "most likely contains what the user is asking about, plus a short "
    "hedged reason (<=20 words, no claims of certainty). "
    'Output STRICT JSON with keys exactly: '
    '{"relevant": bool, "start": int, "end": int, "reason": str}. '
    "Line numbers must be within the provided body's absolute range. "
    "No prose, no markdown, JSON only."
)


def _render_body_with_line_numbers(code_body: str, start_line: int) -> str:
    """Render the body as 'NNN| <code>' so the LLM can reference lines."""
    out = []
    for i, line in enumerate(code_body.splitlines()):
        out.append(f"{start_line + i:>5}| {line}")
    return "\n".join(out)


async def _llm_pinpoint_one(query: str, chunk: dict) -> None:
    """Run a single LLM pinpoint call for one chunk, mutating it in place."""
    code_body = chunk.get("code_body")
    if not code_body:
        return

    start = int(chunk.get("start_line") or 0)
    end = int(chunk.get("end_line") or 0)
    user_msg = (
        f"User question:\n{query[:1000]}\n\n"
        f"File: {chunk.get('file_path','?')}\n"
        f"Chunk: {chunk.get('name','?')} "
        f"(absolute lines {start}-{end})\n\n"
        f"Body with line numbers:\n{_render_body_with_line_numbers(code_body, start)}"
    )

    kwargs: dict = {
        "model": LLM_PINPOINT_MODEL,
        "messages": [
            {"role": "system", "content": _LLM_PINPOINT_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 120,
        "temperature": 0.0,
    }
    if OPENROUTER_API_KEY and "openrouter" in LLM_PINPOINT_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY

    t0 = time.perf_counter()
    try:
        response = await asyncio.to_thread(litellm.completion, **kwargs)
    except Exception as e:  # pragma: no cover - network
        logger.warning(f"[LLM PINPOINT] completion failed for {chunk.get('name')}: {e}")
        sentry_sdk.capture_exception(e)
        return

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    raw = (response.choices[0].message.content or "").strip()
    usage = getattr(response, "usage", None)
    tokens_in = getattr(usage, "prompt_tokens", 0) if usage else 0
    tokens_out = getattr(usage, "completion_tokens", 0) if usage else 0

    cleaned = raw
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except Exception as e:
        logger.warning(
            f"[LLM PINPOINT] {chunk.get('name')}: non-JSON response "
            f"({elapsed_ms}ms, {tokens_in}in/{tokens_out}out): {raw[:120]!r} ({e})"
        )
        return

    relevant = bool(data.get("relevant"))
    if not relevant:
        logger.info(
            f"[LLM PINPOINT] {chunk.get('name')}: relevant=false "
            f"({elapsed_ms}ms, {tokens_in}in/{tokens_out}out)"
        )
        return

    try:
        pred_start = int(data.get("start"))
        pred_end = int(data.get("end"))
    except (TypeError, ValueError):
        logger.warning(
            f"[LLM PINPOINT] {chunk.get('name')}: missing/invalid start/end in {data}"
        )
        return

    # Clamp to the chunk envelope so the LLM can't lie about line numbers.
    pred_start = max(start, min(pred_start, end))
    pred_end = max(pred_start, min(pred_end, end))
    reason = str(data.get("reason") or "").strip()[:200]

    chunk["_probable_line_start"] = pred_start
    chunk["_probable_line_end"] = pred_end
    chunk["_probable_line_source"] = "llm"
    if reason:
        # D1: the LLM reason is also our probable_issue value.
        chunk["_probable_issue"] = reason

    logger.info(
        f"[LLM PINPOINT] {chunk.get('name')}: relevant=true, "
        f"envelope={start}-{end} -> {pred_start}-{pred_end}, "
        f"reason={reason!r}, "
        f"tokens_in={tokens_in} tokens_out={tokens_out} elapsed_ms={elapsed_ms}"
    )


async def apply_llm_pinpoint(
    ranked_chunks: list[dict],
    query: str,
    top_n: int | None = None,
) -> None:
    """
    C5: run LLM pinpoint on the top N ranked chunks in parallel.

    This is opt-in via ENABLE_LLM_PINPOINT. Call sites must check the flag
    before dispatching to this function — we don't check here so tests can
    invoke it directly.
    """
    n = top_n if top_n is not None else LLM_PINPOINT_TOP_N
    targets = [c for c in ranked_chunks[:n] if c.get("code_body")]
    if not targets:
        logger.info(
            f"[LLM PINPOINT] skipped: no chunks with code_body in top {n}"
        )
        return

    logger.info(
        f"[LLM PINPOINT] dispatching {len(targets)} chunks to {LLM_PINPOINT_MODEL}"
    )
    t0 = time.perf_counter()
    await asyncio.gather(
        *(_llm_pinpoint_one(query, c) for c in targets),
        return_exceptions=False,
    )
    logger.info(
        f"[LLM PINPOINT] completed {len(targets)} chunks in "
        f"{time.perf_counter() - t0:.3f}s"
    )
