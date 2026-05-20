from __future__ import annotations

import asyncio
import json
import logging

import litellm
import sentry_sdk

from app.config import OPENROUTER_API_KEY, RERANKER_MODEL
from app.db.models import ModeEnum
from app.services import prmpt_ai_client

logger = logging.getLogger("code-intel.reranker")


PROMPTS = {
    ModeEnum.BUG: "You are a bug-hunting code relevance judge. Score each chunk on how likely it contains or directly affects the reported bug.",
    ModeEnum.OPTIMIZE: "You are a feature-planning code relevance judge. Score each chunk on how likely it must be understood or changed for the requested improvement.",
    ModeEnum.ASK: "You are a code relevance judge. Score each chunk on how well it answers or informs the user's question.",
}


async def rerank_chunks(query: str, chunks: list[dict], mode: ModeEnum, limit: int) -> list[dict]:
    if not chunks:
        return []
    if mode == ModeEnum.FIND:
        return chunks[:limit]

    scored = await _score_with_llm(query, chunks[:60], mode)
    if scored is None:
        return chunks[:limit]

    by_id = {str(item.get("id")): item for item in chunks}
    reranked = []
    for item in scored:
        chunk = by_id.get(str(item.get("id")))
        if not chunk:
            continue
        score = _coerce_score(item.get("score"))
        chunk["rerank_score"] = score
        chunk["final_score"] = score
        reason = str(item.get("reasoning") or item.get("reason") or "").strip()
        if reason:
            chunk["relevance_reasoning"] = reason[:300]
        reranked.append(chunk)

    seen = {c["id"] for c in reranked}
    reranked.extend(c for c in chunks if c.get("id") not in seen)
    reranked.sort(key=lambda c: c.get("final_score", c.get("rrf_score", c.get("similarity", 0))), reverse=True)
    return reranked[:limit]


async def _score_with_llm(query: str, chunks: list[dict], mode: ModeEnum) -> list[dict] | None:
    system = (
        PROMPTS.get(mode, PROMPTS[ModeEnum.ASK])
        + "\nIf provided, structure_similarity is a 0-1 signal for signature/name/file-structure fit."
        + "\nReturn strict JSON array: [{\"id\":\"chunk id\", \"score\": 1-10, \"reasoning\":\"short reason\"}]."
    )
    payload = []
    for c in chunks:
        payload.append({
            "id": c.get("id"),
            "file_path": c.get("file_path"),
            "lines": f"{c.get('start_line')}-{c.get('end_line')}",
            "name": c.get("name"),
            "signature": c.get("signature"),
            "summary": c.get("summary_code") or c.get("semantic_summary"),
            "purpose": c.get("summary_purpose"),
            "concepts": c.get("concepts") or [],
            "structure_similarity": c.get("structure_similarity"),
            "code": (c.get("code_body") or "")[:1200],
        })
    kwargs: dict = {
        "model": RERANKER_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Query:\n{query[:2000]}\n\nChunks:\n{json.dumps(payload)}"},
        ],
        "max_tokens": 1600,
        "temperature": 0.0,
    }
    if OPENROUTER_API_KEY and "openrouter" in RERANKER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY
    try:
        if prmpt_ai_client.is_configured():
            raw = (await prmpt_ai_client.completion_async(**kwargs)).strip()
        else:
            response = await asyncio.to_thread(litellm.completion, **kwargs)
            raw = (response.choices[0].message.content or "").strip()
        cleaned = _strip_fence(raw)
        data = json.loads(cleaned)
        return data if isinstance(data, list) else None
    except Exception as e:
        logger.warning(f"Reranker failed, using heuristic ranking: {e}")
        sentry_sdk.capture_exception(e)
        return None


def _strip_fence(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    return cleaned.strip()


def _coerce_score(value) -> float:
    try:
        return max(0.0, min(float(value), 10.0)) / 10.0
    except (TypeError, ValueError):
        return 0.0
