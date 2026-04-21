/**
 * Supabase Edge Function: process-deletions
 *
 * Processes GDPR Article 17 account deletion requests whose 30-day
 * grace period has elapsed. Designed to run on a daily cron schedule.
 *
 * For each mature pending request the function performs (in order):
 *   1. Cloudinary asset cleanup (delete by tag user_<userId>)
 *   2. Supabase Storage cleanup (recursive list+remove under <userId>/)
 *   3. auth.users row delete (CASCADE wipes all dependent public.* rows)
 *   4. deletion_requests row marked 'completed'
 *
 * Idempotent error handling: if step 1 or 2 fails the request stays
 * pending and the cron will retry it tomorrow. Step 3+4 only run after
 * 1 & 2 succeed — there's no half-deleted state.
 *
 * Authorization: requires SUPABASE_SERVICE_ROLE_KEY (server-side only).
 *
 * Required Edge Function secrets:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *   SENTRY_DSN                 (optional)
 *   ENVIRONMENT                (optional; defaults to 'production')
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as Sentry from 'https://esm.sh/@sentry/deno@8';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STORAGE_BUCKET = 'message-attachments';
const STORAGE_PAGE_SIZE = 1000;

const sentryDsn = Deno.env.get('SENTRY_DSN');
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 1.0,
    release: 'process-deletions@2.0.0',
    environment: Deno.env.get('ENVIRONMENT') ?? 'production',
  });
}

function logInfo(message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ severity: 'INFO', message, ...extra, timestamp: new Date().toISOString() }));
}

function captureError(err: unknown, context: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ severity: 'ERROR', message, ...context, timestamp: new Date().toISOString() }));
  if (sentryDsn) {
    Sentry.captureException(err, { extra: context });
  }
}

// ── Cloudinary ─────────────────────────────────────────────────────────────
// Delete every asset tagged user_<userId>. Idempotent: returns success even
// if no assets matched. Throws on auth/network errors so the request stays
// pending for retry.
async function cloudinaryDeleteByTag(userId: string): Promise<{ deleted: number }> {
  const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
  const apiKey    = Deno.env.get('CLOUDINARY_API_KEY');
  const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials not configured (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET)');
  }

  const tag = `user_${userId}`;
  const auth = btoa(`${apiKey}:${apiSecret}`);
  let totalDeleted = 0;

  // Cloudinary's "delete by tag" only handles up to 1000 resources per call.
  // For users with more assets we loop until none remain.
  for (let pass = 0; pass < 20; pass++) {
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/tags/${encodeURIComponent(tag)}`;
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Cloudinary delete failed (${resp.status}): ${body}`);
    }

    const json = (await resp.json()) as { deleted?: Record<string, string>; partial?: boolean };
    const deletedThisPass = Object.keys(json.deleted ?? {}).length;
    totalDeleted += deletedThisPass;
    if (deletedThisPass === 0 || !json.partial) break;
  }

  return { deleted: totalDeleted };
}

// ── Supabase Storage ───────────────────────────────────────────────────────
// Recursively list and remove every object under <userId>/ in message-attachments.
// Paths are user-scoped by convention (see 20260322_add_attachments_bucket.sql).
//
// IMPORTANT: We never advance `offset` past the first page — Storage `list()`
// is offset-based and removing files inside a paginated walk shifts every
// subsequent index, causing files to be skipped. Instead we always re-list at
// offset=0 after each delete batch and loop until the directory is empty.
// Subdirectories are pushed to a stack and processed with the same strategy.
async function storageDeleteUserTree(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ removed: number }> {
  let totalRemoved = 0;
  const stack: string[] = [userId];
  // Belt-and-braces: hard cap at 100k passes (≈100M files) to avoid runaway loops.
  const MAX_PASSES = 100_000;

  while (stack.length > 0) {
    const prefix = stack.pop()!;
    let safetyPasses = 0;

    while (safetyPasses++ < MAX_PASSES) {
      const { data, error } = await admin.storage
        .from(STORAGE_BUCKET)
        .list(prefix, { limit: STORAGE_PAGE_SIZE, offset: 0 });

      if (error) throw new Error(`Storage list ${prefix} failed: ${error.message}`);
      if (!data || data.length === 0) break;

      const filePaths: string[] = [];
      let foundFolder = false;
      for (const entry of data) {
        const childPath = `${prefix}/${entry.name}`;
        // Folders have a null `id`; files have a uuid.
        if (entry.id === null) {
          stack.push(childPath);
          foundFolder = true;
        } else {
          filePaths.push(childPath);
        }
      }

      if (filePaths.length > 0) {
        const { error: rmError } = await admin.storage.from(STORAGE_BUCKET).remove(filePaths);
        if (rmError) throw new Error(`Storage remove failed: ${rmError.message}`);
        totalRemoved += filePaths.length;
        // After removing files we re-list (offset stays 0) to catch any tail
        // beyond the previous page boundary. Continues until list returns 0.
        continue;
      }

      // No files in this listing — only subfolders. They've been pushed to
      // the stack; nothing more to do at this level.
      if (foundFolder) break;
      // Defensive: nothing actionable returned. Bail out of this prefix.
      break;
    }
  }

  return { removed: totalRemoved };
}

// ── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  return await Sentry.withScope(async (scope: Sentry.Scope) => {
    scope.setTag('function', 'process-deletions');

    // Auth: caller must present CRON_SECRET (set as a function secret) so that
    // an attacker who only learns the public function URL can't trigger deletions.
    // The pg_cron job stores this same value in vault.secrets and forwards it.
    const authHeader = req.headers.get('Authorization');
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!authHeader || !cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Prefer SB_SERVICE_ROLE_KEY (set as a function secret) over the auto-injected
    // SUPABASE_SERVICE_ROLE_KEY because some projects auto-inject a restricted
    // variant that can't bypass RLS / call auth.admin.* APIs.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey =
      Deno.env.get('SB_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: pending, error: fetchError } = await admin
      .from('deletion_requests')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_deletion_at', new Date().toISOString());

    if (fetchError) {
      captureError(fetchError, { op: 'fetch-pending-deletions' });
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!pending || pending.length === 0) {
      logInfo('No mature deletion requests');
      return new Response(JSON.stringify({ processed: 0, message: 'No mature requests' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    logInfo(`Processing ${pending.length} deletion request(s)`, { count: pending.length });

    let processed = 0;
    const errors: Array<{ userId: string; stage: string; error: string }> = [];

    for (const request of pending) {
      const userId = request.user_id as string;
      const requestId = request.id as string;

      try {
        // Stage 1: Cloudinary
        const cld = await cloudinaryDeleteByTag(userId);
        logInfo('Cloudinary cleanup ok', { userId, requestId, deleted: cld.deleted });

        // Stage 2: Storage
        const storage = await storageDeleteUserTree(admin, userId);
        logInfo('Storage cleanup ok', { userId, requestId, removed: storage.removed });

        // Stage 3: auth.users (CASCADE handles public.* rows)
        const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
        if (deleteError) throw new Error(`auth.deleteUser: ${deleteError.message}`);

        // Stage 4: mark completed
        const { error: updateError } = await admin
          .from('deletion_requests')
          .update({ status: 'completed', processed_at: new Date().toISOString() })
          .eq('id', requestId);

        if (updateError) {
          captureError(updateError, { op: 'mark-completed', userId, requestId });
        }

        logInfo('User fully deleted', {
          userId, requestId,
          cloudinary_deleted: cld.deleted,
          storage_removed: storage.removed,
        });
        processed++;
      } catch (err) {
        const stage = err instanceof Error && err.message.startsWith('Cloudinary') ? 'cloudinary'
          : err instanceof Error && err.message.startsWith('Storage') ? 'storage'
          : 'auth-or-meta';
        const message = err instanceof Error ? err.message : String(err);
        captureError(err, { op: 'process-request', stage, userId, requestId });
        errors.push({ userId, stage, error: message });
        // Leave row as 'pending' — cron will retry tomorrow.
      }
    }

    if (errors.length > 0) {
      console.error(JSON.stringify({
        severity: 'ERROR',
        message: `${errors.length} deletion(s) failed — will retry on next run`,
        errors,
        timestamp: new Date().toISOString(),
      }));
    }

    return new Response(
      JSON.stringify({
        processed,
        failed: errors.length,
        errors: errors.length ? errors : undefined,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  });
});
