/**
 * Supabase Edge Function: share-view
 *
 * Serves shared individual prompts via opaque share tokens.
 * Collections are app-only — they return 404 here and must be opened
 * via the prmpt:// deep link in the Prmpt app.
 *
 * URL: GET /functions/v1/share-view?token=<token>
 *
 * Security model:
 *  1. Token format validated with regex before any DB interaction.
 *  2. DB lookup by share_token — the token IS the credential (192-bit entropy).
 *  3. Type routing via URL path prefix (c/p) prevents type confusion.
 *  4. DB fetched using service_role key — never sent to client.
 *  5. Content rendered as escaped plain text only — no innerHTML, no markdown eval.
 *  6. Security headers: X-Frame-Options, CSP, X-Content-Type-Options.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Token format ───────────────────────────────────────────────────────────────
// Matches randomBytes(24).toString('base64url') — 32 base64url chars
const VALID_TOKEN_RE = /^[A-Za-z0-9_-]{20,50}$/;

// ── HTML renderer ──────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPromptHtml(title: string, content: string, ownerName: string, createdAt: string): string {
  const safeTitle = escapeHtml(title);
  const safeContent = escapeHtml(content);
  const safeOwner = escapeHtml(ownerName);
  const safeDate = escapeHtml(new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} — Prmpt</title>
  <meta name="description" content="Shared prompt: ${safeTitle}" />
  <meta name="robots" content="noindex, nofollow" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0d0d0d;
      color: #e8e8e8;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }
    .card {
      width: 100%;
      max-width: 680px;
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      overflow: hidden;
    }
    .header {
      padding: 1.5rem;
      border-bottom: 1px solid #2a2a2a;
      background: #111;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #34d399;
      margin-bottom: 0.75rem;
    }
    .title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #f5f5f5;
      line-height: 1.3;
      margin-bottom: 0.5rem;
    }
    .meta { font-size: 0.75rem; color: #666; }
    .content { padding: 1.5rem; }
    .prompt-text {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.875rem;
      line-height: 1.75;
      color: #d4d4d4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .actions {
      padding: 1rem 1.5rem;
      border-top: 1px solid #2a2a2a;
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }
    .copy-btn {
      background: #34d399;
      color: #0d0d0d;
      border: none;
      border-radius: 8px;
      padding: 0.5rem 1rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .copy-btn:hover { opacity: 0.85; }
    .copy-btn.copied { background: #1a7a55; color: #34d399; }
    .app-link { font-size: 0.75rem; color: #555; text-decoration: none; }
    .app-link:hover { color: #34d399; }
    .footer { margin-top: 2rem; font-size: 0.7rem; color: #444; text-align: center; }
    .footer a { color: #555; text-decoration: none; }
    .footer a:hover { color: #34d399; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="badge">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
        </svg>
        Shared by ${safeOwner}
      </div>
      <div class="title">${safeTitle}</div>
      <div class="meta">Created ${safeDate}</div>
    </div>
    <div class="content">
      <pre class="prompt-text" id="prompt-content">${safeContent}</pre>
    </div>
    <div class="actions">
      <button class="copy-btn" id="copy-btn" onclick="copyPrompt()">Copy Prompt</button>
      <a class="app-link" href="https://tryprmpt.vercel.app">Get Prmpt App →</a>
    </div>
  </div>
  <div class="footer">
    Powered by <a href="https://tryprmpt.vercel.app">Prmpt</a> &middot; Read-only view
  </div>
  <script>
    function copyPrompt() {
      var content = document.getElementById('prompt-content').textContent;
      var btn = document.getElementById('copy-btn');
      navigator.clipboard.writeText(content).then(function() {
        btn.textContent = 'Copied!'; btn.classList.add('copied');
        setTimeout(function() { btn.textContent = 'Copy Prompt'; btn.classList.remove('copied'); }, 2000);
      }).catch(function() {
        var ta = document.createElement('textarea');
        ta.value = content; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = 'Copied!'; btn.classList.add('copied');
        setTimeout(function() { btn.textContent = 'Copy Prompt'; btn.classList.remove('copied'); }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

// ── Response helpers ───────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function notFound(message = 'Not found'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';

  // 1. Format validation before touching DB
  if (!VALID_TOKEN_RE.test(token)) {
    return notFound('Invalid token format');
  }

  // 2. Fetch prompt using service_role key (DB lookup IS the verification)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: prompt, error: promptError } = await supabase
    .from('saved_prompts')
    .select('id, title, content, share_token, user_id, created_at')
    .eq('share_token', token)
    .single();

  if (promptError || !prompt) {
    return notFound('Shared prompt not found or link is invalid');
  }

  // 3. Fetch owner name
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', prompt.user_id)
    .single();

  const ownerName: string = profile?.name ?? 'Unknown User';

  // 4. Return JSON or HTML based on Accept header
  const acceptsJson = (req.headers.get('accept') ?? '').includes('application/json');

  if (acceptsJson) {
    return new Response(
      JSON.stringify({
        id: prompt.id,
        title: prompt.title,
        content: prompt.content,
        owner_name: ownerName,
        created_at: prompt.created_at,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  const html = renderPromptHtml(prompt.title, prompt.content, ownerName, prompt.created_at);
  return new Response(html, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    },
  });
});
