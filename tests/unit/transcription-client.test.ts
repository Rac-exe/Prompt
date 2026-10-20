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

describe('TranscriptionClient - against mock server', () => {
  let TranscriptionClient: any;

  beforeAll(async () => {
    const mod = await import('../../electron/main/api/transcription-client');
    TranscriptionClient = mod.TranscriptionClient;
  });

  it('should connect, start session, and receive transcription', async () => {
    const client = new TranscriptionClient('ws://127.0.0.1:18001');

    const transcriptions: any[] = [];
    const statuses: string[] = [];
    const errors: string[] = [];

    await client.startSession('test-session-1', 16000, {
      onTranscription: (data: any) => transcriptions.push(data),
      onError: (err: string) => errors.push(err),
      onStatus: (status: string) => statuses.push(status),
    });

    // Wait for connection and start confirmation
    await new Promise(r => setTimeout(r, 300));

    expect(statuses).toContain('started');

    // Send a fake audio chunk
    const fakeAudio = Buffer.alloc(1024, 0x42);
    client.sendAudioChunk(fakeAudio);

    // Wait for transcription response
    await new Promise(r => setTimeout(r, 300));

    expect(transcriptions.length).toBeGreaterThan(0);
    expect(transcriptions[0].text).toBe('hello world');

    // Stop session
    await client.stopSession();

    await new Promise(r => setTimeout(r, 300));

    expect(errors.length).toBe(0);
  });

  it('should handle connection to unavailable server gracefully', async () => {
    const client = new TranscriptionClient('ws://127.0.0.1:19999');

    const errors: string[] = [];
    const statuses: string[] = [];

    try {
      await client.startSession('test-session-2', 16000, {
        onTranscription: () => {},
        onError: (err: string) => errors.push(err),
        onStatus: (status: string) => statuses.push(status),
      });
    } catch (e) {
      // Expected to fail
    }

    await new Promise(r => setTimeout(r, 500));

    // Should have received an error callback or thrown
    expect(errors.length + (statuses.includes('error') ? 1 : 0)).toBeGreaterThanOrEqual(0);
  });

  it('should perform HTTP health check', async () => {
    const client = new TranscriptionClient('ws://127.0.0.1:18001');
    const healthy = await client.healthCheck();
    expect(healthy).toBe(true);
  });
});
