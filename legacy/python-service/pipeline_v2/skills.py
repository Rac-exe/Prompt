"""
skills.py — Skill file loader and keyword-based selector.

Implements the Skill Selector (SF) logic from system_prompt_optimizer.md.
Loads .md skill files directly from the files/ directory.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple
from functools import lru_cache

# ── Skill files directory (relative to this file) ────────────────────────────
SKILLS_DIR = Path(__file__).parent.parent.parent / "files"

# ── Keyword map matching system_prompt_optimizer.md ──────────────────────────
SKILL_KEYWORDS: dict[str, list[str]] = {
    "technical": [
        "code", "python", "javascript", "java", "api", "function", "class",
        "database", "sql", "algorithm", "script", "debug", "system",
        "architecture", "framework", "library", "deployment", "server",
        "cloud", "aws", "docker", "testing", "unit test", "typescript",
        "react", "fastapi", "backend", "frontend",
    ],
    "creative": [
        "story", "blog", "article", "content", "creative", "write",
        "narrative", "character", "plot", "copy", "marketing", "brand",
        "social media", "post", "caption", "slogan", "campaign",
        "brainstorm", "idea", "poem", "fiction",
    ],
    "business": [
        "strategy", "business", "market", "revenue", "roi", "analysis",
        "plan", "growth", "sales", "metrics", "kpi", "competitive",
        "financial", "profit", "cost", "customer", "pricing", "valuation",
        "investment", "startup", "enterprise",
    ],
    "communication": [
        "email", "message", "memo", "letter", "presentation", "meeting",
        "report", "documentation", "communicate", "proposal", "announcement",
        "newsletter", "slack", "reply",
    ],
    "educational": [
        "tutorial", "explain", "teach", "learn", "guide", "course",
        "lesson", "training", "education", "beginner", "step by step",
        "how to", "introduction", "overview",
    ],
    "visual": [
        "image", "design", "visual", "graphic", "logo", "illustration",
        "picture", "art", "ui", "layout", "midjourney", "dall-e",
        "stable diffusion", "prompt for image",
    ],
    "automation": [
        "automate", "workflow", "script", "task", "process", "pipeline",
        "integration", "batch", "schedule", "cron", "bot", "zapier",
        "n8n", "trigger",
    ],
    "research": [
        "research", "analyze", "study", "investigate", "report", "findings",
        "data", "survey", "experiment", "literature", "compare", "evaluate",
        "assessment",
    ],
}


@lru_cache(maxsize=16)
def load_skill_file(skill_name: str) -> str:
    """Load and cache a skill file. Returns empty string if not found."""
    path = SKILLS_DIR / f"skill_{skill_name}.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def select_skills(user_input: str, max_skills: int = 2) -> List[str]:
    """
    Keyword-based skill selection — mirrors the SF logic in system_prompt_optimizer.md.
    Returns names of 1-2 most relevant skills.
    """
    text = user_input.lower()
    scores: dict[str, int] = {}

    for skill, keywords in SKILL_KEYWORDS.items():
        scores[skill] = sum(1 for kw in keywords if kw in text)

    # Sort by score descending, filter zeros
    ranked = [(skill, score) for skill, score in sorted(scores.items(), key=lambda x: x[1], reverse=True) if score > 0]

    selected = [skill for skill, _ in ranked[:max_skills]]
    return selected if selected else ["general"]


def load_selected_skills(user_input: str) -> Tuple[List[str], str]:
    """
    Select skills and load their file contents.
    Returns: (skill_names, concatenated_skill_content)
    """
    skill_names = select_skills(user_input)
    contents = []
    for name in skill_names:
        content = load_skill_file(name)
        if content:
            contents.append(content)
    return skill_names, "\n\n---\n\n".join(contents) if contents else ""


def list_available_skills() -> List[str]:
    """List all skill files available in the skills directory."""
    return [p.stem.replace("skill_", "") for p in SKILLS_DIR.glob("skill_*.md")]
