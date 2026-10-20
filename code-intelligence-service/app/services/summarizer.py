"""
Context-aware chunk summarization with concept tagging.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import litellm

from app.config import (
    CONCEPT_PHRASE_PER_CHUNK,
    GRAPH_BUILDER_ENABLED,
    MAX_CODE_BODY_LEN,
    SUMMARY_MAX_TOKENS,
    SUMMARIZER_MODEL,
)
from app.services.concepts import VALID_CONCEPTS, VALID_CONCEPTS_SET as _VALID_CONCEPTS_SET
from app import llm

logger = logging.getLogger("code-intel.summarizer")

_CONCEPT_LIST = ", ".join(VALID_CONCEPTS)

_CONCEPT_PHRASE_INSTRUCTION = f"""
4. "concept_phrases": exactly {CONCEPT_PHRASE_PER_CHUNK} short free-form semantic phrases describing what this code does, suitable for semantic embedding search. Do NOT use the concept list above — write natural language phrases.
   Examples: "JWT bearer token verification", "Express authentication middleware", "database connection pool management"
""" if GRAPH_BUILDER_ENABLED else ""

_CONCEPT_PHRASE_SCHEMA = ', "concept_phrases": ["...", ...]' if GRAPH_BUILDER_ENABLED else ""

BATCH_SUMMARIZE_SYSTEM_PROMPT = f"""You are a code analysis engine. You will receive multiple code elements, each labeled with a numeric ID.

For EACH element, produce:
1. "summary_code": 1-2 concise sentences describing exactly what the code does, including key side effects.
2. "summary_purpose": 1 sentence explaining why this code exists and what role it plays in the architecture.
3. "concepts": 3-6 domain concept tags from this list:
   {_CONCEPT_LIST}
{_CONCEPT_PHRASE_INSTRUCTION}
Use the surrounding context when provided. Return ONLY a valid JSON array:
[{{"id": 1, "summary_code": "...", "summary_purpose": "...", "concepts": [...]{_CONCEPT_PHRASE_SCHEMA}}}, ...]
No markdown, no explanation."""


@dataclass
class SummaryResult:
    summary_code: str
    summary_purpose: str = ""
    concepts: list[str] = field(default_factory=list)
    used_fallback: bool = False
    # Free-form semantic phrases for concept embedding (only populated when
    # GRAPH_BUILDER_ENABLED=true).  Not stored in code_chunks.concepts — kept
    # separate so the fixed-vocab tags remain available for fast keyword matching.
    concept_phrases: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        return self.summary_code


@dataclass
class ChunkSummaryInput:
    name: str
    signature: str | None
    callees: list[str]
    docstring: str | None
    language: str
    code_body: str | None = None
    context_header: str | None = None
    context_before: str | None = None
    context_after: str | None = None
    parent_summary: str | None = None
    sibling_names: list[str] = field(default_factory=list)


def _get_llm_kwargs() -> dict:
    return {**llm.completion_kwargs(SUMMARIZER_MODEL), "temperature": 0.1}


def _build_chunk_text(chunk: ChunkSummaryInput) -> str:
    parts = [f"Name: {chunk.name}", f"Language: {chunk.language}"]
    if chunk.signature:
        parts.append(f"Signature: {chunk.signature}")
    if chunk.callees:
        parts.append(f"Calls: {', '.join(chunk.callees[:20])}")
    if chunk.docstring:
        parts.append(f"Docstring: {chunk.docstring[:500]}")
    if chunk.context_header:
        parts.append(f"File context/imports:\n{chunk.context_header[:1500]}")
    if chunk.parent_summary:
        parts.append(f"Parent scope summary: {chunk.parent_summary[:500]}")
    if chunk.sibling_names:
        parts.append(f"Sibling symbols: {', '.join(chunk.sibling_names[:20])}")
    if chunk.context_before:
        parts.append(f"Previous sibling excerpt:\n{chunk.context_before[:800]}")
    if chunk.context_after:
        parts.append(f"Next sibling excerpt:\n{chunk.context_after[:800]}")
    if chunk.code_body:
        parts.append(f"Implementation:\n{chunk.code_body[:MAX_CODE_BODY_LEN]}")
    return "\n".join(parts)


def summarize_chunk_batch(chunks: list[ChunkSummaryInput]) -> list[SummaryResult]:
    if not chunks:
        return []

    numbered_parts = []
    for i, chunk in enumerate(chunks, 1):
        numbered_parts.append(f"--- ELEMENT {i} ---\n{_build_chunk_text(chunk)}")

    user_content = "\n\n".join(numbered_parts)

    try:
        kwargs = _get_llm_kwargs()
        kwargs["max_tokens"] = min(max(SUMMARY_MAX_TOKENS * len(chunks), 300), 3000)
        parsed = _summarize_attempt(
            kwargs=kwargs,
            user_content=user_content,
            chunks=chunks,
            strict_retry=False,
        )
        if parsed is not None:
            return parsed
        logger.warning("Batch summary parse failed, retrying once with strict JSON reminder")
        retry_parsed = _summarize_attempt(
            kwargs=kwargs,
            user_content=(
                user_content
                + "\n\nIMPORTANT: Your previous response was invalid. "
                + "Return ONLY a valid JSON array, no markdown, no prose, no code fences."
            ),
            chunks=chunks,
            strict_retry=True,
        )
        if retry_parsed is not None:
            return retry_parsed
    except Exception as e:
        logger.warning(f"Batch summarization failed ({e}), using fallbacks")

    return [_build_fallback(c) for c in chunks]


def _summarize_attempt(
    *,
    kwargs: dict,
    user_content: str,
    chunks: list[ChunkSummaryInput],
    strict_retry: bool,
) -> list[SummaryResult] | None:
    request_kwargs = dict(kwargs)
    request_kwargs["messages"] = [
        {"role": "system", "content": BATCH_SUMMARIZE_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    if strict_retry:
        request_kwargs["temperature"] = 0.0
    response = litellm.completion(**request_kwargs)
    raw = (response.choices[0].message.content or "").strip()
    return _parse_batch_response(raw, chunks)


def _parse_batch_response(raw: str, chunks: list[ChunkSummaryInput]) -> list[SummaryResult] | None:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(f"Batch summary JSON parse failed: {e}, raw={cleaned[:300]!r}")
        return None

    if not isinstance(data, list):
        return None

    by_id: dict[int, SummaryResult] = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        try:
            item_id = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        summary_code = str(item.get("summary_code") or item.get("summary") or "").strip()
        summary_purpose = str(item.get("summary_purpose") or "").strip()
        if not summary_code:
            continue
        raw_concepts = item.get("concepts") or []
        concepts = [c for c in raw_concepts if c in _VALID_CONCEPTS_SET][:6]
        raw_phrases = item.get("concept_phrases") or []
        concept_phrases = [
            str(p).strip()[:200] for p in raw_phrases
            if isinstance(p, str) and p.strip()
        ][:CONCEPT_PHRASE_PER_CHUNK]
        by_id[item_id] = SummaryResult(
            summary_code=summary_code[:500],
            summary_purpose=summary_purpose[:350],
            concepts=concepts,
            concept_phrases=concept_phrases,
            used_fallback=False,
        )

    results = []
    for i, chunk in enumerate(chunks, 1):
        results.append(by_id.get(i) or _build_fallback(chunk))
    return results


def _build_fallback(chunk: ChunkSummaryInput) -> SummaryResult:
    summary = chunk.name
    if chunk.signature:
        summary += f" {chunk.signature}"
    if chunk.docstring:
        summary += f" - {chunk.docstring[:120]}"
    text_parts = [chunk.name, chunk.signature or "", chunk.docstring or "", chunk.code_body or ""]
    haystack = " ".join(text_parts).lower()
    concepts = [concept for concept in VALID_CONCEPTS if concept.lower() in haystack][:6]
    return SummaryResult(
        summary_code=summary[:300],
        summary_purpose="",
        concepts=concepts,
        used_fallback=True,
    )
