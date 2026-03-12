import axios, { AxiosInstance, AxiosError } from "axios";
import { EventEmitter } from "events";
const WebSocket = require('ws');

interface StreamRequest {
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
  onChunk: (chunk: string, accumulated: string) => void;
  accumulated?: string; // Track accumulated text for fallback scenarios
}

export class PythonClient extends EventEmitter {
  private client: AxiosInstance;
  private baseUrl: string;
  private ws: any | null = null;
  private activeRequests: Map<string, StreamRequest> = new Map();
  private isConnecting: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(baseUrl: string = "http://127.0.0.1:8001") {
    super();
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 60000,
      headers: { "Content-Type": "application/json" }
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.ensureConnection();
    } catch (error) {
      console.error('[PythonClient] Background connection failed:', error);
    }
  }

  private async ensureConnection(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const wsUrl = `${this.baseUrl.replace('http', 'ws')}/ws/optimize-stream`;
      console.log(`[PythonClient] Connecting to WebSocket: ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log(`[PythonClient] ✓ WebSocket connected`);
        this.connectionPromise = null;
        resolve();
      });

      this.ws.on('message', (data: any) => {
        try {
          const messageStr = data.toString();
          // console.log('[PythonClient] Raw WS message:', messageStr.substring(0, 200)); 
          const message = JSON.parse(messageStr);
          let requestId = message.request_id;

          // Fallback: If no request_id in message but we have exactly one active request, assume it matches
          if (!requestId && this.activeRequests.size === 1) {
            requestId = this.activeRequests.keys().next().value;
            // console.log('[PythonClient] No requestId in message, using single active request:', requestId);
          }

          if (requestId && this.activeRequests.has(requestId)) {
            const request = this.activeRequests.get(requestId)!;

            if (message.type === 'chunk') {
              request.onChunk(message.content, message.accumulated);
            } else if (message.type === 'complete') {
              // console.log('[PythonClient] Received completion signal');
              request.resolve(message.optimized);
              this.activeRequests.delete(requestId);
            } else if (message.type === 'error') {
              console.error('[PythonClient] Received error signal:', message.message);
              request.reject(new Error(message.message));
              this.activeRequests.delete(requestId);
            }
          } else {
            console.warn('[PythonClient] Received message for unknown or missing request ID:', requestId);
          }
        } catch (error) {
          console.error('[PythonClient] Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error(`[PythonClient] WebSocket error:`, error);
        this.connectionPromise = null;
        reject(error);
      });

      this.ws.on('close', () => {
        console.log(`[PythonClient] WebSocket closed`);

        // CRITICAL FIX: Resolve/Reject all active requests when socket closes
        // Otherwise they hang forever if the server disconnects
        for (const [requestId, request] of this.activeRequests.entries()) {
          if (request.accumulated && request.accumulated.length > 0) {
            // If we have some data, treat as success
            console.warn(`[PythonClient] Request ${requestId} socket closed but has data, resolving along with warning.`);
            request.resolve(request.accumulated);
          } else {
            request.reject(new Error('WebSocket connection closed unexpectedly'));
          }
        }
        this.activeRequests.clear();

        this.ws = null;
        this.connectionPromise = null;
      });
    });

    return this.connectionPromise;
  }

  async optimizeStream(
    prompt: string,
    skipCache: boolean = false,
    messages: Array<{ role: string; content: string }> | null = null,
    onChunk: (chunk: string, accumulated: string) => void,
    mode: string = "fast",
    customInstructions: string = ""
  ): Promise<string> {
    await this.ensureConnection();

    const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    // Track accumulated text for fallback
    let accumulatedText = "";

    return new Promise((resolve, reject) => {
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

      // Safety Timeout (Hard limit)
      const timeoutMs = 30000; // 30 seconds
      const timeoutId = setTimeout(() => {
        if (this.activeRequests.has(requestId)) {
          console.warn(`[PythonClient] Request ${requestId} timed out (hard limit)`);
          const req = this.activeRequests.get(requestId);
          this.activeRequests.delete(requestId);

          if (req && req.accumulated && req.accumulated.length > 0) {
            // Resolve with what we have
            resolve(req.accumulated);
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
            const req = this.activeRequests.get(requestId);
            this.activeRequests.delete(requestId);

            // Clear the hard timeout too
            clearTimeout(timeoutId);

            if (req && req.accumulated && req.accumulated.length > 0) {
              resolve(req.accumulated);
            } else {
              // Silence before any data - this shouldn't happen
              console.warn(`[PythonClient] Request ${requestId} timed out with no data received`);
              resolve("");
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
        this.ws.send(JSON.stringify({
          request_id: requestId,
          prompt,
          skip_cache: skipCache,
          messages,
          mode,
          custom_instructions: customInstructions
        }));
      } catch (error) {
        clearTimeout(timeoutId);
        this.activeRequests.delete(requestId);
        reject(error);
      }
    });
  }

  // Legacy method for non-streaming requests (retaining for backward compatibility)
  async optimize(
    prompt: string,
    skipCache: boolean = false,
    messages?: Array<{ role: string; content: string }>,
    mode: string = "fast",
    customInstructions: string = ""
  ): Promise<string> {
    try {
      const response = await this.client.post("/optimize", {
        prompt,
        skip_cache: skipCache,
        messages: messages || null,
        mode,
        custom_instructions: customInstructions
      });
      return response.data.optimized;
    } catch (error) {
      console.error('[PythonClient] Optimization failed:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get("/health", { timeout: 5000 });
      return response.data && response.data.status === "ok";
    } catch (error) {
      return false;
    }
  }
}
