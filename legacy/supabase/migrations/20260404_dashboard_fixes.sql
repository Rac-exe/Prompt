-- ============================================================
-- Migration: Dashboard fixes
-- Date: 2026-04-04
-- Description: Adds admin-read-all policy on profiles so the
--   dashboard can list all users. Adds a cleanup function for
--   zombie sessions (app crashed without calling endSession).
-- ============================================================

-- ── Allow admins to read all profiles ──────────────────────────────────────────
-- Existing policy only allows users to read their own profile (auth.uid() = id).
-- Admins need to read all profiles for the analytics dashboard user list.
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (public.is_admin());

-- ── Zombie session cleanup ─────────────────────────────────────────────────────
-- If the Electron app crashes or the user kills the process, endSession() never
-- fires and the session stays open forever (ended_at IS NULL). This function
-- closes any session that has been open for more than the given threshold.
CREATE OR REPLACE FUNCTION public.close_stale_sessions(threshold_hours INT DEFAULT 24)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  closed_count INT;
BEGIN
  UPDATE public.app_sessions
  SET
    ended_at = now(),
    duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int
  WHERE ended_at IS NULL
    AND started_at < now() - (threshold_hours || ' hours')::interval;

  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_stale_sessions(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_stale_sessions(INT) TO authenticated;

COMMENT ON FUNCTION public.close_stale_sessions(INT) IS
  'Closes zombie app_sessions older than threshold_hours (default 24). Returns count of sessions closed.';
