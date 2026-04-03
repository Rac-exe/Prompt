/**
 * keepalive.js — Render free-tier wake-up pinger
 *
 * Pings the Python backend /health endpoint every 10 minutes so Render's
 * free instance never hits the 15-minute inactivity threshold and sleeps.
 *
 * Run once:      node keepalive.js
 * Run on startup: add to Windows Task Scheduler (see README or instructions below)
 */

const https = require('https');
const http = require('http');

// ── Config ────────────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.PYTHON_SERVICE_URL || 'https://prompt-rsxh.onrender.com';
const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (Render sleeps after 15m)
const HEALTH_PATH = '/health';
// ─────────────────────────────────────────────────────────────────────────────

function ping() {
  const url = new URL(HEALTH_PATH, BACKEND_URL);
  const transport = url.protocol === 'https:' ? https : http;

  const req = transport.get(url.toString(), { timeout: 10_000 }, (res) => {
    const ts = new Date().toLocaleTimeString();
    if (res.statusCode === 200) {
      console.log(`[${ts}] ✅ Backend alive — ${res.statusCode}`);
    } else {
      console.warn(`[${ts}] ⚠️  Backend returned ${res.statusCode}`);
    }
    res.resume(); // drain response body
  });

  req.on('error', (err) => {
    const ts = new Date().toLocaleTimeString();
    console.error(`[${ts}] ❌ Ping failed: ${err.message}`);
  });

  req.on('timeout', () => {
    const ts = new Date().toLocaleTimeString();
    console.error(`[${ts}] ❌ Ping timed out`);
    req.destroy();
  });
}

// Ping immediately on start, then on interval
ping();
setInterval(ping, PING_INTERVAL_MS);

console.log(`Prmpt keepalive started — pinging ${BACKEND_URL}${HEALTH_PATH} every ${PING_INTERVAL_MS / 60_000} minutes`);
console.log('Press Ctrl+C to stop.\n');
