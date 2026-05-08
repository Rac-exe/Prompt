/**
 * Transcription integration smoke tests.
 *
 * Tests the transcription client against the mock WebSocket server
 * to verify the full start -> audio -> transcription -> stop flow.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@sentry/electron/main', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts, cb) => cb({ setStatus: vi.fn(), end: vi.fn() })),
}));

vi.mock('../../electron/main/utils/auth-state', () => ({
  authState: {
    isAuthenticated: true,
    currentAccessToken: 'mock-token',
    currentUserId: 'mock-user-id',
  },
}));

describe('Transcription - Full Flow Integration', () => {
  let TranscriptionClient: any;

  beforeAll(async () => {
    const mod = await import('../../electron/main/api/transcription-client');
    TranscriptionClient = mod.TranscriptionClient;
  });

  it('full transcription lifecycle: connect -> start -> audio -> receive text -> stop', async () => {
    const client = new TranscriptionClient('ws://127.0.0.1:18001');

    const transcriptions: any[] = [];
    const statuses: string[] = [];
    const errors: string[] = [];

    await client.startSession('smoke-test-session', 16000, {
      onTranscription: (data: any) => transcriptions.push(data),
      onError: (err: string) => errors.push(err),
      onStatus: (status: string) => statuses.push(status),
    });

    await new Promise(r => setTimeout(r, 300));
    expect(statuses).toContain('started');

    // Send multiple audio chunks
    for (let i = 0; i < 3; i++) {
      const fakeAudio = Buffer.alloc(1024, 0x42 + i);
      client.sendAudioChunk(fakeAudio);
      await new Promise(r => setTimeout(r, 100));
    }

    await new Promise(r => setTimeout(r, 300));
    expect(transcriptions.length).toBeGreaterThan(0);
    expect(transcriptions[0].text).toBe('hello world');
    expect(transcriptions[0].is_final).toBe(true);

    // Stop
    await client.stopSession();
    await new Promise(r => setTimeout(r, 300));

    expect(errors.length).toBe(0);
  });

  it('health check returns true when server is reachable', async () => {
    const client = new TranscriptionClient('ws://127.0.0.1:18001');
    const healthy = await client.healthCheck();
    expect(healthy).toBe(true);
  });

  it('health check returns false for unreachable server', async () => {
    const client = new TranscriptionClient('ws://127.0.0.1:19999');
    const healthy = await client.healthCheck();
    expect(healthy).toBe(false);
  });
});
