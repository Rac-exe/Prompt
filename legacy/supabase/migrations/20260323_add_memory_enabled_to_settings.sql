-- ============================================================
-- Migration: Add memory_enabled to user_settings
-- Date: 2026-03-23
-- Description: Adds a boolean toggle for the memory system.
--   When true (default), the app auto-learns facts from usage.
--   When false, no automatic fact extraction occurs.
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN NOT NULL DEFAULT true;
