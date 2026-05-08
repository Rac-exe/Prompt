import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Health endpoints
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'prompt-optimizer' });
});

app.get('/health/ready', (_req, res) => {
  res.json({ status: 'ready', checks: { llm_api_key: true, optimizer_model: true, whisper_model: true } });
});

// Clarify endpoint
app.post('/clarify', (_req, res) => {
  res.json({ should_clarify: false, is_complex: false, complexity_reason: null, suggested_sections: [], questions: [] });
});

// Generate title
app.post('/generate-title', (req, res) => {
  const prompt = req.body?.prompt || '';
  const title = prompt.split(' ').slice(0, 4).join(' ') || 'Test Title';
  res.json({ title });
});

// Optimize (non-streaming)
app.post('/optimize', (req, res) => {
  const original = req.body?.prompt || '';
  res.json({
    optimized: `[OPTIMIZED] ${original}`,
    original,
    model: 'mock/test-model',
    latency_ms: 42,
  });
});

// Transcribe audio (REST)
app.post('/transcribe-audio', (_req, res) => {
  res.json({ text: 'mock transcription result' });
});

// Upload image
app.post('/upload/image', (_req, res) => {
  res.json({ url: 'https://mock.cloudinary.com/test-image.png', public_id: 'test-image' });
});

// Extract memory facts
app.post('/extract-memory-facts', (_req, res) => {
  res.json({ facts: [{ category: 'preference', key: 'style', value: 'concise', confidence: 0.9 }] });
});

// Auth endpoints (simplified mocks)
app.post('/auth/send-signup-otp', (_req, res) => res.json({ success: true }));
app.post('/auth/verify-signup-otp', (_req, res) => res.json({ valid: true, data: { name: 'Test', dob: '2000-01-01', email: 'test@test.com', password: 'hashed' } }));
app.post('/auth/send-reset-otp', (_req, res) => res.json({ success: true }));
app.post('/auth/reset-password', (_req, res) => res.json({ valid: true, success: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req) => {
  const url = req.url || '';

  if (url.startsWith('/ws/optimize-stream')) {
    handleOptimizeStream(ws);
  } else if (url.startsWith('/ws/transcribe-stream')) {
    handleTranscribeStream(ws);
  }
});

function handleOptimizeStream(ws: WebSocket) {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'abort') {
        return;
      }

      const requestId = msg.request_id || 'test-req';
      const original = msg.prompt || '';
      const optimized = `[OPTIMIZED] ${original}`;

      // Send chunks
      const words = optimized.split(' ');
      let accumulated = '';
      words.forEach((word, i) => {
        accumulated += (i > 0 ? ' ' : '') + word;
        ws.send(JSON.stringify({
          type: 'chunk',
          request_id: requestId,
          content: (i > 0 ? ' ' : '') + word,
          accumulated,
        }));
      });

      // Send complete
      ws.send(JSON.stringify({
        type: 'complete',
        request_id: requestId,
        optimized,
        original,
        models_used: { optimizer: 'mock/test-model', summarizer: 'mock/summarizer' },
      }));
    } catch {
      // Binary or invalid — ignore
    }
  });
}

function handleTranscribeStream(ws: WebSocket) {
  let started = false;

  ws.on('message', (data) => {
    if (typeof data === 'string' || (data instanceof Buffer && data[0] === 0x7b)) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'start') {
          started = true;
          ws.send(JSON.stringify({ type: 'status', status: 'started', session_id: msg.session_id }));
        } else if (msg.action === 'stop') {
          ws.send(JSON.stringify({ type: 'final', text: 'final mock transcription', accumulated: 'hello world final mock transcription' }));
          ws.send(JSON.stringify({ type: 'status', status: 'stopped' }));
          started = false;
        }
      } catch { /* binary data that looks like JSON start */ }
    } else if (started) {
      // Binary audio data — send fake transcription
      ws.send(JSON.stringify({
        type: 'transcription',
        text: 'hello world',
        accumulated: 'hello world',
        is_final: true,
        speech_final: false,
      }));
    }
  });
}

export function startMockPythonServer(port = 8001): Promise<http.Server> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[MockPython] Running on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

export function stopMockPythonServer(): Promise<void> {
  return new Promise((resolve) => {
    wss.close();
    server.close(() => resolve());
  });
}

// Allow running standalone
if (require.main === module) {
  startMockPythonServer(8001);
}
