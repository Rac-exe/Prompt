/**
 * AI provider settings: the user's OpenRouter API key, the models chosen for
 * prompt optimization and for the code-intelligence (RAG) pipeline, and an
 * optional Deepgram key for voice input.
 *
 * Keys live only in the main process. They are stored in the local database,
 * encrypted with the OS keystore (safeStorage) where that works without
 * prompts, and are never sent to the renderer: it only sees whether a key is
 * set plus its last four characters.
 */

import { safeStorage } from 'electron';
import { kvGet, kvSet } from '../local-db';

export const DEFAULT_OPTIMIZER_MODEL = 'anthropic/claude-haiku-4.5';
export const DEFAULT_RAG_MODEL = 'anthropic/claude-haiku-4.5';

const KV_KEY = 'ai_settings';
const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const MODELS_CACHE_MS = 60 * 60 * 1000;

export interface AISettings {
  openrouterApiKey: string;
  optimizerModel: string;
  ragModel: string;
  deepgramApiKey: string;
}

/** What the renderer is allowed to see. */
export interface AISettingsView {
  configured: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string;
  optimizerModel: string;
  ragModel: string;
  hasDeepgramKey: boolean;
  deepgramKeyPreview: string;
}

/** Partial update. A key of null clears it; undefined leaves it unchanged. */
export interface AISettingsUpdate {
  openrouterApiKey?: string | null;
  optimizerModel?: string;
  ragModel?: string;
  deepgramApiKey?: string | null;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  supportsTools: boolean;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
}

export interface KeyValidation {
  valid: boolean;
  error?: string;
  label?: string;
  limitRemaining?: number | null;
}

interface StoredSecret {
  enc: boolean;
  value: string;
}

interface StoredSettings {
  openrouterApiKey?: StoredSecret;
  deepgramApiKey?: StoredSecret;
  optimizerModel?: string;
  ragModel?: string;
}

// macOS + ad-hoc signing = Keychain prompts on every launch, so encrypt only
// where the OS keystore works silently (same policy the app used before).
function canEncrypt(): boolean {
  return process.platform !== 'darwin' && safeStorage.isEncryptionAvailable();
}

function seal(plain: string): StoredSecret {
  if (canEncrypt()) {
    return { enc: true, value: safeStorage.encryptString(plain).toString('base64') };
  }
  return { enc: false, value: plain };
}

function unseal(secret: StoredSecret | undefined): string {
  if (!secret || !secret.value) return '';
  if (!secret.enc) return secret.value;
  try {
    return safeStorage.decryptString(Buffer.from(secret.value, 'base64'));
  } catch (err) {
    console.error('[AISettings] Could not decrypt a stored key; it must be entered again:', err);
    return '';
  }
}

function preview(key: string): string {
  return key ? `…${key.slice(-4)}` : '';
}

function readStored(): StoredSettings {
  const raw = kvGet(KV_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredSettings;
  } catch {
    return {};
  }
}

type Listener = (view: AISettingsView) => void;

class AISettingsService {
  private listeners = new Set<Listener>();
  private modelsCache: { at: number; models: OpenRouterModel[] } | null = null;

  get(): AISettings {
    const stored = readStored();
    return {
      openrouterApiKey: unseal(stored.openrouterApiKey),
      deepgramApiKey: unseal(stored.deepgramApiKey),
      optimizerModel: stored.optimizerModel || DEFAULT_OPTIMIZER_MODEL,
      ragModel: stored.ragModel || DEFAULT_RAG_MODEL,
    };
  }

  getView(): AISettingsView {
    const s = this.get();
    return {
      configured: !!s.openrouterApiKey,
      hasApiKey: !!s.openrouterApiKey,
      apiKeyPreview: preview(s.openrouterApiKey),
      optimizerModel: s.optimizerModel,
      ragModel: s.ragModel,
      hasDeepgramKey: !!s.deepgramApiKey,
      deepgramKeyPreview: preview(s.deepgramApiKey),
    };
  }

  isConfigured(): boolean {
    return !!this.get().openrouterApiKey;
  }

  save(update: AISettingsUpdate): AISettingsView {
    const stored = readStored();
    if (update.openrouterApiKey !== undefined) {
      const key = (update.openrouterApiKey ?? '').trim();
      if (key) stored.openrouterApiKey = seal(key);
      else delete stored.openrouterApiKey;
    }
    if (update.deepgramApiKey !== undefined) {
      const key = (update.deepgramApiKey ?? '').trim();
      if (key) stored.deepgramApiKey = seal(key);
      else delete stored.deepgramApiKey;
    }
    if (typeof update.optimizerModel === 'string' && update.optimizerModel.trim()) {
      stored.optimizerModel = update.optimizerModel.trim();
    }
    if (typeof update.ragModel === 'string' && update.ragModel.trim()) {
      stored.ragModel = update.ragModel.trim();
    }
    kvSet(KV_KEY, JSON.stringify(stored));
    const view = this.getView();
    for (const listener of this.listeners) {
      try {
        listener(view);
      } catch (err) {
        console.error('[AISettings] change listener failed:', err);
      }
    }
    return view;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Headers for HTTP calls to python-service. */
  pythonHeaders(): Record<string, string> {
    const s = this.get();
    const headers: Record<string, string> = {
      'X-Prmpt-Optimizer-Model': s.optimizerModel,
      'X-Prmpt-Rag-Model': s.ragModel,
    };
    if (s.openrouterApiKey) headers['X-Prmpt-OpenRouter-Key'] = s.openrouterApiKey;
    return headers;
  }

  /** Headers for calls to the code-intelligence service. */
  codeIntelHeaders(): Record<string, string> {
    const s = this.get();
    const headers: Record<string, string> = { 'X-Prmpt-Rag-Model': s.ragModel };
    if (s.openrouterApiKey) headers['X-Prmpt-OpenRouter-Key'] = s.openrouterApiKey;
    return headers;
  }

  /** The `llm` object sent with each optimize-stream WebSocket message. */
  llmPayload(): { api_key: string; optimizer_model: string; rag_model: string } {
    const s = this.get();
    return { api_key: s.openrouterApiKey, optimizer_model: s.optimizerModel, rag_model: s.ragModel };
  }

  /** Check an OpenRouter key against OpenRouter's key endpoint. */
  async validateOpenRouterKey(key: string): Promise<KeyValidation> {
    const trimmed = (key || '').trim();
    if (!trimmed) return { valid: false, error: 'Enter an API key.' };
    try {
      const res = await fetch(`${OPENROUTER_API}/key`, {
        headers: { Authorization: `Bearer ${trimmed}` },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 403) {
        return { valid: false, error: 'OpenRouter rejected this key.' };
      }
      if (!res.ok) {
        return { valid: false, error: `OpenRouter returned ${res.status}. Try again.` };
      }
      const body: any = await res.json().catch(() => ({}));
      return {
        valid: true,
        label: body?.data?.label ?? undefined,
        limitRemaining: body?.data?.limit_remaining ?? null,
      };
    } catch (err) {
      return { valid: false, error: `Could not reach OpenRouter: ${(err as Error).message}` };
    }
  }

  /** OpenRouter's public model list (cached for an hour). */
  async listModels(): Promise<OpenRouterModel[]> {
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_CACHE_MS) {
      return this.modelsCache.models;
    }
    const res = await fetch(`${OPENROUTER_API}/models`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
    const body: any = await res.json();
    const perMillion = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * 1_000_000 * 100) / 100 : null;
    };
    const models: OpenRouterModel[] = (Array.isArray(body?.data) ? body.data : [])
      .filter((m: any) => typeof m?.id === 'string')
      .map((m: any) => ({
        id: m.id,
        name: typeof m.name === 'string' ? m.name : m.id,
        contextLength: typeof m.context_length === 'number' ? m.context_length : null,
        supportsTools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
        promptPricePerMillion: perMillion(m.pricing?.prompt),
        completionPricePerMillion: perMillion(m.pricing?.completion),
      }))
      .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));
    this.modelsCache = { at: Date.now(), models };
    return models;
  }
}

export const aiSettings = new AISettingsService();
