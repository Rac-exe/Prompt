from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

import litellm
import sentry_sdk

from app.config import ANSWER_MODEL, OPENROUTER_API_KEY
from app.services import prmpt_ai_client

logger = logging.getLogger("code-intel.answer")

ANSWER_SYSTEM_PROMPT = """You are a codebase Q&A assistant. Answer using ONLY the provided code chunks.
- Cite files and line ranges when referencing code.
- If the chunks are insufficient, say what is missing.
- Be concise and technical."""


async def generate_answer(
    query: str,
    chunks: list[dict],
    project_summary: str | None = None,
) -> tuple[str | None, list[str]]:
    if not chunks:
        return None, []

    context = _build_context(chunks, project_summary)
    kwargs: dict = {
        "model": ANSWER_MODEL,
        "messages": [
            {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query[:2000]}"},
        ],
        "max_tokens": 900,
        "temperature": 0.2,
    }
    if OPENROUTER_API_KEY and "openrouter" in ANSWER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY
    try:
        if prmpt_ai_client.is_configured():
            answer = (await prmpt_ai_client.completion_async(**kwargs)).strip()
        else:
            response = await asyncio.to_thread(litellm.completion, **kwargs)
            answer = (response.choices[0].message.content or "").strip()
        return answer or None, [str(c["id"]) for c in chunks[:8] if c.get("id")]
    except Exception as e:
        logger.warning(f"Answer generation failed: {e}")
        sentry_sdk.capture_exception(e)
        return None, []


def answer_source_ids(chunks: list[dict]) -> list[str]:
    """The chunk ids cited as sources for an answer (top-N)."""
    return [str(c["id"]) for c in chunks[:8] if c.get("id")]


async def generate_answer_stream(
    query: str,
    chunks: list[dict],
    project_summary: str | None = None,
) -> AsyncIterator[str]:
    """Yield the answer token-by-token. This is the latency-perceived win for
    Ask: the UI renders deltas as they arrive instead of waiting ~20-50s for the
    whole completion. Falls back to a single emit if streaming is unavailable
    (e.g. the proxy backend, which has no streaming endpoint)."""
    if not chunks:
        return

    context = _build_context(chunks, project_summary)
    kwargs: dict = {
        "model": ANSWER_MODEL,
        "messages": [
            {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query[:2000]}"},
        ],
        "max_tokens": 900,
        "temperature": 0.2,
    }
    if OPENROUTER_API_KEY and "openrouter" in ANSWER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY

    # Proxy backend can't stream — emit the full answer once.
    if prmpt_ai_client.is_configured():
        try:
            answer = (await prmpt_ai_client.completion_async(**kwargs)).strip()
            if answer:
                yield answer
        except Exception as e:
            logger.warning(f"Answer (proxy) generation failed: {e}")
            sentry_sdk.capture_exception(e)
        return

    try:
        response = await litellm.acompletion(stream=True, **kwargs)
        async for part in response:
            try:
                delta = part.choices[0].delta.content
            except (AttributeError, IndexError, KeyError):
                delta = None
            if delta:
                yield delta
    except Exception as e:
        logger.warning(f"Answer streaming failed ({e}); falling back to non-streamed")
        sentry_sdk.capture_exception(e)
        # Fallback: one-shot non-streamed completion so Ask still answers.
        try:
            answer, _ = await generate_answer(query, chunks, project_summary)
            if answer:
                yield answer
        except Exception as e2:
            logger.warning(f"Answer fallback also failed: {e2}")
            sentry_sdk.capture_exception(e2)


def _build_context(chunks: list[dict], project_summary: str | None) -> str:
    parts: list[str] = []
    if project_summary:
        parts.append(f"Project summary:\n{project_summary}")
    for i, chunk in enumerate(chunks[:15], 1):
        parts.append(
            f"[Chunk {i}] {chunk.get('file_path')}:{chunk.get('start_line')}-{chunk.get('end_line')} "
            f"({chunk.get('name')})\n"
            f"Summary: {chunk.get('summary_code') or chunk.get('semantic_summary') or ''}\n"
            f"Purpose: {chunk.get('summary_purpose') or ''}\n"
            f"Code:\n{(chunk.get('code_body') or '')[:1800]}"
        )
    return "\n\n".join(parts)
