import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
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
  messages: Record<string, CachedMessage[]>; // keyed by chatId
  settings: Record<string, any>; // keyed by userId
  avatar: Record<string, string>; // keyed by userId, stores base64 data URL
  lastSyncedAt: Record<string, string>; // table name -> ISO timestamp
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
 * IMPORTANT: Uses lazy initialization so app.getPath('userData') is
 * called only after app.isReady(), not at module import time.
 */
export class LocalCache {
  private _cacheDir: string | null = null;

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
    try {
      const path = this.cachePath(userId);
      if (!existsSync(path)) return { ...DEFAULT_STORE };
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle missing keys after upgrades
      return { ...DEFAULT_STORE, ...parsed };
    } catch (err) {
      console.error('[LocalCache] Error loading cache:', err);
      return { ...DEFAULT_STORE };
    }
  }

  save(userId: string, store: CacheStore): void {
    try {
      writeFileSync(this.cachePath(userId), JSON.stringify(store, null, 2), 'utf-8');
    } catch (err) {
      console.error('[LocalCache] Error saving cache:', err);
    }
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
