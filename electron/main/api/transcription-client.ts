/**
 * TranscriptionClient
 *
 * Manages a per-session WebSocket connection to the Python streaming
 * transcription service at /ws/transcribe-stream.
 *
 * Each recording session opens a fresh WebSocket. When the session ends
 * the socket is closed — no persistent connection or reconnection logic.
 */
const WebSocket = require('ws');
import * as Sentry from '@sentry/electron/main';
import { authState } from '../utils/auth-state';

export interface TranscriptionCallbacks {
  onTranscription: (data: {
    text: string;
    accumulated: string;
    type: string;
    is_final?: boolean;
    speech_final?: boolean;
  }) => void;
  onError: (error: string) => void;
  onStatus: (status: string) => void;
}

export class TranscriptionClient {
  private ws: any | null = null;
  private baseUrl: string;
  private callbacks: TranscriptionCallbacks | null = null;
  private sessionReady = false;
  private pendingChunks: Buffer[] = [];
  private chunkCount = 0;
  private sessionId: string | null = null;
  private finishSpan: (() => void) | null = null;

  constructor(baseUrl: string = 'ws://127.0.0.1:8001') {
    this.baseUrl = baseUrl;
  }

  async startSession(
    sessionId: string,
    sampleRate: number,
    callbacks: TranscriptionCallbacks,
  ): Promise<void> {
    this.forceClose();

    this.callbacks = callbacks;
    this.sessionReady = false;
    this.pendingChunks = [];
    this.chunkCount = 0;
    this.sessionId = sessionId;

    const token = authState.currentAccessToken;
    const wsUrl = token
      ? `${this.baseUrl}/ws/transcribe-stream?token=${encodeURIComponent(token)}`
      : `${this.baseUrl}/ws/transcribe-stream`;

    console.log(`[TranscriptionClient] Connecting…`);

    Sentry.addBreadcrumb({
      category: 'transcription',
      message: 'Connecting to transcription service',
      level: 'info',
      data: { sessionId, sampleRate },
    });

    return new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.on('open', () => {
          if (this.ws !== ws) return;
          console.log('[TranscriptionClient] WebSocket connected');

          Sentry.addBreadcrumb({
            category: 'transcription',
            message: 'WebSocket connected to backend',
            level: 'info',
            data: { sessionId },
          });

          const startMsg = JSON.stringify({
            action: 'start',
            session_id: sessionId,
            sample_rate: sampleRate,
          });
          ws.send(startMsg);

          this.sessionReady = true;
          if (this.pendingChunks.length > 0) {
            console.log(`[TranscriptionClient] Flushing ${this.pendingChunks.length} buffered chunks`);
            Sentry.addBreadcrumb({
              category: 'transcription',
              message: 'Flushing buffered audio chunks',
              level: 'info',
              data: { count: this.pendingChunks.length, sessionId },
            });
            for (const chunk of this.pendingChunks) {
              ws.send(chunk);
            }
            this.chunkCount += this.pendingChunks.length;
          }
          this.pendingChunks = [];
          resolve();
        });

        ws.on('message', (rawData: any) => {
          if (this.ws !== ws) return;
          try {
            const data = JSON.parse(rawData.toString());
            this.routeMessage(data);
          } catch (err) {
            console.error('[TranscriptionClient] Failed to parse message:', err);
            Sentry.captureException(err, { tags: { component: 'transcription-client', sessionId } });
          }
        });

        ws.on('error', (error: Error) => {
          if (this.ws !== ws) return;
          console.error('[TranscriptionClient] WebSocket error:', error.message);
          Sentry.addBreadcrumb({
            category: 'transcription',
            message: 'WebSocket error',
            level: 'error',
            data: { error: error.message, sessionId },
          });
          Sentry.captureException(error, { tags: { component: 'transcription-client', sessionId } });
          this.callbacks?.onError(error.message);
          reject(new Error('Failed to connect to transcription service'));
        });

        ws.on('close', () => {
          if (this.ws !== ws) return;
          console.log(`[TranscriptionClient] WebSocket closed (sent ${this.chunkCount} chunks)`);
          Sentry.addBreadcrumb({
            category: 'transcription',
            message: 'WebSocket closed',
            level: 'info',
            data: { chunksSent: this.chunkCount, sessionId },
          });
          this.ws = null;
          this.sessionReady = false;
        });
      } catch (error: any) {
        console.error('[TranscriptionClient] Failed to create WebSocket:', error);
        Sentry.captureException(error, { tags: { component: 'transcription-client' } });
        this.callbacks?.onError(error?.message ?? 'WebSocket creation failed');
        reject(error);
      }
    });
  }

  sendAudioChunk(chunk: Buffer): void {
    if (!this.sessionReady) {
      this.pendingChunks.push(chunk);
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(chunk);
    this.chunkCount++;
    if (this.chunkCount <= 3 || this.chunkCount % 100 === 0) {
      console.log(`[TranscriptionClient] chunk #${this.chunkCount} (${chunk.length} bytes)`);
    }
  }

  async stopSession(): Promise<void> {
    console.log(`[TranscriptionClient] stopSession (sent ${this.chunkCount} chunks total)`);

    Sentry.addBreadcrumb({
      category: 'transcription',
      message: 'Stopping transcription session',
      level: 'info',
      data: { chunksSent: this.chunkCount, sessionId: this.sessionId },
    });

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.forceClose();
      return;
    }

    try {
      this.ws.send(JSON.stringify({ action: 'stop' }));
    } catch (err) {
      console.error('[TranscriptionClient] Error sending stop:', err);
      Sentry.captureException(err, { tags: { component: 'transcription-client', sessionId: this.sessionId ?? undefined } });
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    this.forceClose();
  }

  disconnect(): void {
    this.forceClose();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl.replace('ws://', 'http://')}/health`,
      );
      const data: any = await response.json();
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  private routeMessage(data: any): void {
    if (!this.callbacks) return;

    switch (data.type) {
      case 'transcription':
        this.callbacks.onTranscription({
          text: data.text ?? '',
          accumulated: data.accumulated ?? data.text ?? '',
          type: data.type,
          is_final: data.is_final,
          speech_final: data.speech_final,
        });
        if (data.is_final) {
          Sentry.addBreadcrumb({
            category: 'transcription',
            message: 'Received finalized transcription segment',
            level: 'info',
            data: { sessionId: this.sessionId, speech_final: data.speech_final },
          });
        }
        break;

      case 'final':
        Sentry.addBreadcrumb({
          category: 'transcription',
          message: 'Received final accumulated transcription',
          level: 'info',
          data: { sessionId: this.sessionId, length: (data.accumulated ?? '').length },
        });
        this.callbacks.onTranscription({
          text: data.text ?? '',
          accumulated: data.accumulated ?? data.text ?? '',
          type: data.type,
          is_final: data.is_final,
          speech_final: data.speech_final,
        });
        break;

      case 'status':
        console.log(`[TranscriptionClient] status: ${data.status}`);
        Sentry.addBreadcrumb({
          category: 'transcription',
          message: `Transcription status: ${data.status}`,
          level: 'info',
          data: { status: data.status, sessionId: this.sessionId },
        });
        this.callbacks.onStatus(data.status);
        break;

      case 'error':
        console.error(`[TranscriptionClient] server error: ${data.message}`);
        Sentry.addBreadcrumb({
          category: 'transcription',
          message: 'Transcription server error',
          level: 'error',
          data: { error: data.message, sessionId: this.sessionId },
        });
        this.callbacks.onError(data.message ?? 'Unknown server error');
        break;

      default:
        console.warn('[TranscriptionClient] Unknown message type:', data.type);
    }
  }

  private forceClose(): void {
    this.sessionReady = false;
    this.pendingChunks = [];
    this.callbacks = null;
    if (this.finishSpan) {
      this.finishSpan();
      this.finishSpan = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try { ws.removeAllListeners(); ws.close(); } catch (_) {}
    }
  }
}
