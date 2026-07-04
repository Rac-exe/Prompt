-- ============================================================
-- Migration: Download Event Tracking
-- Date: 2026-04-09
-- Description: Tracks installer downloads for conversion analytics.
--   Unauthenticated inserts allowed (downloads happen before signup).
--   Only admins can read the data.
-- ============================================================

CREATE TABLE download_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'windows',
  referrer TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_download_events_created ON download_events(created_at DESC);
CREATE INDEX idx_download_events_version ON download_events(version);

ALTER TABLE download_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view downloads"
  ON download_events FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Anyone can insert downloads"
  ON download_events FOR INSERT
  WITH CHECK (true);

GRANT SELECT ON download_events TO authenticated;
GRANT INSERT ON download_events TO anon, authenticated;

COMMENT ON TABLE download_events IS 'Tracks installer downloads from the website for conversion analytics';
