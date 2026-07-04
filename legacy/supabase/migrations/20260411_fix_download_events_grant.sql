-- Grant service_role access to download_events so the Edge Function
-- (which authenticates as service_role) can insert tracking rows.
GRANT ALL ON TABLE download_events TO service_role;
