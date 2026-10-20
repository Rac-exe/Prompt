import { getDb, LOCAL_USER_ID, newId, nowIso, toJson, fromJson } from '../local-db';

// ============================================
// INTERFACES
// ============================================

export interface PromptCollection {
  id: string;
  user_id: string;
  name: string;
  icon?: string;
  created_at: string;
  updated_at: string;
}

export interface SavedPrompt {
  id: string;
  user_id: string;
  collection_id: string;
  title: string;
  content: string;
  metadata?: {
    tags?: string[];
    source_chat?: string;
    isFavorite?: boolean;
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
}

export interface SavedPromptWithCollection extends SavedPrompt {
  collection_name: string;
  collection_icon?: string;
}

function toPrompt<T extends SavedPrompt>(row: any): T {
  return { ...row, metadata: fromJson(row.metadata, {}) };
}

function isUniqueViolation(err: unknown): boolean {
  return String((err as { code?: string })?.code || '').startsWith('SQLITE_CONSTRAINT_UNIQUE');
}

// ============================================
// SERVICE
// ============================================

/**
 * Prompt library (collections + saved prompts), stored in the local SQLite database.
 */
export class PromptLibraryService {
  // ============================================
  // COLLECTIONS
  // ============================================

  /**
   * Get all collections, oldest first
   */
  async getCollections(): Promise<PromptCollection[]> {
    return getDb()
      .prepare('SELECT * FROM prompt_collections ORDER BY created_at ASC, rowid ASC')
      .all();
  }

  /**
   * Get a single collection by ID
   */
  async getCollection(collectionId: string): Promise<PromptCollection | null> {
    return getDb().prepare('SELECT * FROM prompt_collections WHERE id = ?').get(collectionId) || null;
  }

  /**
   * Create a new collection
   */
  async createCollection(name: string, icon?: string): Promise<PromptCollection> {
    const now = nowIso();
    const collection: PromptCollection = {
      id: newId(),
      user_id: LOCAL_USER_ID,
      name,
      icon: icon || 'folder',
      created_at: now,
      updated_at: now,
    };
    try {
      getDb()
        .prepare(
          `INSERT INTO prompt_collections (id, user_id, name, icon, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(collection.id, collection.user_id, collection.name, collection.icon, now, now);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`Collection "${name}" already exists`);
      throw err;
    }
    return collection;
  }

  /**
   * Rename a collection
   */
  async renameCollection(collectionId: string, newName: string): Promise<PromptCollection> {
    try {
      getDb()
        .prepare('UPDATE prompt_collections SET name = ?, updated_at = ? WHERE id = ?')
        .run(newName, nowIso(), collectionId);
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`Collection "${newName}" already exists`);
      throw err;
    }
    const collection = await this.getCollection(collectionId);
    if (!collection) throw new Error('Collection not found');
    return collection;
  }

  /**
   * Delete a collection (its prompts are removed by ON DELETE CASCADE)
   */
  async deleteCollection(collectionId: string): Promise<void> {
    getDb().prepare('DELETE FROM prompt_collections WHERE id = ?').run(collectionId);
  }

  // ============================================
  // PROMPTS
  // ============================================

  /**
   * Get all prompts with their collection name and icon, newest first
   */
  async getPrompts(): Promise<SavedPromptWithCollection[]> {
    const rows = getDb()
      .prepare(
        `SELECT sp.*, pc.name AS collection_name, pc.icon AS collection_icon
         FROM saved_prompts sp
         JOIN prompt_collections pc ON pc.id = sp.collection_id
         ORDER BY sp.created_at DESC, sp.rowid DESC`,
      )
      .all();
    return rows.map((row: any) => toPrompt<SavedPromptWithCollection>(row));
  }

  /**
   * Get prompts in a specific collection, newest first
   */
  async getPromptsByCollection(collectionId: string): Promise<SavedPrompt[]> {
    const rows = getDb()
      .prepare('SELECT * FROM saved_prompts WHERE collection_id = ? ORDER BY created_at DESC, rowid DESC')
      .all(collectionId);
    return rows.map((row: any) => toPrompt<SavedPrompt>(row));
  }

  /**
   * Get a single prompt by ID
   */
  async getPrompt(promptId: string): Promise<SavedPrompt | null> {
    const row = getDb().prepare('SELECT * FROM saved_prompts WHERE id = ?').get(promptId);
    return row ? toPrompt<SavedPrompt>(row) : null;
  }

  /**
   * Save a new prompt to a collection
   */
  async savePrompt(
    collectionId: string,
    title: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<SavedPrompt> {
    const collection = await this.getCollection(collectionId);
    if (!collection) throw new Error('Collection not found');

    const now = nowIso();
    const prompt: SavedPrompt = {
      id: newId(),
      user_id: LOCAL_USER_ID,
      collection_id: collectionId,
      title,
      content,
      metadata: metadata || {},
      created_at: now,
      updated_at: now,
    };
    getDb()
      .prepare(
        `INSERT INTO saved_prompts (id, user_id, collection_id, title, content, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(prompt.id, prompt.user_id, collectionId, title, content, toJson(prompt.metadata), now, now);
    return prompt;
  }

  /**
   * Update an existing prompt
   */
  async updatePrompt(
    promptId: string,
    updates: {
      title?: string;
      content?: string;
      collection_id?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<SavedPrompt> {
    const current = await this.getPrompt(promptId);
    if (!current) throw new Error('Prompt not found');
    if (updates.collection_id && !(await this.getCollection(updates.collection_id))) {
      throw new Error('Collection not found');
    }
    const next: SavedPrompt = {
      ...current,
      ...updates,
      metadata: updates.metadata ?? current.metadata,
      updated_at: nowIso(),
    };
    getDb()
      .prepare(
        `UPDATE saved_prompts SET title = ?, content = ?, collection_id = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(next.title, next.content, next.collection_id, toJson(next.metadata), next.updated_at, promptId);
    return next;
  }

  /**
   * Delete a prompt
   */
  async deletePrompt(promptId: string): Promise<void> {
    getDb().prepare('DELETE FROM saved_prompts WHERE id = ?').run(promptId);
  }

  /**
   * Move a prompt to a different collection
   */
  async movePromptToCollection(promptId: string, newCollectionId: string): Promise<SavedPrompt> {
    return this.updatePrompt(promptId, { collection_id: newCollectionId });
  }

  /**
   * Toggle favorite status of a prompt
   */
  async toggleFavorite(promptId: string): Promise<SavedPrompt> {
    const prompt = await this.getPrompt(promptId);
    if (!prompt) throw new Error('Prompt not found');

    const isFavorite = prompt.metadata?.isFavorite || false;

    return this.updatePrompt(promptId, {
      metadata: {
        ...prompt.metadata,
        isFavorite: !isFavorite,
      },
    });
  }

  // ============================================
  // BATCH OPERATIONS
  // ============================================

  /**
   * Get all library data (collections + prompts)
   */
  async getFullLibrary(): Promise<{
    collections: PromptCollection[];
    prompts: SavedPromptWithCollection[];
  }> {
    const [collections, prompts] = await Promise.all([
      this.getCollections(),
      this.getPrompts(),
    ]);

    return { collections, prompts };
  }

  /**
   * Create a collection and save a prompt to it in one step
   */
  async createCollectionAndSavePrompt(
    collectionName: string,
    promptTitle: string,
    promptContent: string,
    collectionIcon?: string,
    metadata?: Record<string, any>
  ): Promise<{
    collection: PromptCollection;
    prompt: SavedPrompt;
  }> {
    const collection = await this.createCollection(collectionName, collectionIcon);
    const prompt = await this.savePrompt(collection.id, promptTitle, promptContent, metadata);
    return { collection, prompt };
  }
}
