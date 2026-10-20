"""
LLM provider settings for the request being served.

The desktop app sends the user's OpenRouter API key and chosen RAG model as
headers on every request (python-service forwards them when it asks us for
project context). Nothing is persisted here: the key only lives for the
request that carried it, plus any background indexing that request started.

OPENROUTER_API_KEY from the environment is the fallback when no header is
sent, which keeps the CLI scripts and local experiments working.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from typing import Mapping

from app.config import OPENROUTER_API_KEY

API_KEY_HEADER = "x-prmpt-openrouter-key"
RAG_MODEL_HEADER = "x-prmpt-rag-model"


class MissingAPIKeyError(RuntimeError):
    """Raised when an OpenRouter model is needed but no API key was provided."""

    def __init__(self) -> None:
        super().__init__(
            "No OpenRouter API key configured. Add one in Prmpt Settings > AI provider."
        )


@dataclass(frozen=True)
class LLMSettings:
    api_key: str = ""
    rag_model: str = ""


_current: contextvars.ContextVar[LLMSettings] = contextvars.ContextVar(
    "llm_settings", default=LLMSettings()
)


def settings_from_headers(headers: Mapping[str, str]) -> LLMSettings:
    return LLMSettings(
        api_key=(headers.get(API_KEY_HEADER) or "").strip(),
        rag_model=(headers.get(RAG_MODEL_HEADER) or "").strip(),
    )


def use_settings(settings: LLMSettings) -> contextvars.Token:
    return _current.set(settings)


def reset_settings(token: contextvars.Token) -> None:
    _current.reset(token)


def current_settings() -> LLMSettings:
    return _current.get()


def openrouter_model(model_id: str) -> str:
    """OpenRouter model ids ("anthropic/claude-haiku-4.5") in litellm form."""
    model_id = model_id.strip()
    return model_id if model_id.startswith("openrouter/") else f"openrouter/{model_id}"


def rag_model(default: str) -> str:
    """The user's chosen RAG model (answers, agentic retrieval), else default."""
    chosen = _current.get().rag_model
    return openrouter_model(chosen) if chosen else default


def user_facing_error(error: Exception) -> str | None:
    """A message worth showing the user for provider/configuration errors
    (missing or rejected key, unknown model, rate limit), else None."""
    if isinstance(error, MissingAPIKeyError):
        return str(error)
    import litellm  # local import keeps this module light for config-only users

    if isinstance(error, litellm.AuthenticationError):
        return "OpenRouter rejected the API key. Check it in Prmpt Settings > AI provider."
    if isinstance(error, litellm.NotFoundError) or (
        isinstance(error, litellm.BadRequestError) and "not a valid model" in str(error).lower()
    ):
        return "The selected model was not found on OpenRouter. Pick another model in Settings > AI provider."
    if isinstance(error, litellm.RateLimitError):
        return "OpenRouter rate limit or credit limit reached. Try again shortly or check your OpenRouter credits."
    return None


def completion_kwargs(model: str) -> dict:
    """{"model", "api_key"} for a litellm completion call.

    OpenRouter models get the request's key (or the env fallback) and raise
    MissingAPIKeyError when there is none. Models from other providers are
    passed through unchanged; litellm reads their keys from the environment.
    """
    kwargs: dict = {"model": model}
    if "openrouter" in model.lower():
        key = _current.get().api_key or OPENROUTER_API_KEY
        if not key:
            raise MissingAPIKeyError()
        kwargs["api_key"] = key
    return kwargs


def with_key(kwargs: dict) -> dict:
    """Completion kwargs plus the API key for kwargs["model"]. Call it where
    the request is made so a missing key lands in the caller's error handling."""
    return {**kwargs, **completion_kwargs(kwargs["model"])}
