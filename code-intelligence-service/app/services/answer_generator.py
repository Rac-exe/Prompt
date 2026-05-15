from __future__ import annotations

import asyncio
import logging

import litellm
import sentry_sdk

from app.config import ANSWER_MODEL, OPENROUTER_API_KEY

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
        response = await asyncio.to_thread(litellm.completion, **kwargs)
        answer = (response.choices[0].message.content or "").strip()
        return answer or None, [str(c["id"]) for c in chunks[:8] if c.get("id")]
    except Exception as e:
        logger.warning(f"Answer generation failed: {e}")
        sentry_sdk.capture_exception(e)
        return None, []


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
