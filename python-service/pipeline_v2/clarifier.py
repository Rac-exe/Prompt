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

from .config import SUMMARIZER_MODEL, MissingAPIKeyError, provider_kwargs
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
1. Set should_clarify to true for any prompt that has meaningful ambiguity. Almost every prompt benefits from clarification — default to true.
2. Set should_clarify to false ONLY if the prompt is very simple, already fully specified, or is a follow-up refinement like "make it shorter."
3. Generate 2-4 questions. ALWAYS use "multiple_choice" with 3-5 concrete options. Never use "text" type.
4. Infer questions from what the prompt is missing — do not hardcode. Read the prompt and figure out what is underspecified.
5. For multi-part builds (apps, systems, workflows): set is_complex to true, fill suggested_sections, and include a delivery format question asking "One complete prompt" vs "Broken into task sections."
6. Never ask about things the user already specified.
7. When should_clarify is false, return empty questions and suggested_sections arrays.

CRITICAL — DETECT MISSING CONTEXT BY CATEGORY:
For CODE / TECHNICAL / BUG FIX prompts (mentions code, buttons, CSS, API, database, components, etc.):
  - If no tech stack / framework specified → ASK (e.g. "React + Tailwind", "Vue + CSS", "Vanilla HTML/CSS/JS", "Next.js", "Flutter")
  - If no project type specified → ASK (e.g. "Web app", "Mobile app", "Desktop app", "CLI tool")
  - If referring to existing code ("fix this", "change that") but no context about codebase → ASK what framework, styling approach, or component library they use

For WRITING / CONTENT prompts (blog, email, article, social media, etc.):
  - If no tone specified → ASK
  - If no audience specified → ASK
  - If no length/format specified → ASK

For BUSINESS / STRATEGY prompts:
  - If no industry/domain specified → ASK
  - If no audience or stakeholders specified → ASK

The optimizer WILL fabricate details if you don't ask. Missing tech stack is the #1 cause of bad outputs — a prompt about "fixing button hover styles" will get "HTML/CSS/JS typing practice app" hallucinated if you don't ask what framework they use. Your job is to prevent that."""


_FAIL_SAFE: Dict[str, Any] = {
    "should_clarify": False,
    "is_complex": False,
    "complexity_reason": "",
    "suggested_sections": [],
    "questions": [],
}


def _get_litellm_kwargs(model: str, api_key: str = "") -> tuple[str, dict]:
    return model, provider_kwargs(model, api_key)


def clarify(user_input: str, model: str | None = None, api_key: str = "") -> Dict[str, Any]:
    """
    Analyze a prompt and return clarification questions as structured JSON.
    Returns the fail-safe (should_clarify=False) on any error.
    """
    resolved_model = model or SUMMARIZER_MODEL
    try:
        resolved_model_name, extra = _get_litellm_kwargs(resolved_model, api_key)
    except MissingAPIKeyError as exc:
        logger.warning(f"Clarifier skipped: {exc}")
        return dict(_FAIL_SAFE)


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
    except json.JSONDecodeError as exc:
        logger.warning(f"Failed to parse JSON response: {raw[:200]}")
        return dict(_FAIL_SAFE)

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
        opts = [
            o for o in list(q.get("options", []))
            if str(o).strip().lower() != "other"
        ]
        result["questions"].append({
            "id": str(q.get("id", f"q{len(result['questions'])}")),
            "question": str(q["question"]),
            "type": "multiple_choice" if opts else "text",
            "options": opts,
            "optional": bool(q.get("optional", True)),
        })

    if result["should_clarify"] and not result["questions"]:
        result["should_clarify"] = False

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
