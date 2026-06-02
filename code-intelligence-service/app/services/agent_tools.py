"""
Local, zero-network code-intelligence tools for the agentic retrieval loop.

Every tool is backed by the project's local SQLite store (FTS5 + the symbol
graph), so a tool call is a local DB read — no embeddings, no LLM, no remote
hop. The loop in agent_loop.py exposes these to the model via function calling
and feeds the (compact) results back as observations.

Design notes:
- Results are intentionally COMPACT (id, path, line range, name, signature, a
  short summary) to keep the model's context budget small across hops. The full
  body is only returned by `read_chunk`.
- All tools degrade gracefully: on any error they return an `error` field rather
  than raising, so a single bad tool call never kills the loop.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.db import queries

logger = logging.getLogger("code-intel.agent-tools")

_MAX_SNIPPET = 600


def _compact(chunk: dict) -> dict:
    """Small, model-friendly view of a chunk (no large code body)."""
    return {
        "id": str(chunk.get("id") or ""),
        "file_path": chunk.get("file_path"),
        "name": chunk.get("name"),
        "type": chunk.get("chunk_type"),
        "lines": [chunk.get("start_line"), chunk.get("end_line")],
        "signature": (chunk.get("signature") or "")[:200] or None,
        "summary": (chunk.get("summary_code") or chunk.get("semantic_summary") or "")[:240] or None,
        "edge": chunk.get("edge"),
    }


# ── Tool schemas (OpenAI / litellm function-calling format) ───────────────────
TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_symbols",
            "description": "Keyword/FTS search over indexed code. Use to locate "
                           "candidate files/functions by name or terms.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "search terms"},
                    "limit": {"type": "integer", "default": 8},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_definition",
            "description": "Find the chunk(s) that DEFINE a symbol by name "
                           "(function/class/method). Prefer this to confirm where "
                           "something is actually implemented.",
            "parameters": {
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_callers",
            "description": "List chunks that call or import the given chunk id "
                           "(incoming graph edges).",
            "parameters": {
                "type": "object",
                "properties": {
                    "chunk_id": {"type": "string"},
                    "limit": {"type": "integer", "default": 12},
                },
                "required": ["chunk_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_callees",
            "description": "List chunks the given chunk id calls or imports "
                           "(outgoing graph edges).",
            "parameters": {
                "type": "object",
                "properties": {
                    "chunk_id": {"type": "string"},
                    "limit": {"type": "integer", "default": 12},
                },
                "required": ["chunk_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "expand_neighbors",
            "description": "Graph-expand around chunk ids to pull in related "
                           "context (multi-hop neighbors).",
            "parameters": {
                "type": "object",
                "properties": {
                    "chunk_ids": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "integer", "default": 12},
                },
                "required": ["chunk_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "Full-text search for an exact term/phrase across the "
                           "codebase (FTS5).",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string"},
                    "limit": {"type": "integer", "default": 8},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_chunk",
            "description": "Read the FULL code body of one or more chunk ids. Use "
                           "sparingly — only for chunks you will cite.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chunk_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["chunk_ids"],
            },
        },
    },
]

TOOL_NAMES = {s["function"]["name"] for s in TOOL_SCHEMAS}


def _run_tool_sync(name: str, args: dict[str, Any], project_id: str, user_id: str) -> Any:
    if name == "search_symbols":
        limit = int(args.get("limit", 8))
        rows = queries.text_search(project_id, user_id, str(args.get("query", "")), limit)
        return [_compact(r) for r in rows]

    if name == "grep":
        limit = int(args.get("limit", 8))
        rows = queries.text_search(project_id, user_id, str(args.get("pattern", "")), limit)
        return [_compact(r) for r in rows]

    if name == "get_definition":
        rows = queries.find_definitions(project_id, str(args.get("symbol", "")), limit=5)
        return [_compact(r) for r in rows]

    if name == "find_callers":
        rows = queries.get_callers(project_id, str(args.get("chunk_id", "")), int(args.get("limit", 12)))
        return [_compact(r) for r in rows]

    if name == "find_callees":
        rows = queries.get_callees(project_id, str(args.get("chunk_id", "")), int(args.get("limit", 12)))
        return [_compact(r) for r in rows]

    if name == "expand_neighbors":
        ids = [str(x) for x in (args.get("chunk_ids") or [])][:8]
        rows = queries.get_related_chunks_multihop(ids, project_id, max_total=int(args.get("limit", 12)))
        return [_compact(r) for r in rows]

    if name == "read_chunk":
        ids = [str(x) for x in (args.get("chunk_ids") or [])][:6]
        rows = queries.hydrate_chunks_by_ids(ids, project_id, user_id)
        out = []
        for r in rows:
            c = _compact(r)
            c["code"] = (r.get("code_body") or "")[:_MAX_SNIPPET * 4]
            out.append(c)
        return out

    return {"error": f"unknown tool {name!r}"}


async def run_tool(name: str, args: dict[str, Any], ctx: dict) -> Any:
    """Dispatch a tool by name. Never raises — returns {'error': ...} on failure."""
    if name not in TOOL_NAMES:
        return {"error": f"unknown tool {name!r}"}
    project_id = str(ctx.get("project_id") or "")
    user_id = str(ctx.get("user_id") or "")
    try:
        return await asyncio.to_thread(_run_tool_sync, name, args or {}, project_id, user_id)
    except Exception as e:
        logger.warning("[AGENT_TOOL] %s failed: %s", name, e)
        return {"error": f"{name} failed: {str(e)[:160]}"}
