# Security & Production-Readiness Audit Report

**Application:** Prmpt (Prompt Optimizer Desktop App)  
**Audit Date:** 2026-03-28  
**Auditor Role:** Senior Backend Security Engineer  
**Scope:** Full codebase — Python backend, Electron main process, React frontend, Supabase schema, native Rust modules  
**Standard:** OWASP Top 10 (2021), Electron Security Checklist, CWE/SANS Top 25, NIST 800-53 controls

---

## Executive Summary

The codebase demonstrates **above-average security awareness** for a desktop application at its maturity stage. Key strengths include proper Electron sandboxing (`nodeIntegration: false`, `contextIsolation: true`), JWT-authenticated API endpoints, Row-Level Security (RLS) on all database tables, PII scrubbing in error telemetry, and defense-in-depth file validation. However, **16 findings** require attention before production deployment under high-traffic/multi-user conditions, including 2 Critical, 4 High, 6 Medium, and 4 Low severity items.

---

## Table of Contents

1. [Security Analysis](#1-security-analysis)
2. [Scalability Analysis](#2-scalability-analysis)
3. [Rate Limiting & API Protection](#3-rate-limiting--api-protection)
4. [Code Quality & Consistency](#4-code-quality--consistency)
5. [Production Readiness](#5-production-readiness)
6. [Native Module (Rust) Security](#6-native-module-rust-security)
7. [Dependency Review](#7-dependency-review)
8. [Summary Matrix](#8-summary-matrix)
9. [Prioritized Remediation Roadmap](#9-prioritized-remediation-roadmap)

---

## 1. Security Analysis

### SEC-01: Authentication Bypass in Development Mode
| Attribute | Value |
|---|---|
| **Severity** | **CRITICAL** |
| **Component** | `python-service/app/auth.py` |
| **OWASP** | A07:2021 – Identification and Authentication Failures |
| **CWE** | CWE-287: Improper Authentication |

**Finding:**  
When `SUPABASE_JWT_SECRET` is not set, the entire authentication layer is disabled — all endpoints pass through with a stub payload `{"sub": "dev-user", "role": "authenticated"}`. The flag `_AUTH_ENABLED` is set at module load time and cannot be toggled at runtime.

```python
# auth.py lines 27-33
_AUTH_ENABLED = bool(SUPABASE_JWT_SECRET)
if not _AUTH_ENABLED:
    logger.warning("[Auth] SUPABASE_JWT_SECRET is not set — endpoint authentication is DISABLED.")
```

**Risk:** If deployed to production without the environment variable, the entire API is unauthenticated. There is no fail-closed behavior — the system **fails open**.

**Current Status:** Warning logged but not enforced.

**Recommendation:**
1. Fail closed in production: if `APP_ENV == "production"` and `SUPABASE_JWT_SECRET` is unset, refuse to start the server (`sys.exit(1)`).
2. Add a startup health check that verifies the JWT secret is configured before accepting traffic.

---

### SEC-02: CORS Wildcard in Production
| Attribute | Value |
|---|---|
| **Severity** | **HIGH** |
| **Component** | `python-service/app/main.py` lines 176-185 |
| **OWASP** | A05:2021 – Security Misconfiguration |
| **CWE** | CWE-942: Overly Permissive Cross-domain Whitelist |

**Finding:**  
CORS is configured with a default of `"*"` (all origins) when `ALLOWED_ORIGINS` is not set. Combined with `allow_credentials=True`, this creates a dangerous configuration — browsers may enforce some protections, but misconfigured proxies or non-browser clients bypass CORS entirely.

```python
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "*")
_allowed_origins = [o.strip() for o in _raw_origins.split(",")] if _raw_origins != "*" else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Current Status:** Defaults to wildcard; requires env var to restrict.

**Recommendation:**
1. Default to an empty list or `["http://127.0.0.1"]` when `ALLOWED_ORIGINS` is unset.
2. Never combine `allow_origins=["*"]` with `allow_credentials=True` — the CORS spec explicitly forbids this combination.
3. Restrict `allow_methods` and `allow_headers` to the specific methods/headers your API uses.

---

### SEC-03: WebSocket Auth Token in Query Parameters
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `python-service/app/auth.py` line 83, `electron/main/api/python-client.ts` |
| **OWASP** | A07:2021 – Identification and Authentication Failures |
| **CWE** | CWE-598: Information Exposure Through Query Strings |

**Finding:**  
WebSocket authentication passes JWT tokens as query parameters (`?token=<access_token>`). Query parameters are logged by proxies, load balancers, and web servers, potentially exposing credentials in access logs.

```python
token = websocket.query_params.get("token", "")
```

**Current Status:** Implemented as the primary WebSocket auth mechanism.

**Recommendation:**
1. Where possible, send the token in the first WebSocket message after connection (a "handshake" message) rather than in the URL.
2. If query params must be used (e.g., browser WebSocket API limitation), ensure all intermediate proxies strip or redact `token` parameters from logs.
3. Use short-lived tokens (< 5 minutes) specifically for WebSocket connection establishment.

---

### SEC-04: Deep Link Arbitrary JavaScript Execution
| Attribute | Value |
|---|---|
| **Severity** | **HIGH** |
| **Component** | `electron/main/index-new.ts` lines 489-510 |
| **OWASP** | A03:2021 – Injection |
| **CWE** | CWE-79: Improper Neutralization of Input During Web Page Generation |

**Finding:**  
The deep link handler extracts a `token` from the URL path and injects it directly into `executeJavaScript()` without sanitization:

```typescript
win.webContents.executeJavaScript(
  `window.location.hash = '/share/${token}';`
).catch(() => {});
```

A crafted deep link such as `promptweaver://share/';alert(1);//` would inject arbitrary JavaScript into the renderer context.

**Current Status:** No input sanitization on the `token` variable before JavaScript interpolation.

**Recommendation:**
1. Validate the token against a strict allowlist pattern (e.g., alphanumeric only: `/^[a-zA-Z0-9_-]+$/`).
2. Use `win.webContents.send('navigate-to-share', token)` via IPC instead of `executeJavaScript()` to avoid code injection entirely.

---

### SEC-05: Access Token Stored in Plaintext Memory Object
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `electron/main/utils/auth-state.ts` |
| **OWASP** | A02:2021 – Cryptographic Failures |
| **CWE** | CWE-312: Cleartext Storage of Sensitive Information |

**Finding:**  
The Supabase access token is stored in a plain JavaScript object (`authState.currentAccessToken`). This is accessible to any code in the main process and persists for the application lifetime. It is also stored in plaintext JSON on disk via `electron-storage-adapter.ts` → `session.json`.

```typescript
export const authState = {
    isAuthenticated: false,
    currentUserId: null as string | null,
    currentUserEmail: null as string | null,
    currentAccessToken: null as string | null,
};
```

**Current Status:** No encryption at rest or in-memory protections.

**Recommendation:**
1. Use Electron's `safeStorage` API to encrypt session data on disk.
2. Consider using `keytar` or the OS credential store for token persistence.
3. Clear `currentAccessToken` from memory on sign-out (currently done implicitly but not explicitly nulled in all sign-out paths).

---

### SEC-06: Weak Password Validation Policy
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `electron/main/utils/validation.ts` lines 35-55 |
| **OWASP** | A07:2021 – Identification and Authentication Failures |
| **CWE** | CWE-521: Weak Password Requirements |

**Finding:**  
Password validation requires only 6 characters minimum with no complexity requirements (no uppercase, number, or special character requirements). The weak password blocklist contains only 4 entries.

```typescript
if (password.length < 6) {
    return { isValid: false, error: 'Password must be at least 6 characters' };
}
const weakPasswords = ['password', '123456', 'qwerty', 'abc123'];
```

**Current Status:** Minimal password policy.

**Recommendation:**
1. Increase minimum length to 8 characters (NIST SP 800-63B recommendation).
2. Add complexity requirements or use zxcvbn for password strength estimation.
3. Expand the weak password blocklist or use a proven library like `hibp` to check against known breached passwords.
4. Note: Supabase Auth also has its own password policies — ensure they are configured server-side as the primary enforcement.

---

### SEC-07: Input Sanitization Limited to Null Byte Removal
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `electron/main/utils/validation.ts` line 194-199 |
| **OWASP** | A03:2021 – Injection |
| **CWE** | CWE-20: Improper Input Validation |

**Finding:**  
The `sanitizeString` function only removes null bytes. While Supabase's parameterized queries prevent SQL injection, there is no HTML/XSS sanitization for user-generated content that may be rendered in the frontend (chat titles, message content, personalization prompts).

```typescript
export function sanitizeString(input: string): string {
    if (!input) return '';
    return input.replace(/\0/g, '');
}
```

**Current Status:** Minimal sanitization; relies on React's built-in XSS protection (JSX auto-escaping).

**Recommendation:**
1. React's JSX auto-escaping provides good default XSS protection — this is acceptable as long as no `dangerouslySetInnerHTML` is used.
2. Verify no `dangerouslySetInnerHTML` usage exists in the frontend (not found in current audit scope, but should be verified).
3. Consider adding a content sanitization library (e.g., DOMPurify) for any user content that may be rendered as HTML.

---

### SEC-08: Prompt Injection Sanitization is Pattern-Based
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `python-service/pipeline_v2/document_parser.py` lines 62-85 |
| **OWASP** | A03:2021 – Injection |

**Finding:**  
The prompt injection sanitization uses a fixed list of regex patterns. While this provides defense-in-depth, pattern-based prompt injection detection is inherently bypassable (Unicode homoglyphs, encoding tricks, creative rephrasing).

```python
injection_patterns = [
    r'ignore\s+(all\s+)?previous\s+instructions',
    r'you\s+are\s+now\s+(in\s+)?admin',
    # ... 6 more patterns
]
```

**Current Status:** Defense-in-depth measure with 8K token cap as primary protection.

**Recommendation:**
1. The 8K token cap is the correct primary defense — this limits the attack surface.
2. Consider adding more patterns (base64-encoded instructions, markdown-hidden text).
3. For high-security environments, consider an LLM-based prompt injection classifier as a second layer.
4. Current implementation is reasonable for the threat model — this is LOW severity because the app processes prompts for optimization, not for executing commands.

---

### SEC-09: No Content Security Policy (CSP) for Electron Windows
| Attribute | Value |
|---|---|
| **Severity** | **HIGH** |
| **Component** | `electron/main/windows/app-window-manager.ts`, `electron/main/overlay/overlay-window-manager.ts` |
| **OWASP** | A05:2021 – Security Misconfiguration |
| **CWE** | CWE-1021: Improper Restriction of Rendered UI Layers |

**Finding:**  
No Content Security Policy (CSP) is configured for any BrowserWindow. While `nodeIntegration: false` and `contextIsolation: true` are correctly set, CSP provides an additional critical layer of defense against XSS and code injection.

**Current Status:** No CSP headers or meta tags configured.

**Recommendation:**
1. Set CSP via `session.defaultSession.webRequest.onHeadersReceived()` or the `Content-Security-Policy` response header.
2. Recommended starting policy:
   ```
   default-src 'self';
   script-src 'self';
   style-src 'self' 'unsafe-inline';
   img-src 'self' data: https:;
   connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:8001 ws://127.0.0.1:8001;
   ```
3. Ref: [Electron Security Checklist #6](https://www.electronjs.org/docs/latest/tutorial/security#6-define-a-content-security-policy)

---

### SEC-10: Preload IPC Channel Allowlisting — Positive Pattern
| Attribute | Value |
|---|---|
| **Severity** | **INFO (Positive Finding)** |
| **Component** | `electron/preload.ts` |

**Finding (Positive):**  
The preload script correctly uses `contextBridge.exposeInMainWorld()` with explicitly defined methods. IPC `send` channels are whitelisted. The renderer process has no direct access to `ipcRenderer` or Node.js APIs. This follows Electron security best practices.

**Current Status:** ✅ Properly implemented.

---

### SEC-11: Supabase RLS and Explicit User Scoping — Positive Pattern
| Attribute | Value |
|---|---|
| **Severity** | **INFO (Positive Finding)** |
| **Component** | `supabase/migrations/001_init_schema.sql`, `electron/main/database/services/chat-service.ts` |

**Finding (Positive):**  
All Supabase tables have Row-Level Security enabled with policies restricting access to `auth.uid()`. Additionally, the Electron services apply **explicit user scoping** (`.eq('user_id', userData.user.id)`) on every query as a defense-in-depth measure — even though RLS would catch unauthorized access.

**Current Status:** ✅ Defense-in-depth — both RLS and application-level user scoping.

---

### SEC-12: PII Scrubbing in Error Telemetry — Positive Pattern
| Attribute | Value |
|---|---|
| **Severity** | **INFO (Positive Finding)** |
| **Component** | `python-service/app/main.py` (lines 39-71), `electron/main/index-new.ts` (lines 9-45) |

**Finding (Positive):**  
Both the Python backend and Electron main process implement `beforeSend` hooks for Sentry that redact PII fields (prompt, content, message, text) from error events, breadcrumbs, and stack frame variables. `send_default_pii` is set to `false`.

**Current Status:** ✅ Properly implemented in both services.

---

## 2. Scalability Analysis

### SCALE-01: In-Memory Prompt Cache Without Eviction Strategy
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `python-service/app/main.py` lines 436-437 |

**Finding:**  
The prompt cache is a plain `dict` with a naive FIFO eviction (pop first key when size exceeds 100). This is not LRU, has no TTL, and stores full prompt strings in memory.

```python
prompt_cache: dict[str, str] = {}
MAX_CACHE_SIZE = 100
# Eviction:
if len(prompt_cache) >= MAX_CACHE_SIZE:
    prompt_cache.pop(next(iter(prompt_cache)))
```

**Impact:** Under high load, frequently requested prompts may be evicted while stale entries persist. Memory is unbounded for the values (large optimized texts).

**Recommendation:**
1. Replace with `functools.lru_cache` or `cachetools.TTLCache` with a 5-minute TTL.
2. Add a maximum value size limit.
3. For multi-process deployments, use Redis or memcached.

---

### SCALE-02: In-Memory Rate Limiting Not Multi-Process Safe
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `python-service/app/main.py` lines 443-463 |

**Finding:**  
Server-side rate limiting uses an in-memory dict protected by an asyncio lock. This works for single-process Uvicorn but fails completely under multi-process deployments (Gunicorn, Kubernetes replicas) — each process maintains its own counter.

```python
_rate_lock = _asyncio.Lock()
_rate_counters: dict[str, int] = {}   # key: "<user_id>:<YYYY-MM-DD>"
```

Additionally, old counter entries are never cleaned up — the dict grows unboundedly over days.

**Impact:** Rate limits are trivially circumvented in multi-instance deployments. Memory leak in long-running processes.

**Recommendation:**
1. Use Redis `INCR` with a 24-hour TTL for rate limit counters.
2. If staying single-process, add daily cleanup of expired counter entries.
3. The comment in the code acknowledges this limitation — address before scaling.

---

### SCALE-03: Electron Rate Limit Cache — 60-Second TTL
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `electron/main/database/services/rate-limit-service.ts` |

**Finding:**  
The client-side rate limit check uses a 60-second in-memory cache, querying Supabase on cache miss. This is appropriate for a desktop app (single user) but the Supabase query counts all messages for the current day (`messages` table scan):

```sql
SELECT count(*) FROM messages WHERE user_id = ? AND created_at >= today
```

**Impact:** On accounts with thousands of messages, this query may become slow without a composite index on `(user_id, created_at)`.

**Recommendation:**
1. Verify that the `messages` table has an index on `(user_id, created_at)`.
2. Consider a dedicated `daily_usage` counter table or materialized view.

---

### SCALE-04: Concurrency Semaphore — Appropriate for Single Instance
| Attribute | Value |
|---|---|
| **Severity** | **INFO** |
| **Component** | `python-service/app/main.py` line 450 |

**Finding (Acceptable):**  
The optimization WebSocket uses an asyncio semaphore (`MAX_CONCURRENT_OPTIMIZATIONS = 50`) to cap concurrent LLM calls, preventing thread pool exhaustion.

```python
_optimize_semaphore = _asyncio.Semaphore(int(os.environ.get("MAX_CONCURRENT_OPTIMIZATIONS", "50")))
```

**Current Status:** ✅ Appropriate for single-instance deployment. Needs distributed coordination for multi-instance.

---

### SCALE-05: Global Whisper/VAD Model Singletons
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `python-service/app/main.py` lines 1022-1058 |

**Finding:**  
Whisper and Silero VAD models are loaded as global singletons. This is memory-efficient but means transcription is effectively serialized — concurrent WebSocket transcription sessions would contend for the same model instance.

**Impact:** Maximum 1 concurrent transcription session per process (acceptable for desktop app; not for multi-tenant service).

**Recommendation:**
1. For current desktop use case, this is acceptable.
2. For multi-tenant deployment, consider model pooling or per-request model loading.

---

## 3. Rate Limiting & API Protection

### RL-01: No IP-Based Rate Limiting
| Attribute | Value |
|---|---|
| **Severity** | **HIGH** |
| **Component** | `python-service/app/main.py` |
| **OWASP** | A04:2021 – Insecure Design |

**Finding:**  
Rate limiting is per-user (JWT `sub` claim) only. There is no IP-based rate limiting, no per-endpoint throttling, and no protection against unauthenticated brute-force attacks on the `/optimize` endpoint or authentication endpoints.

**Impact:** An attacker could:
1. Flood unauthenticated endpoints (`/health`, `/`) without restriction.
2. Attempt credential stuffing against the auth endpoints (handled by Supabase's own rate limiting, but the Python service has no additional protection).
3. Exhaust server resources by sending many unauthenticated requests before JWT verification.

**Recommendation:**
1. Add a reverse proxy (Nginx, Caddy, Cloudflare) with IP-based rate limiting.
2. Use FastAPI middleware like `slowapi` for per-IP rate limiting.
3. Add per-endpoint rate limits (e.g., `/optimize` = 10 req/min, `/generate-title` = 30 req/min).

---

### RL-02: No Request Body Size Limit
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `python-service/app/main.py` |
| **OWASP** | A04:2021 – Insecure Design |
| **CWE** | CWE-770: Allocation of Resources Without Limits |

**Finding:**  
The FastAPI application does not configure maximum request body size. While Pydantic models validate structure, there is no limit on the overall HTTP body size. A crafted request with extremely long `prompt` or `messages` fields could consume excessive memory.

- `prompt` field: no maximum length (only minimum 3 chars checked)
- `messages` list: no maximum count
- `attached_files` list: capped at 5 items, but individual file sizes are only checked in the document parser
- WebSocket messages: no size limit

**Recommendation:**
1. Add a maximum prompt length (e.g., 50,000 characters).
2. Limit the messages list to a reasonable count (e.g., 100 messages).
3. Configure Uvicorn's `--limit-max-header-size` and use middleware for body size limits.
4. Add WebSocket message size limits.

---

### RL-03: Health Endpoint Not Rate Limited (DDoS Vector)
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `python-service/app/main.py` line 776 |

**Finding:**  
The `/health` endpoint requires no authentication and has no rate limiting. While health checks should be lightweight, they can be abused for DDoS amplification.

**Recommendation:**
1. Add basic IP-based rate limiting (e.g., 60 requests/minute per IP).
2. Consider restricting health checks to internal networks or specific IPs.

---

## 4. Code Quality & Consistency

### CQ-01: Consistent Error Handling Patterns
| Attribute | Value |
|---|---|
| **Severity** | **INFO (Positive Finding)** |

**Finding (Positive):**  
Error handling follows consistent patterns across the codebase:
- Python: `try/except` with Sentry capture, structured logging, and graceful fallbacks.
- Electron: `try/catch` with Sentry breadcrumbs, IPC error responses.
- Rust: Comprehensive error handling with `Result` types and graceful fallbacks.
- All services fail gracefully rather than crashing.

**Current Status:** ✅ Consistent and well-implemented.

---

### CQ-02: Logging Inconsistency — Mixed Console and Logger
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `python-service/app/main.py` |

**Finding:**  
The Python service mixes `print()` statements with `logger.info()`/`logger.error()` calls throughout. The `print()` calls bypass the structured logging system, are not captured by Sentry's `LoggingIntegration`, and cannot be filtered by log level.

Example mixing:
```python
print(f"[Optimize] Original length: {len(clean_prompt)} chars")   # not structured
logger.error(f"TitleGen.llm_failed error={exc}")                    # structured
```

**Recommendation:**
1. Replace all `print()` calls with `logger.info()` / `logger.debug()` calls.
2. Use structured logging fields (`logger.info("event", extra={...})`) instead of f-string interpolation.

---

### CQ-03: Naming Convention Adherence
| Attribute | Value |
|---|---|
| **Severity** | **INFO** |

**Finding:**  
- **Python:** Generally follows PEP 8. Private variables use underscore prefix (`_rate_lock`, `_AUTH_ENABLED`). Constants use `UPPER_SNAKE_CASE`. Minor deviation: some inline functions lack type hints.
- **TypeScript/Electron:** Follows standard camelCase for variables, PascalCase for classes. IPC channel names use colon-separated namespacing (`auth:sign-in`, `window:minimize`) — consistent.
- **Rust:** Follows Rust naming conventions. `#![deny(clippy::all)]` enforces linting. `snake_case` for functions, `UPPER_SNAKE_CASE` for constants.

**Current Status:** ✅ Largely consistent across languages.

---

### CQ-04: Design Pattern Usage
| Attribute | Value |
|---|---|
| **Severity** | **INFO** |

**Finding:**  
- **Singleton Pattern:** `SupabaseClientManager`, Whisper/VAD model loading — appropriate.
- **Observer Pattern:** IPC event system with named channels — well-structured.
- **Strategy Pattern:** `detect_prompt_type` → `get_optimization_strategy` — clean separation.
- **Builder Pattern:** Multipart file upload construction — well-implemented.
- **Guard Pattern:** `AIGuardrails` for spam prevention — appropriate.

**Current Status:** ✅ Appropriate design patterns applied.

---

## 5. Production Readiness

### PROD-01: No Graceful Shutdown for Python Service
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `python-service/app/main.py` |

**Finding:**  
The Python service has no graceful shutdown handler. When receiving SIGTERM:
- Active WebSocket connections are terminated without notification.
- In-flight LLM calls are abandoned without cleanup.
- Transcription sessions are dropped without saving partial results.
- The in-memory rate limit counters are lost.

**Recommendation:**
1. Add a `@app.on_event("shutdown")` handler that:
   - Sends close frames to all WebSocket connections.
   - Waits for in-flight optimization requests to complete (with timeout).
   - Cleans up transcription sessions.
2. Add SIGTERM signal handler for pre-shutdown tasks.

---

### PROD-02: Health Check Endpoint Missing Dependency Status
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `python-service/app/main.py` line 776-783 |

**Finding:**  
The `/health` endpoint always returns `{"status": "ok"}` without checking actual service dependencies (LLM API reachability, model availability, Whisper model loaded, Sentry connectivity).

```python
@app.get("/health")
async def health():
    return {"status": "ok", "service": "prompt-optimizer", "api_ready": True}
```

**Recommendation:**
1. Implement a `/health/ready` (readiness probe) that checks:
   - LLM API key is configured
   - Whisper model is loaded
   - Sentry is initialized
2. Keep `/health` as a lightweight liveness probe (current behavior).
3. Add `/health/detailed` with authentication for operator diagnostics.

---

### PROD-03: No Request Tracing / Correlation IDs
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `python-service/app/main.py` |

**Finding:**  
HTTP requests do not have correlation IDs. While Sentry transactions provide some tracing, there is no request-scoped correlation ID that flows through logs. WebSocket streams use `request_id` but HTTP endpoints do not.

**Recommendation:**
1. Add middleware that generates/extracts a `X-Request-ID` header.
2. Include the request ID in all log entries for that request.
3. Return the request ID in response headers.

---

### PROD-04: Error Messages Leak Internal Details
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `python-service/app/main.py` line 586 |

**Finding:**  
Error responses include raw exception messages which may expose internal details:

```python
raise HTTPException(status_code=500, detail=f"Optimization failed: {error_msg}")
```

**Recommendation:**
1. Return generic error messages to clients.
2. Log detailed errors server-side only.
3. Include a correlation ID in the error response for support purposes.

---

### PROD-05: Usage Logger Silently Swallows All Exceptions
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `python-service/pipeline_v2/usage_logger.py` line 126-128 |

**Finding:**  
The usage logger catches all exceptions with a bare `except Exception: pass`. While this is intentional (never let logging crash the main request), it means logging failures are completely invisible.

```python
except Exception:
    pass  # Never let logging crash the main request
```

**Recommendation:**
1. At minimum, log to stderr or a fallback mechanism when usage logging fails.
2. Consider emitting a metric/counter for logging failures.

---

## 6. Native Module (Rust) Security

### RUST-01: Unsafe Code Usage — Appropriate and Well-Bounded
| Attribute | Value |
|---|---|
| **Severity** | **INFO (Positive Finding)** |
| **Component** | `native/windows-core/src/` |

**Finding (Positive):**  
The Rust native module uses `unsafe` blocks for Win32 FFI calls. All unsafe usage is:
- Bounded to well-documented Win32 API calls (SetWindowsHookExW, SendInput, GetForegroundWindow).
- Protected by null checks (`hwnd.0.is_null()`), window existence verification (`IsWindow`), and foreground guards.
- Thread safety managed via `Mutex<Option<HookState>>` for global state and `thread_local!` for per-thread state.
- The `#![deny(clippy::all)]` lint ensures code quality.

**Notable Security Considerations:**
- **Keyboard Hook (WH_KEYBOARD_LL):** The hook is system-wide and observes all keystrokes. It only buffers the last 64 characters and only triggers on the exact "@prompt" pattern. Injected events (SendInput) are explicitly filtered to prevent feedback loops (`LLKHF_INJECTED` check).
- **Clipboard Access:** The replacement engine temporarily overwrites the clipboard for paste injection but restores the original content after a 300ms delay. Race conditions with user clipboard operations are possible but benign.
- **UIPI Boundary:** The code correctly notes that SendInput may fail against elevated processes (UIPI) and returns `false` rather than crashing.

**Current Status:** ✅ Appropriate use of unsafe code with proper safety guards.

---

### RUST-02: Clipboard Restoration Race Condition
| Attribute | Value |
|---|---|
| **Severity** | **LOW** |
| **Component** | `native/windows-core/src/replacement.rs` lines 585-608 |

**Finding:**  
Clipboard restoration is done in a spawned thread after a 300ms delay. If the user copies something during this window, their clipboard content will be overwritten by the restoration.

**Impact:** Minor UX issue — user could lose clipboard content if they copy within 300ms of a replacement operation.

**Recommendation:**
1. This is acceptable for the current use case — the 300ms window is very short.
2. Consider extending to 500ms or implementing a clipboard change detection check before restoration.

---

## 7. Dependency Review

### DEP-01: Electron Version — Major Version Behind
| Attribute | Value |
|---|---|
| **Severity** | **HIGH** |
| **Component** | `package.json` — `electron: ^28.0.0` |

**Finding:**  
Electron 28 was released in December 2023. As of March 2026, multiple Electron major versions have been released with security patches for Chromium vulnerabilities. Running on an outdated Electron version exposes the application to known Chromium CVEs.

**Recommendation:**
1. Upgrade to the latest stable Electron version.
2. Establish a quarterly Electron upgrade cadence.
3. Subscribe to Electron security advisories.

---

### DEP-02: Python Dependencies — No Pinned Versions
| Attribute | Value |
|---|---|
| **Severity** | **MEDIUM** |
| **Component** | `python-service/requirements.txt` |

**Finding:**  
Many Python dependencies are pinned only to a major or minor version (e.g., `fastapi`, `pydantic`). Some critical dependencies like `PyJWT` are not version-pinned at all. This risks pulling in breaking or vulnerable versions on fresh installs.

**Recommendation:**
1. Use `pip freeze > requirements.lock` to create a lockfile with exact versions.
2. Regularly run `pip-audit` or `safety check` against the lockfile.
3. Consider using `poetry` or `pipenv` for dependency management.

---

### DEP-03: Frontend Dependencies — Generally Current
| Attribute | Value |
|---|---|
| **Severity** | **INFO** |
| **Component** | `app-ui/package.json` |

**Finding:**  
Frontend dependencies (React 18, Radix UI, TanStack Query, Zod) are reasonably current. The use of Zod for runtime validation is a positive security practice.

**Current Status:** ✅ Acceptable.

---

## 8. Summary Matrix

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| SEC-01 | Auth bypass when JWT secret unset (fails open) | **CRITICAL** | Security |
| SEC-04 | Deep link XSS via executeJavaScript injection | **HIGH** | Security |
| SEC-09 | No Content Security Policy on Electron windows | **HIGH** | Security |
| SEC-02 | CORS wildcard with credentials in production | **HIGH** | Security |
| RL-01 | No IP-based rate limiting on Python API | **HIGH** | API Protection |
| DEP-01 | Electron 28 — significantly outdated | **HIGH** | Dependencies |
| SEC-05 | Access token stored in plaintext (memory + disk) | **MEDIUM** | Security |
| SEC-06 | Weak password validation policy | **MEDIUM** | Security |
| SEC-03 | JWT token in WebSocket query parameters | **MEDIUM** | Security |
| SCALE-01 | In-memory cache without proper eviction | **MEDIUM** | Scalability |
| SCALE-02 | In-memory rate limiting not multi-process safe | **MEDIUM** | Scalability |
| RL-02 | No request body size limit | **MEDIUM** | API Protection |
| PROD-01 | No graceful shutdown handler | **MEDIUM** | Production |
| PROD-02 | Health check doesn't verify dependencies | **MEDIUM** | Production |
| DEP-02 | Python dependencies not fully pinned | **MEDIUM** | Dependencies |
| SEC-07 | Sanitization limited to null bytes | **LOW** | Security |
| SEC-08 | Pattern-based prompt injection detection | **LOW** | Security |
| SCALE-03 | Rate limit query may be slow at scale | **LOW** | Scalability |
| CQ-02 | Mixed print/logger in Python service | **LOW** | Code Quality |
| PROD-03 | No request correlation IDs | **LOW** | Production |
| PROD-04 | Error messages leak internal details | **LOW** | Production |
| PROD-05 | Usage logger swallows exceptions | **LOW** | Production |
| RUST-02 | Clipboard restoration race condition | **LOW** | Native Module |
| RL-03 | Health endpoint not rate limited | **LOW** | API Protection |

---

## 9. Prioritized Remediation Roadmap

### Immediate (Before Production Deploy)
1. **SEC-01:** Add fail-closed behavior — refuse to start in production without JWT secret.
2. **SEC-04:** Sanitize deep link tokens or use IPC instead of `executeJavaScript()`.
3. **SEC-02:** Remove CORS wildcard default; require explicit origin configuration.
4. **DEP-01:** Upgrade Electron to latest stable version.

### Short-Term (Sprint 1-2)
5. **SEC-09:** Implement Content Security Policy for all BrowserWindows.
6. **RL-01:** Add IP-based rate limiting (reverse proxy or `slowapi`).
7. **RL-02:** Add request body size limits and prompt length caps.
8. **PROD-01:** Implement graceful shutdown handler.
9. **SEC-05:** Use `safeStorage` for session encryption at rest.

### Medium-Term (Sprint 3-4)
10. **SCALE-02:** Migrate rate limiting to Redis for multi-instance readiness.
11. **SCALE-01:** Replace dict cache with TTL-based cache.
12. **PROD-02:** Enhance health check with dependency verification.
13. **DEP-02:** Create lockfile and add `pip-audit` to CI.
14. **SEC-06:** Strengthen password policy.
15. **CQ-02:** Standardize on structured logging.

### Ongoing
16. Quarterly Electron and dependency upgrades.
17. Regular `npm audit` and `pip-audit` scans in CI.
18. Annual security review of Supabase RLS policies.

---

## Appendix: Positive Security Patterns Observed

The following security practices are correctly implemented and should be maintained:

| Practice | Implementation | Quality |
|----------|---------------|---------|
| Electron sandboxing | `nodeIntegration: false`, `contextIsolation: true` | ✅ Excellent |
| Preload IPC allowlisting | `contextBridge.exposeInMainWorld` with explicit API | ✅ Excellent |
| Supabase RLS | All tables with `auth.uid()` policies | ✅ Excellent |
| Application-level user scoping | `.eq('user_id', ...)` on every query | ✅ Defense-in-depth |
| JWT authentication | HS256 with audience/expiry verification | ✅ Good |
| PII scrubbing in telemetry | `beforeSend` hooks in both Python and Electron Sentry | ✅ Excellent |
| File validation | Magic-byte validation, size limits, token caps | ✅ Good |
| Protocol URL validation | `openExternal` restricted to http/https | ✅ Good |
| PKCE OAuth flow | Correct PKCE implementation for desktop OAuth | ✅ Excellent |
| Rust memory safety | `#![deny(clippy::all)]`, proper Mutex usage | ✅ Good |
| GDPR deletion requests | 30-day soft-delete with cancellation support | ✅ Good |
| Concurrent request control | Asyncio semaphore for LLM call limiting | ✅ Good |
| AI response validation | `ResponseValidator` prevents stale result display | ✅ Good |
| Prompt optimization guardrails | Similarity, cooldown, in-flight limits | ✅ Good |

---

*End of Audit Report*
