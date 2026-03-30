"""
Centralized model + API-key configuration for the pipeline.

Every module imports from here instead of scattering os.environ.get() calls.
To change a model, update .env — no code edits needed.
"""

import os

# ── LLM models ────────────────────────────────────────────────────────────────
OPTIMIZER_MODEL  = os.environ.get("OPTIMIZER_MODEL",  "openrouter/openai/gpt-4o-mini")
SUMMARIZER_MODEL = os.environ.get("SUMMARIZER_MODEL", "openrouter/openai/gpt-4o-mini")
TITLE_MODEL      = os.environ.get("TITLE_MODEL",      SUMMARIZER_MODEL)
MEMORY_MODEL     = os.environ.get("MEMORY_MODEL",     SUMMARIZER_MODEL)

# ── API keys ──────────────────────────────────────────────────────────────────
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# ── Auth ───────────────────────────────────────────────────────────────────────
# Supabase JWT secret — from Supabase dashboard → Project Settings → API → JWT Secret.
# When set, every protected endpoint verifies the caller's Bearer token.
# If unset in local dev, auth is skipped with a warning.
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
