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
import litellm
import sentry_sdk
from app.config import OPENAI_API_KEY, OPENROUTER_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS

logger = logging.getLogger("code-intel.embedding")

MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0


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


async def _embed_with_retry(texts: list[str]) -> list[list[float]]:
    """Call litellm.embedding with retries for transient provider failures."""
    model, kwargs = _get_model_and_kwargs()
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            t0 = time.perf_counter()
            response = await asyncio.to_thread(
                litellm.embedding,
                model=model,
                input=texts,
                dimensions=EMBEDDING_DIMENSIONS,
                **kwargs,
            )
            elapsed = time.perf_counter() - t0
            logger.debug(
                f"Embedding batch ok: {len(texts)} texts, "
                f"dim={EMBEDDING_DIMENSIONS}, took {elapsed:.2f}s"
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


async def embed_text(text: str) -> list[float]:
    results = await _embed_with_retry([text])
    return results[0]


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
        all_embeddings.extend(await _embed_with_retry(batch))

    logger.info(f"Batch embedding complete: {len(all_embeddings)} vectors produced")
    return all_embeddings
