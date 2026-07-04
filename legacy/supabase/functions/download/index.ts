/**
 * Supabase Edge Function: download
 *
 * Tracks installer download events and redirects to the .exe in Supabase Storage.
 * Runs on the edge so there is no cold-start delay -- no Render in the download path.
 *
 * URL: GET /functions/v1/download
 *
 * Flow:
 *  1. Extract version, user-agent, referrer, and hashed IP from the request.
 *  2. INSERT a row into download_events (non-blocking -- failure never blocks the redirect).
 *  3. 302 redirect to the public Storage .exe URL.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RELEASES_BASE_URL =
  Deno.env.get('RELEASES_BASE_URL') ??
  'https://tfetlkkdggdkbuycfoun.supabase.co/storage/v1/object/public/releases';

const APP_VERSION = Deno.env.get('APP_VERSION') ?? '1.0.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function sha256Prefix(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const ua = req.headers.get('user-agent') ?? '';
  const referrer = req.headers.get('referer') ?? '';
  const rawIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const ipHash = await sha256Prefix(rawIp);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  supabase
    .from('download_events')
    .insert({
      version: APP_VERSION,
      platform: 'windows',
      referrer: referrer ? referrer.slice(0, 500) : null,
      user_agent: ua ? ua.slice(0, 500) : null,
      ip_hash: ipHash,
    })
    .then(({ error }) => {
      if (error) console.error('[download] Failed to log event:', error.message);
    });

  const exeUrl = `${RELEASES_BASE_URL}/Prmpt%20Setup%20${APP_VERSION}.exe`;

  return new Response(null, {
    status: 302,
    headers: {
      ...CORS_HEADERS,
      Location: exeUrl,
    },
  });
});
