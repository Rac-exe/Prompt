"""
optimizer.py — Main LLM orchestrator for pipeline_v2.

Implements:
- Decision Taker (DT): classifies input as NEW / REFINEMENT / ADDITION
- Skill Selector (SF): via skills.py
- Prompt Optimizer (PO): sends full context to LLM and streams result
- Context Summarizer (LLM 1): compresses CC if token budget exceeded
"""

from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path
from typing import Tuple, List, Dict, Union, Optional, Generator

import logging

import litellm
import sentry_sdk

from .context import ChatContext

logger = logging.getLogger(__name__)
from .skills import load_selected_skills, load_skill_file
from .usage_logger import log_usage
from .fast_mode import detect_prompt_type, get_optimization_strategy, SYSTEM_PROMPT as FAST_SYSTEM_PROMPT
from .document_parser import parse_files
from .config import SUMMARIZER_MODEL, OPENROUTER_API_KEY
from .project_context import fetch_project_context

litellm.set_verbose = False

# ── System prompts ────────────────────────────────────────────────────────────
FILES_DIR = Path(__file__).parent.parent.parent / "files"


def _load_system_prompt(name: str) -> str:
    path = FILES_DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    raise FileNotFoundError(f"System prompt not found: {path}")


# ── Token budget ──────────────────────────────────────────────────────────────
SUMMARIZE_THRESHOLD = 3000   # compact CC when token count exceeds this
CC_KEEP_RECENT    = 4        # recent messages to keep after compaction
CC_FALLBACK_MSGS  = 6        # messages to use if summarizer fails





# ── Model capabilities ───────────────────────────────────────────────────────
# Focus on reliable, budget-friendly vision models
VISION_MODELS = {
    # OpenAI
    "gpt-4o-mini", "openai/gpt-4o-mini", "openrouter/openai/gpt-4o-mini",
    "gpt-4o", "openai/gpt-4o", "openrouter/openai/gpt-4o",

    # Anthropic Claude — all Sonnet and Haiku variants support vision
    "claude-3-5-sonnet", "anthropic/claude-3-5-sonnet", "openrouter/anthropic/claude-3-5-sonnet",
    "claude-3-5-haiku", "anthropic/claude-3-5-haiku", "openrouter/anthropic/claude-3-5-haiku",
    "claude-3-haiku",   "anthropic/claude-3-haiku",   "openrouter/anthropic/claude-3-haiku",
    # Haiku 4.x (OpenRouter uses dot notation)
    "claude-haiku-4",   "claude-haiku-4.5",
    "anthropic/claude-haiku-4",   "anthropic/claude-haiku-4.5",
    "openrouter/anthropic/claude-haiku-4", "openrouter/anthropic/claude-haiku-4.5",
    # Version-specific strings that appear in .env / LiteLLM
    "claude-haiku-4-5", "claude-haiku-4-5-20251001",
    "anthropic/claude-haiku-4.5-20251001",

    # Google Gemini
    "gemini-1.5-flash", "google/gemini-1.5-flash", "openrouter/google/gemini-1.5-flash",
    "gemini-1.5-pro",   "google/gemini-1.5-pro",   "openrouter/google/gemini-1.5-pro",
}


def supports_vision(model: str) -> bool:
    """Check if a model supports vision/multimodal input."""
    model_lower = model.lower()
    return any(vm in model_lower for vm in VISION_MODELS)


# ── Provider config ───────────────────────────────────────────────────────────
def _get_litellm_kwargs(provider: str, model: str) -> Tuple[str, dict]:
    """Return (resolved_model, extra_kwargs) for litellm."""
    if provider == "openrouter" or model.startswith("openrouter/"):
        key = os.environ.get("OPENROUTER_API_KEY", "") or OPENROUTER_API_KEY
        if not key:
            raise RuntimeError(
                "OPENROUTER_API_KEY is not set. Add it to your .env file."
            )
        return model, {"api_key": key}
    return model, {}


# ── Output cleaner ────────────────────────────────────────────────────────────
def _extract_optimized_prompt(raw: str) -> str:
    """
    The system prompt formats output with **ANALYSIS**, **OPTIMIZED PROMPT**,
    **KEY IMPROVEMENTS**, **USAGE TIP** sections.
    Extract only the content inside **OPTIMIZED PROMPT** and drop the rest.
    Falls back to the full raw text if the marker is not found.
    """
    match = re.search(
        r'\*\*OPTIMIZED PROMPT\*\*\s*\n(.*?)(?=\n\*\*[A-Z]|\Z)',
        raw, re.DOTALL | re.IGNORECASE
    )
    if match:
        return match.group(1).strip()
    return raw.strip()


# ── Analysis leak detection & stripping ──────────────────────────────────────
_TASK_HEADING_RE = re.compile(r'##\s*Task\s', re.IGNORECASE)
_SECTION_HEADING_RE = re.compile(r'##\s*\S', re.IGNORECASE)
_ANALYSIS_LEAK_RE = re.compile(
    r'(?:DECISION\s+TAKER|SKILL\s+SELECTOR|OPTIMIZATION\s+TECHNIQUES|USER\s+CONTEXT\s+INTEGRATION)',
    re.IGNORECASE,
)
_ANALYSIS_LAST_SECTION_RE = re.compile(
    r'(?:\*{0,2})'
    r'(?:DECISION\s+TAKER|SKILL\s+SELECTOR|OPTIMIZATION\s+TECHNIQUES'
    r'|USER\s+CONTEXT\s+INTEGRATION|USER\s+CONTEXT'
    r'|DISTINCTLY\s+DIFFERENT(?:\s+OPTIMIZATION)?)',
    re.IGNORECASE,
)
_STRIP_BUFFER_LIMIT_TASK = 2000
_STRIP_BUFFER_LIMIT_SINGLE = 4000
_QUICK_CHECK_LEN = 500


def _find_prompt_start_after_analysis(buf: str) -> int:
    """Find where the actual prompt starts after leaked analysis sections."""
    matches = list(_ANALYSIS_LAST_SECTION_RE.finditer(buf))
    if not matches:
        return 0
    last = matches[-1]
    search_from = last.end()
    remaining = buf[search_from:]
    sep = remaining.find('\n---')
    if sep != -1:
        after_sep = remaining[sep + 4:].lstrip('\n')
        if after_sep and not _ANALYSIS_LEAK_RE.search(after_sep[:200]):
            return search_from + sep + 4 + (len(remaining[sep + 4:]) - len(remaining[sep + 4:].lstrip('\n')))
    parts = remaining.split('\n\n')
    offset = search_from
    for i, part in enumerate(parts):
        offset += len(part) + 2
        if i == 0:
            continue
        rest_from_here = buf[offset:]
        if rest_from_here.strip() and not _ANALYSIS_LEAK_RE.search(rest_from_here[:300]):
            return offset
    return min(search_from + len(parts[0]) + 2 if len(parts) > 1 else search_from, len(buf))


# ─────────────────────────────────────────────────────────────────────────────
# LLM 1 — Context Summarizer
# ─────────────────────────────────────────────────────────────────────────────

def summarize_context(cc: ChatContext, provider: str) -> str:
    """
    LLM 1: Compress full chat context into a compact summary.
    Uses SUMMARIZER_MODEL (cheap/fast) regardless of what the optimizer uses.
    """
    sentry_sdk.add_breadcrumb(
        category="optimizer", message="Context summarization started",
        level="info", data={"session_id": cc.session_id},
    )
    system_prompt = _load_system_prompt("system_prompt_summarizer.md")
    resolved_model, extra = _get_litellm_kwargs(provider, SUMMARIZER_MODEL)

    user_prompt = f"""Chat History:
{cc.to_text(max_messages=50)}

Compress this conversation into the required JSON format."""

    t0 = time.perf_counter()
    response = litellm.completion(
        model=resolved_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=500,
        temperature=0.2,
        **extra,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    if response.usage:
        log_usage(
            call_type="summarizer",
            model=resolved_model,
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            total_tokens=response.usage.total_tokens,
            session_id=cc.session_id,
            latency_ms=latency_ms,
        )
    return response.choices[0].message.content.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Task-plan aware delivery format
# ─────────────────────────────────────────────────────────────────────────────

def _build_delivery_format(task_plan: Optional[list] = None) -> str:
    """Build the DELIVERY FORMAT appendix for the system prompt.

    When a task_plan is available (from task_planner.py), each task gets a
    precise state anchor so the optimizer writes continuations, not repeats.
    Without a plan, falls back to the original generic instruction.
    """
    sentry_sdk.add_breadcrumb(
        category="optimizer", message="Building delivery format",
        level="info", data={"has_task_plan": bool(task_plan), "task_count": len(task_plan) if task_plan else 0},
    )
    if task_plan:
        plan_text = "\n".join(
            f"Task {t['number']}: {t['name']}\n"
            f"  Goal: {t['goal']}\n"
            f"  Produces: {', '.join(t.get('produces', []))}\n"
            f"  State after: {t.get('state_after', '')}"
            for t in task_plan
        )
        return (
            "\n\n<internal_reference>\n"
            "The following task plan is for your internal reference ONLY. "
            "Do NOT reproduce, echo, or summarize it in your output.\n\n"
            f"{plan_text}\n"
            "</internal_reference>\n\n"
            "DELIVERY FORMAT: Write each task as a standalone executable prompt "
            "for an AI coding assistant using the hybrid format:\n"
            "1. One-line project anchor (tech stack + goal)\n"
            "2. 'At this point:' — list what previous tasks built (from the reference above)\n"
            "3. Task instructions — actionable, specific, not spec-like\n"
            "4. Exit condition — what should work/exist when done\n"
            "Use ## Task N: Name as the heading. Each task must be independently "
            "executable if pasted into the same ongoing chat.\n\n"
            "CRITICAL: Do NOT output any analysis, classification, or internal reasoning. "
            "No DECISION TAKER, SKILL SELECTOR, OPTIMIZATION TECHNIQUES, or USER CONTEXT sections. "
            "No DT, SF, PO, or UC headers. Skip all preamble. "
            "Begin your response DIRECTLY with ## Task 1: — the very first characters you output "
            "must be the ## Task 1 heading."
        )
    return (
        "\n\nDELIVERY FORMAT: The user wants this prompt broken into ordered task sections. "
        "Output each section with a ## Section Title header followed by its prompt content. "
        "Within each section, use bullet points (- ) for individual requirements and instructions. "
        "Never write dense paragraphs — every requirement must be its own bullet point. "
        "Sections should be self-contained and executable in sequence.\n\n"
        "CRITICAL: Do NOT output any analysis, classification, or internal reasoning. "
        "No DECISION TAKER, SKILL SELECTOR, OPTIMIZATION TECHNIQUES, or USER CONTEXT sections. "
        "No DT, SF, PO, or UC headers. Skip all preamble. "
        "Begin your response DIRECTLY with the first ## Section heading."
    )


# ─────────────────────────────────────────────────────────────────────────────
# LLM 2 — Prompt Optimizer (DT + SF + PO)
# ─────────────────────────────────────────────────────────────────────────────

def optimize(
    user_input: str,
    cc: ChatContext,
    model: str = "gpt-4o-mini",
    provider: str = "auto",
    stream: bool = False,
    mode: str = "thinking",
    custom_instructions: str = "",
    attached_files: Optional[List[Dict]] = None,
    forced_skill: Optional[str] = None,
    previous_output: Optional[str] = None,
    models_info: Optional[Dict] = None,
    clarification_answers: Optional[str] = None,
    wants_sections: bool = False,
    task_plan: Optional[list] = None,
    project_id: Optional[str] = None,
    project_branch: Optional[str] = None,
    auth_token: Optional[str] = None,
) -> Union[str, Generator]:
    """
    Full pipeline: DT → SF → PO → optimized prompt (clean, no metadata).
    Automatically summarizes context if token budget exceeded.
    Supports Mode: "fast" or "thinking".
    
    Args:
        attached_files: List of {name, mimeType, base64} dicts for file attachments
        forced_skill: Override auto skill selection with specific skill name
        previous_output: If provided (regeneration), the LLM is instructed to
                         produce a distinctly different and better optimization.
        clarification_answers: Pre-formatted user answers from the clarification step.
        wants_sections: If True, instruct the LLM to output as ordered task sections.
        project_id: If provided, fetches code context from the Code Intelligence Service.
        project_branch: Current git branch for context scoping.
        auth_token: JWT token forwarded for Code Intelligence Service auth.
    """
    if attached_files is None:
        attached_files = []

    sentry_sdk.add_breadcrumb(
        category="optimizer", message="Optimization started",
        level="info", data={
            "mode": mode, "model": model, "stream": stream,
            "has_clarification": bool(clarification_answers),
            "wants_sections": wants_sections,
            "has_files": len(attached_files) > 0,
            "forced_skill": forced_skill,
            "is_regeneration": bool(previous_output and previous_output.strip()),
        },
    )

    # Fetch project codebase context if a project is attached
    project_context_text = ""
    if project_id:
        try:
            ctx = fetch_project_context(
                project_id=project_id,
                user_query=user_input,
                branch=project_branch,
                auth_token=auth_token,
            )
            if ctx:
                project_context_text = ctx
                print(f"[Optimizer] Project context retrieved ({len(ctx)} chars)")
        except Exception as e:
            print(f"[Optimizer] Project context fetch failed: {e}")

    is_regeneration = bool(previous_output and previous_output.strip())
    # Use a higher temperature for regeneration so outputs are more varied
    temperature = 0.95 if is_regeneration else 0.7

    # Build the regeneration instruction block appended to the user message
    regen_instruction = ""
    if is_regeneration:
        regen_instruction = (
            f"\n\n---\n"
            f"PREVIOUS OPTIMIZED VERSION (already shown to user — do NOT reproduce this):\n"
            f"{previous_output.strip()}\n\n"
            f"Generate a DISTINCTLY DIFFERENT optimization of the original request above. "
            f"Use a different structural approach, angle, or framing. "
            f"Cover aspects or dimensions the previous version missed or under-emphasized. "
            f"The new version must be meaningfully different — not a paraphrase or minor reword of the previous one."
        )

    resolved_model, extra = _get_litellm_kwargs(provider, model)
    model_has_vision = supports_vision(resolved_model)

    if models_info is not None:
        models_info["optimizer"] = resolved_model
    
    # Parse attached files
    file_text_context, vision_parts = parse_files(attached_files, model_has_vision)

    if clarification_answers and clarification_answers.strip():
        user_input = (
            f"ORIGINAL REQUEST:\n{user_input}\n\n"
            f"USER CLARIFICATIONS:\n{clarification_answers}"
        )
        sentry_sdk.add_breadcrumb(
            category="optimizer", message="Clarification answers injected",
            level="info", data={"answer_length": len(clarification_answers)},
        )

    if mode == "fast":
        prompt_type = detect_prompt_type(user_input)
        optimization_strategy = get_optimization_strategy(prompt_type)
        
        system_content = f"{FAST_SYSTEM_PROMPT}\n\nSpecific strategy for this {prompt_type} prompt:\n\n{optimization_strategy}"

        if wants_sections:
            system_content += _build_delivery_format(task_plan)

        if custom_instructions and custom_instructions.strip():
            system_content += (
                f"\n\nDETECTED PROMPT CATEGORY: {prompt_type}\n\n"
                f"USER CUSTOM INSTRUCTIONS (Apply these as secondary enrichment. "
                f"The detected category above is authoritative — do not let user memory override it):\n"
                f"{custom_instructions.strip()}"
            )

        messages = [{"role": "system", "content": system_content}]
        
        # Include recent history
        for msg in cc.messages[-CC_FALLBACK_MSGS:]:
            messages.append({"role": msg.role, "content": msg.content})
        
        # Prepend file context if present
        final_user_input = user_input
        if project_context_text:
            final_user_input = f"{project_context_text}\n\n{final_user_input}"
        if file_text_context:
            final_user_input = f"[ATTACHED CONTEXT]\n\n{file_text_context}\n\n[END ATTACHED CONTEXT]\n\n{final_user_input}"

        # Append regeneration instruction when applicable
        final_user_input = final_user_input + regen_instruction
        
        # Add vision parts if present
        if vision_parts:
            if models_info is not None:
                models_info["used_vision"] = True
            user_message_parts = [{"type": "text", "text": final_user_input}]
            user_message_parts.extend(vision_parts)
            messages.append({"role": "user", "content": user_message_parts})
        else:
            messages.append({"role": "user", "content": final_user_input})
        
        skill_names = []
        
    else:
        system_prompt = _load_system_prompt("system_prompt_optimizer.md")
        
        # Select skills (or use forced skill)
        if forced_skill:
            logger.info(f"Using forced skill: {forced_skill}")
            skill_names = [forced_skill]
            skills_content = load_skill_file(forced_skill)
            if not skills_content:
                logger.warning(f"Forced skill '{forced_skill}' not found, falling back to auto-selection")
                skill_names, skills_content = load_selected_skills(user_input)
        else:
            skill_names, skills_content = load_selected_skills(user_input)
    
        # Context management: compact if CC exceeds token budget
        if cc.token_estimate() > SUMMARIZE_THRESHOLD:
            logger.info(f"Compacting context ({SUMMARIZER_MODEL})...")
            try:
                summary_text = summarize_context(cc, provider)
                cc.compact_with_summary(summary_text, keep_recent=CC_KEEP_RECENT)
                if models_info is not None:
                    models_info["summarizer"] = SUMMARIZER_MODEL
                sentry_sdk.add_breadcrumb(
                    category="optimizer", message="Context compacted in-memory",
                    level="info", data={"kept_recent": CC_KEEP_RECENT, "new_msg_count": len(cc.messages)},
                )
            except Exception as exc:
                logger.warning(f"Summarizer failed ({exc.__class__.__name__}: {exc}). Using tail-trim fallback.")
                sentry_sdk.capture_exception(exc)
    
        cc_text = cc.to_text(max_messages=CC_FALLBACK_MSGS)
        
        # Prepend file/project context if present
        final_user_input = user_input
        if project_context_text:
            final_user_input = f"{project_context_text}\n\n{final_user_input}"
        if file_text_context:
            final_user_input = f"[ATTACHED CONTEXT]\n\n{file_text_context}\n\n[END ATTACHED CONTEXT]\n\n{final_user_input}"
    
        user_prompt = f"""CHAT CONTEXT:
{cc_text}

LOADED SKILLS: {', '.join(skill_names)}
{skills_content}

USER REQUEST:
{final_user_input}

Apply your internal analysis silently (classify, select skills, choose techniques). Output ONLY the fully optimized prompt — no analysis headers, no reasoning, no section labels."""

        # Append regeneration instruction when applicable
        if regen_instruction:
            user_prompt = user_prompt + regen_instruction

        if wants_sections:
            system_prompt += _build_delivery_format(task_plan)

        if custom_instructions and custom_instructions.strip():
            system_prompt += (
                f"\n\nUSER CUSTOM INSTRUCTIONS (Apply these as secondary enrichment to the optimized prompt. "
                f"Do not let user memory override the user's explicit intent):\n"
                f"{custom_instructions.strip()}"
            )
    
        # Build messages array
        messages = [
            {"role": "system", "content": system_prompt},
        ]
        
        # Add vision parts if present (for thinking mode)
        if vision_parts:
            if models_info is not None:
                models_info["used_vision"] = True
            user_message_parts = [{"type": "text", "text": user_prompt}]
            user_message_parts.extend(vision_parts)
            messages.append({"role": "user", "content": user_message_parts})
        else:
            messages.append({"role": "user", "content": user_prompt})

    # Collect response (stream or not) and output directly
    t0 = time.perf_counter()
    
    if stream:
        response = litellm.completion(
            model=resolved_model, messages=messages,
            max_tokens=8192, temperature=temperature, stream=True,
            stream_options={"include_usage": True}, **extra,
        )
        def _stream_generator():
            result_acc = ""
            usage = None
            is_task_mode = wants_sections and bool(task_plan)
            # Always start with a buffer to detect leaks
            prefix_buffer = ""
            leak_detected = False
            buffer_limit = _STRIP_BUFFER_LIMIT_TASK if is_task_mode else _STRIP_BUFFER_LIMIT_SINGLE
            sentry_sdk.add_breadcrumb(
                category="optimizer", message="Stream prefix strip enabled (universal)",
                level="info", data={"is_task_mode": is_task_mode},
            )

            for chunk in response:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    result_acc += delta

                    if prefix_buffer is not None:
                        prefix_buffer += delta

                        # Quick check: if first ~500 chars have no analysis headers, flush immediately
                        if not leak_detected and len(prefix_buffer) >= _QUICK_CHECK_LEN:
                            if not _ANALYSIS_LEAK_RE.search(prefix_buffer):
                                sentry_sdk.add_breadcrumb(
                                    category="optimizer", message="No analysis leak detected, flushing buffer",
                                    level="info", data={"buffer_len": len(prefix_buffer)},
                                )
                                dump = prefix_buffer
                                prefix_buffer = None
                                yield dump
                                continue
                            else:
                                leak_detected = True
                                sentry_sdk.add_breadcrumb(
                                    category="optimizer", message="Analysis leak detected in stream",
                                    level="warning", data={"buffer_len": len(prefix_buffer)},
                                )

                        if leak_detected or len(prefix_buffer) >= _QUICK_CHECK_LEN:
                            if is_task_mode:
                                # Task mode: strip until ## Task heading
                                heading_match = _TASK_HEADING_RE.search(prefix_buffer)
                                if heading_match:
                                    stripped_len = heading_match.start()
                                    clean_start = prefix_buffer[stripped_len:]
                                    prefix_buffer = None
                                    if stripped_len > 0:
                                        sentry_sdk.add_breadcrumb(
                                            category="optimizer", message="Stripped analysis prefix (task mode)",
                                            level="warning", data={"chars_stripped": stripped_len},
                                        )
                                    if clean_start:
                                        yield clean_start
                                elif len(prefix_buffer) >= buffer_limit:
                                    fallback_match = _SECTION_HEADING_RE.search(prefix_buffer)
                                    if fallback_match:
                                        clean_start = prefix_buffer[fallback_match.start():]
                                        prefix_buffer = None
                                        if clean_start:
                                            yield clean_start
                                    else:
                                        sentry_sdk.add_breadcrumb(
                                            category="optimizer", message="Task mode safety valve: flushing buffer",
                                            level="warning", data={"buffer_len": len(prefix_buffer)},
                                        )
                                        dump = prefix_buffer
                                        prefix_buffer = None
                                        yield dump
                            else:
                                # Single-prompt mode: find where actual prompt starts
                                if len(prefix_buffer) >= buffer_limit:
                                    prompt_start = _find_prompt_start_after_analysis(prefix_buffer)
                                    if prompt_start > 0 and prompt_start < len(prefix_buffer):
                                        clean = prefix_buffer[prompt_start:].lstrip('\n')
                                        sentry_sdk.add_breadcrumb(
                                            category="optimizer", message="Stripped analysis prefix (single prompt)",
                                            level="warning", data={"chars_stripped": prompt_start},
                                        )
                                        prefix_buffer = None
                                        if clean:
                                            yield clean
                                    else:
                                        sentry_sdk.add_breadcrumb(
                                            category="optimizer", message="Single prompt safety valve: flushing buffer",
                                            level="warning", data={"buffer_len": len(prefix_buffer)},
                                        )
                                        dump = prefix_buffer
                                        prefix_buffer = None
                                        yield dump
                    else:
                        yield delta

                if hasattr(chunk, "usage") and chunk.usage:
                    usage = chunk.usage

            # Flush any remaining buffer
            if prefix_buffer is not None and prefix_buffer:
                if leak_detected:
                    if is_task_mode:
                        heading_match = _TASK_HEADING_RE.search(prefix_buffer) or _SECTION_HEADING_RE.search(prefix_buffer)
                        if heading_match:
                            yield prefix_buffer[heading_match.start():]
                        else:
                            yield prefix_buffer
                    else:
                        prompt_start = _find_prompt_start_after_analysis(prefix_buffer)
                        if prompt_start > 0 and prompt_start < len(prefix_buffer):
                            clean = prefix_buffer[prompt_start:].lstrip('\n')
                            yield clean if clean else prefix_buffer
                        else:
                            yield prefix_buffer
                else:
                    yield prefix_buffer

            latency_ms = int((time.perf_counter() - t0) * 1000)
            if usage:
                log_usage(
                    call_type=f"optimizer_{mode}",
                    model=resolved_model,
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    total_tokens=usage.total_tokens,
                    session_id=cc.session_id,
                    skills=skill_names,
                    latency_ms=latency_ms,
                )
            
        return _stream_generator()
        
    else:
        response = litellm.completion(
            model=resolved_model, messages=messages,
            max_tokens=8192, temperature=temperature, **extra,
        )
        result = response.choices[0].message.content
        usage = response.usage

        latency_ms = int((time.perf_counter() - t0) * 1000)
    
        if usage:
            log_usage(
                call_type=f"optimizer_{mode}",
                model=resolved_model,
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                total_tokens=usage.total_tokens,
                session_id=cc.session_id,
                skills=skill_names,
                latency_ms=latency_ms,
            )
    
        cleaned = result.strip()
        # Task mode: strip until ## Task heading
        if wants_sections and task_plan and cleaned:
            heading_match = re.search(r'##\s*Task\s', cleaned, re.IGNORECASE)
            if not heading_match:
                heading_match = re.search(r'##\s*\S', cleaned, re.IGNORECASE)
            if heading_match and heading_match.start() > 0:
                sentry_sdk.add_breadcrumb(
                    category="optimizer", message="Stripped analysis prefix from non-stream result (task mode)",
                    level="warning", data={"chars_stripped": heading_match.start()},
                )
                cleaned = cleaned[heading_match.start():]
        # Single-prompt mode: detect and strip analysis headers
        elif cleaned and re.search(
            r'(?:DECISION\s+TAKER|SKILL\s+SELECTOR|OPTIMIZATION\s+TECHNIQUES|USER\s+CONTEXT\s+INTEGRATION)',
            cleaned[:500], re.IGNORECASE
        ):
            prompt_start = _find_prompt_start_after_analysis(cleaned)
            if prompt_start > 0 and prompt_start < len(cleaned):
                sentry_sdk.add_breadcrumb(
                    category="optimizer", message="Stripped analysis prefix from non-stream result (single prompt)",
                    level="warning", data={"chars_stripped": prompt_start},
                )
                cleaned = cleaned[prompt_start:].lstrip('\n')
        logger.info(f"Optimization complete ({latency_ms}ms)")
        return cleaned

