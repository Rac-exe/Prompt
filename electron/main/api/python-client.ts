import axios, { AxiosInstance, AxiosError } from "axios";
import * as Sentry from '@sentry/electron/main';
import { logger, getActiveSpan, spanToTraceHeader, getDynamicSamplingContextFromSpan, dynamicSamplingContextToSentryBaggageHeader } from '@sentry/core';
import { EventEmitter } from "events";
import { authState } from '../utils/auth-state';
const WebSocket = require('ws');

export interface ModelsUsed {
  optimizer: string;
  summarizer?: string;
  used_vision?: boolean;
}

interface OptimizeResult {
  text: string;
  models?: ModelsUsed;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'text';
  options: string[];
  allow_other: boolean;
  optional: boolean;
}

export interface ClarifyResult {
  should_clarify: boolean;
  is_complex: boolean;
  complexity_reason: string;
  suggested_sections: string[];
  questions: ClarifyQuestion[];
}

interface StreamRequest {
  resolve: (value: OptimizeResult) => void;
  reject: (reason?: any) => void;
  onChunk: (chunk: string, accumulated: string) => void;
  accumulated?: string;
  aborted?: boolean;
}

export class PythonClient extends EventEmitter {
  private client: AxiosInstance;
  private baseUrl: string;
  private ws: any | null = null;
  private activeRequests: Map<string, StreamRequest> = new Map();
  private isConnecting: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  // The request ID of the most recently started stream (for single-stream abort)
  private latestRequestId: string | null = null;
  // Recently aborted IDs — suppresses spurious "unknown request ID" warnings
  private abortedRequestIds: Set<string> = new Set();

  constructor(baseUrl: string = "http://127.0.0.1:8001") {
    super();
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 60000,
      headers: { "Content-Type": "application/json" }
    });

    // Attach Bearer token to every outgoing HTTP request from the current auth session
    this.client.interceptors.request.use((config) => {
      const token = authState.currentAccessToken;
      if (token) {
        config.headers = config.headers ?? {};
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      return config;
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.ensureConnection();
    } catch (error) {
      console.error('[PythonClient] Background connection failed:', error);
    }
  }

  /** Close and re-open the WebSocket (called after token refresh so the new token is used). */
  public reconnect(): void {
    if (this.ws) {
      console.log('[PythonClient] Reconnecting WebSocket with refreshed token…');
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
      this.connectionPromise = null;
    }
    this.connect().catch(e => console.error('[PythonClient] Reconnect failed:', e));
  }

  /** Builds the WS URL including the auth token as a query param when available. */
  private buildWsUrl(path: string): string {
    const base = `${this.baseUrl.replace('http', 'ws')}${path}`;
    const token = authState.currentAccessToken;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }

  private async ensureConnection(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.connectWithRetry();
    return this.connectionPromise;
  }

  private connectWithRetry(maxElapsedMs = 90_000): Promise<void> {
    const start = Date.now();
    const delays = [2000, 4000, 8000, 15000, 20000]; // backoff steps

    const attempt = (attemptIndex: number): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const wsUrl = this.buildWsUrl('/ws/optimize-stream');
        console.log(`[PythonClient] Connecting to WebSocket (attempt ${attemptIndex + 1}): ${wsUrl.split('?')[0]}`);

        const ws = new WebSocket(wsUrl);
        let settled = false;

        const onOpen = () => {
          if (settled) return;
          settled = true;
          console.log(`[PythonClient] ✓ WebSocket connected`);
          this.ws = ws;
          this.connectionPromise = null;
          resolve();
        };

        const onError = (err: Error) => {
          if (settled) return;
          settled = true;
          try { ws.close(); } catch (_) {}
          const elapsed = Date.now() - start;
          const delay = delays[Math.min(attemptIndex, delays.length - 1)];
          if (elapsed + delay < maxElapsedMs) {
            console.warn(`[PythonClient] WS connect failed, retrying in ${delay}ms… (${Math.round(elapsed / 1000)}s elapsed)`);
            setTimeout(() => attempt(attemptIndex + 1).then(resolve).catch(reject), delay);
          } else {
            this.connectionPromise = null;
            reject(err);
          }
        };

        ws.once('open', onOpen);
        ws.once('error', onError);
        // Also handle immediate close before open (server refusing / cold start not ready)
        ws.once('close', () => { if (!settled) onError(new Error('WebSocket closed before open')); });

        ws.on('message', (data: any) => {
          try {
            const messageStr = data.toString();
            const message = JSON.parse(messageStr);
            let requestId = message.request_id;

            // Fallback: If no request_id in message but we have exactly one active request, assume it matches
            if (!requestId && this.activeRequests.size === 1) {
              requestId = this.activeRequests.keys().next().value;
            }

            if (requestId && this.activeRequests.has(requestId)) {
              const request = this.activeRequests.get(requestId)!;

              if (request.aborted) {
                this.activeRequests.delete(requestId);
                return;
              }

              if (message.type === 'chunk') {
                request.onChunk(message.content, message.accumulated);
              } else if (message.type === 'complete') {
                request.resolve({ text: message.optimized, models: message.models_used });
                this.activeRequests.delete(requestId);
              } else if (message.type === 'error') {
                console.error('[PythonClient] Received error signal:', message.message);
                request.reject(new Error(message.message));
                this.activeRequests.delete(requestId);
              }
            } else {
              if (!this.abortedRequestIds.has(requestId)) {
                console.warn('[PythonClient] Received message for unknown or missing request ID:', requestId);
              }
            }
          } catch (error) {
            console.error('[PythonClient] Failed to parse message:', error);
          }
        });

        ws.on('close', () => {
          console.log(`[PythonClient] WebSocket closed`);

          if (this.activeRequests.size > 0) {
            Sentry.captureMessage(`Python WebSocket closed with ${this.activeRequests.size} pending request(s)`, 'warning');
          }

          for (const [reqId, request] of this.activeRequests.entries()) {
            if (request.accumulated && request.accumulated.length > 0) {
              console.warn(`[PythonClient] Request ${reqId} socket closed but has data, resolving with partial.`);
              request.resolve({ text: request.accumulated, models: undefined });
            } else {
              request.reject(new Error('WebSocket connection closed unexpectedly'));
            }
          }
          this.activeRequests.clear();
          this.ws = null;
          this.connectionPromise = null;
        });
      });
    };

    return attempt(0);
  }

  async optimizeStream(
    prompt: string,
    skipCache: boolean = false,
    messages: Array<{ role: string; content: string }> | null = null,
    onChunk: (chunk: string, accumulated: string) => void,
    mode: string = "thinking",
    customInstructions: string = "",
    attachedFiles: Array<{ name: string; mimeType: string; base64: string; sizeBytes: number }> = [],
    forcedSkill: string | null = null,
    previousOutput: string | null = null,
    clarificationAnswers: string | null = null,
    wantsSections: boolean = false,
    projectId: string | null = null,
    projectBranch: string | null = null,
  ): Promise<OptimizeResult> {
    await this.ensureConnection();

    const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    this.latestRequestId = requestId;

    let accumulatedText = "";

    return new Promise<OptimizeResult>((resolve, reject) => {
      // Wrapper for onChunk to track accumulation locally
      const wrappedOnChunk = (chunk: string, acc: string) => {
        accumulatedText = acc;
        onChunk(chunk, acc);
      };

      this.activeRequests.set(requestId, {
        resolve,
        reject,
        onChunk: wrappedOnChunk,
        accumulated: "" // Initialize
      });

      // Safety Timeout (Hard limit — generous for Render cold starts which can take 50s+)
      const timeoutMs = 90000; // 90 seconds
      const timeoutId = setTimeout(() => {
        if (this.activeRequests.has(requestId)) {
          console.warn(`[PythonClient] Request ${requestId} timed out (hard limit)`);
          const req = this.activeRequests.get(requestId);
          this.activeRequests.delete(requestId);

          if (req && req.accumulated && req.accumulated.length > 0) {
            resolve({ text: req.accumulated, models: undefined });
          } else {
            reject(new Error('Optimization request timed out'));
          }
        }
      }, timeoutMs);

      // SILENCE DETECTION TIMEOUT
      // If no chunks received for 3.5 seconds AFTER first chunk, assume stream is done
      let silenceTimeoutId: NodeJS.Timeout | null = null;
      let hasReceivedFirstChunk = false;

      const resetSilenceTimeout = () => {
        if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
        silenceTimeoutId = setTimeout(() => {
          if (this.activeRequests.has(requestId)) {
            console.log(`[PythonClient] Request ${requestId} silence detected (3.5s), auto-resolving`);
            Sentry.captureMessage('Stream silence timeout', 'warning');
            logger.warn(logger.fmt`stream.silence_timeout requestId=${requestId}`);
            const req = this.activeRequests.get(requestId);
            this.activeRequests.delete(requestId);

            // Clear the hard timeout too
            clearTimeout(timeoutId);

            if (req && req.accumulated && req.accumulated.length > 0) {
              resolve({ text: req.accumulated, models: undefined });
            } else {
              console.warn(`[PythonClient] Request ${requestId} timed out with no data received`);
              resolve({ text: "", models: undefined });
            }
          }
        }, 3500);
      };

      // DON'T initialize silence timer immediately - wait for first chunk
      // This prevents false positives when server is slow to respond initially

      // Update the accumulated value in the map reference whenever chunk arrives
      const requestObj = this.activeRequests.get(requestId);
      if (requestObj) {
        requestObj.onChunk = (chunk, acc) => {
          requestObj.accumulated = acc;
          onChunk(chunk, acc);

          // Start silence timer only after first chunk arrives
          if (!hasReceivedFirstChunk) {
            hasReceivedFirstChunk = true;
            resetSilenceTimeout();
          } else {
            // Reset silence timer on subsequent chunks
            resetSilenceTimeout();
          }
        };
      }

      // Hook into resolve/reject to clear timeout
      const originalResolve = resolve;
      const originalReject = reject;

      // We can't easily hook the promise executor's resolve/reject parameters 
      // because they are called by the event handler.
      // Instead, we trust the map logic. The timeout checks map existence.

      try {
        // Propagate the active Sentry trace so Python can link its spans to this Electron trace.
        let sentryTrace: string | undefined;
        let baggage: string | undefined;
        try {
          const activeSpan = getActiveSpan();
          if (activeSpan) {
            sentryTrace = spanToTraceHeader(activeSpan);
            const dsc = getDynamicSamplingContextFromSpan(activeSpan);
            baggage = dynamicSamplingContextToSentryBaggageHeader(dsc);
          }
        } catch (_) { /* non-fatal if trace API unavailable */ }

        this.ws.send(JSON.stringify({
          request_id: requestId,
          prompt,
          previous_output: previousOutput || undefined,
          messages,
          mode,
          custom_instructions: customInstructions,
          attached_files: attachedFiles,
          forced_skill: forcedSkill,
          clarification_answers: clarificationAnswers || undefined,
          wants_sections: wantsSections || undefined,
          project_id: projectId || undefined,
          project_branch: projectBranch || undefined,
          sentry_trace: sentryTrace,
          baggage,
          user_id: authState.currentUserId || undefined,
        }));
      } catch (error) {
        clearTimeout(timeoutId);
        this.activeRequests.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Abort the most recently started stream.
   * Resolves the pending promise with whatever text has been accumulated so far
   * so the caller gets a partial result rather than an error.
   */
  abortLatestStream(): void {
    const requestId = this.latestRequestId;
    if (!requestId || !this.activeRequests.has(requestId)) {
      console.log('[PythonClient] abortLatestStream: no active stream to abort');
      return;
    }

    const req = this.activeRequests.get(requestId)!;
    req.aborted = true;
    this.activeRequests.delete(requestId);
    this.latestRequestId = null;

    // Remember this ID so incoming late chunks don't log a noisy warning.
    // Clean up after 30 s — well past any realistic stream tail.
    this.abortedRequestIds.add(requestId);
    setTimeout(() => this.abortedRequestIds.delete(requestId), 30_000);

    const partial = req.accumulated || '';
    console.log(`[PythonClient] Aborting stream ${requestId}, resolving with ${partial.length} chars`);

    // Try to notify the Python server to stop (best-effort)
    try {
      if (this.ws && this.ws.readyState === 1 /* OPEN */) {
        this.ws.send(JSON.stringify({ type: 'abort', request_id: requestId }));
      }
    } catch (_) { /* ignore */ }

    req.resolve({ text: partial, models: undefined });
  }

  async clarify(prompt: string): Promise<ClarifyResult> {
    return Sentry.startSpan({ name: 'python.clarify', op: 'http.client' }, async (span) => {
      Sentry.addBreadcrumb({ category: 'python-client', message: 'Clarify request started', level: 'info', data: { promptLen: prompt.length } });
      try {
        const response = await this.client.post('/clarify', { prompt }, { timeout: 15000 });
        const result: ClarifyResult = response.data;
        span.setAttribute('should_clarify', result.should_clarify);
        span.setAttribute('question_count', result.questions.length);
        span.setAttribute('is_complex', result.is_complex);
        Sentry.addBreadcrumb({ category: 'python-client', message: 'Clarify response received', level: 'info', data: { should_clarify: result.should_clarify, questions: result.questions.length, is_complex: result.is_complex } });
        logger.info(logger.fmt`python.clarify_complete should_clarify=${result.should_clarify} questions=${result.questions.length}`);
        return result;
      } catch (error) {
        Sentry.captureException(error, { tags: { component: 'python-client', op: 'clarify' }, level: 'warning' });
        span.setStatus({ code: 2, message: 'clarify_failed' });
        logger.warn(logger.fmt`python.clarify_failed error=${error instanceof Error ? error.message : String(error)}`);
        return {
          should_clarify: false,
          is_complex: false,
          complexity_reason: '',
          suggested_sections: [],
          questions: [],
        };
      }
    });
  }

  // Legacy method for non-streaming requests (retaining for backward compatibility)
  async optimize(
    prompt: string,
    skipCache: boolean = false,
    messages?: Array<{ role: string; content: string }>,
    mode: string = "thinking",
    customInstructions: string = ""
  ): Promise<string> {
    try {
      const response = await this.client.post("/optimize", {
        prompt,
        skip_cache: skipCache,
        messages: messages || null,
        mode,
        custom_instructions: customInstructions,
        user_id: authState.currentUserId || undefined,
      });
      return response.data.optimized;
    } catch (error) {
      Sentry.captureException(error);
      console.error('[PythonClient] Optimization failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get("/health", { timeout: 5000 });
      const ok = response.data && response.data.status === "ok";
      Sentry.addBreadcrumb({ category: 'python', message: `Health check ${ok ? 'passed' : 'failed'}`, level: ok ? 'info' : 'warning' });
      return ok;
    } catch (error) {
      Sentry.addBreadcrumb({ category: 'python', message: 'Health check unreachable', level: 'error' });
      return false;
    }
  }

  /**
   * Extract memory facts from a raw prompt + optimized text.
   * Calls /extract-memory-facts on the Python service.
   * Returns extracted facts, or an empty array on failure.
   * Used fire-and-forget after each optimization — non-blocking.
   */
  async extractMemoryFacts(
    rawPrompt: string,
    optimizedText: string,
    skill: string | null = null
  ): Promise<Array<{ category: string; key: string; value: string; confidence: number }>> {
    try {
      const response = await this.client.post('/extract-memory-facts', {
        raw_prompt: rawPrompt,
        optimized_text: optimizedText,
        skill: skill || undefined,
      }, { timeout: 15000 });
      const facts = response.data?.facts;
      return Array.isArray(facts) ? facts : [];
    } catch (error) {
      console.warn('[PythonClient] extractMemoryFacts failed (non-critical):', error);
      return [];
    }
  }

  /**
   * Generate a short smart title for a new chat from the first user message.
   * Calls /generate-title on the Python service (GPT-4o-mini via OpenRouter).
   * Returns the generated title, or "New Chat" as a fallback.
   */
  async generateTitle(prompt: string): Promise<string> {
    try {
      const response = await this.client.post('/generate-title', { prompt }, { timeout: 8000 });
      const title = response.data?.title?.trim();
      return title && title.length > 0 ? title : 'New Chat';
    } catch (error) {
      console.warn('[PythonClient] generateTitle failed, using fallback:', error);
      return 'New Chat';
    }
  }

  /**
   * Upload an image to Cloudinary via the Python service.
   *
   * Returns the secure CDN URL and the Cloudinary public_id. The public_id
   * is the canonical handle used for direct asset deletion (account-deletion
   * cron, manual cleanup, etc).
   */
  async uploadImage(
    base64: string,
    filename: string,
    mimeType: string = 'image/jpeg',
  ): Promise<{ url: string; publicId: string }> {
    try {
      const response = await this.client.post('/upload/image', {
        base64,
        filename,
        mime_type: mimeType,
      }, { timeout: 30000 });
      Sentry.addBreadcrumb({
        category: 'file-upload',
        message: `Image uploaded via Python proxy: ${filename}`,
        level: 'info',
      });
      return {
        url: response.data.url,
        publicId: response.data.public_id ?? '',
      };
    } catch (error) {
      Sentry.captureException(error, {
        tags: { component: 'image-upload' },
        extra: { filename, mimeType },
      });
      throw error;
    }
  }

  async transcribeAudio(audioBase64: string): Promise<string> {
    try {
      const response = await this.client.post(
        '/transcribe-audio',
        { audio_base64: audioBase64 },
        { timeout: 120000 }
      );
      const text = response.data?.text;
      return typeof text === 'string' ? text : '';
    } catch (error) {
      Sentry.captureException(error);
      const message = error instanceof AxiosError
        ? error.response?.data?.detail || error.message
        : error instanceof Error
          ? error.message
          : 'Transcription failed';
      console.error('[PythonClient] Audio transcription failed:', message);
      throw new Error(message);
    }
  }
}
