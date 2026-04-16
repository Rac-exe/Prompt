"""
Query decomposition and intent classification.
Splits a user question into focused sub-queries for multi-vector retrieval
and extracts domain concept tags + intent type.

Includes a fast path for simple queries that skips the LLM call.
"""

import asyncio
import json
import re
import logging
import litellm
from dataclasses import dataclass, field

from app.config import QUERY_DECOMPOSE_MODEL, OPENROUTER_API_KEY, SIMPLE_QUERY_WORD_THRESHOLD

logger = logging.getLogger("code-intel.query_analyzer")

DECOMPOSE_SYSTEM_PROMPT = """You are a code search query analyzer. Given a user question about their codebase, produce a JSON object with:

1. "intent": One of: "bug", "architecture", "performance", "feature", "refactor", "general"
2. "sub_queries": 2-4 focused search queries that together cover all aspects of the question. Each should target one specific concept, component, or code pattern. Include identifier names if the user mentioned any.
3. "concepts": 1-4 domain concept tags from: state-management, routing, auth, data-fetching, error-handling, UI-rendering, validation, caching, database, API, file-io, config, middleware, testing, logging, security, payments, notifications, concurrency, search

Return ONLY valid JSON. No markdown, no explanation."""


@dataclass
class QueryAnalysis:
    intent: str = "general"
    sub_queries: list[str] = field(default_factory=list)
    concepts: list[str] = field(default_factory=list)


VALID_CONCEPTS = {
    "state-management", "routing", "auth", "data-fetching", "error-handling",
    "UI-rendering", "validation", "caching", "database", "API", "file-io",
    "config", "middleware", "testing", "logging", "security", "payments",
    "notifications", "concurrency", "search",
}

VALID_INTENTS = {"bug", "architecture", "performance", "feature", "refactor", "general"}

CONCEPT_KEYWORDS: dict[str, list[str]] = {
    "state-management": ["state", "store", "redux", "toggle", "setter", "getter", "usestate", "dispatch", "context", "zustand"],
    "auth": ["auth", "login", "signup", "password", "token", "session", "jwt", "oauth", "credential"],
    "routing": ["route", "router", "navigate", "path", "url", "redirect", "endpoint"],
    "database": ["database", "db", "query", "model", "schema", "migration", "mongoose", "sql", "mongo", "prisma"],
    "API": ["api", "endpoint", "request", "response", "rest", "graphql", "controller", "handler"],
    "error-handling": ["error", "exception", "catch", "throw", "handler", "retry", "fallback"],
    "validation": ["valid", "validate", "schema", "sanitize", "check", "constraint", "zod", "joi"],
    "data-fetching": ["fetch", "get", "load", "retrieve", "download", "http", "axios", "httpx"],
    "caching": ["cache", "memoize", "store", "invalidate", "ttl", "redis"],
    "middleware": ["middleware", "interceptor", "pipe", "guard", "filter"],
    "file-io": ["file", "read", "write", "stream", "upload", "download", "fs"],
    "security": ["security", "encrypt", "hash", "cors", "csrf", "xss"],
    "UI-rendering": ["render", "component", "view", "template", "dom", "jsx", "tsx"],
    "config": ["config", "env", "settings", "options", "preference"],
    "logging": ["log", "logger", "debug", "trace", "monitor"],
    "testing": ["test", "spec", "mock", "assert", "expect", "jest", "mocha"],
    "concurrency": ["async", "await", "promise", "thread", "worker", "parallel", "concurrent"],
    "search": ["search", "find", "filter", "query", "index", "match"],
    "payments": ["payment", "stripe", "checkout", "billing", "invoice", "charge"],
    "notifications": ["notification", "email", "sms", "push", "alert", "webhook"],
}

INTENT_KEYWORDS: dict[str, list[str]] = {
    "bug": ["bug", "broken", "error", "fix", "crash", "fail", "wrong", "issue", "doesn't work", "not working"],
    "performance": ["slow", "performance", "optimize", "fast", "speed", "latency", "memory", "leak"],
    "feature": ["add", "create", "implement", "build", "new feature", "support"],
    "refactor": ["refactor", "clean", "restructure", "reorganize", "simplify"],
    "architecture": ["architecture", "design", "pattern", "structure", "organize"],
}


def _detect_concepts_keyword(query: str) -> list[str]:
    query_lower = query.lower()
    query_words = set(re.findall(r"\w+", query_lower))
    matched = []
    for concept, keywords in CONCEPT_KEYWORDS.items():
        if any(kw in query_words for kw in keywords):
            matched.append(concept)
    return matched


def _detect_intent_keyword(query: str) -> str:
    query_lower = query.lower()
    for intent, keywords in INTENT_KEYWORDS.items():
        if any(kw in query_lower for kw in keywords):
            return intent
    return "general"


async def decompose_query(query: str) -> QueryAnalysis:
    """
    Decompose a user query into sub-queries, concepts, and intent.
    Uses a fast path for simple queries to skip the LLM call.
    """
    word_count = len(query.split())
    detected_concepts = _detect_concepts_keyword(query)

    logger.info(
        f"[DECOMPOSE] Query received: {word_count} words, "
        f"threshold={SIMPLE_QUERY_WORD_THRESHOLD}, "
        f"keyword_concepts={detected_concepts}, model={QUERY_DECOMPOSE_MODEL}"
    )

    if word_count <= SIMPLE_QUERY_WORD_THRESHOLD and detected_concepts:
        intent = _detect_intent_keyword(query)
        logger.info(
            f"[DECOMPOSE] FAST PATH activated: {word_count} words <= threshold, "
            f"intent={intent}, concepts={detected_concepts} — skipping LLM call"
        )
        return QueryAnalysis(
            intent=intent,
            sub_queries=[query],
            concepts=detected_concepts[:4],
        )

    kwargs: dict = {
        "model": QUERY_DECOMPOSE_MODEL,
        "messages": [
            {"role": "system", "content": DECOMPOSE_SYSTEM_PROMPT},
            {"role": "user", "content": query[:5000]},
        ],
        "max_tokens": 200,
        "temperature": 0.1,
    }
    if OPENROUTER_API_KEY and "openrouter" in QUERY_DECOMPOSE_MODEL.lower():
        kwargs["api_key"] = OPENROUTER_API_KEY

    try:
        logger.info(
            f"[DECOMPOSE] LLM path: calling {QUERY_DECOMPOSE_MODEL} "
            f"(query_len={len(query)} chars)"
        )
        import time as _time
        t0 = _time.perf_counter()
        response = await asyncio.to_thread(litellm.completion, **kwargs)
        elapsed_ms = int((_time.perf_counter() - t0) * 1000)
        raw = (response.choices[0].message.content or "").strip()
        usage = response.usage
        tokens_in = usage.prompt_tokens if usage else 0
        tokens_out = usage.completion_tokens if usage else 0
        logger.info(
            f"[DECOMPOSE] LLM responded in {elapsed_ms}ms "
            f"({tokens_in} in / {tokens_out} out)"
        )

        cleaned = raw
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

        data = json.loads(cleaned)

        intent = data.get("intent", "general")
        if intent not in VALID_INTENTS:
            intent = "general"

        sub_queries = data.get("sub_queries", [])
        if not sub_queries or not isinstance(sub_queries, list):
            sub_queries = [query]
        sub_queries = [sq for sq in sub_queries if isinstance(sq, str) and sq.strip()][:4]
        if not sub_queries:
            sub_queries = [query]

        concepts = [c for c in data.get("concepts", []) if c in VALID_CONCEPTS][:4]
        if not concepts:
            concepts = detected_concepts[:4]

        logger.info(
            f"[DECOMPOSE] Result: intent={intent}, "
            f"sub_queries={sub_queries}, concepts={concepts}"
        )
        return QueryAnalysis(intent=intent, sub_queries=sub_queries, concepts=concepts)

    except Exception as e:
        logger.warning(f"Query decomposition failed ({e}), using original query")
        return QueryAnalysis(
            intent=_detect_intent_keyword(query),
            sub_queries=[query],
            concepts=detected_concepts[:4],
        )
