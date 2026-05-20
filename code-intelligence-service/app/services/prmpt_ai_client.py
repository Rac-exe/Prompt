from __future__ import annotations

import asyncio
import json
import logging
import urllib.error
import urllib.request
from typing import Any

from app.config import PRMPT_AI_PROXY_TOKEN, PRMPT_AI_PROXY_URL

logger = logging.getLogger("code-intel.prmpt-ai")


def is_configured() -> bool:
    return bool(PRMPT_AI_PROXY_URL.strip())


async def embed_texts(
    texts: list[str],
    model: str,
    dimensions: int,
) -> list[list[float]]:
    return await asyncio.to_thread(_embed_texts_sync, texts, model, dimensions)


async def completion_async(**kwargs: Any) -> str:
    return await asyncio.to_thread(completion, **kwargs)


def completion(**kwargs: Any) -> str:
    if not is_configured():
        raise RuntimeError("PRMPT_AI_PROXY_URL is not configured")
    payload = {
        "model": kwargs.get("model"),
        "messages": kwargs.get("messages", []),
        "max_tokens": kwargs.get("max_tokens"),
        "temperature": kwargs.get("temperature"),
    }
    data = _post_json("/v1/chat/completions", payload)
    if isinstance(data.get("content"), str):
        return data["content"]
    choices = data.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        if isinstance(message.get("content"), str):
            return message["content"]
    raise RuntimeError("Prmpt AI proxy returned no completion content")


def _embed_texts_sync(texts: list[str], model: str, dimensions: int) -> list[list[float]]:
    if not is_configured():
        raise RuntimeError("PRMPT_AI_PROXY_URL is not configured")
    payload = {
        "model": model,
        "input": texts,
        "dimensions": dimensions,
    }
    data = _post_json("/v1/embeddings", payload)
    if isinstance(data.get("embeddings"), list):
        return data["embeddings"]
    rows = data.get("data") or []
    embeddings = [row.get("embedding") for row in rows if isinstance(row, dict)]
    if len(embeddings) != len(texts):
        raise RuntimeError(
            f"Prmpt AI proxy returned {len(embeddings)} embeddings for {len(texts)} texts"
        )
    return embeddings


def _post_json(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    base = PRMPT_AI_PROXY_URL.rstrip("/")
    url = f"{base}{path}"
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if PRMPT_AI_PROXY_TOKEN:
        headers["Authorization"] = f"Bearer {PRMPT_AI_PROXY_TOKEN}"
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        logger.warning("Prmpt AI proxy HTTP %s for %s: %s", e.code, path, detail)
        raise
