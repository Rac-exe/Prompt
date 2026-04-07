"""
clarifier.py — LLM-driven prompt analysis for intelligent clarification questions.

Analyzes a user's raw prompt and returns structured JSON with context-aware
questions that will help produce a better optimized prompt.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict

import litellm

from .config import SUMMARIZER_MODEL, OPENROUTER_API_KEY
from .usage_logger import log_usage

logger = logging.getLogger("prmpt.clarifier")

CLARIFIER_SYSTEM_PROMPT = """\
You are a prompt analysis AI. Given the user's raw request, decide if clarifying questions would meaningfully improve the final optimized prompt.

Return ONLY valid JSON (no markdown, no prose) with this schema:
{
  "should_clarify": true/false,
  "is_complex": true/false,
  "complexity_reason": "short reason",
  "suggested_sections": ["Phase 1", "Phase 2"],
  "questions": [
    {"id": "q0", "question": "Your question?", "type": "multiple_choice", "options": ["A", "B", "C"], "optional": false}
  ]
}

RULES:
1. Set should_clarify to true for any prompt that has meaningful ambiguity — tech stack, tone, audience, scope, features, format, etc.
2. Set should_clarify to false ONLY if the prompt is very simple, already fully specified, or is a follow-up refinement like "make it shorter."
3. Generate 2-4 questions. ALWAYS use "multiple_choice" with 3-5 concrete options. Never use "text" type.
4. Infer questions from what the prompt is missing — do not hardcode. Read the prompt and figure out what is underspecified.
5. For multi-part builds (apps, systems, workflows): set is_complex to true, fill suggested_sections, and include a delivery format question asking "One complete prompt" vs "Broken into task sections."
6. Never ask about things the user already specified.
7. When should_clarify is false, return empty questions and suggested_sections arrays."""


_FAIL_SAFE: Dict[str, Any] = {
    "should_clarify": False,
    "is_complex": False,
    "complexity_reason": "",
    "suggested_sections": [],
    "questions": [],
}


def _get_litellm_kwargs(model: str) -> tuple[str, dict]:
    if model.startswith("openrouter/"):
        key = OPENROUTER_API_KEY
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is not set.")
        return model, {"api_key": key}
    return model, {}


def clarify(user_input: str, model: str | None = None) -> Dict[str, Any]:
    """
    Analyze a prompt and return clarification questions as structured JSON.
    Returns the fail-safe (should_clarify=False) on any error.
    """
    resolved_model = model or SUMMARIZER_MODEL
    resolved_model_name, extra = _get_litellm_kwargs(resolved_model)

    t0 = time.perf_counter()
    try:
        response = litellm.completion(
            model=resolved_model_name,
            messages=[
                {"role": "system", "content": CLARIFIER_SYSTEM_PROMPT},
                {"role": "user", "content": user_input},
            ],
            max_tokens=512,
            temperature=0.2,
            response_format={"type": "json_object"},
            **extra,
        )
    except Exception as exc:
        logger.warning(f"LLM call failed: {exc}")
        return dict(_FAIL_SAFE)

    latency_ms = int((time.perf_counter() - t0) * 1000)

    if response.usage:
        log_usage(
            call_type="clarifier",
            model=resolved_model_name,
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            total_tokens=response.usage.total_tokens,
            latency_ms=latency_ms,
        )

    raw = response.choices[0].message.content or ""
    logger.info(f"Clarifier response ({latency_ms}ms): {raw[:300]}")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(f"Failed to parse JSON response: {raw[:200]}")
        return dict(_FAIL_SAFE)

    # Validate and normalize the response
    result: Dict[str, Any] = {
        "should_clarify": bool(parsed.get("should_clarify", False)),
        "is_complex": bool(parsed.get("is_complex", False)),
        "complexity_reason": str(parsed.get("complexity_reason", "")),
        "suggested_sections": list(parsed.get("suggested_sections", [])),
        "questions": [],
    }

    for q in parsed.get("questions", [])[:4]:
        if not isinstance(q, dict) or "question" not in q:
            continue
        opts = list(q.get("options", []))
        result["questions"].append({
            "id": str(q.get("id", f"q{len(result['questions'])}")),
            "question": str(q["question"]),
            "type": "multiple_choice" if opts else "text",
            "options": opts,
            "optional": bool(q.get("optional", True)),
        })

    if result["should_clarify"] and not result["questions"]:
        result["should_clarify"] = False

    # Always inject the delivery format question for complex prompts.
    # The LLM is unreliable about including it, so we add it ourselves.
    if result["should_clarify"] and result["is_complex"]:
        has_delivery_q = any(
            q["id"] == "delivery_format"
            or "task sections" in q["question"].lower()
            or "broken into" in q["question"].lower()
            for q in result["questions"]
        )
        if not has_delivery_q:
            result["questions"].append({
                "id": "delivery_format",
                "question": "How would you like the optimized prompt delivered?",
                "type": "multiple_choice",
                "options": [
                    "One complete prompt",
                    "Broken into task sections (recommended for complex builds)",
                ],
                "optional": False,
            })

    logger.info(f"Clarify result: should_clarify={result['should_clarify']}, questions={len(result['questions'])}, is_complex={result['is_complex']}")
    return result
