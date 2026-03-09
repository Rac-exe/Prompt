/**
 * TranscriptionClient
 *
 * Manages WebSocket connection to Python Whisper transcription service.
 * Uses the `ws` package (Node.js) — NOT the browser WebSocket API.
 *
 * Flow:
 *   start → [status: listening] → [transcription: ...] × N
 *         → [status: processing] ← fired when user clicks Stop
 *         → [final: ...] ← last Whisper result
 *         → [status: stopped]
 */
const WebSocket = require('ws');

export class TranscriptionClient {
  private ws: any | null = null;
  private baseUrl: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private reconnectDelay: number = 1000;
  private currentSessionId: string | null = null;

  private onTranscriptionCallback: ((data: { text: string; accumulated: string; type: string }) => void) | null = null;
  private onErrorCallback:         ((error: string) => void) | null = null;
  private onStatusCallback:        ((status: string) => void) | null = null;

  private connectionPromise: Promise<void> | null = null;

  constructor(baseUrl: string = 'ws://127.0.0.1:8001') {
    this.baseUrl = baseUrl;
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  private async ensureConnection(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      const wsUrl = `${this.baseUrl}/ws/transcribe`;
      console.log(`[TranscriptionClient] Connecting to: ${wsUrl}`);

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          console.log('[TranscriptionClient] WebSocket connected');
          this.reconnectAttempts = 0;
          this.connectionPromise = null;
          resolve();
        });

        this.ws.on('message', (rawData: any) => {
          try {
            const data = JSON.parse(rawData.toString());
            console.log(`[TranscriptionClient] ← ${JSON.stringify(data)}`);

            switch (data.type) {
              case 'transcription':
              case 'final':
                if (this.onTranscriptionCallback) {
                  this.onTranscriptionCallback({
                    text:        data.text        || '',
                    accumulated: data.accumulated || data.text || '',
                    type:        data.type,
                  });
                }
                break;

              case 'status':
                console.log(`[TranscriptionClient] Status: ${data.status}`);
                // Surface every status change to the renderer so it can show
                // "Listening…", "Processing…", and "Stopped" states.
                if (this.onStatusCallback) {
                  this.onStatusCallback(data.status);
                }
                break;

              case 'error':
                console.error('[TranscriptionClient] Server error:', data.message);
                if (this.onErrorCallback) this.onErrorCallback(data.message);
                break;

              default:
                console.warn('[TranscriptionClient] Unknown message type:', data.type);
            }
          } catch (error) {
            console.error('[TranscriptionClient] Failed to parse message:', error);
          }
        });

        this.ws.on('error', (error: Error) => {
          console.error('[TranscriptionClient] WebSocket error:', error.message);
          this.connectionPromise = null;
          reject(new Error('Failed to connect to transcription service'));
        });

        this.ws.on('close', () => {
          console.log('[TranscriptionClient] WebSocket closed');
          this.ws = null;
          this.connectionPromise = null;

          if (this.currentSessionId && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[TranscriptionClient] Reconnecting (attempt ${this.reconnectAttempts})…`);
            setTimeout(() => {
              this.ensureConnection().catch(err =>
                console.error('[TranscriptionClient] Reconnect failed:', err)
              );
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        });

      } catch (error) {
        console.error('[TranscriptionClient] Failed to create WebSocket:', error);
        this.connectionPromise = null;
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async startTranscription(
    sessionId: string,
    onTranscription: (data: { text: string; accumulated: string; type: string }) => void,
    onError?:        (error: string) => void,
    onStatus?:       (status: string) => void,
  ): Promise<void> {
    console.log(`[TranscriptionClient] startTranscription — session: ${sessionId}`);

    this.onTranscriptionCallback = onTranscription;
    this.onErrorCallback         = onError  || null;
    this.onStatusCallback        = onStatus || null;

    try {
      await this.ensureConnection();

      if (!this.ws) throw new Error('WebSocket not connected');

      this.currentSessionId = sessionId;

      const msg = JSON.stringify({ action: 'start', session_id: sessionId });
      console.log(`[TranscriptionClient] → ${msg}`);
      this.ws.send(msg);

    } catch (error) {
      console.error('[TranscriptionClient] Failed to start transcription:', error);
      if (onError) onError(error instanceof Error ? error.message : 'Failed to start transcription');
      throw error;
    }
  }

  async stopTranscription(): Promise<void> {
    console.log('[TranscriptionClient] stopTranscription called');

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[TranscriptionClient] No active connection to stop');
      this.currentSessionId = null;
      return;
    }

    try {
      const msg = JSON.stringify({ action: 'stop' });
      console.log(`[TranscriptionClient] → ${msg}`);
      this.ws.send(msg);
      this.currentSessionId = null;
    } catch (error) {
      console.error('[TranscriptionClient] Failed to stop transcription:', error);
    }
  }

  disconnect(): void {
    console.log('[TranscriptionClient] disconnect called');
    this.currentSessionId        = null;
    this.onTranscriptionCallback = null;
    this.onErrorCallback         = null;
    this.onStatusCallback        = null;

    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace('ws://', 'http://')}/health`);
      const data: any = await response.json();
      return data.status === 'ok';
    } catch {
      return false;
    }
  }
}
