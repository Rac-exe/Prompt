/**
 * TranscriptionClient
 * 
 * Manages WebSocket connection to Python Whisper transcription service.
 * Uses the `ws` package (Node.js) — NOT the browser WebSocket API.
 * Provides real-time speech-to-text transcription with live updates.
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
  private onErrorCallback: ((error: string) => void) | null = null;
  private connectionPromise: Promise<void> | null = null;

  constructor(baseUrl: string = 'ws://127.0.0.1:8001') {
    this.baseUrl = baseUrl;
  }

  /**
   * Ensure WebSocket connection is established
   */
  private async ensureConnection(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

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

            if (data.type === 'transcription' || data.type === 'final') {
              if (this.onTranscriptionCallback) {
                this.onTranscriptionCallback({
                  text: data.text || '',
                  accumulated: data.accumulated || data.text || '',
                  type: data.type
                });
              }
            } else if (data.type === 'error') {
              console.error('[TranscriptionClient] Server error:', data.message);
              if (this.onErrorCallback) {
                this.onErrorCallback(data.message);
              }
            } else if (data.type === 'status') {
              console.log('[TranscriptionClient] Status:', data.status);
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

          // Auto-reconnect if we have an active session
          if (this.currentSessionId && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[TranscriptionClient] Reconnecting (attempt ${this.reconnectAttempts})...`);
            setTimeout(() => {
              this.ensureConnection().catch(err => {
                console.error('[TranscriptionClient] Reconnect failed:', err);
              });
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

  /**
   * Start transcription session
   */
  async startTranscription(
    sessionId: string,
    onTranscription: (data: { text: string; accumulated: string; type: string }) => void,
    onError?: (error: string) => void
  ): Promise<void> {
    try {
      // Store callbacks so the message handler can use them
      this.onTranscriptionCallback = onTranscription;
      this.onErrorCallback = onError || null;

      await this.ensureConnection();

      if (!this.ws) {
        throw new Error('WebSocket not connected');
      }

      this.currentSessionId = sessionId;

      // Send start command
      this.ws.send(JSON.stringify({
        action: 'start',
        session_id: sessionId
      }));

      console.log('[TranscriptionClient] Transcription started:', sessionId);
    } catch (error) {
      console.error('[TranscriptionClient] Failed to start transcription:', error);
      if (onError) {
        onError(error instanceof Error ? error.message : 'Failed to start transcription');
      }
      throw error;
    }
  }

  /**
   * Stop transcription session
   */
  async stopTranscription(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[TranscriptionClient] No active connection to stop');
      this.currentSessionId = null;
      return;
    }

    try {
      this.ws.send(JSON.stringify({
        action: 'stop'
      }));

      console.log('[TranscriptionClient] Transcription stopped');
      this.currentSessionId = null;
    } catch (error) {
      console.error('[TranscriptionClient] Failed to stop transcription:', error);
    }
  }

  /**
   * Close WebSocket connection entirely
   */
  disconnect(): void {
    this.currentSessionId = null;
    this.onTranscriptionCallback = null;
    this.onErrorCallback = null;

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }

  /**
   * Check if transcription service is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace('ws://', 'http://')}/health`);
      const data: any = await response.json();
      return data.status === 'ok';
    } catch (error) {
      return false;
    }
  }
}
