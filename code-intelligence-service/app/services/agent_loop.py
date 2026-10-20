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

On ANY error or when nothing useful is gathered, agentic_retrieve returns None
and the caller falls back to the one-shot pipeline. This is gated by
AGENTIC_RETRIEVAL_ENABLED (on by default); FIND mode never uses it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import litellm

from app import llm
from app.config import (
    AGENT_MAX_CHUNKS,
    AGENT_MAX_HOPS,
    AGENT_MODEL,
    AGENT_TIME_BUDGET_S,
)
from app.db import queries
from app.services.agent_tools import TOOL_SCHEMAS, run_tool
from app.services.prompt_cache import apply_prompt_cache

logger = logging.getLogger("code-intel.agent-loop")

_SYSTEM_PROMPT = """You are a code-retrieval planner with access to local tools over an indexed codebase.
Goal: gather the MINIMAL set of code chunks needed to answer the user's request precisely.

Strategy:
1. Start with search_symbols / grep to locate candidates.
2. Use get_definition to confirm where a symbol is actually IMPLEMENTED (not just used).
3. Use find_callers / find_callees / expand_neighbors to follow the graph when the
   answer depends on how code connects.
4. Call read_chunk ONLY for the few chunks you will actually cite.

Be efficient: prefer 2-4 well-chosen tool calls over many. When you have enough
context, STOP calling tools and reply with a short final note listing the chunk
ids that matter (the system reads them from your tool usage)."""


def _completion_kwargs(messages: list[dict]) -> dict:
    model = llm.rag_model(AGENT_MODEL)
    return {
        **llm.completion_kwargs(model),
        "messages": apply_prompt_cache(messages, model),
        "tools": TOOL_SCHEMAS,
        "tool_choice": "auto",
        "temperature": 0.1,
        "max_tokens": 700,
    }


async def agentic_retrieve(
    project_id: str,
    user_id: str,
    query: str,
    mode: str,
    limit: int,
) -> list[dict] | None:
    """Run the bounded tool loop and return hydrated chunk dicts, or None to
    signal the caller to fall back to the one-shot pipeline."""
    t0 = time.perf_counter()
    ctx = {"project_id": project_id, "user_id": user_id}
    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"Mode: {mode}\nRequest: {query[:2000]}"},
    ]
    # Ordered, de-duplicated chunk ids the agent surfaced. ids from get_definition
    # / read_chunk are weighted first (the agent committed to them).
    seen: dict[str, int] = {}

    def _record(ids: list[str], priority: int) -> None:
        for cid in ids:
            if cid and (cid not in seen or priority < seen[cid]):
                seen[cid] = priority

    try:
        for hop in range(AGENT_MAX_HOPS):
            if time.perf_counter() - t0 > AGENT_TIME_BUDGET_S:
                logger.info("[AGENT] time budget hit at hop %d", hop)
                break

            resp = await litellm.acompletion(**_completion_kwargs(messages))
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

            for tc, name, args, result in results:
                # Track surfaced ids with priority by tool kind.
                if isinstance(result, list):
                    ids = [str(r.get("id")) for r in result if isinstance(r, dict) and r.get("id")]
                    priority = 0 if name in ("get_definition", "read_chunk") else 1
                    _record(ids, priority)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": name,
                    "content": json.dumps(result, default=str)[:4000],
                })

        if not seen:
            logger.info("[AGENT] no chunks gathered — falling back to one-shot")
            return None

        # Order ids by (priority, first-seen) and hydrate the top set.
        ordered_ids = [cid for cid, _ in sorted(seen.items(), key=lambda kv: kv[1])]
        ordered_ids = ordered_ids[: max(limit, AGENT_MAX_CHUNKS)]
        chunks = await asyncio.to_thread(queries.hydrate_chunks_by_ids, ordered_ids, project_id, user_id)
        if not chunks:
            return None

        # Preserve the agent's ordering (hydrate may reorder).
        order_index = {cid: i for i, cid in enumerate(ordered_ids)}
        chunks.sort(key=lambda c: order_index.get(str(c.get("id")), 1_000))
        for rank, c in enumerate(chunks):
            # Synthetic descending score so downstream display has a spread.
            c.setdefault("similarity_score", round(max(0.05, 1.0 - rank * 0.05), 4))
            c["final_score"] = c.get("similarity_score")
        logger.info(
            "[AGENT] gathered %d chunks in %.2fs (hops used, ids=%d)",
            len(chunks), time.perf_counter() - t0, len(seen),
        )
        return chunks[:limit] if limit else chunks

    except Exception as e:
        logger.warning("[AGENT] loop failed (%s) — falling back to one-shot", e)
        return None
