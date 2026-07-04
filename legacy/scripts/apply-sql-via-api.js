#!/usr/bin/env node
'use strict';

/**
 * Apply a SQL file to a Supabase project using the Management API.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-sql-via-api.js <project-ref> <sql-file>
 *
 * Designed to be a one-shot tool when the project's CLI migration history is out
 * of sync with the actual schema and a normal `supabase db push` would replay
 * already-applied migrations.
 */

const fs = require('fs');

async function main() {
  const [, , ref, sqlPath] = process.argv;
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  if (!ref || !sqlPath) {
    console.error('Usage: node scripts/apply-sql-via-api.js <project-ref> <sql-file>');
    process.exit(2);
  }
  if (!token) {
    console.error('SUPABASE_ACCESS_TOKEN env var is required');
    process.exit(2);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const url = `https://api.supabase.com/v1/projects/${ref}/database/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    console.error(text);
    process.exit(1);
  }

  console.log('OK');
  if (text && text !== '[]') console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
