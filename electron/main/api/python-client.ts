import axios, { AxiosInstance, AxiosError } from "axios";
import { EventEmitter } from "events";
const WebSocket = require('ws');

interface StreamRequest {
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
  onChunk: (chunk: string, accumulated: string) => void;
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
          const message = JSON.parse(data.toString());
          const requestId = message.request_id;

          if (requestId && this.activeRequests.has(requestId)) {
            const request = this.activeRequests.get(requestId)!;

            if (message.type === 'chunk') {
              request.onChunk(message.content, message.accumulated);
            } else if (message.type === 'complete') {
              request.resolve(message.optimized);
              this.activeRequests.delete(requestId);
            } else if (message.type === 'error') {
              request.reject(new Error(message.message));
              this.activeRequests.delete(requestId);
            }
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
    onChunk: (chunk: string, accumulated: string) => void
  ): Promise<string> {
    await this.ensureConnection();

    const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    return new Promise((resolve, reject) => {
      this.activeRequests.set(requestId, { resolve, reject, onChunk });

      try {
        this.ws.send(JSON.stringify({
          request_id: requestId,
          prompt,
          skip_cache: skipCache,
          messages
        }));
      } catch (error) {
        this.activeRequests.delete(requestId);
        reject(error);
      }
    });
  }

  // Legacy method for non-streaming requests (retaining for backward compatibility)
  async optimize(
    prompt: string,
    skipCache: boolean = false,
    messages?: Array<{ role: string; content: string }>
  ): Promise<string> {
    try {
      const response = await this.client.post("/optimize", {
        prompt,
        skip_cache: skipCache,
        messages: messages || null
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
