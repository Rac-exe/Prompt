from __future__ import annotations

import asyncio
import json
import logging
import os
from threading import Lock

import litellm
import numpy as np
import sentry_sdk

from app.config import (
    OPENROUTER_API_KEY,
    RERANKER_BACKEND,
    RERANKER_LOCAL_MAX_LENGTH,
    RERANKER_LOCAL_MODEL,
    RERANKER_MODEL,
)
from app.db.models import ModeEnum
from app.services import prmpt_ai_client

logger = logging.getLogger("code-intel.reranker")
_local_model_lock = Lock()
_local_model_loaded = False
_local_model_failed = False
_local_ort_session = None
_local_tokenizer = None
_TEST_CHUNK_PENALTY = 0.60


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

    scored = None
    if RERANKER_BACKEND == "local":
        scored = await _score_with_local(query, chunks[:60])
        if scored is None:
            logger.warning("Local reranker unavailable, falling back to LLM reranker")
    if scored is None:
        scored = await _score_with_llm(query, chunks[:60], mode)
    if scored is None:
        return chunks[:limit]

    by_id = {str(item.get("id")): item for item in chunks}
    reranked = []
    query_mentions_tests = _query_mentions_tests(query)
    for item in scored:
        chunk = by_id.get(str(item.get("id")))
        if not chunk:
            continue
        score = _coerce_score(item.get("score"))
        if not query_mentions_tests and _is_test_chunk(chunk):
            score *= _TEST_CHUNK_PENALTY
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


async def _score_with_local(query: str, chunks: list[dict]) -> list[dict] | None:
    session, tokenizer = _get_local_reranker()
    if session is None or tokenizer is None:
        return None
    # Run CPU-intensive ONNX inference in a thread so the event loop stays free
    # to serve other requests concurrently.
    def _infer_all() -> list[dict]:
        scored: list[dict] = []
        for chunk in chunks:
            text = _local_chunk_text(chunk)
            score = _run_local_inference(session, tokenizer, query, text)
            scored.append(
                {
                    "id": str(chunk.get("id")),
                    "score": float(score),
                    "reasoning": "local-cross-encoder",
                }
            )
        return scored

    try:
        return await asyncio.to_thread(_infer_all)
    except Exception as e:
        logger.warning("Local reranker inference failed: %s", e)
        sentry_sdk.capture_exception(e)
        return None


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
        logger.warning("LLM reranker failed, using heuristic ranking: %s", e)
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
        numeric = float(value)
        if numeric > 1.0:
            return max(0.0, min(numeric, 10.0)) / 10.0
        return max(0.0, min(numeric, 1.0))
    except (TypeError, ValueError):
        return 0.0


def query_mentions_tests(query: str) -> bool:
    """Public alias: True when the query explicitly asks about tests."""
    return _query_mentions_tests(query)


def is_test_chunk(chunk: dict) -> bool:
    """Public alias: True when the chunk is a test file/symbol."""
    return _is_test_chunk(chunk)


def _query_mentions_tests(query: str) -> bool:
    lowered = (query or "").lower()
    return any(
        term in lowered
        for term in (
            " test",
            "tests",
            "pytest",
            "spec",
            "unit test",
            "integration test",
            "e2e",
        )
    )


def _is_test_chunk(chunk: dict) -> bool:
    file_path = str(chunk.get("file_path") or "").replace("\\", "/").lower()
    name = str(chunk.get("name") or "").strip().lower()
    if "/tests/" in file_path or file_path.startswith("tests/"):
        return True
    if "/test_" in file_path or file_path.endswith("_test.py"):
        return True
    if name.startswith("test") or name.startswith("test_"):
        return True
    return False


def _local_chunk_text(chunk: dict) -> str:
    parts = [
        str(chunk.get("file_path") or ""),
        str(chunk.get("name") or ""),
        str(chunk.get("signature") or ""),
        str(chunk.get("summary_code") or chunk.get("semantic_summary") or ""),
        str(chunk.get("summary_purpose") or ""),
    ]
    concepts = chunk.get("concepts") or []
    if concepts:
        parts.append("Concepts: " + ", ".join(str(c) for c in concepts[:8]))
    return "\n".join(p for p in parts if p).strip()[:2500]


def _get_local_reranker():
    global _local_model_loaded, _local_model_failed, _local_ort_session, _local_tokenizer
    if _local_model_loaded:
        return _local_ort_session, _local_tokenizer
    if _local_model_failed:
        return None, None
    with _local_model_lock:
        if _local_model_loaded:
            return _local_ort_session, _local_tokenizer
        if _local_model_failed:
            return None, None
        try:
            from huggingface_hub import hf_hub_download
            from tokenizers import Tokenizer
            import onnxruntime as ort

            tokenizer_path = hf_hub_download(repo_id=RERANKER_LOCAL_MODEL, filename="tokenizer.json")
            model_path = _download_local_model_path(hf_hub_download)

            _local_tokenizer = Tokenizer.from_file(tokenizer_path)
            sess_options = ort.SessionOptions()
            sess_options.intra_op_num_threads = max(1, min(2, os.cpu_count() or 2))
            _local_ort_session = ort.InferenceSession(model_path, sess_options=sess_options)
            _local_model_loaded = True
            logger.info("Local reranker initialized: model=%s", RERANKER_LOCAL_MODEL)
            return _local_ort_session, _local_tokenizer
        except Exception as e:
            _local_model_failed = True
            logger.warning("Failed to initialize local reranker model=%s: %s", RERANKER_LOCAL_MODEL, e)
            sentry_sdk.capture_exception(e)
            return None, None


def initialize_local_reranker() -> bool:
    """Eagerly load and verify the local reranker model.

    Called at application startup so the first real request doesn't pay the
    cold-start cost of downloading / initializing the ONNX session.

    Returns True when the model loaded and a test inference succeeded,
    False on any failure (the runtime will fall back to the LLM reranker).
    """
    if RERANKER_BACKEND != "local":
        logger.info("Local reranker init skipped (RERANKER_BACKEND=%s)", RERANKER_BACKEND)
        return True

    logger.info("Initializing local reranker model=%s ...", RERANKER_LOCAL_MODEL)
    session, tokenizer = _get_local_reranker()
    if session is None or tokenizer is None:
        logger.error(
            "Local reranker failed to load; model=%s will fall back to LLM reranker",
            RERANKER_LOCAL_MODEL,
        )
        return False

    try:
        test_score = _run_local_inference(
            session,
            tokenizer,
            "find the login function",
            "def login(username, password):\n    ...",
        )
        if not (0.0 <= test_score <= 1.0):
            raise ValueError(f"score out of range: {test_score}")
        logger.info(
            "Local reranker ready: model=%s verification_score=%.4f",
            RERANKER_LOCAL_MODEL,
            test_score,
        )
        return True
    except Exception as e:
        logger.error(
            "Local reranker verification failed model=%s: %s",
            RERANKER_LOCAL_MODEL,
            e,
        )
        sentry_sdk.capture_exception(e)
        return False


def _download_local_model_path(hf_hub_download) -> str:
    candidates = (
        "onnx/model.onnx",
        "onnx/model_quantized.onnx",
        "model.onnx",
    )
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            return hf_hub_download(repo_id=RERANKER_LOCAL_MODEL, filename=candidate)
        except Exception as e:
            last_error = e
    if last_error:
        raise last_error
    raise RuntimeError("No ONNX model file candidates resolved")


def _run_local_inference(session, tokenizer, query: str, text: str) -> float:
    encoded = tokenizer.encode(query, text)
    max_len = max(32, RERANKER_LOCAL_MAX_LENGTH)
    ids = encoded.ids[:max_len]
    attention = [1] * len(ids)
    if len(ids) < max_len:
        pad = [0] * (max_len - len(ids))
        ids = ids + pad
        attention = attention + pad
    input_ids = np.asarray([ids], dtype=np.int64)
    attention_mask = np.asarray([attention], dtype=np.int64)

    inputs = {}
    for inp in session.get_inputs():
        lname = inp.name.lower()
        if "input_ids" in lname:
            inputs[inp.name] = input_ids
        elif "attention_mask" in lname:
            inputs[inp.name] = attention_mask
        elif "token_type" in lname:
            inputs[inp.name] = np.zeros_like(input_ids, dtype=np.int64)
    outputs = session.run(None, inputs)
    logit = float(np.asarray(outputs[0]).reshape(-1)[0])
    prob = 1.0 / (1.0 + np.exp(-logit))
    return max(0.0, min(prob, 1.0))
