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

import litellm

from .context import ChatContext
from .skills import load_selected_skills, load_skill_file
from .usage_logger import log_usage
from .fast_mode import detect_prompt_type, get_optimization_strategy, SYSTEM_PROMPT as FAST_SYSTEM_PROMPT
from .document_parser import parse_files

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

# Dedicated cheap/fast model for summarization (separate from the main optimizer)
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "claude-haiku-4-5-20251001")


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
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            print("❌  OPENROUTER_API_KEY not set in .env")
            sys.exit(1)
        # We leave the openrouter prefix if it's there, LiteLLM handles it gracefully
        return model, {"api_key": api_key}
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


# ─────────────────────────────────────────────────────────────────────────────
# LLM 1 — Context Summarizer
# ─────────────────────────────────────────────────────────────────────────────

def summarize_context(cc: ChatContext, provider: str) -> str:
    """
    LLM 1: Compress full chat context into a compact summary.
    Always uses the cheap haiku model regardless of what model the optimizer uses.
    """
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
) -> Union[str, Generator]:
    """
    Full pipeline: DT → SF → PO → optimized prompt (clean, no metadata).
    Automatically summarizes context if token budget exceeded.
    Supports Mode: "fast" or "thinking".
    
    Args:
        attached_files: List of {name, mimeType, base64} dicts for file attachments
        forced_skill: Override auto skill selection with specific skill name
    """
    if attached_files is None:
        attached_files = []
    
    resolved_model, extra = _get_litellm_kwargs(provider, model)
    model_has_vision = supports_vision(resolved_model)
    
    # Parse attached files
    file_text_context, vision_parts = parse_files(attached_files, model_has_vision)
    
    if mode == "fast":
        prompt_type = detect_prompt_type(user_input)
        optimization_strategy = get_optimization_strategy(prompt_type)
        
        system_content = f"{FAST_SYSTEM_PROMPT}\n\nSpecific strategy for this {prompt_type} prompt:\n\n{optimization_strategy}"
        
        if custom_instructions and custom_instructions.strip():
            system_content += f"\n\nUSER CUSTOM INSTRUCTIONS (Apply these secondary rules to the optimized prompt):\n{custom_instructions.strip()}"

        messages = [{"role": "system", "content": system_content}]
        
        # Include recent history
        for msg in cc.messages[-CC_FALLBACK_MSGS:]:
            messages.append({"role": msg.role, "content": msg.content})
        
        # Prepend file context if present
        final_user_input = user_input
        if file_text_context:
            final_user_input = f"[ATTACHED CONTEXT]\n\n{file_text_context}\n\n[END ATTACHED CONTEXT]\n\n{user_input}"
        
        # Add vision parts if present
        if vision_parts:
            # For vision models, create a multipart message
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
            print(f"🎯  Using forced skill: {forced_skill}")
            skill_names = [forced_skill]
            skills_content = load_skill_file(forced_skill)
            if not skills_content:
                print(f"⚠️  Forced skill '{forced_skill}' not found, falling back to auto-selection")
                skill_names, skills_content = load_selected_skills(user_input)
        else:
            skill_names, skills_content = load_selected_skills(user_input)
    
        # Context management: compact if CC exceeds token budget
        if cc.token_estimate() > SUMMARIZE_THRESHOLD:
            print("🔄  Compacting context (haiku summarizer)...")
            try:
                summary_text = summarize_context(cc, provider)
                cc.compact_with_summary(summary_text, keep_recent=CC_KEEP_RECENT)
                from .context import save_chat_context as _save
                _save(cc)
            except Exception as exc:
                print(f"⚠️  Summarizer failed ({exc.__class__.__name__}: {exc}). Using tail-trim fallback.")
    
        cc_text = cc.to_text(max_messages=CC_FALLBACK_MSGS)
        
        # Prepend file context if present
        final_user_input = user_input
        if file_text_context:
            final_user_input = f"[ATTACHED CONTEXT]\n\n{file_text_context}\n\n[END ATTACHED CONTEXT]\n\n{user_input}"
    
        user_prompt = f"""CHAT CONTEXT:
{cc_text}

LOADED SKILLS: {', '.join(skill_names)}
{skills_content}

USER REQUEST:
{final_user_input}

Analyze the request, classify it (NEW/REFINEMENT/ADDITION), apply the relevant skill techniques, and provide the fully optimized prompt."""

        if custom_instructions and custom_instructions.strip():
            system_prompt += f"\n\nUSER CUSTOM INSTRUCTIONS (Apply these secondary rules to the optimized prompt):\n{custom_instructions.strip()}"
    
        # Build messages array
        messages = [
            {"role": "system", "content": system_prompt},
        ]
        
        # Add vision parts if present (for thinking mode)
        if vision_parts:
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
            max_tokens=1500, temperature=0.7, stream=True,
            stream_options={"include_usage": True}, **extra,
        )
        def _stream_generator():
            result_acc = ""
            usage = None
            for chunk in response:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    result_acc += delta
                    yield delta
                if hasattr(chunk, "usage") and chunk.usage:
                    usage = chunk.usage
                    
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
            # print("Stream completed.")
            
        return _stream_generator()
        
    else:
        response = litellm.completion(
            model=resolved_model, messages=messages,
            max_tokens=1500, temperature=0.7, **extra,
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
    
        print(result.strip())
        return result.strip()

