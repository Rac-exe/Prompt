"""
LLM-based chunk summarization.
Takes a function/class skeleton (name, signature, callees, docstring)
and produces a ~60-token semantic summary suitable for embedding.
"""

import logging
import litellm
from app.config import SUMMARIZER_MODEL, OPENROUTER_API_KEY, SUMMARY_MAX_TOKENS

logger = logging.getLogger("code-intel.summarizer")

SUMMARIZE_SYSTEM_PROMPT = """You are a code summarization engine. Given a code element's metadata (name, signature, callees, docstring), produce a concise semantic summary in 1-2 sentences.

Focus on WHAT the code does and WHY, not how. Include the domain concepts involved.

Rules:
- Maximum 60 tokens
- Use active voice
- Do not repeat the function name
- Include key dependencies and side effects
- Return ONLY the summary text, nothing else"""


def summarize_chunk(
    name: str,
    signature: str | None,
    callees: list[str],
    docstring: str | None,
    language: str,
) -> str:
    parts = [f"Name: {name}"]
    if signature:
        parts.append(f"Signature: {signature}")
    if callees:
        parts.append(f"Calls: {', '.join(callees[:10])}")
    if docstring:
        parts.append(f"Docstring: {docstring[:500]}")
    parts.append(f"Language: {language}")

    user_content = "\n".join(parts)

    kwargs: dict = {
        "model": SUMMARIZER_MODEL,
        "messages": [
            {"role": "system", "content": SUMMARIZE_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": SUMMARY_MAX_TOKENS,
        "temperature": 0.1,
    }
    if OPENROUTER_API_KEY and "openrouter" in SUMMARIZER_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY

    try:
        response = litellm.completion(**kwargs)
        summary = (response.choices[0].message.content or "").strip()
        logger.debug(f"Summarized {name}: {summary[:80]}...")
        return summary
    except Exception as e:
        logger.error(f"Summarization failed for {name}: {e}")
        fallback = f"{name}"
        if signature:
            fallback += f" {signature}"
        if docstring:
            fallback += f" — {docstring[:100]}"
        return fallback[:200]
