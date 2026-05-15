"""
Canonical concept/intent vocabulary for the code intelligence service.

This is the single source of truth for:
  - VALID_CONCEPTS: domain tags applied to indexed chunks AND used for query
    matching. The summarizer tags chunks with these; the query analyzer emits
    these; search.py boosts on overlap. If these three drift, chunks tagged
    with a concept the analyzer can't emit become unreachable via concept
    search.
  - VALID_INTENTS: the small closed set returned by query decomposition.
  - CONCEPT_KEYWORDS / INTENT_KEYWORDS: keyword hints used for the fast-path
    (no-LLM) detection.

Before this module, three separate files maintained their own copies and had
silently drifted (e.g. summarizer could emit "CLI" / "scheduling" but the
analyzer filtered them out, making such chunks unreachable).
"""

import logging

logger = logging.getLogger("code-intel.concepts")


VALID_CONCEPTS: list[str] = [
    "state-management",
    "routing",
    "auth",
    "data-fetching",
    "error-handling",
    "UI-rendering",
    "validation",
    "caching",
    "database",
    "API",
    "file-io",
    "config",
    "middleware",
    "testing",
    "logging",
    "security",
    "payments",
    "notifications",
    "scheduling",
    "serialization",
    "concurrency",
    "CLI",
    "build-tooling",
    "internationalization",
    "analytics",
    "search",
]

VALID_CONCEPTS_SET: frozenset[str] = frozenset(VALID_CONCEPTS)


VALID_INTENTS: frozenset[str] = frozenset({
    "bug", "architecture", "performance", "feature", "refactor", "general",
})


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
    "testing": ["test", "spec", "mock", "assert", "expect", "jest", "mocha", "pytest"],
    "concurrency": ["async", "await", "promise", "thread", "worker", "parallel", "concurrent"],
    "search": ["search", "find", "filter", "query", "index", "match"],
    "payments": ["payment", "stripe", "checkout", "billing", "invoice", "charge"],
    "notifications": ["notification", "email", "sms", "push", "alert", "webhook"],
    "scheduling": ["schedule", "cron", "job", "queue", "timer", "interval", "arq"],
    "serialization": ["serialize", "deserialize", "json", "yaml", "parse", "stringify", "encode", "decode"],
    "CLI": ["cli", "command", "argv", "flag", "console", "stdin", "stdout"],
    "build-tooling": ["build", "webpack", "vite", "rollup", "esbuild", "bundler", "compile", "tsc"],
    "internationalization": ["i18n", "locale", "translation", "intl", "language"],
    "analytics": ["analytics", "tracking", "pageview", "metric", "segment", "amplitude", "mixpanel"],
}


INTENT_KEYWORDS: dict[str, list[str]] = {
    "bug": ["bug", "broken", "error", "fix", "crash", "fail", "wrong", "issue", "doesn't work", "not working"],
    "performance": ["slow", "performance", "optimize", "fast", "speed", "latency", "memory", "leak"],
    "feature": ["add", "create", "implement", "build", "new feature", "support"],
    "refactor": ["refactor", "clean", "restructure", "reorganize", "simplify"],
    "architecture": ["architecture", "design", "pattern", "structure", "organize"],
}


def log_vocabulary_state() -> None:
    """Emit a one-line banner summarizing the canonical vocabulary.

    Called on service startup so it's immediately visible in the logs whether
    the unified vocabulary actually loaded.
    """
    kw_total = sum(len(v) for v in CONCEPT_KEYWORDS.values())
    missing_keywords = [c for c in VALID_CONCEPTS if c not in CONCEPT_KEYWORDS]
    logger.info(
        "[CONCEPTS] Canonical vocabulary loaded: concepts=%d, intents=%d, "
        "keyword_entries=%d, concepts_without_keywords=%s",
        len(VALID_CONCEPTS),
        len(VALID_INTENTS),
        kw_total,
        missing_keywords or "none",
    )
