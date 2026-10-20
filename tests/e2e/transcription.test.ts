/**
 * Transcription integration smoke tests.
 *
 * Tests the transcription client against the mock WebSocket server
 * to verify the full start -> audio -> transcription -> stop flow.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// The client reads the user's Deepgram key from the local settings DB
vi.mock('../../electron/main/database/services/ai-settings-service', () => ({
  aiSettings: {
    get: () => ({ openrouterApiKey: 'sk-or-test', optimizerModel: 'mock/optimizer', ragModel: 'mock/rag', deepgramApiKey: null }),
    isConfigured: () => true,
    pythonHeaders: () => ({ 'X-Prmpt-OpenRouter-Key': 'sk-or-test' }),
    codeIntelHeaders: () => ({ 'X-Prmpt-OpenRouter-Key': 'sk-or-test' }),
    llmPayload: () => ({ api_key: 'sk-or-test', optimizer_model: 'mock/optimizer', rag_model: 'mock/rag' }),
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
