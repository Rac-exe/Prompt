-- ============================================================
-- Migration: Add observation_count to user_memory
-- Date: 2026-03-23
-- Description: Tracks how many times a fact has been independently
--   observed/confirmed by the LLM extraction. Higher observation
--   counts indicate stronger signals.
-- ============================================================

ALTER TABLE user_memory
  ADD COLUMN IF NOT EXISTS observation_count INT NOT NULL DEFAULT 1;
