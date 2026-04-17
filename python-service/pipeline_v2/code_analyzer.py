"""
code_analyzer.py — Dedicated LLM step that reads retrieved code chunks
and the user's query, then produces structured JSON findings for the
prompt optimizer.

Runs GPT-4o-mini via OpenRouter. Adds ~1-2s latency and ~$0.0005 per call.
"""

from __future__ import annotations

import json
import logging
import time
import sentry_sdk
from typing import Optional

import litellm

from .config import OPENROUTER_API_KEY

logger = logging.getLogger("prmpt.code_analyzer")

CODE_ANALYZER_MODEL = "openrouter/openai/gpt-4o-mini"

_ANALYZER_SYSTEM_PROMPT = """\
You are a code analysis engine. You receive a user's bug report / feature request \
and a set of code chunks retrieved from their project. Your job is to produce a \
precise, structured analysis that a prompt-writing LLM will consume downstream.

RULES:
1. Read every code chunk carefully. Compare the code against the user's claim.
2. For each file, classify its status:
   - "has_bug" — the code has a concrete defect related to the user's issue
   - "partial_bug" — some parts are correct, but specific lines are broken
   - "already_correct" — the code already handles what the user described
   - "needs_investigation" — not enough code retrieved to confirm
3. When marking bugs, cite the specific function/line and what's wrong.
4. List things the code already does correctly — the optimizer must NOT \
   suggest fixing things that aren't broken.
5. Identify what's MISSING from the retrieved code (e.g., backend endpoints \
   that the frontend calls but weren't retrieved).
6. Determine the affected scope: frontend-only, backend-only, or both.

OUTPUT: Return ONLY valid JSON matching this schema (no markdown fences, no explanation):
{
  "root_cause": "<1-2 sentence root cause summary>",
  "findings": [
    {
      "file": "<file_path>",
      "status": "has_bug | partial_bug | already_correct | needs_investigation",
      "already_correct": ["<thing that works>", ...],
      "actual_bugs": ["<specific bug with line/function reference>", ...],
      "fix_priority": "high | medium | low"
    }
  ],
  "missing_context": ["<what code is missing that should be examined>", ...],
  "affected_scope": "frontend | backend | frontend + backend | unknown"
}
"""


def analyze_code(
    user_query: str,
    project_context_text: str,
    intent: str = "general",
    concepts: list[str] | None = None,
) -> Optional[dict]:
    """
    Call GPT-4o-mini to analyze retrieved code chunks against the user's query.
    Returns parsed JSON findings dict, or None on failure.
    """
    if not project_context_text or not project_context_text.strip():
        return None

    if not OPENROUTER_API_KEY:
        logger.warning("OPENROUTER_API_KEY not set — skipping code analysis")
        return None

    concepts_str = ", ".join(concepts) if concepts else "none detected"

    user_prompt = (
        f"QUERY INTENT: {intent}\n"
        f"DETECTED CONCEPTS: {concepts_str}\n\n"
        f"USER QUERY:\n{user_query}\n\n"
        f"RETRIEVED CODE:\n{project_context_text}\n\n"
        f"Analyze the code against the user's query and return your findings as JSON."
    )

    try:
        t0 = time.perf_counter()
        response = litellm.completion(
            model=CODE_ANALYZER_MODEL,
            messages=[
                {"role": "system", "content": _ANALYZER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=1500,
            temperature=0.1,
            api_key=OPENROUTER_API_KEY,
        )
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        raw = response.choices[0].message.content.strip()

        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        findings = json.loads(raw)

        usage = response.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0
        logger.info(
            f"Code analysis complete in {elapsed_ms}ms "
            f"({tokens_in} in / {tokens_out} out): "
            f"root_cause={findings.get('root_cause', 'N/A')[:80]}"
        )
        return findings

    except json.JSONDecodeError as e:
        sentry_sdk.capture_exception(e)
        logger.warning(f"Code analyzer returned invalid JSON: {e}")
        return None
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"Code analysis failed: {e}", exc_info=True)
        return None


def format_analysis_block(findings: dict) -> str:
    """Format the analysis findings as a text block for injection into the optimizer prompt."""
    lines = ["[CODE ANALYSIS — verified by automated code review]", ""]
    lines.append(f"ROOT CAUSE: {findings.get('root_cause', 'Unknown')}")
    lines.append(f"AFFECTED SCOPE: {findings.get('affected_scope', 'unknown')}")
    lines.append("")

    for f in findings.get("findings", []):
        status_label = f.get("status", "unknown").replace("_", " ").upper()
        lines.append(f"FILE: {f.get('file', 'unknown')} [{status_label}] (priority: {f.get('fix_priority', 'medium')})")

        correct = f.get("already_correct", [])
        if correct:
            for item in correct:
                lines.append(f"  ✓ {item}")

        bugs = f.get("actual_bugs", [])
        if bugs:
            for item in bugs:
                lines.append(f"  ✗ {item}")

        lines.append("")

    missing = findings.get("missing_context", [])
    if missing:
        lines.append("MISSING CONTEXT (not retrieved but likely relevant):")
        for item in missing:
            lines.append(f"  - {item}")
        lines.append("")

    lines.append("[END CODE ANALYSIS]")
    return "\n".join(lines)
