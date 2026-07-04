-- ============================================================
-- Migration: Usage Analytics
-- Date: 2026-04-04
-- Description: Adds app_sessions, usage_events, and pre-aggregated
--   daily/hourly summary tables for the admin analytics dashboard.
--   Includes RLS policies (users write own, admins read all),
--   Postgres triggers for automatic summary aggregation, and
--   composite indexes for fast time-range queries.
-- ============================================================

-- ── Helper: admin role check ─────────────────────────────────────────────────
-- SECURITY DEFINER so it can read profiles.role without triggering RLS
-- recursion when used inside RLS policies on other tables.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;

-- ── app_sessions ─────────────────────────────────────────────────────────────
CREATE TABLE app_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  app_version TEXT,
  platform TEXT NOT NULL DEFAULT 'windows'
);

CREATE INDEX idx_app_sessions_user_started
  ON app_sessions (user_id, started_at DESC);

ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own sessions"
  ON app_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users and admins can view sessions"
  ON app_sessions FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can close own sessions"
  ON app_sessions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── usage_events ─────────────────────────────────────────────────────────────
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('ai_response', 'optimization', 'overlay_optimization', 'overlay_open')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_user_created
  ON usage_events (user_id, created_at DESC);

CREATE INDEX idx_usage_events_type
  ON usage_events (event_type);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own events"
  ON usage_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users and admins can view events"
  ON usage_events FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- No UPDATE/DELETE — append-only, tamper-resistant

-- ── daily_usage_summaries ────────────────────────────────────────────────────
CREATE TABLE daily_usage_summaries (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_messages INT NOT NULL DEFAULT 0,
  total_optimizations INT NOT NULL DEFAULT 0,
  total_overlay_triggers INT NOT NULL DEFAULT 0,
  total_sessions INT NOT NULL DEFAULT 0,
  total_seconds_online INT NOT NULL DEFAULT 0,
  peak_hour SMALLINT,
  PRIMARY KEY (user_id, date)
);

CREATE INDEX idx_daily_summaries_date
  ON daily_usage_summaries (date DESC);

ALTER TABLE daily_usage_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users and admins can view daily summaries"
  ON daily_usage_summaries FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "System can upsert daily summaries"
  ON daily_usage_summaries FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can update daily summaries"
  ON daily_usage_summaries FOR UPDATE
  USING (user_id = auth.uid());

-- ── hourly_usage_summaries ───────────────────────────────────────────────────
CREATE TABLE hourly_usage_summaries (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hour SMALLINT NOT NULL CHECK (hour >= 0 AND hour <= 23),
  message_count INT NOT NULL DEFAULT 0,
  optimization_count INT NOT NULL DEFAULT 0,
  overlay_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, hour)
);

ALTER TABLE hourly_usage_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users and admins can view hourly summaries"
  ON hourly_usage_summaries FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "System can upsert hourly summaries"
  ON hourly_usage_summaries FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can update hourly summaries"
  ON hourly_usage_summaries FOR UPDATE
  USING (user_id = auth.uid());

-- ── Trigger: upsert daily summary on usage_events INSERT ─────────────────────
CREATE OR REPLACE FUNCTION upsert_daily_summary_on_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_date DATE := (NEW.created_at AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO public.daily_usage_summaries (user_id, date, total_messages, total_optimizations, total_overlay_triggers)
  VALUES (
    NEW.user_id,
    event_date,
    CASE WHEN NEW.event_type = 'ai_response' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type IN ('optimization', 'overlay_optimization') THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'overlay_open' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_messages = daily_usage_summaries.total_messages
      + CASE WHEN NEW.event_type = 'ai_response' THEN 1 ELSE 0 END,
    total_optimizations = daily_usage_summaries.total_optimizations
      + CASE WHEN NEW.event_type IN ('optimization', 'overlay_optimization') THEN 1 ELSE 0 END,
    total_overlay_triggers = daily_usage_summaries.total_overlay_triggers
      + CASE WHEN NEW.event_type = 'overlay_open' THEN 1 ELSE 0 END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_upsert_daily_summary
  AFTER INSERT ON usage_events
  FOR EACH ROW
  EXECUTE FUNCTION upsert_daily_summary_on_event();

-- ── Trigger: upsert hourly summary on usage_events INSERT ────────────────────
CREATE OR REPLACE FUNCTION upsert_hourly_summary_on_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_date DATE := (NEW.created_at AT TIME ZONE 'UTC')::date;
  event_hour SMALLINT := EXTRACT(HOUR FROM (NEW.created_at AT TIME ZONE 'UTC'))::smallint;
BEGIN
  INSERT INTO public.hourly_usage_summaries (user_id, date, hour, message_count, optimization_count, overlay_count)
  VALUES (
    NEW.user_id,
    event_date,
    event_hour,
    CASE WHEN NEW.event_type = 'ai_response' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type IN ('optimization', 'overlay_optimization') THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'overlay_open' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, date, hour) DO UPDATE SET
    message_count = hourly_usage_summaries.message_count
      + CASE WHEN NEW.event_type = 'ai_response' THEN 1 ELSE 0 END,
    optimization_count = hourly_usage_summaries.optimization_count
      + CASE WHEN NEW.event_type IN ('optimization', 'overlay_optimization') THEN 1 ELSE 0 END,
    overlay_count = hourly_usage_summaries.overlay_count
      + CASE WHEN NEW.event_type = 'overlay_open' THEN 1 ELSE 0 END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_upsert_hourly_summary
  AFTER INSERT ON usage_events
  FOR EACH ROW
  EXECUTE FUNCTION upsert_hourly_summary_on_event();

-- ── Trigger: update daily session stats when a session ends ──────────────────
CREATE OR REPLACE FUNCTION upsert_daily_session_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  session_date DATE := (NEW.started_at AT TIME ZONE 'UTC')::date;
  duration INT := COALESCE(NEW.duration_seconds, 0);
BEGIN
  -- Only fire when ended_at transitions from NULL to a value
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.daily_usage_summaries (user_id, date, total_sessions, total_seconds_online)
  VALUES (NEW.user_id, session_date, 1, duration)
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_sessions = daily_usage_summaries.total_sessions + 1,
    total_seconds_online = daily_usage_summaries.total_seconds_online + duration;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_upsert_daily_session
  AFTER UPDATE ON app_sessions
  FOR EACH ROW
  EXECUTE FUNCTION upsert_daily_session_on_close();

-- ── Grants ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON app_sessions TO authenticated;
GRANT SELECT, INSERT ON usage_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON daily_usage_summaries TO authenticated;
GRANT SELECT, INSERT, UPDATE ON hourly_usage_summaries TO authenticated;

-- ── Comments ─────────────────────────────────────────────────────────────────
COMMENT ON TABLE app_sessions IS 'Tracks when the Electron app is open per user (start/end/duration)';
COMMENT ON TABLE usage_events IS 'Append-only log of discrete user actions (AI responses, optimizations, overlay opens)';
COMMENT ON TABLE daily_usage_summaries IS 'Pre-aggregated daily totals per user, maintained by triggers';
COMMENT ON TABLE hourly_usage_summaries IS 'Pre-aggregated hourly totals per user, maintained by triggers';
COMMENT ON FUNCTION public.is_admin() IS 'SECURITY DEFINER helper: returns true if the calling user has admin role in profiles';
