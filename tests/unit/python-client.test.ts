import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';

// Mock Electron-specific modules
vi.mock('@sentry/electron/main', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts, cb) => cb({ setStatus: vi.fn(), setAttribute: vi.fn() })),
  setTag: vi.fn(),
}));

vi.mock('@sentry/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fmt: (s: any) => s },
  getActiveSpan: vi.fn(),
  spanToTraceHeader: vi.fn().mockReturnValue(''),
  getDynamicSamplingContextFromSpan: vi.fn().mockReturnValue({}),
  dynamicSamplingContextToSentryBaggageHeader: vi.fn().mockReturnValue(''),
}));

vi.mock('../../electron/main/utils/auth-state', () => ({
  authState: {
    isAuthenticated: true,
    currentAccessToken: 'mock-token',
    currentUserId: 'mock-user-id',
  },
}));

describe('PythonClient - against mock server', () => {
  let PythonClient: any;

  beforeAll(async () => {
    const mod = await import('../../electron/main/api/python-client');
    PythonClient = mod.PythonClient;
  });

  it('should perform health check successfully', async () => {
    const client = new PythonClient('http://127.0.0.1:18001');
    const healthy = await client.healthCheck();
    expect(healthy).toBe(true);
  });

  it('should call clarify endpoint and receive response', async () => {
    const client = new PythonClient('http://127.0.0.1:18001');
    const result = await client.clarify('test prompt');
    expect(result).toBeDefined();
    expect(result.should_clarify).toBe(false);
    expect(result.questions).toEqual([]);
  });

  it('should call generate-title endpoint', async () => {
    const client = new PythonClient('http://127.0.0.1:18001');
    const title = await client.generateTitle('hello world test prompt');
    expect(title).toBeDefined();
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
  });

  it('should perform streaming optimization via WebSocket', async () => {
    const client = new PythonClient('http://127.0.0.1:18001');

    const chunks: string[] = [];
    const result = await client.optimizeStream(
      'make this better',
      false,
      null,
      (chunk: string, accumulated: string) => {
        chunks.push(chunk);
      },
      'thinking',
      '',
      [],
      null,
      null,
      null,
      false,
      null,
      null,
    );

    expect(result.text).toContain('[OPTIMIZED]');
    expect(result.text).toContain('make this better');
    expect(chunks.length).toBeGreaterThan(0);

    // Cleanup WebSocket
    client.disconnect?.();
  });

  it('should handle health check failure gracefully', async () => {
    const client = new PythonClient('http://127.0.0.1:19999');
    const healthy = await client.healthCheck();
    expect(healthy).toBe(false);
  });
});
