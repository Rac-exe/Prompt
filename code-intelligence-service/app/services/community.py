"""
Community report helpers — caching, retrieval, and formatting utilities.

Provides a thin caching layer over community data so that retrieval paths
don't re-fetch community reports on every search request.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.config import COMMUNITY_REPORT_CACHE_TTL
from app.services import cache as _cache

logger = logging.getLogger("code-intel.community")

# ── Cache helpers ─────────────────────────────────────────────────────────────

def get_cached_community_reports(project_id: str) -> Optional[list[dict]]:
    """Return cached community reports for a project, or None if stale/missing."""
    return _cache.get(f"communities:{project_id}", COMMUNITY_REPORT_CACHE_TTL)


def set_cached_community_reports(project_id: str, reports: list[dict]) -> None:
    """Cache community reports for a project."""
    _cache.set(f"communities:{project_id}", reports)


def invalidate_community_cache(project_id: str) -> None:
    """Bust community cache after a re-index."""
    _cache.invalidate(f"communities:{project_id}")


# ── Formatting helpers ───────────────────────────────────────────────────────

def format_community_context(reports: list[dict], max_reports: int = 2) -> str:
    """
    Format community reports into a compact string for LLM context.

    Used by DRIFT primer and ASK mode global search to give the LLM
    architectural context before asking it to generate an answer.
    """
    lines: list[str] = []
    for report in reports[:max_reports]:
        label = report.get("label") or "Unnamed cluster"
        summary = report.get("summary") or ""
        similarity = report.get("similarity", 0.0)
        lines.append(
            f"[{label} — {similarity:.0%} match]\n{summary}"
        )
    return "\n\n".join(lines)


def top_community_ids(reports: list[dict], n: int = 2) -> list[str]:
    """Extract the top-N community UUIDs from a match_community_reports result."""
    return [str(r["id"]) for r in reports[:n] if r.get("id")]
