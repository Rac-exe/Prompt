-- Fix: upsert_daily_session_on_close was counting crash-recovered sessions
-- (duration_seconds IS NULL) as real sessions, inflating total_sessions.
-- Crash-recovered sessions still add 0 to total_seconds_online (already correct),
-- but now they no longer increment total_sessions at all.

CREATE OR REPLACE FUNCTION upsert_daily_session_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  session_date DATE := (NEW.started_at AT TIME ZONE 'UTC')::date;
  duration     INT  := COALESCE(NEW.duration_seconds, 0);
BEGIN
  -- Only fire when ended_at transitions from NULL to a value
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip crash-recovered sessions (duration_seconds IS NULL = unclean termination).
  -- They contribute 0 time and are not meaningful real sessions.
  IF NEW.duration_seconds IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.daily_usage_summaries (user_id, date, total_sessions, total_seconds_online)
  VALUES (NEW.user_id, session_date, 1, duration)
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_sessions       = daily_usage_summaries.total_sessions + 1,
    total_seconds_online = daily_usage_summaries.total_seconds_online + duration;

  RETURN NEW;
END;
$$;
