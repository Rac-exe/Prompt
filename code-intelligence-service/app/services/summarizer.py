"""
LLM-based chunk summarization with concept tagging.
Takes a function/class skeleton (name, signature, callees, docstring, code body)
and produces a semantic summary + domain concept tags.

Supports both single-chunk and batch summarization (5-10 per LLM call).
"""

import json
import logging
import litellm
import sentry_sdk
from dataclasses import dataclass, field
from app.config import (
    SUMMARIZER_MODEL, OPENROUTER_API_KEY, SUMMARY_MAX_TOKENS,
    MAX_CODE_BODY_LEN, SUMMARIZER_BATCH_SIZE,
)

logger = logging.getLogger("code-intel.summarizer")

VALID_CONCEPTS = [
    "state-management", "routing", "auth", "data-fetching", "error-handling",
    "UI-rendering", "validation", "caching", "database", "API", "file-io",
    "config", "middleware", "testing", "logging", "security", "payments",
    "notifications", "scheduling", "serialization", "concurrency", "CLI",
    "build-tooling", "internationalization", "analytics", "search",
]

_VALID_CONCEPTS_SET = set(VALID_CONCEPTS)

SUMMARIZE_SYSTEM_PROMPT = """You are a code analysis engine. Given a code element's metadata and implementation, produce a JSON object with exactly two fields:

1. "summary": A concise semantic summary in 1-2 sentences (max 60 tokens).
   - Focus on WHAT the code does and WHY, not how
   - Use active voice
   - Do not repeat the function/class name verbatim
   - Include key dependencies and side effects

2. "concepts": An array of 2-5 domain concept tags from this list:
   state-management, routing, auth, data-fetching, error-handling,
   UI-rendering, validation, caching, database, API, file-io,
   config, middleware, testing, logging, security, payments,
   notifications, scheduling, serialization, concurrency, CLI,
   build-tooling, internationalization, analytics, search

Return ONLY valid JSON. No markdown, no explanation."""

BATCH_SUMMARIZE_SYSTEM_PROMPT = """You are a code analysis engine. You will receive multiple code elements, each labeled with a numeric ID.

For EACH element, produce:
1. "summary": A concise semantic summary in 1-2 sentences (max 60 tokens).
   - Focus on WHAT the code does and WHY, not how
   - Use active voice
   - Do not repeat the function/class name verbatim

2. "concepts": An array of 2-5 domain concept tags from this list:
   state-management, routing, auth, data-fetching, error-handling,
   UI-rendering, validation, caching, database, API, file-io,
   config, middleware, testing, logging, security, payments,
   notifications, scheduling, serialization, concurrency, CLI,
   build-tooling, internationalization, analytics, search

Return ONLY a valid JSON array with one object per element:
[{"id": 1, "summary": "...", "concepts": [...]}, {"id": 2, ...}]
No markdown, no explanation."""


@dataclass
class SummaryResult:
    summary: str
    concepts: list[str] = field(default_factory=list)


@dataclass
class ChunkSummaryInput:
    """Lightweight struct for batch summarization input."""
    name: str
    signature: str | None
    callees: list[str]
    docstring: str | None
    language: str
    code_body: str | None = None


def _get_llm_kwargs() -> dict:
    kwargs: dict = {"model": SUMMARIZER_MODEL, "temperature": 0.1}
    if OPENROUTER_API_KEY and "openrouter" in SUMMARIZER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY
    return kwargs


def _build_chunk_text(chunk: ChunkSummaryInput) -> str:
    parts = [f"Name: {chunk.name}"]
    if chunk.signature:
        parts.append(f"Signature: {chunk.signature}")
    if chunk.callees:
        parts.append(f"Calls: {', '.join(chunk.callees[:10])}")
    if chunk.docstring:
        parts.append(f"Docstring: {chunk.docstring[:500]}")
    parts.append(f"Language: {chunk.language}")
    if chunk.code_body:
        parts.append(f"Implementation:\n{chunk.code_body[:MAX_CODE_BODY_LEN]}")
    return "\n".join(parts)


def summarize_chunk(
    name: str,
    signature: str | None,
    callees: list[str],
    docstring: str | None,
    language: str,
    code_body: str | None = None,
) -> SummaryResult:
    """Summarize a single chunk (fallback path)."""
    user_content = _build_chunk_text(ChunkSummaryInput(
        name=name, signature=signature, callees=callees,
        docstring=docstring, language=language, code_body=code_body,
    ))

    kwargs = _get_llm_kwargs()
    kwargs["messages"] = [
        {"role": "system", "content": SUMMARIZE_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    kwargs["max_tokens"] = SUMMARY_MAX_TOKENS

    try:
        response = litellm.completion(**kwargs)
        raw = (response.choices[0].message.content or "").strip()
        return _parse_summary_response(raw, name, signature, docstring)
    except Exception as e:
        logger.error(f"Summarization LLM call failed for {name}: {e}", exc_info=True)
        sentry_sdk.capture_exception(e)
        return _build_fallback(name, signature, docstring)


def summarize_chunk_batch(chunks: list[ChunkSummaryInput]) -> list[SummaryResult]:
    """
    Summarize multiple chunks in a single LLM call.
    Falls back to individual calls if batch parsing fails.
    """
    if not chunks:
        return []
    if len(chunks) == 1:
        c = chunks[0]
        return [summarize_chunk(c.name, c.signature, c.callees, c.docstring, c.language, c.code_body)]

    numbered_parts = []
    for i, chunk in enumerate(chunks, 1):
        text = _build_chunk_text(chunk)
        numbered_parts.append(f"--- ELEMENT {i} ---\n{text}")

    user_content = "\n\n".join(numbered_parts)

    max_tokens = min(SUMMARY_MAX_TOKENS * len(chunks), 2000)
    kwargs = _get_llm_kwargs()
    kwargs["messages"] = [
        {"role": "system", "content": BATCH_SUMMARIZE_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    kwargs["max_tokens"] = max_tokens

    try:
        names = [c.name for c in chunks]
        prompt_chars = len(user_content)
        logger.info(
            f"[BATCH SUMMARIZE] Sending {len(chunks)} chunks to {SUMMARIZER_MODEL} "
            f"(names={names}, prompt_chars={prompt_chars}, max_tokens={max_tokens})"
        )
        t0 = __import__("time").perf_counter()
        response = litellm.completion(**kwargs)
        elapsed_ms = int((__import__("time").perf_counter() - t0) * 1000)
        raw = (response.choices[0].message.content or "").strip()
        usage = response.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0
        logger.info(
            f"[BATCH SUMMARIZE] LLM responded in {elapsed_ms}ms "
            f"({tokens_in} in / {tokens_out} out, response_len={len(raw)} chars)"
        )
        results = _parse_batch_response(raw, chunks)
        if results:
            return results
        logger.warning("[BATCH SUMMARIZE] Parse returned None, falling back to individual calls")
    except Exception as e:
        logger.warning(f"[BATCH SUMMARIZE] Failed ({e}), falling back to individual calls")
        sentry_sdk.capture_exception(e)

    return [
        summarize_chunk(c.name, c.signature, c.callees, c.docstring, c.language, c.code_body)
        for c in chunks
    ]


def _parse_batch_response(raw: str, chunks: list[ChunkSummaryInput]) -> list[SummaryResult] | None:
    """Parse a batch JSON array response. Returns None if parsing fails."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(f"Batch summary JSON parse failed: {e}, raw: {cleaned[:300]}")
        return None

    if not isinstance(data, list):
        logger.warning("Batch summary response is not an array")
        return None

    id_to_result: dict[int, SummaryResult] = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id")
        summary = str(item.get("summary", "")).strip()
        raw_concepts = item.get("concepts", [])
        if item_id is not None and summary:
            concepts = [c for c in raw_concepts if c in _VALID_CONCEPTS_SET][:5]
            id_to_result[int(item_id)] = SummaryResult(summary=summary[:300], concepts=concepts)

    results: list[SummaryResult] = []
    for i, chunk in enumerate(chunks, 1):
        if i in id_to_result:
            results.append(id_to_result[i])
        else:
            logger.debug(f"Missing batch result for element {i} ({chunk.name}), using fallback")
            results.append(_build_fallback(chunk.name, chunk.signature, chunk.docstring))

    logger.info(
        f"Batch summary parsed: {len(id_to_result)}/{len(chunks)} successful, "
        f"model={SUMMARIZER_MODEL}"
    )
    return results


def _parse_summary_response(
    raw: str,
    name: str,
    signature: str | None,
    docstring: str | None,
) -> SummaryResult:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
        summary = str(data.get("summary", "")).strip()
        raw_concepts = data.get("concepts", [])

        if not summary:
            logger.warning(f"Empty summary in LLM response for {name}, using fallback")
            return _build_fallback(name, signature, docstring)

        concepts = [c for c in raw_concepts if c in _VALID_CONCEPTS_SET][:5]
        return SummaryResult(summary=summary[:300], concepts=concepts)
    except (json.JSONDecodeError, TypeError, AttributeError) as e:
        logger.warning(
            f"Failed to parse structured summary for {name} ({e.__class__.__name__}), "
            f"raw response: {cleaned[:200]}"
        )
        if cleaned and len(cleaned) < 500:
            return SummaryResult(summary=cleaned[:300], concepts=[])
        return _build_fallback(name, signature, docstring)


def _build_fallback(
    name: str,
    signature: str | None,
    docstring: str | None,
) -> SummaryResult:
    fallback = name
    if signature:
        fallback += f" {signature}"
    if docstring:
        fallback += f" — {docstring[:100]}"
    logger.info(f"Using fallback summary for {name}: {fallback[:80]}...")
    return SummaryResult(summary=fallback[:200], concepts=[])
