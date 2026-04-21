import axios, { AxiosInstance } from 'axios';
import * as Sentry from '@sentry/electron/main';
import { authState } from '../utils/auth-state';

export interface IngestPayload {
  project_id: string;
  chunks: ChunkData[];
  call_graph: CallGraphEdge[];
  language_map: Record<string, number>;
  branch?: string;
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
}

export interface CallGraphEdge {
  from_name: string;
  from_file: string;
  to_name: string;
  to_file: string;
  relationship_type: 'calls' | 'imports' | 'inherits' | 'implements';
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
  code_body?: string;
  concepts?: string[];
  similarity_score: number;
  branch?: string;
  branch_diverged: boolean;
}

export interface RetrieveResult {
  ranked_chunks: RetrievedChunk[];
  related_chunks: RetrievedChunk[];
  branch_context?: Record<string, any>;
}

export class CodeIntelClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.CODE_INTELLIGENCE_SERVICE_URL || 'http://127.0.0.1:8002';
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 120_000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.client.interceptors.request.use((config) => {
      const token = authState.currentAccessToken;
      if (token) {
        config.headers = config.headers ?? {};
        config.headers['Authorization'] = `Bearer ${token}`;
      }
      return config;
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await this.client.get('/health');
      const healthy = resp.data?.status === 'ok';
      Sentry.setTag('code_intel.healthy', String(healthy));
      return healthy;
    } catch (err) {
      Sentry.setTag('code_intel.healthy', 'false');
      Sentry.captureException(err, { level: 'warning', tags: { component: 'code-intel-client', op: 'healthCheck' } });
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
    return Sentry.startSpan({ name: 'codeIntel.ingestSkeleton', op: 'code-intel.ingest' }, async (span) => {
      span.setAttribute('project_id', payload.project_id);
      span.setAttribute('chunks_count', payload.chunks.length);
      const resp = await this.client.post('/api/index/ingest', payload, { timeout: 300_000 });
      return resp.data;
    });
  }

  async retrieve(params: {
    project_id: string;
    query: string;
    branch?: string;
    limit?: number;
  }): Promise<RetrieveResult> {
    return Sentry.startSpan({ name: 'codeIntel.retrieve', op: 'code-intel.search' }, async (span) => {
      span.setAttribute('project_id', params.project_id);
      const resp = await this.client.get('/api/retrieve', { params });
      Sentry.addBreadcrumb({ category: 'code-intel', message: 'Context retrieved', level: 'info', data: { project_id: params.project_id, chunks: resp.data?.ranked_chunks?.length ?? 0 } });
      return resp.data;
    });
  }

  async syncProject(projectId?: string): Promise<void> {
    await this.client.post('/api/sync', { project_id: projectId });
  }
}
