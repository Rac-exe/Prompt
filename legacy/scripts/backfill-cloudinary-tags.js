#!/usr/bin/env node
/**
 * One-time backfill: tag every existing Cloudinary asset with `user_<userId>`
 * and populate `profiles.avatar_public_id` so the account-deletion cron can
 * wipe assets uploaded BEFORE the tagging migration shipped.
 *
 * What it does, per user:
 *   1. Reads `profiles.avatar_url`. If unset or already tagged, skips.
 *      Otherwise: parses the public_id from the Cloudinary URL, calls the
 *      Cloudinary "add tag" admin API, and writes `avatar_public_id` back.
 *   2. Pages through all `messages` rows authored by the user, extracts
 *      `metadata.attachedFiles[].cloudinaryUrl`, derives public_id, and
 *      adds the user_<id> tag in batches.
 *
 * Run with:
 *   node scripts/backfill-cloudinary-tags.js
 *
 * Env vars (loaded from .env automatically if present):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VITE_CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Idempotent: safe to re-run. Failed asset tags are logged and skipped.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Tiny .env loader (no dotenv dependency required) ──────────────────────
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLOUD_NAME   = process.env.VITE_CLOUDINARY_CLOUD_NAME;
const API_KEY      = process.env.CLOUDINARY_API_KEY;
const API_SECRET   = process.env.CLOUDINARY_API_SECRET;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}
if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.error('Missing Cloudinary credentials (VITE_CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).');
  process.exit(1);
}

const CLOUDINARY_AUTH = 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract a Cloudinary public_id from a secure_url.
 *
 * Examples:
 *   https://res.cloudinary.com/demo/image/upload/v1234/folder/abc.jpg
 *     → folder/abc
 *   https://res.cloudinary.com/demo/image/upload/users/u1/file.png
 *     → users/u1/file
 */
function extractPublicId(cloudinaryUrl) {
  if (typeof cloudinaryUrl !== 'string') return null;
  const m = cloudinaryUrl.match(
    /res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/
  );
  if (!m) return null;
  // Strip trailing `?…` query strings
  return m[1].split('?')[0];
}

async function supabaseFetch(pathAndQuery, init = {}) {
  const url = `${SUPABASE_URL}/rest/v1${pathAndQuery}`;
  const headers = {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  const resp = await fetch(url, { ...init, headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Supabase ${resp.status}: ${body}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

/**
 * Cloudinary "add tag to multiple resources" admin API.
 * https://cloudinary.com/documentation/admin_api#updating_tags
 */
async function cloudinaryAddTag(publicIds, tag) {
  if (publicIds.length === 0) return { added: 0 };

  const params = new URLSearchParams();
  params.append('command', 'add');
  params.append('tag', tag);
  params.append('type', 'upload');
  for (const id of publicIds) params.append('public_ids[]', id);

  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/tags`,
    { method: 'POST', headers: { Authorization: CLOUDINARY_AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Cloudinary ${resp.status}: ${body}`);
  }
  const json = await resp.json();
  return { added: (json.public_ids || []).length };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function backfillProfiles() {
  console.log('\n── Backfilling profiles ──');
  const profiles = await supabaseFetch(
    '/profiles?select=id,avatar_url,avatar_public_id'
  );
  let updated = 0, skipped = 0, failed = 0;

  for (const p of profiles) {
    if (!p.avatar_url) { skipped++; continue; }
    if (p.avatar_public_id) { skipped++; continue; }

    const publicId = extractPublicId(p.avatar_url);
    if (!publicId) {
      console.warn(`  ✗ user=${p.id} could not parse public_id from ${p.avatar_url}`);
      failed++;
      continue;
    }

    try {
      await cloudinaryAddTag([publicId], `user_${p.id}`);
      await supabaseFetch(
        `/profiles?id=eq.${encodeURIComponent(p.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ avatar_public_id: publicId }),
        },
      );
      updated++;
      process.stdout.write(`  ✓ user=${p.id} avatar tagged\r`);
    } catch (err) {
      console.warn(`  ✗ user=${p.id} ${err.message}`);
      failed++;
    }
  }

  console.log(`\nProfiles: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

async function backfillMessages() {
  console.log('\n── Backfilling message attachments ──');

  // Per-user batch tagging — Cloudinary's "add tag" caps at 1000 public_ids.
  const batchByUser = new Map(); // userId → Set<publicId>
  let processedRows = 0;
  let pageSize = 500;
  let from = 0;

  while (true) {
    const rows = await supabaseFetch(
      `/messages?select=user_id,metadata&order=id&limit=${pageSize}&offset=${from}`
    );
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const files = row?.metadata?.attachedFiles;
      if (!Array.isArray(files)) continue;
      for (const f of files) {
        const url = f?.cloudinaryUrl;
        if (!url) continue;
        const publicId = extractPublicId(url);
        if (!publicId) continue;
        if (!batchByUser.has(row.user_id)) batchByUser.set(row.user_id, new Set());
        batchByUser.get(row.user_id).add(publicId);
      }
    }
    processedRows += rows.length;
    process.stdout.write(`  scanned ${processedRows} messages\r`);

    if (rows.length < pageSize) break;
    from += pageSize;
  }
  console.log(`\nFound ${batchByUser.size} user(s) with attachments to tag`);

  let totalTagged = 0;
  let userFailures = 0;
  for (const [userId, idSet] of batchByUser.entries()) {
    const ids = [...idSet];
    const tag = `user_${userId}`;
    try {
      // Cloudinary caps at 1000 ids per call.
      for (let i = 0; i < ids.length; i += 900) {
        const chunk = ids.slice(i, i + 900);
        const { added } = await cloudinaryAddTag(chunk, tag);
        totalTagged += added;
      }
      process.stdout.write(`  ✓ user=${userId} tagged ${ids.length} asset(s)\r`);
    } catch (err) {
      console.warn(`  ✗ user=${userId} ${err.message}`);
      userFailures++;
    }
  }
  console.log(`\nMessages: ${totalTagged} asset tags added, ${userFailures} user(s) failed`);
}

(async function main() {
  console.log(`Cloudinary backfill — cloud=${CLOUD_NAME}`);
  console.log(`Supabase URL: ${SUPABASE_URL}\n`);
  try {
    await backfillProfiles();
    await backfillMessages();
    console.log('\n✓ Backfill complete.');
  } catch (err) {
    console.error('\n✗ Backfill failed:', err);
    process.exit(1);
  }
})();
