"""
LLM-based chunk summarization with concept tagging.
Takes a function/class skeleton (name, signature, callees, docstring, code body)
and produces a semantic summary + domain concept tags.
"""

import json
import logging
import litellm
from dataclasses import dataclass, field
from app.config import SUMMARIZER_MODEL, OPENROUTER_API_KEY, SUMMARY_MAX_TOKENS, MAX_CODE_BODY_LEN

logger = logging.getLogger("code-intel.summarizer")

VALID_CONCEPTS = [
    "state-management", "routing", "auth", "data-fetching", "error-handling",
    "UI-rendering", "validation", "caching", "database", "API", "file-io",
    "config", "middleware", "testing", "logging", "security", "payments",
    "notifications", "scheduling", "serialization", "concurrency", "CLI",
    "build-tooling", "internationalization", "analytics", "search",
]

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


@dataclass
class SummaryResult:
    summary: str
    concepts: list[str] = field(default_factory=list)


def summarize_chunk(
    name: str,
    signature: str | None,
    callees: list[str],
    docstring: str | None,
    language: str,
    code_body: str | None = None,
) -> SummaryResult:
    parts = [f"Name: {name}"]
    if signature:
        parts.append(f"Signature: {signature}")
    if callees:
        parts.append(f"Calls: {', '.join(callees[:10])}")
    if docstring:
        parts.append(f"Docstring: {docstring[:500]}")
    parts.append(f"Language: {language}")
    if code_body:
        parts.append(f"Implementation:\n{code_body[:MAX_CODE_BODY_LEN]}")

    user_content = "\n".join(parts)
    body_len = len(code_body) if code_body else 0
    logger.debug(
        f"Summarizing {name} (lang={language}, body={body_len} chars, "
        f"callees={len(callees)}, model={SUMMARIZER_MODEL})"
    )

    kwargs: dict = {
        "model": SUMMARIZER_MODEL,
        "messages": [
            {"role": "system", "content": SUMMARIZE_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": SUMMARY_MAX_TOKENS,
        "temperature": 0.1,
    }
    if OPENROUTER_API_KEY and "openrouter" in SUMMARIZER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY

    try:
        response = litellm.completion(**kwargs)
        raw = (response.choices[0].message.content or "").strip()
        result = _parse_summary_response(raw, name, signature, docstring)
        logger.debug(
            f"Summarized {name}: concepts={result.concepts}, "
            f"summary={result.summary[:80]}..."
        )
        return result
    except Exception as e:
        logger.error(f"Summarization LLM call failed for {name}: {e}", exc_info=True)
        return _build_fallback(name, signature, docstring)


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

        concepts = [c for c in raw_concepts if c in VALID_CONCEPTS][:5]
        dropped = [c for c in raw_concepts if c not in VALID_CONCEPTS]
        if dropped:
            logger.debug(f"Dropped invalid concepts for {name}: {dropped}")

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
