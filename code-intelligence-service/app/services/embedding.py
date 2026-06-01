"""
Embedding service using LiteLLM — routes through OpenRouter so no
separate OpenAI API key is needed. Falls back to direct OpenAI if
OPENAI_API_KEY is set.

OpenRouter's embedding endpoint can be flaky, so we retry with
exponential backoff.
"""

import asyncio
import time
import logging
import os
from collections import OrderedDict
from threading import Lock
import litellm
import numpy as np
import sentry_sdk
from app.config import (
    EMBEDDING_BACKEND,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_LOCAL_MODEL,
    EMBEDDING_MODEL,
    OPENAI_API_KEY,
    OPENROUTER_API_KEY,
    STRUCTURE_EMBEDDING_DIMENSIONS,
)
from app.services import prmpt_ai_client

logger = logging.getLogger("code-intel.embedding")

MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0
QUERY_EMBED_CACHE_MAX = 512
_query_embed_cache: OrderedDict[tuple[str, str], list[float]] = OrderedDict()
_query_embed_lock = Lock()
_local_embed_lock = Lock()
_local_embed_loaded = False
_local_embed_failed = False
_local_embed_session = None
_local_embed_tokenizer = None


def _get_model_and_kwargs() -> tuple[str, dict]:
    """Pick the right model string and auth kwargs for litellm.embedding()."""
    if OPENAI_API_KEY:
        logger.debug(f"Using direct OpenAI for embeddings (model={EMBEDDING_MODEL})")
        return EMBEDDING_MODEL, {"api_key": OPENAI_API_KEY}

    if OPENROUTER_API_KEY:
        model = f"openrouter/openai/{EMBEDDING_MODEL}"
        logger.debug(f"Using OpenRouter for embeddings (model={model})")
        return model, {"api_key": OPENROUTER_API_KEY}

    raise RuntimeError(
        "Neither OPENAI_API_KEY nor OPENROUTER_API_KEY is set. "
        "At least one is required for embeddings."
    )


async def _embed_with_retry(texts: list[str], dimensions: int = EMBEDDING_DIMENSIONS) -> list[list[float]]:
    """Call litellm.embedding with retries for transient provider failures."""
    if EMBEDDING_BACKEND == "local":
        return await asyncio.to_thread(_embed_with_local, texts, dimensions)

    if prmpt_ai_client.is_configured():
        last_error: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                return await prmpt_ai_client.embed_texts(texts, EMBEDDING_MODEL, dimensions)
            except Exception as e:
                last_error = e
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Prmpt AI proxy embedding attempt %d/%d failed (%s), retrying in %.1fs",
                    attempt + 1, MAX_RETRIES, str(e)[:120], delay,
                )
                sentry_sdk.capture_exception(e)
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(delay)
        raise RuntimeError(
            f"Proxy embedding failed after {MAX_RETRIES} attempts: {last_error}"
        ) from last_error

    model, kwargs = _get_model_and_kwargs()
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            t0 = time.perf_counter()
            response = await asyncio.to_thread(
                litellm.embedding,
                model=model,
                input=texts,
                dimensions=dimensions,
                **kwargs,
            )
            elapsed = time.perf_counter() - t0
            logger.debug(
                f"Embedding batch ok: {len(texts)} texts, "
                f"dim={dimensions}, took {elapsed:.2f}s"
            )
            return [d["embedding"] for d in response.data]
        except Exception as e:
            last_error = e
            delay = RETRY_BASE_DELAY * (2 ** attempt)
            logger.warning(
                "Embedding attempt %d/%d failed (%s), retrying in %.1fs",
                attempt + 1, MAX_RETRIES, str(e)[:120], delay,
            )
            sentry_sdk.capture_exception(e)
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(delay)

    raise RuntimeError(
        f"Embedding failed after {MAX_RETRIES} attempts: {last_error}"
    ) from last_error


def _embed_with_local(texts: list[str], dimensions: int) -> list[list[float]]:
    session, tokenizer = _get_local_embedder()
    if session is None or tokenizer is None:
        raise RuntimeError("Local embedding backend is unavailable")
    max_len = 512
    encodings = [tokenizer.encode(t[:4000]) for t in texts]
    input_ids = []
    attention_masks = []
    for enc in encodings:
        ids = enc.ids[:max_len]
        attn = [1] * len(ids)
        if len(ids) < max_len:
            pad = [0] * (max_len - len(ids))
            ids = ids + pad
            attn = attn + pad
        input_ids.append(ids)
        attention_masks.append(attn)
    inputs = {
        "input_ids": np.asarray(input_ids, dtype=np.int64),
        "attention_mask": np.asarray(attention_masks, dtype=np.int64),
    }
    ort_inputs = {}
    for inp in session.get_inputs():
        lname = inp.name.lower()
        if "input_ids" in lname:
            ort_inputs[inp.name] = inputs["input_ids"]
        elif "attention_mask" in lname:
            ort_inputs[inp.name] = inputs["attention_mask"]
        elif "token_type" in lname:
            ort_inputs[inp.name] = np.zeros_like(inputs["input_ids"], dtype=np.int64)
    outputs = session.run(None, ort_inputs)
    arr = np.asarray(outputs[0])
    if arr.ndim == 3:
        mask = inputs["attention_mask"][:, :, None].astype(np.float32)
        summed = (arr * mask).sum(axis=1)
        denom = np.maximum(mask.sum(axis=1), 1e-9)
        vectors = summed / denom
    elif arr.ndim == 2:
        vectors = arr
    else:
        raise RuntimeError(f"Unsupported local embedding output shape: {arr.shape}")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / np.maximum(norms, 1e-9)
    result: list[list[float]] = []
    for vector in vectors:
        vec = vector.astype(np.float32)
        if vec.shape[0] > dimensions:
            vec = vec[:dimensions]
        elif vec.shape[0] < dimensions:
            vec = np.pad(vec, (0, dimensions - vec.shape[0]))
        result.append(vec.tolist())
    return result


def _get_local_embedder():
    global _local_embed_loaded, _local_embed_failed, _local_embed_session, _local_embed_tokenizer
    if _local_embed_loaded:
        return _local_embed_session, _local_embed_tokenizer
    if _local_embed_failed:
        return None, None
    with _local_embed_lock:
        if _local_embed_loaded:
            return _local_embed_session, _local_embed_tokenizer
        if _local_embed_failed:
            return None, None
        try:
            from huggingface_hub import hf_hub_download
            from tokenizers import Tokenizer
            import onnxruntime as ort

            tokenizer_path = hf_hub_download(repo_id=EMBEDDING_LOCAL_MODEL, filename="tokenizer.json")
            model_path = _download_local_model(hf_hub_download)
            _local_embed_tokenizer = Tokenizer.from_file(tokenizer_path)
            sess_options = ort.SessionOptions()
            sess_options.intra_op_num_threads = max(1, min(2, os.cpu_count() or 2))
            _local_embed_session = ort.InferenceSession(model_path, sess_options=sess_options)
            _local_embed_loaded = True
            logger.info("Local embedder initialized: model=%s", EMBEDDING_LOCAL_MODEL)
            return _local_embed_session, _local_embed_tokenizer
        except Exception as e:
            _local_embed_failed = True
            logger.warning("Failed to initialize local embedding model=%s: %s", EMBEDDING_LOCAL_MODEL, e)
            sentry_sdk.capture_exception(e)
            return None, None


def _download_local_model(hf_hub_download) -> str:
    candidates = (
        "onnx/model.onnx",
        "onnx/model_quantized.onnx",
        "model.onnx",
    )
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            return hf_hub_download(repo_id=EMBEDDING_LOCAL_MODEL, filename=candidate)
        except Exception as e:
            last_error = e
    if last_error:
        raise last_error
    raise RuntimeError("No local embedding ONNX model file resolved")


async def embed_text(text: str) -> list[float]:
    model_name = EMBEDDING_LOCAL_MODEL if EMBEDDING_BACKEND == "local" else EMBEDDING_MODEL
    cache_key = (model_name, text)
    with _query_embed_lock:
        cached = _query_embed_cache.get(cache_key)
        if cached is not None:
            _query_embed_cache.move_to_end(cache_key)
            return list(cached)
    results = await _embed_with_retry([text])
    vector = results[0]
    with _query_embed_lock:
        _query_embed_cache[cache_key] = vector
        _query_embed_cache.move_to_end(cache_key)
        while len(_query_embed_cache) > QUERY_EMBED_CACHE_MAX:
            _query_embed_cache.popitem(last=False)
    return vector


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch embed multiple texts (max 2048 per call)."""
    if not texts:
        return []

    batch_size = 2048
    all_embeddings: list[list[float]] = []
    total_batches = (len(texts) + batch_size - 1) // batch_size

    logger.info(
        f"Batch embedding: {len(texts)} texts in {total_batches} batch(es)"
    )

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        batch_num = (i // batch_size) + 1
        logger.debug(f"Embedding batch {batch_num}/{total_batches}: {len(batch)} texts")
        all_embeddings.extend(await _embed_with_retry(batch, EMBEDDING_DIMENSIONS))

    logger.info(f"Batch embedding complete: {len(all_embeddings)} vectors produced")
    return all_embeddings


async def embed_structure_texts(texts: list[str]) -> list[list[float]]:
    """Embed structural texts with the configured structure dimensions."""
    if not texts:
        return []
    batch_size = 2048
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        all_embeddings.extend(await _embed_with_retry(batch, STRUCTURE_EMBEDDING_DIMENSIONS))
    return all_embeddings
