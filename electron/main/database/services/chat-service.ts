import { getDb, LOCAL_USER_ID, newId, nowIso, toJson, fromJson, toBool } from '../local-db';

export interface Chat {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  metadata: {
    tags: string[];
    folder: string | null;
    color: string;
    statistics: {
      total_messages: number;
      total_optimizations: number;
      avg_response_time_ms: number;
    };
  };
}

export interface Message {
  id: string;
  chat_id: string;
  user_id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  created_at: string;
  optimization_id: string | null;
  metadata: {
    model: string;
    tokens: {
      prompt: number;
      completion: number;
      total: number;
    };
    timing: {
      duration_ms: number;
    };
    source_app?: string;
    trigger_type?: string;
  };
}

const DEFAULT_CHAT_METADATA: Chat['metadata'] = {
  tags: [],
  folder: null,
  color: '#ffffff',
  statistics: { total_messages: 0, total_optimizations: 0, avg_response_time_ms: 0 },
};

function toChat(row: any): Chat {
  return {
    ...row,
    is_pinned: toBool(row.is_pinned),
    metadata: fromJson(row.metadata, DEFAULT_CHAT_METADATA),
  };
}

function toMessage(row: any): Message {
  return { ...row, metadata: fromJson(row.metadata, {}) };
}

/**
 * Chats and messages, stored in the local SQLite database.
 */
export class ChatService {
  /**
   * Get recent chats (most recently updated first)
   */
  async getChats(): Promise<Chat[]> {
    const rows = getDb()
      .prepare('SELECT * FROM chats ORDER BY updated_at DESC, rowid DESC LIMIT 100')
      .all();
    return rows.map(toChat);
  }

  /**
   * Get a single chat by ID
   */
  async getChat(chatId: string): Promise<Chat | null> {
    const row = getDb().prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    return row ? toChat(row) : null;
  }

  /**
   * Create a new chat
   */
  async createChat(title?: string): Promise<Chat> {
    const now = nowIso();
    const chat: Chat = {
      id: newId(),
      user_id: LOCAL_USER_ID,
      title: title || 'New Chat',
      created_at: now,
      updated_at: now,
      is_pinned: false,
      metadata: DEFAULT_CHAT_METADATA,
    };
    getDb()
      .prepare(
        `INSERT INTO chats (id, user_id, title, created_at, updated_at, is_pinned, metadata)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(chat.id, chat.user_id, chat.title, chat.created_at, chat.updated_at, toJson(chat.metadata));
    return chat;
  }

  /**
   * Bump a chat's updated_at to now so it floats to the top of the recents list.
   */
  async touchChat(chatId: string): Promise<void> {
    getDb().prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(nowIso(), chatId);
  }

  /**
   * Update chat title
   */
  async updateChatTitle(chatId: string, title: string): Promise<void> {
    getDb().prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), chatId);
  }

  /**
   * Delete a chat (its messages are removed by ON DELETE CASCADE)
   */
  async deleteChat(chatId: string): Promise<void> {
    getDb().prepare('DELETE FROM chats WHERE id = ?').run(chatId);
  }

  /**
   * Get messages for a chat, oldest first
   */
  async getMessages(chatId: string): Promise<Message[]> {
    const rows = getDb()
      .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 500')
      .all(chatId);
    return rows.map(toMessage);
  }

  /**
   * Add a message to a chat.
   * Pass `id` to use a pre-generated UUID (keeps retries idempotent).
   */
  async addMessage(
    chatId: string,
    content: string,
    role: 'user' | 'assistant' | 'system',
    optimizationId?: string,
    metadata?: any,
    id?: string,
  ): Promise<Message> {
    const message = {
      id: id || newId(),
      chat_id: chatId,
      user_id: LOCAL_USER_ID,
      content,
      role,
      created_at: nowIso(),
      optimization_id: optimizationId || null,
      metadata: metadata || {},
    };
    getDb()
      .prepare(
        `INSERT INTO messages (id, chat_id, user_id, content, role, created_at, optimization_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.chat_id,
        message.user_id,
        message.content,
        message.role,
        message.created_at,
        message.optimization_id,
        toJson(message.metadata),
      );
    return message as Message;
  }

  /**
   * Find or create a default "Quick Optimizations" chat
   */
  async getOrCreateQuickOptimizationsChat(): Promise<Chat> {
    const row = getDb().prepare("SELECT * FROM chats WHERE title = 'Quick Optimizations' LIMIT 1").get();
    if (row) return toChat(row);
    return this.createChat('Quick Optimizations');
  }

  /**
   * Save user feedback to a message
   */
  async saveFeedback(messageId: string, rating: 'positive' | 'negative'): Promise<void> {
    this.updateMetadata(messageId, (current) => ({ ...current, feedback: { rating } }));
  }

  /**
   * Count how many user-role messages exist in a chat.
   * Used to decide whether the title should still be updated on follow-up messages.
   */
  async countUserMessages(chatId: string): Promise<number> {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'user'")
      .get(chatId);
    return row ? Number(row.n) : 0;
  }

  /**
   * Update only the attachedFiles metadata on an existing message.
   * Used to backfill stored attachment paths after they are saved.
   */
  async updateMessageAttachments(messageId: string, attachedFiles: any[]): Promise<void> {
    this.updateMetadata(messageId, (current) => ({ ...current, attachedFiles }));
  }

  private updateMetadata(messageId: string, update: (current: any) => any): void {
    const conn = getDb();
    const row = conn.prepare('SELECT metadata FROM messages WHERE id = ?').get(messageId);
    if (!row) throw new Error('Message not found');
    const next = update(fromJson(row.metadata, {}));
    conn.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(toJson(next), messageId);
  }
}
