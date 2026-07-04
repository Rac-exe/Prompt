-- Enable pg_net for outbound HTTP requests
create extension if not exists pg_net schema extensions;

-- Enable pg_cron for scheduled jobs
create extension if not exists pg_cron;

-- Ping Render /health every 7 minutes to prevent free-tier cold starts
select cron.schedule(
  'keep-render-alive',
  '*/7 * * * *',
  $$
  select net.http_get(
    url := 'https://prompt-rsxh.onrender.com/health'
  );
  $$
);
