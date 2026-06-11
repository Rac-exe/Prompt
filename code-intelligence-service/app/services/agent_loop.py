"""
Bounded, local-first agentic retrieval loop (Bet 2).

Instead of a single fixed recall pass, the model drives retrieval: it calls the
local SQLite tools in agent_tools.py (search, get_definition, callers/callees,
neighbors, grep, read_chunk) over a few hops, then we hydrate the chunks it
actually relied on and hand them back to the normal answer/stream path.

Hard caps make this safe for production:
  - AGENT_MAX_HOPS        max tool-calling rounds
  - AGENT_TIME_BUDGET_S   wall-clock budget for the whole loop
  - AGENT_MAX_CHUNKS      ceiling on returned chunks

Feedback-driven retries: the loop is NOT stateless. When a previous attempt
failed ("it didn't work, fix it again"), the caller passes the chunk ids that
were already tried plus the failure signal (test output / error / user note).
The planner is told to AVOID those chunks and expand to adjacent context
(callers, callees, config, siblings), and retries widen the search budget and
raise temperature so a retry produces *different, better* context instead of
re-deriving the same files. This is what makes retrieval deterministic in the
useful sense (same prompt + new failure state => new context).

On ANY error or when nothing useful is gathered, agentic_retrieve returns None
and the caller falls back to the one-shot pipeline. This is gated by
AGENTIC_RETRIEVAL_ENABLED and never changes default behavior when off.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import litellm
import sentry_sdk

from app.config import (
    AGENT_MAX_CHUNKS,
    AGENT_MAX_HOPS,
    AGENT_MODEL,
    AGENT_TIME_BUDGET_S,
    OPENROUTER_API_KEY,
)
from app.db import queries
from app.services import prmpt_ai_client
from app.services.agent_tools import TOOL_SCHEMAS, run_tool

logger = logging.getLogger("code-intel.agent-loop")

# Priority bands for harvested chunk ids (lower = stronger commitment).
_PRIORITY_COMMITTED = 0  # get_definition / read_chunk — the agent committed
_PRIORITY_GRAPH = 1      # callers / callees / neighbors — structural relevance
_PRIORITY_LEAD = 2       # raw search / grep hits — candidate leads only

_SYSTEM_PROMPT = """You are a code-retrieval planner with access to local tools over an indexed codebase.
Goal: gather the MINIMAL set of code chunks needed to answer the user's request precisely.

Strategy:
1. Start with search_symbols / grep to locate candidates.
2. Use get_definition to confirm where a symbol is actually IMPLEMENTED (not just used).
3. Use find_callers / find_callees / expand_neighbors to follow the graph when the
   answer depends on how code connects.
4. Call read_chunk ONLY for the few chunks you will actually cite.

Be efficient: prefer 2-4 well-chosen tool calls over many. Raw search/grep hits are
only LEADS — they are not returned unless you confirm them with get_definition,
read_chunk, or a graph step. When you have enough context, STOP calling tools and
reply with a short final note. The system records the chunks from your tool usage."""


def _build_user_prompt(
    query: str,
    mode: str,
    previous_attempt_chunk_ids: list[str] | None,
    error_signal: str | None,
    attempt_number: int,
) -> str:
    """Compose the planner's user turn, injecting prior-attempt feedback so a
    retry diverges from what already failed instead of repeating it."""
    parts = [f"Mode: {mode}", f"Request: {query[:2000]}"]
    if attempt_number > 1:
        parts.append(
            f"\nThis is RETRY #{attempt_number}. A previous attempt did NOT resolve "
            "the request. Do not return the same context again."
        )
    if error_signal:
        parts.append(f"\nObserved failure / why the last attempt was insufficient:\n{error_signal[:1500]}")
    if previous_attempt_chunk_ids:
        shown = ", ".join(str(c) for c in previous_attempt_chunk_ids[:40])
        parts.append(
            "\nThese chunk ids were ALREADY TRIED and did not fix it — do NOT return "
            f"them. Instead expand OUTWARD from them (callers, callees, config, "
            f"sibling modules, related symbols):\n{shown}"
        )
    return "\n".join(parts)


def _completion_kwargs(messages: list[dict], temperature: float) -> dict:
    kwargs: dict = {
        "model": AGENT_MODEL,
        "messages": prmpt_ai_client.apply_prompt_cache(messages, AGENT_MODEL),
        "tools": TOOL_SCHEMAS,
        "tool_choice": "auto",
        "temperature": temperature,
        "max_tokens": 700,
    }
    if OPENROUTER_API_KEY and "openrouter" in AGENT_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY
    return kwargs


async def agentic_retrieve(
    project_id: str,
    user_id: str,
    query: str,
    mode: str,
    limit: int,
    *,
    previous_attempt_chunk_ids: list[str] | None = None,
    error_signal: str | None = None,
    attempt_number: int = 1,
    stats: dict | None = None,
) -> list[dict] | None:
    """Run the bounded tool loop and return hydrated chunk dicts, or None to
    signal the caller to fall back to the one-shot pipeline.

    Feedback params (optional) drive retries:
      - previous_attempt_chunk_ids: chunks already tried; excluded from results.
      - error_signal: failure context to steer the next search.
      - attempt_number: 1 = first pass; >1 widens budget + raises temperature.

    stats (optional out-param): populated with token usage and loop metrics so
    callers/benchmarks can account for the loop's OWN LLM spend.
    """
    t0 = time.perf_counter()
    ctx = {"project_id": project_id, "user_id": user_id}

    excluded: set[str] = {str(c) for c in (previous_attempt_chunk_ids or []) if c}

    # Retries widen the net so we don't re-derive the same context.
    is_retry = attempt_number > 1
    hop_cap = AGENT_MAX_HOPS + (2 if is_retry else 0)
    chunk_cap = AGENT_MAX_CHUNKS + (5 * (attempt_number - 1) if is_retry else 0)
    temperature = 0.1 if not is_retry else min(0.6, 0.1 + 0.2 * (attempt_number - 1))

    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _build_user_prompt(
                query, mode, previous_attempt_chunk_ids, error_signal, attempt_number
            ),
        },
    ]

    # Ordered, de-duplicated chunk ids the agent surfaced, keyed by priority band.
    seen: dict[str, int] = {}

    def _record(ids: list[str], priority: int) -> None:
        for cid in ids:
            if not cid or cid in excluded:
                continue
            if cid not in seen or priority < seen[cid]:
                seen[cid] = priority

    prompt_tokens = 0
    completion_tokens = 0
    hops_used = 0
    tool_calls_made = 0

    def _finalize_stats(fell_back: bool, returned: int) -> None:
        if stats is not None:
            stats.update({
                "agent_prompt_tokens": prompt_tokens,
                "agent_completion_tokens": completion_tokens,
                "agent_total_tokens": prompt_tokens + completion_tokens,
                "agent_hops_used": hops_used,
                "agent_tool_calls": tool_calls_made,
                "agent_attempt_number": attempt_number,
                "agent_elapsed_s": round(time.perf_counter() - t0, 3),
                "agent_fell_back": fell_back,
                "agent_chunks_returned": returned,
            })

    try:
        for hop in range(hop_cap):
            if time.perf_counter() - t0 > AGENT_TIME_BUDGET_S:
                logger.info("[AGENT] time budget hit at hop %d", hop)
                break
            hops_used = hop + 1

            resp = await litellm.acompletion(**_completion_kwargs(messages, temperature))

            usage = getattr(resp, "usage", None)
            if usage is not None:
                prompt_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
                completion_tokens += int(getattr(usage, "completion_tokens", 0) or 0)

            choice = resp.choices[0]
            msg = choice.message
            tool_calls = getattr(msg, "tool_calls", None) or []

            if not tool_calls:
                logger.info("[AGENT] finished at hop %d (no more tool calls)", hop)
                break

            # Append the assistant turn (with its tool calls) before observations.
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in tool_calls
                ],
            })

            # Execute all tool calls in this hop concurrently.
            async def _exec(tc):
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await run_tool(name, args, ctx)
                return tc, name, args, result

            results = await asyncio.gather(*[_exec(tc) for tc in tool_calls])
            tool_calls_made += len(results)

            for tc, name, args, result in results:
                # Track surfaced ids by commitment band. Raw search/grep hits are
                # LEADS (weakest) so noisy candidates the agent never confirms do
                # not leak into the returned set.
                if isinstance(result, list):
                    ids = [str(r.get("id")) for r in result if isinstance(r, dict) and r.get("id")]
                    if name in ("get_definition", "read_chunk"):
                        priority = _PRIORITY_COMMITTED
                    elif name in ("find_callers", "find_callees", "expand_neighbors"):
                        priority = _PRIORITY_GRAPH
                    else:  # search_symbols, grep
                        priority = _PRIORITY_LEAD
                    _record(ids, priority)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": name,
                    "content": json.dumps(result, default=str)[:4000],
                })

            # Re-check the budget mid-loop: a single slow completion can overrun.
            if time.perf_counter() - t0 > AGENT_TIME_BUDGET_S:
                logger.info("[AGENT] time budget hit after hop %d observations", hop)
                break

        if not seen:
            logger.info("[AGENT] no chunks gathered — falling back to one-shot")
            _finalize_stats(fell_back=True, returned=0)
            return None

        # Prefer confirmed (committed) + structural (graph) chunks. Only fall back
        # to raw search leads when the agent confirmed nothing — this is the
        # precision fix: a broad search no longer dumps unconfirmed hits into the
        # result set.
        confirmed = [cid for cid, p in seen.items() if p <= _PRIORITY_GRAPH]
        leads = [cid for cid, p in seen.items() if p == _PRIORITY_LEAD]
        pool = confirmed if confirmed else leads

        ordered_ids = sorted(pool, key=lambda cid: seen[cid])
        ordered_ids = ordered_ids[: max(limit, chunk_cap)]
        chunks = await asyncio.to_thread(queries.hydrate_chunks_by_ids, ordered_ids, project_id, user_id)
        if not chunks:
            _finalize_stats(fell_back=True, returned=0)
            return None

        # Drop any excluded ids that slipped through hydration (defensive).
        if excluded:
            chunks = [c for c in chunks if str(c.get("id")) not in excluded]
            if not chunks:
                _finalize_stats(fell_back=True, returned=0)
                return None

        # Preserve the agent's ordering (hydrate may reorder).
        order_index = {cid: i for i, cid in enumerate(ordered_ids)}
        chunks.sort(key=lambda c: order_index.get(str(c.get("id")), 1_000))
        for rank, c in enumerate(chunks):
            # Synthetic descending score so downstream display has a spread.
            c.setdefault("similarity_score", round(max(0.05, 1.0 - rank * 0.05), 4))
            c["final_score"] = c.get("similarity_score")

        result_chunks = chunks[:limit] if limit else chunks
        _finalize_stats(fell_back=False, returned=len(result_chunks))
        logger.info(
            "[AGENT] gathered %d chunks in %.2fs (attempt=%d hops=%d tools=%d tokens=%d confirmed=%d leads=%d)",
            len(result_chunks), time.perf_counter() - t0, attempt_number, hops_used,
            tool_calls_made, prompt_tokens + completion_tokens, len(confirmed), len(leads),
        )
        return result_chunks

    except Exception as e:
        logger.warning("[AGENT] loop failed (%s) — falling back to one-shot", e)
        sentry_sdk.capture_exception(e)
        _finalize_stats(fell_back=True, returned=0)
        return None
