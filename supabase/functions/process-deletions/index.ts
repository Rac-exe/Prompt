/**
 * Supabase Edge Function: process-deletions
 *
 * Processes GDPR Article 17 account deletion requests whose 30-day
 * grace period has elapsed. Designed to run on a daily cron schedule.
 *
 * For each mature pending request:
 *   1. Deletes the auth.users row via admin API (CASCADE wipes all dependent data)
 *   2. Marks the deletion_request as 'completed'
 *
 * Schedule with pg_cron or an external scheduler:
 *   SELECT cron.schedule('process-deletions', '0 2 * * *',
 *     $$SELECT net.http_post(url := '...')$$);
 *
 * Authorization: requires SUPABASE_SERVICE_ROLE_KEY (server-side only).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get('Authorization');
  const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authHeader || !expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: pending, error: fetchError } = await admin
    .from('deletion_requests')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_deletion_at', new Date().toISOString());

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ processed: 0, message: 'No mature requests' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let processed = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  for (const request of pending) {
    try {
      const { error: deleteError } = await admin.auth.admin.deleteUser(request.user_id);
      if (deleteError) {
        errors.push({ userId: request.user_id, error: deleteError.message });
        continue;
      }

      await admin
        .from('deletion_requests')
        .update({ status: 'completed', processed_at: new Date().toISOString() })
        .eq('id', request.id);

      processed++;
    } catch (err) {
      errors.push({ userId: request.user_id, error: String(err) });
    }
  }

  return new Response(
    JSON.stringify({ processed, failed: errors.length, errors: errors.length ? errors : undefined }),
    { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  );
});
