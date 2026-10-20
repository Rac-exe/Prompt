from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

import litellm

from app import llm
from app.config import ANSWER_MODEL

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
    """Non-streamed answer. Provider/configuration errors (no key, rejected
    key, unknown model) are raised so the caller can show them to the user;
    other failures return (None, [])."""
    if not chunks:
        return None, []

    kwargs = _answer_kwargs(query, chunks, project_summary)
    try:
        response = await asyncio.to_thread(litellm.completion, **kwargs)
        answer = (response.choices[0].message.content or "").strip()
        return answer or None, [str(c["id"]) for c in chunks[:8] if c.get("id")]
    except Exception as e:
        if llm.user_facing_error(e):
            raise
        logger.warning(f"Answer generation failed: {e}")
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
    whole completion. Falls back to a single non-streamed completion if
    streaming fails. Provider/configuration errors are raised."""
    if not chunks:
        return

    kwargs = _answer_kwargs(query, chunks, project_summary)
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
        if llm.user_facing_error(e):
            raise
        logger.warning(f"Answer streaming failed ({e}); falling back to non-streamed")
        answer, _ = await generate_answer(query, chunks, project_summary)
        if answer:
            yield answer


def _answer_kwargs(query: str, chunks: list[dict], project_summary: str | None) -> dict:
    context = _build_context(chunks, project_summary)
    return {
        **llm.completion_kwargs(llm.rag_model(ANSWER_MODEL)),
        "messages": [
            {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query[:2000]}"},
        ],
        "max_tokens": 900,
        "temperature": 0.2,
    }


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
