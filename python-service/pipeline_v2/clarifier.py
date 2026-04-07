"""
clarifier.py — LLM-driven prompt analysis for intelligent clarification questions.

Analyzes a user's raw prompt and returns structured JSON with context-aware
questions that will help produce a better optimized prompt.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict

import litellm

from .config import SUMMARIZER_MODEL, OPENROUTER_API_KEY
from .usage_logger import log_usage

CLARIFIER_SYSTEM_PROMPT = """\
You are a prompt analysis AI. Analyze the user's raw request and decide whether asking clarifying questions would significantly improve the final optimized prompt.

Return ONLY valid JSON matching this exact schema — no prose, no markdown fences:

{
  "should_clarify": boolean,
  "is_complex": boolean,
  "complexity_reason": string,
  "suggested_sections": [],
  "questions": [
    {
      "id": string,
      "question": string,
      "type": "multiple_choice" | "text",
      "options": [],
      "allow_other": boolean,
      "optional": boolean
    }
  ]
}

RULES:
- Set should_clarify to false if the prompt is simple, already fully specified, a follow-up refinement (e.g. "make it shorter", "add error handling", "change the tone"), or has no meaningful ambiguity to resolve.
- Generate 2-5 questions MAX. Never more.
- Questions must be inferred entirely from what the prompt describes — no hardcoded templates. Read the prompt and figure out what is missing or underspecified.
- If the prompt describes a multi-part build (app, system, workflow, full project), set is_complex to true and populate suggested_sections with logical build phases.
- ALWAYS include a delivery format question if is_complex is true: ask whether the user wants "One complete prompt" or "Broken into task sections".
- Use multiple_choice when there are obvious option sets (tech stack, tone, format, etc.). Use text when the answer is open-ended and unpredictable.
- Set allow_other to true on multiple_choice questions where the user might have a preference outside your options.
- Do not ask about things the user already specified in their prompt.
- When should_clarify is false, return an empty questions array and empty suggested_sections array."""


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
            max_tokens=1024,
            temperature=0.3,
            response_format={"type": "json_object"},
            **extra,
        )
    except Exception as exc:
        print(f"[Clarifier] LLM call failed: {exc}")
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

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        print(f"[Clarifier] Failed to parse JSON response: {raw[:200]}")
        return dict(_FAIL_SAFE)

    # Validate and normalize the response
    result: Dict[str, Any] = {
        "should_clarify": bool(parsed.get("should_clarify", False)),
        "is_complex": bool(parsed.get("is_complex", False)),
        "complexity_reason": str(parsed.get("complexity_reason", "")),
        "suggested_sections": list(parsed.get("suggested_sections", [])),
        "questions": [],
    }

    for q in parsed.get("questions", [])[:5]:
        if not isinstance(q, dict) or "question" not in q:
            continue
        result["questions"].append({
            "id": str(q.get("id", "")),
            "question": str(q["question"]),
            "type": q.get("type", "text") if q.get("type") in ("multiple_choice", "text") else "text",
            "options": list(q.get("options", [])),
            "allow_other": bool(q.get("allow_other", False)),
            "optional": bool(q.get("optional", True)),
        })

    if result["should_clarify"] and not result["questions"]:
        result["should_clarify"] = False

    return result
