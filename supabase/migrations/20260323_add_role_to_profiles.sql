-- ============================================================
-- Migration: Add role column to profiles
-- Date: 2026-03-23
-- Description: Adds a role column to the profiles table to
--   distinguish user types for rate limiting and permissions.
--   Roles: 'user' (default), 'dev', 'admin'
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'dev', 'admin'));

-- Index for fast role lookups (e.g. rate-limit checks)
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles (role);

COMMENT ON COLUMN profiles.role IS 'User role: user (default, rate-limited), dev (unlimited), admin (unlimited)';
