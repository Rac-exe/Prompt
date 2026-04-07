"""
Embedding service using LiteLLM — routes through OpenRouter so no
separate OpenAI API key is needed. Falls back to direct OpenAI if
OPENAI_API_KEY is set.
"""

import logging
import litellm
from app.config import OPENAI_API_KEY, OPENROUTER_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS

logger = logging.getLogger("code-intel.embedding")


def _get_model_and_kwargs() -> tuple[str, dict]:
    """Pick the right model string and auth kwargs for litellm.embedding()."""
    if OPENAI_API_KEY:
        return EMBEDDING_MODEL, {"api_key": OPENAI_API_KEY}

    if OPENROUTER_API_KEY:
        model = f"openrouter/openai/{EMBEDDING_MODEL}"
        return model, {"api_key": OPENROUTER_API_KEY}

    raise RuntimeError(
        "Neither OPENAI_API_KEY nor OPENROUTER_API_KEY is set. "
        "At least one is required for embeddings."
    )


def embed_text(text: str) -> list[float]:
    model, kwargs = _get_model_and_kwargs()
    response = litellm.embedding(
        model=model,
        input=[text],
        dimensions=EMBEDDING_DIMENSIONS,
        **kwargs,
    )
    return response.data[0]["embedding"]


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch embed multiple texts (max 2048 per call)."""
    if not texts:
        return []

    model, kwargs = _get_model_and_kwargs()
    batch_size = 2048
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = litellm.embedding(
            model=model,
            input=batch,
            dimensions=EMBEDDING_DIMENSIONS,
            **kwargs,
        )
        all_embeddings.extend([d["embedding"] for d in response.data])

    return all_embeddings
