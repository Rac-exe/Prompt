import express from 'express';
import http from 'http';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'code-intelligence' });
});

app.get('/health/ready', (_req, res) => {
  res.json({ status: 'ready', checks: { service_ready: true, local_sqlite: true } });
});

app.get('/', (_req, res) => {
  res.json({ service: 'code-intelligence', version: '1.0.0-mock' });
});

// Retrieve endpoint
app.get('/api/retrieve', (req, res) => {
  res.json({
    mode: req.query.mode || 'bug',
    ranked_chunks: [],
    related_chunks: [],
    branch_context: null,
    query_intent: 'test',
    query_concepts: [],
  });
});

// Context endpoint
app.post('/api/context', (_req, res) => {
  res.json({
    mode: req.body?.mode || 'bug',
    probable_locations: [],
    related_locations: [],
    answer: null,
    sources: [],
    intent: 'test',
    concepts: [],
    project_summary: null,
    branch_context: null,
    search_id: 'mock-search-1',
  });
});

app.post('/api/feedback', (_req, res) => {
  res.json({ status: 'recorded' });
});

// Projects CRUD
app.post('/api/projects', (_req, res) => {
  res.status(201).json({ id: 'mock-project-1', user_id: 'mock-user', name: 'Test Project', index_status: 'stale' });
});

app.get('/api/projects', (_req, res) => {
  res.json([{ id: 'mock-project-1', user_id: 'mock-user', name: 'Test Project', index_status: 'stale' }]);
});

// Sync
app.post('/api/sync', (_req, res) => {
  res.json({ status: 'synced', scope: 'all' });
});

// Ingest
app.post('/api/index/ingest', (req, res) => {
  const chunks = req.body?.chunks?.length || 0;
  res.status(202).json({ status: 'accepted', project_id: req.body?.project_id, chunks_queued: chunks, edges_queued: 0, queue: 'background' });
});

const server = http.createServer(app);

export function startMockCodeIntelServer(port = 8002): Promise<http.Server> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[MockCodeIntel] Running on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

export function stopMockCodeIntelServer(): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

if (require.main === module) {
  startMockCodeIntelServer(8002);
}
