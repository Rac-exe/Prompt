/**
 * Local app database (SQLite via better-sqlite3).
 *
 * Holds everything the app used to keep in Supabase: chats, messages, the
 * prompt library, settings, the local profile and memory. One file in the
 * user-data folder; nothing leaves the machine.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';

/** The single local user. Rows keep a user_id column so shapes match the old API. */
export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001';

const SCHEMA_VERSION = 1;

let db: any | null = null;

export function getLocalDbPath(): string {
  return path.join(app.getPath('userData'), 'prmpt.db');
}

export function getDb(): any {
  if (db) return db;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(getLocalDbPath()), { recursive: true });
  const conn = new Database(getLocalDbPath());
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('foreign_keys = ON');
  migrate(conn);
  db = conn;
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function fromJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function migrate(conn: any): void {
  const version = conn.pragma('user_version', { simple: true }) as number;
  if (version >= SCHEMA_VERSION) return;
  conn.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      personalization_prompt TEXT,
      ui_settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      created_at TEXT NOT NULL,
      optimization_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS prompt_optimizations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      original_text TEXT NOT NULL,
      optimized_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0,
      rating INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS prompt_collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'folder',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, name)
    );

    CREATE TABLE IF NOT EXISTS saved_prompts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      collection_id TEXT NOT NULL REFERENCES prompt_collections(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_prompts_collection ON saved_prompts(collection_id);

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'dark',
      font_size TEXT NOT NULL DEFAULT 'medium',
      font_family TEXT NOT NULL DEFAULT 'inter',
      prompt_instructions TEXT NOT NULL DEFAULT '',
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      memory_type TEXT NOT NULL CHECK (memory_type IN ('user', 'behavioral', 'context')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL DEFAULT 'inferred' CHECK (source IN ('inferred', 'explicit')),
      observation_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, memory_type, key)
    );

    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  conn.pragma(`user_version = ${SCHEMA_VERSION}`);
}

/** Small key/value store for app-level state (e.g. AI provider settings). */
export function kvGet(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_kv WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function kvSet(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO app_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function kvDelete(key: string): void {
  getDb().prepare('DELETE FROM app_kv WHERE key = ?').run(key);
}
