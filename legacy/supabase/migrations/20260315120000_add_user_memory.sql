-- ============================================================
-- Migration: User Memory System
-- Date: 2026-03-15
-- Description: Stores per-user memory facts across three types:
--   'user'       — explicit facts about the user (domain, name, role)
--   'behavioral' — inferred usage patterns (style, preferred model)
--   'context'    — recurring prompt themes
-- ============================================================

CREATE TABLE IF NOT EXISTS user_memory (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type  TEXT        NOT NULL CHECK (memory_type IN ('user', 'behavioral', 'context')),
  key          TEXT        NOT NULL,
  value        TEXT        NOT NULL,
  confidence   FLOAT       NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source       TEXT        NOT NULL DEFAULT 'inferred' CHECK (source IN ('inferred', 'explicit')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One value per (user, type, key) triple
  CONSTRAINT uq_user_memory UNIQUE (user_id, memory_type, key)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_memory_user_type
  ON user_memory (user_id, memory_type);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own memory"
  ON user_memory
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Auto-update trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_user_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_memory_updated_at
  BEFORE UPDATE ON user_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_user_memory_updated_at();

-- ── Permissions ───────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON user_memory TO authenticated;
