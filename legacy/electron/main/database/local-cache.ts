import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { app } from 'electron';

export interface CachedCollection {
  id: string;
  name: string;
  icon: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CachedPrompt {
  id: string;
  title: string;
  content: string;
  collection_id: string;
  user_id: string;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
  metadata?: any;
}

export interface CachedChat {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  metadata?: any;
}

export interface CachedMessage {
  id: string;
  chat_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata?: any;
}

export interface CacheStore {
  collections: CachedCollection[];
  prompts: CachedPrompt[];
  chats: CachedChat[];
  messages: Record<string, CachedMessage[]>;
  settings: Record<string, any>;
  avatar: Record<string, string>;
  lastSyncedAt: Record<string, string>;
}

const DEFAULT_STORE: CacheStore = {
  collections: [],
  prompts: [],
  chats: [],
  messages: {},
  settings: {},
  avatar: {},
  lastSyncedAt: {},
};

/**
 * LocalCache — persists Supabase data to a per-user JSON file
 * in Electron's userData directory so the app works offline.
 *
 * File location: {userData}/offline-cache/{userId}.json
 *
 * Architecture:
 *   - In-memory Map holds the authoritative CacheStore per userId.
 *   - Reads always hit memory (microseconds) after the first disk load.
 *   - Writes update memory immediately, then flush to disk asynchronously
 *     so the main thread is never blocked by JSON serialization + I/O.
 */
export class LocalCache {
  private _cacheDir: string | null = null;
  private memCache: Map<string, CacheStore> = new Map();
  private pendingFlush: Map<string, Promise<void>> = new Map();

  private get cacheDir(): string {
    if (!this._cacheDir) {
      const userDataPath = app.getPath('userData');
      this._cacheDir = join(userDataPath, 'offline-cache');
      if (!existsSync(this._cacheDir)) {
        mkdirSync(this._cacheDir, { recursive: true });
      }
      console.log('[LocalCache] Cache directory:', this._cacheDir);
    }
    return this._cacheDir;
  }

  private cachePath(userId: string): string {
    return join(this.cacheDir, `${userId}.json`);
  }

  load(userId: string): CacheStore {
    const cached = this.memCache.get(userId);
    if (cached) return cached;

    let store: CacheStore;
    try {
      const path = this.cachePath(userId);
      if (!existsSync(path)) {
        store = { ...DEFAULT_STORE };
      } else {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw);
        store = { ...DEFAULT_STORE, ...parsed };
      }
    } catch (err) {
      console.error('[LocalCache] Error loading cache:', err);
      store = { ...DEFAULT_STORE };
    }

    this.memCache.set(userId, store);
    return store;
  }

  private flushToDisk(userId: string): void {
    const store = this.memCache.get(userId);
    if (!store) return;

    const path = this.cachePath(userId);
    const flushPromise = writeFile(path, JSON.stringify(store), 'utf-8')
      .catch(err => console.error('[LocalCache] Async flush error:', err))
      .finally(() => {
        if (this.pendingFlush.get(userId) === flushPromise) {
          this.pendingFlush.delete(userId);
        }
      });
    this.pendingFlush.set(userId, flushPromise);
  }

  save(userId: string, store: CacheStore): void {
    this.memCache.set(userId, store);
    this.flushToDisk(userId);
  }

  /**
   * Batch multiple field updates into a single load + save cycle.
   * Prevents N separate disk reads/writes when setting chats, collections, and prompts together.
   */
  batchUpdate(userId: string, updates: Partial<Pick<CacheStore, 'chats' | 'collections' | 'prompts' | 'settings' | 'avatar'>>): void {
    const store = this.load(userId);
    const now = new Date().toISOString();
    if (updates.chats !== undefined) {
      store.chats = updates.chats;
      store.lastSyncedAt['chats'] = now;
    }
    if (updates.collections !== undefined) {
      store.collections = updates.collections;
      store.lastSyncedAt['collections'] = now;
    }
    if (updates.prompts !== undefined) {
      store.prompts = updates.prompts;
      store.lastSyncedAt['prompts'] = now;
    }
    if (updates.settings !== undefined) {
      store.settings = updates.settings;
    }
    if (updates.avatar !== undefined) {
      store.avatar = updates.avatar;
    }
    this.save(userId, store);
  }

  getCollections(userId: string): CachedCollection[] {
    return this.load(userId).collections;
  }

  setCollections(userId: string, collections: CachedCollection[]): void {
    const store = this.load(userId);
    store.collections = collections;
    store.lastSyncedAt['collections'] = new Date().toISOString();
    this.save(userId, store);
  }

  addOrUpdateCollection(userId: string, collection: CachedCollection): void {
    const store = this.load(userId);
    const idx = store.collections.findIndex(c => c.id === collection.id);
    if (idx >= 0) store.collections[idx] = collection;
    else store.collections.unshift(collection);
    this.save(userId, store);
  }

  removeCollection(userId: string, collectionId: string): void {
    const store = this.load(userId);
    store.collections = store.collections.filter(c => c.id !== collectionId);
    this.save(userId, store);
  }

  getPrompts(userId: string): CachedPrompt[] {
    return this.load(userId).prompts;
  }

  setPrompts(userId: string, prompts: CachedPrompt[]): void {
    const store = this.load(userId);
    store.prompts = prompts;
    store.lastSyncedAt['prompts'] = new Date().toISOString();
    this.save(userId, store);
  }

  addOrUpdatePrompt(userId: string, prompt: CachedPrompt): void {
    const store = this.load(userId);
    const idx = store.prompts.findIndex(p => p.id === prompt.id);
    if (idx >= 0) store.prompts[idx] = prompt;
    else store.prompts.unshift(prompt);
    this.save(userId, store);
  }

  removePrompt(userId: string, promptId: string): void {
    const store = this.load(userId);
    store.prompts = store.prompts.filter(p => p.id !== promptId);
    this.save(userId, store);
  }

  getChats(userId: string): CachedChat[] {
    return this.load(userId).chats;
  }

  setChats(userId: string, chats: CachedChat[]): void {
    const store = this.load(userId);
    store.chats = chats;
    store.lastSyncedAt['chats'] = new Date().toISOString();
    this.save(userId, store);
  }

  addOrUpdateChat(userId: string, chat: CachedChat): void {
    const store = this.load(userId);
    const idx = store.chats.findIndex(c => c.id === chat.id);
    if (idx >= 0) store.chats[idx] = chat;
    else store.chats.unshift(chat);
    this.save(userId, store);
  }

  removeChat(userId: string, chatId: string): void {
    const store = this.load(userId);
    store.chats = store.chats.filter(c => c.id !== chatId);
    delete store.messages[chatId];
    this.save(userId, store);
  }

  getMessages(userId: string, chatId: string): CachedMessage[] {
    const store = this.load(userId);
    return store.messages[chatId] || [];
  }

  setMessages(userId: string, chatId: string, messages: CachedMessage[]): void {
    const store = this.load(userId);
    store.messages[chatId] = messages;
    this.save(userId, store);
  }

  getSettings(userId: string): any | null {
    return this.load(userId).settings?.[userId] ?? null;
  }

  setSettings(userId: string, settings: any): void {
    const store = this.load(userId);
    if (!store.settings) store.settings = {};
    store.settings[userId] = settings;
    this.save(userId, store);
  }

  getAvatar(userId: string): string | null {
    return this.load(userId).avatar?.[userId] ?? null;
  }

  setAvatar(userId: string, base64Url: string): void {
    const store = this.load(userId);
    if (!store.avatar) store.avatar = {};
    store.avatar[userId] = base64Url;
    this.save(userId, store);
  }
}

// Singleton
export const localCache = new LocalCache();
