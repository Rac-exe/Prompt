import axios, { AxiosInstance } from 'axios';
import { aiSettings } from '../database/services/ai-settings-service';
import { getCodeIntelRoot } from '../database/code-intel-local-store';

export interface IngestPayload {
  project_id: string;
  chunks: ChunkData[];
  call_graph: CallGraphEdge[];
  language_map: Record<string, number>;
  branch?: string;
  cleanup_scope?: 'none' | 'file' | 'project';
  cleanup_keys?: ChunkKey[];
}

export interface ChunkData {
  file_path: string;
  start_line: number;
  end_line: number;
  chunk_type: 'file' | 'class' | 'function' | 'method';
  name: string;
  signature?: string;
  language: string;
  docstring?: string;
  content_hash: string;
  callees: string[];
  imports: string[];
  code_body?: string;
  is_exported?: boolean;
  scope_type?: 'file' | 'class' | 'function' | 'method' | 'config';
  chunk_index?: number;
  parent_scope_name?: string;
}

export interface CallGraphEdge {
  from_name: string;
  from_file: string;
  to_name: string;
  to_file: string;
  relationship_type: 'calls' | 'imports' | 'inherits' | 'implements';
}

export interface ChunkKey {
  file_path: string;
  name: string;
  chunk_type: ChunkData['chunk_type'];
}

export interface ProjectInfo {
  id: string;
  user_id: string;
  name: string;
  repo_url?: string;
  local_path?: string;
  current_branch?: string;
  default_branch: string;
  index_status: string;
  last_indexed_at?: string;
  github_repo_owner?: string;
  github_repo_name?: string;
}

export interface RetrievedChunk {
  id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  chunk_type: string;
  name: string;
  signature?: string;
  language: string;
  semantic_summary?: string;
  summary_purpose?: string;
  code_body?: string;
  concepts?: string[];
  similarity_score: number;
  branch?: string;
  branch_diverged: boolean;
  relevance_reasoning?: string;
  probable_issue?: string;
}

export interface RetrieveResult {
  ranked_chunks: RetrievedChunk[];
  related_chunks: RetrievedChunk[];
  branch_context?: Record<string, any>;
}

export interface ContextLocation extends Omit<RetrievedChunk, 'id' | 'similarity_score'> {
  id?: string;
  confidence_score?: number;
  similarity_score?: number;
}

export interface ContextResult {
  mode: 'find' | 'ask' | 'bug' | 'optimize';
  probable_locations: ContextLocation[];
  related_locations: ContextLocation[];
  answer?: string | null;
  sources?: ContextLocation[];
  intent?: string;
  concepts?: string[];
  project_summary?: string | null;
  branch_context?: Record<string, any>;
  search_id?: string | null;
}

function sanitizeAxiosError(err: unknown): Error {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }

  const method = err.config?.method?.toUpperCase() || 'REQUEST';
  const url = err.config?.url || 'unknown-url';
  const status = err.response?.status;
  const code = err.code;
  const detail = typeof err.response?.data === 'string'
    ? err.response.data.slice(0, 300)
    : err.response?.data?.detail || err.response?.statusText || err.message;

  const safe = new Error(
    `Code intelligence ${method} ${url} failed${status ? ` with status ${status}` : ''}${code ? ` (${code})` : ''}: ${detail}`,
  );
  safe.name = 'CodeIntelRequestError';
  safe.stack = err.stack;
  return safe;
}

export class CodeIntelClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.CODE_INTELLIGENCE_SERVICE_URL || 'http://127.0.0.1:8002';
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 300_000,
      headers: {
        'Content-Type': 'application/json',
        'X-Prmpt-Code-Intel-Root': getCodeIntelRoot(),
      },
    });

    // Send the user's OpenRouter key and chosen RAG model with every request
    this.client.interceptors.request.use((config) => {
      config.headers = config.headers ?? {};
      for (const [name, value] of Object.entries(aiSettings.codeIntelHeaders())) {
        config.headers[name] = value;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => Promise.reject(sanitizeAxiosError(error)),
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await this.client.get('/health');
      const healthy = resp.data?.status === 'ok';
      return healthy;
    } catch (err) {
      console.error(sanitizeAxiosError(err));
      return false;
    }
  }

  async createProject(data: {
    name: string;
    repo_url?: string;
    local_path?: string;
    default_branch?: string;
    github_repo_owner?: string;
    github_repo_name?: string;
  }): Promise<ProjectInfo> {
    const resp = await this.client.post('/api/projects', data);
    return resp.data;
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const resp = await this.client.get('/api/projects');
    return resp.data;
  }

  async getProject(projectId: string): Promise<ProjectInfo> {
    const resp = await this.client.get(`/api/projects/${projectId}`);
    return resp.data;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/api/projects/${projectId}`);
  }

  async deleteChunksForFile(projectId: string, filePath: string): Promise<void> {
    await this.client.delete(`/api/projects/${projectId}/chunks`, {
      params: { file_path: filePath },
    });
  }

  async ingestSkeleton(payload: IngestPayload): Promise<{ status: string; chunks_queued: number }> {
    const resp = await this.client.post('/api/index/ingest', payload, { timeout: 300_000 });
    return resp.data;
  }

  async retrieve(params: {
    project_id: string;
    query: string;
    branch?: string;
    limit?: number;
    mode?: 'find' | 'ask' | 'bug' | 'optimize';
  }): Promise<RetrieveResult> {
    const resp = await this.client.get('/api/retrieve', { params });
    return resp.data;
  }

  async context(params: {
    project_id: string;
    query: string;
    branch?: string;
    limit?: number;
    mode?: 'find' | 'ask' | 'bug' | 'optimize';
  }): Promise<ContextResult> {
    const resp = await this.client.post('/api/context', params);
    return resp.data;
  }

  /**
   * Streaming Ask: POSTs to /api/context/stream and parses the SSE stream,
   * invoking callbacks as events arrive. Returns an abort() function. The
   * answer is streamed token-by-token so the renderer shows output in seconds.
   */
  contextStream(
    params: { project_id: string; query: string; branch?: string; limit?: number; mode?: 'find' | 'ask' | 'bug' | 'optimize' },
    handlers: {
      onLocations?: (data: any) => void;
      onToken?: (delta: string) => void;
      onDone?: (data: any) => void;
      onError?: (message: string) => void;
    },
  ): () => void {
    const controller = new AbortController();
    const url = `${this.baseUrl}/api/context/stream`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'X-Prmpt-Code-Intel-Root': getCodeIntelRoot(),
      ...aiSettings.codeIntelHeaders(),
    };

    (async () => {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(params),
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error(`context/stream HTTP ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // SSE events are separated by a blank line; parse incrementally.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of raw.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const dataStr = dataLines.join('\n');
            if (!dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (eventName === 'locations') handlers.onLocations?.(parsed);
              else if (eventName === 'token') handlers.onToken?.(parsed.delta ?? '');
              else if (eventName === 'done') handlers.onDone?.(parsed);
              else if (eventName === 'error') handlers.onError?.(parsed.message ?? 'stream error');
            } catch {
              // ignore malformed event
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const safe = sanitizeAxiosError(err);
        console.error(safe);
        handlers.onError?.(safe.message);
      }
    })();

    return () => controller.abort();
  }
}
