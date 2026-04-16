"""
Deterministic project-level summary generator.
Analyzes file paths, languages, imports, and framework patterns to produce
a compact tech-stack description (~200 tokens) stored per project.
No LLM calls — pure heuristic analysis.
"""

import logging
from typing import Optional
from app.db.queries import update_project_summary

logger = logging.getLogger("code-intel.project_summary")

FRAMEWORK_PATTERNS: dict[str, list[str]] = {
    "React": ["from 'react'", "from \"react\"", "import React", "useState", "useEffect"],
    "Next.js": ["next/", "pages/api/", "app/api/", "getServerSideProps", "getStaticProps"],
    "Vue.js": [".vue", "from 'vue'", "createApp"],
    "Svelte": [".svelte", "from 'svelte'"],
    "Angular": ["@angular/", "@Component", "@NgModule"],
    "Express": ["from 'express'", "require('express')", "app.get(", "app.post("],
    "FastAPI": ["from fastapi", "FastAPI(", "@app.get", "@app.post"],
    "Django": ["from django", "django.conf", "INSTALLED_APPS"],
    "Flask": ["from flask", "Flask(__name__"],
    "Prisma": ["@prisma/client", "prisma.schema"],
    "SQLAlchemy": ["from sqlalchemy", "declarative_base"],
    "Mongoose": ["from 'mongoose'", "require('mongoose')", "Schema("],
    "Redux": ["from 'redux'", "createStore", "createSlice", "useSelector", "useDispatch"],
    "Zustand": ["from 'zustand'", "create("],
    "TailwindCSS": ["tailwind", "tailwindcss"],
    "TypeORM": ["from 'typeorm'", "Entity(", "Repository"],
    "Supabase": ["@supabase/", "createClient", "supabase"],
    "Firebase": ["firebase/", "initializeApp"],
    "Stripe": ["from 'stripe'", "require('stripe')", "stripe."],
    "Jest": ["from 'jest'", "describe(", "it(", "expect("],
    "Pytest": ["import pytest", "def test_"],
}

FILE_PATTERN_SIGNALS: dict[str, list[str]] = {
    "REST API": ["routes/", "api/", "controllers/", "endpoints/"],
    "GraphQL": ["schema.graphql", "resolvers/", "typeDefs"],
    "WebSocket": ["socket", "ws/", "realtime"],
    "CLI tool": ["cli.py", "cli.ts", "bin/", "commands/"],
    "Monorepo": ["packages/", "apps/", "libs/"],
    "Microservices": ["services/", "gateway/"],
}

ENTRY_POINT_PATTERNS = [
    "index.ts", "index.js", "main.ts", "main.py", "app.py", "server.ts",
    "server.js", "index.tsx", "App.tsx", "App.jsx", "manage.py", "main.go",
    "lib.rs", "Main.java",
]


def generate_project_summary(
    project_id: str,
    language_map: dict[str, int],
    chunks: list[dict],
) -> Optional[str]:
    """
    Analyze indexed chunks to produce a compact project summary.
    Stores the summary in the DB and returns it.
    """
    if not chunks:
        return None

    all_file_paths = list({c.get("file_path", "") for c in chunks if c.get("file_path")})
    all_imports = []
    for c in chunks:
        imports = c.get("imports", [])
        if isinstance(imports, list):
            all_imports.extend(imports)
    all_code_bodies = [c.get("code_body", "") or "" for c in chunks]
    searchable_text = " ".join(all_imports) + " " + " ".join(all_code_bodies[:100])

    detected_frameworks = _detect_frameworks(searchable_text, all_file_paths)
    architecture_signals = _detect_architecture(all_file_paths)
    entry_points = _detect_entry_points(all_file_paths)
    lang_summary = _format_languages(language_map)

    logger.info(
        f"[project={project_id}] [PROJECT SUMMARY] Detection results: "
        f"languages={language_map}, frameworks={detected_frameworks}, "
        f"architecture={architecture_signals}, entry_points={entry_points[:5]}, "
        f"files={len(all_file_paths)}, symbols={len(chunks)}, "
        f"imports_scanned={len(all_imports)}"
    )

    parts = []
    if lang_summary:
        parts.append(lang_summary)
    if detected_frameworks:
        parts.append(f"Frameworks: {', '.join(detected_frameworks)}")
    if architecture_signals:
        parts.append(f"Architecture: {', '.join(architecture_signals)}")
    if entry_points:
        parts.append(f"Entry points: {', '.join(entry_points[:5])}")

    parts.append(f"{len(all_file_paths)} files, {len(chunks)} indexed symbols")

    summary = ". ".join(parts)
    tech_stack = {
        "languages": language_map,
        "frameworks": detected_frameworks,
        "architecture": architecture_signals,
        "entry_points": entry_points[:5],
    }

    try:
        update_project_summary(project_id, summary, tech_stack)
        logger.info(f"[project={project_id}] Project summary generated: {summary[:120]}...")
    except Exception as e:
        logger.warning(f"Failed to store project summary: {e}")

    return summary


def _detect_frameworks(text: str, file_paths: list[str]) -> list[str]:
    detected = []
    combined = text + " " + " ".join(file_paths)
    for framework, patterns in FRAMEWORK_PATTERNS.items():
        if any(p.lower() in combined.lower() for p in patterns):
            detected.append(framework)
    return detected[:8]


def _detect_architecture(file_paths: list[str]) -> list[str]:
    signals = []
    paths_joined = " ".join(file_paths).lower()
    for signal, patterns in FILE_PATTERN_SIGNALS.items():
        if any(p.lower() in paths_joined for p in patterns):
            signals.append(signal)
    return signals


def _detect_entry_points(file_paths: list[str]) -> list[str]:
    entry_points = []
    for fp in file_paths:
        basename = fp.rsplit("/", 1)[-1] if "/" in fp else fp
        if basename in ENTRY_POINT_PATTERNS:
            entry_points.append(fp)
    return entry_points


def _format_languages(language_map: dict[str, int]) -> str:
    if not language_map:
        return ""
    sorted_langs = sorted(language_map.items(), key=lambda x: x[1], reverse=True)
    primary = sorted_langs[0][0].title()
    if len(sorted_langs) > 1:
        others = [l.title() for l, _ in sorted_langs[1:4]]
        return f"{primary} (primary), {', '.join(others)}"
    return primary
