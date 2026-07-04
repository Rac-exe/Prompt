-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Cron IO Cleanup
--
-- Context: The project hit its Disk IO Budget limit. pg_stat_statements audit
-- revealed cron.job_run_details had 12,591 rows (41 days of logs) being full-
-- table-scanned every 7 minutes by pg_cron's internal UPDATE ... WHERE status
-- IN (...) — 304 disk blocks per scan with 0.3% cache hit.
--
-- Two keepalive jobs (render + code-intel) run every 7 min = 412 log rows/day.
-- pg_cron has no option to disable logging, so we:
--   1. Purge old history (keep last 2 days)
--   2. Replace keepalives with self-cleaning versions
--   3. Reindex bloated tables (messages had 17 MB indexes on 744 kB data)
--
-- See docs/SUPABASE_IO_AUDIT.md for the full analysis.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Purge old cron history ──────────────────────────────────────────────
DELETE FROM cron.job_run_details
WHERE end_time < NOW() - INTERVAL '2 days';


-- ── 2. Replace keepalives with self-cleaning versions ──────────────────────
-- Only one job carries the cleanup DELETE — running it in both would be
-- redundant since it clears rows from all jobs.

SELECT cron.unschedule('keep-render-alive');
SELECT cron.unschedule('keep-code-intel-alive');

-- Python backend keepalive + cron history cleanup
SELECT cron.schedule(
  'keep-render-alive',
  '*/7 * * * *',
  $$
  SELECT net.http_get(url := 'https://prompt-rsxh.onrender.com/health');
  DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '2 days';
  $$
);

-- Code-intel service keepalive
SELECT cron.schedule(
  'keep-code-intel-alive',
  '*/7 * * * *',
  $$
  SELECT net.http_get(url := 'https://prompt-gdx1.onrender.com/health');
  $$
);


-- ── 3. Reclaim index bloat ─────────────────────────────────────────────────
-- messages: 17 MB indexes on 744 kB of data (bloat from truncated rows)
-- code_chunks: 152 kB of empty index structures after truncate
-- prompt_optimizations: 2 MB indexes on 1 MB data
REINDEX TABLE public.messages;
REINDEX TABLE public.code_chunks;
REINDEX TABLE public.prompt_optimizations;
