"""
task_planner.py — Pre-pass that builds a structured task graph before the optimizer
writes sectioned output.

When the user wants their optimized prompt broken into tasks, this module first
asks a cheap/fast LLM to plan the task sequence — what each task builds, what
state it leaves — so the optimizer can write accurate state declarations.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional

import litellm
import sentry_sdk

from .config import SUMMARIZER_MODEL, OPENROUTER_API_KEY
from .usage_logger import log_usage

logger = logging.getLogger("prmpt.task_planner")

PLANNER_SYSTEM_PROMPT = """\
You are a software project planner. Given a user's request to build something, \
break it into an ordered sequence of implementation tasks.

Return ONLY valid JSON (no markdown, no prose) with this schema:
{
  "tasks": [
    {
      "number": 1,
      "name": "Short task name",
      "goal": "One sentence describing what this task accomplishes",
      "depends_on": "What previous task(s) this requires (empty string for task 1)",
      "produces": ["list", "of", "concrete", "outputs — files, components, configs"],
      "state_after": "One sentence: what the codebase looks like after this task completes"
    }
  ]
}

RULES:
1. Order tasks by dependency — earlier tasks must not depend on later ones.
2. Each task should be independently executable by an AI coding assistant.
3. Task 1 always handles project setup / scaffolding.
4. Keep to 3–12 tasks. Merge trivial steps; split overly large ones.
5. Be specific in "produces" — name actual files, components, or endpoints, not vague categories.
6. "state_after" should describe what a developer would see if they checked the project after running this task.
7. Do not include testing, deployment, or CI/CD unless the user explicitly asked for them.
8. Read the user's request carefully — only plan what they asked for."""


def _get_litellm_kwargs(model: str) -> tuple[str, dict]:
    if model.startswith("openrouter/"):
        key = OPENROUTER_API_KEY
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is not set.")
        return model, {"api_key": key}
    return model, {}


def plan_tasks(
    user_input: str,
    model: str | None = None,
    provider: str = "auto",
) -> Optional[List[Dict[str, Any]]]:
    """
    Produce a structured task plan from the user's prompt.

    Returns a list of task dicts on success, or None on any failure
    (so the optimizer can fall back to the old DELIVERY FORMAT).
    """
    with sentry_sdk.start_span(op="ai.task_planner", description="Plan tasks") as span:
        resolved_model = model or SUMMARIZER_MODEL
        resolved_model_name, extra = _get_litellm_kwargs(resolved_model)
        span.set_data("model", resolved_model_name)
        span.set_data("input_length", len(user_input))

        sentry_sdk.add_breadcrumb(
            category="task_planner", message="Task planning started",
            level="info", data={"model": resolved_model_name, "input_length": len(user_input)},
        )

        t0 = time.perf_counter()
        try:
            response = litellm.completion(
                model=resolved_model_name,
                messages=[
                    {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                    {"role": "user", "content": user_input},
                ],
                max_tokens=1024,
                temperature=0.2,
                response_format={"type": "json_object"},
                **extra,
            )
        except Exception as exc:
            logger.warning(f"Task planner LLM call failed: {exc}")
            sentry_sdk.capture_exception(exc)
            span.set_status("internal_error")
            return None

        latency_ms = int((time.perf_counter() - t0) * 1000)
        span.set_data("latency_ms", latency_ms)

        if response.usage:
            span.set_data("prompt_tokens", response.usage.prompt_tokens)
            span.set_data("completion_tokens", response.usage.completion_tokens)
            log_usage(
                call_type="task_planner",
                model=resolved_model_name,
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                total_tokens=response.usage.total_tokens,
                latency_ms=latency_ms,
            )

        raw = response.choices[0].message.content or ""
        logger.info(f"Task planner response ({latency_ms}ms): {raw[:300]}")

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning(f"Task planner JSON parse failed: {raw[:200]}")
            sentry_sdk.add_breadcrumb(
                category="task_planner", message="JSON parse failed",
                level="warning", data={"raw_preview": raw[:200]},
            )
            span.set_status("internal_error")
            return None

        tasks_raw = parsed.get("tasks", [])
        if not isinstance(tasks_raw, list) or len(tasks_raw) < 2:
            logger.warning(f"Task planner returned {len(tasks_raw) if isinstance(tasks_raw, list) else 0} tasks — need at least 2")
            span.set_status("internal_error")
            return None

        tasks: List[Dict[str, Any]] = []
        for t in tasks_raw:
            if not isinstance(t, dict) or "name" not in t:
                continue
            tasks.append({
                "number": int(t.get("number", len(tasks) + 1)),
                "name": str(t["name"]),
                "goal": str(t.get("goal", "")),
                "depends_on": str(t.get("depends_on", "")),
                "produces": list(t.get("produces", [])),
                "state_after": str(t.get("state_after", "")),
            })

        if len(tasks) < 2:
            logger.warning("Task planner produced fewer than 2 valid tasks after normalization")
            span.set_status("internal_error")
            return None

        span.set_data("task_count", len(tasks))
        span.set_status("ok")

        sentry_sdk.add_breadcrumb(
            category="task_planner", message="Task planning complete",
            level="info", data={"task_count": len(tasks), "latency_ms": latency_ms},
        )

        logger.info(f"Task plan: {len(tasks)} tasks in {latency_ms}ms")
        return tasks
