"""
Centralized model + API-key configuration for the pipeline.

The desktop app sends the user's OpenRouter API key and chosen models with each
request (see LLMSettings). The models below are defaults for anything the user
didn't choose; OPENROUTER_API_KEY is only a fallback for CLI and local testing.
"""

import os
from dataclasses import dataclass
from typing import Mapping, Optional

# ── LLM models ────────────────────────────────────────────────────────────────
OPTIMIZER_MODEL  = os.environ.get("OPTIMIZER_MODEL",  "openrouter/openai/gpt-4o-mini")
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/openai/gpt-4o-mini")
TITLE_MODEL      = os.environ.get("TITLE_MODEL",      SUMMARIZER_MODEL)
MEMORY_MODEL     = os.environ.get("MEMORY_MODEL",     SUMMARIZER_MODEL)

# ── API keys ──────────────────────────────────────────────────────────────────
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# Headers the desktop app (HTTP) and this service (to code-intel) use to carry
# the user's provider settings.
API_KEY_HEADER = "x-prmpt-openrouter-key"
OPTIMIZER_MODEL_HEADER = "x-prmpt-optimizer-model"
RAG_MODEL_HEADER = "x-prmpt-rag-model"


class MissingAPIKeyError(RuntimeError):
    """Raised when an OpenRouter model is needed but no API key was provided."""

    def __init__(self) -> None:
        super().__init__(
            "No OpenRouter API key configured. Add one in Prmpt Settings > AI provider."
        )


@dataclass(frozen=True)
class LLMSettings:
    """The user's provider settings for one request."""

    api_key: str = ""
    optimizer_model: str = ""  # OpenRouter id, e.g. "anthropic/claude-haiku-4.5"
    rag_model: str = ""        # forwarded to the code-intelligence service

    @classmethod
    def from_mapping(cls, data: Optional[Mapping]) -> "LLMSettings":
        """From the `llm` object in a WebSocket payload."""
        if not isinstance(data, Mapping):
            return cls()
        return cls(
            api_key=str(data.get("api_key") or "").strip(),
            optimizer_model=str(data.get("optimizer_model") or "").strip(),
            rag_model=str(data.get("rag_model") or "").strip(),
        )

    @classmethod
    def from_headers(cls, headers: Mapping[str, str]) -> "LLMSettings":
        return cls(
            api_key=(headers.get(API_KEY_HEADER) or "").strip(),
            optimizer_model=(headers.get(OPTIMIZER_MODEL_HEADER) or "").strip(),
            rag_model=(headers.get(RAG_MODEL_HEADER) or "").strip(),
        )

    def code_intel_headers(self) -> dict:
        headers = {}
        if self.api_key:
            headers["X-Prmpt-OpenRouter-Key"] = self.api_key
        if self.rag_model:
            headers["X-Prmpt-Rag-Model"] = self.rag_model
        return headers


def openrouter_model(model_id: str) -> str:
    """OpenRouter model ids ("anthropic/claude-haiku-4.5") in litellm form."""
    model_id = model_id.strip()
    return model_id if model_id.startswith("openrouter/") else f"openrouter/{model_id}"


def optimizer_model(llm: Optional[LLMSettings]) -> str:
    """The user's chosen optimization model, else the OPTIMIZER_MODEL default."""
    if llm and llm.optimizer_model:
        return openrouter_model(llm.optimizer_model)
    return OPTIMIZER_MODEL


def provider_kwargs(model: str, api_key: str = "") -> dict:
    """Extra litellm kwargs for `model`: the API key for OpenRouter models
    (request key, else env fallback). Raises MissingAPIKeyError without one.
    Other providers read their own keys from the environment via litellm."""
    if model.startswith("openrouter/"):
        key = api_key or os.environ.get("OPENROUTER_API_KEY", "") or OPENROUTER_API_KEY
        if not key:
            raise MissingAPIKeyError()
        return {"api_key": key}
    return {}


def user_facing_error(error: BaseException) -> Optional[str]:
    """A message worth showing the user for provider/configuration errors
    (missing or rejected key, unknown model, rate limit), else None."""
    if isinstance(error, MissingAPIKeyError):
        return str(error)
    import litellm  # local import: config must stay importable without litellm loaded

    if isinstance(error, litellm.AuthenticationError):
        return "OpenRouter rejected the API key. Check it in Prmpt Settings > AI provider."
    if isinstance(error, litellm.NotFoundError) or (
        isinstance(error, litellm.BadRequestError) and "not a valid model" in str(error).lower()
    ):
        return "The selected model was not found on OpenRouter. Pick another model in Settings > AI provider."
    if isinstance(error, litellm.RateLimitError):
        return "OpenRouter rate limit or credit limit reached. Try again shortly or check your OpenRouter credits."
    return None
