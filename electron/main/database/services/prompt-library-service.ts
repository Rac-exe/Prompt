import { SupabaseClientManager } from '../supabase-client';

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

// ============================================
// SERVICE
// ============================================

export class PromptLibraryService {
  private client = SupabaseClientManager.getClient();

  // ============================================
  // COLLECTIONS
  // ============================================

  /**
   * Get all collections for the current user
   */
  async getCollections(): Promise<PromptCollection[]> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[PromptLibraryService] ❌ getCollections: Not authenticated');
      throw new Error('Not authenticated');
    }

    console.log('[PromptLibraryService] Loading collections for user:', userData.user.id);

    const { data, error } = await this.client
      .from('prompt_collections')
      .select('*')
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[PromptLibraryService] ❌ Error loading collections:', error);
      throw error;
    }

    console.log('[PromptLibraryService] ✅ Loaded', data?.length || 0, 'collections for user:', userData.user.id);
    return data || [];
  }

  /**
   * Get a single collection by ID
   */
  async getCollection(collectionId: string): Promise<PromptCollection | null> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[PromptLibraryService] ❌ getCollection: Not authenticated');
      throw new Error('Not authenticated');
    }

    const { data, error } = await this.client
      .from('prompt_collections')
      .select('*')
      .eq('id', collectionId)
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create a new collection
   */
  async createCollection(name: string, icon?: string): Promise<PromptCollection> {
    console.log('[PromptLibraryService] createCollection called:', name);
    
    // STEP 1: Verify authentication
    const { data: userData, error: userError } = await this.client.auth.getUser();
    
    if (userError) {
      console.error('[PromptLibraryService] ❌ Auth error:', userError);
      throw new Error(`Authentication error: ${userError.message}`);
    }
    
    if (!userData.user) {
      console.error('[PromptLibraryService] ❌ No user found - not authenticated');
      throw new Error('Not authenticated');
    }
    
    console.log('[PromptLibraryService] ✅ User authenticated:', userData.user.id);

    // STEP 2: Insert collection
    console.log('[PromptLibraryService] Inserting collection:', {
      user_id: userData.user.id,
      name,
      icon: icon || 'folder',
    });

    const { data, error } = await this.client
      .from('prompt_collections')
      .insert({
        user_id: userData.user.id,
        name,
        icon: icon || 'folder',
      })
      .select()
      .single();

    // STEP 3: Log INSERT RESULT (CRITICAL DIAGNOSTIC)
    console.log('🔴 COLLECTION INSERT RESULT:', { 
      data: data ? { id: data.id, name: data.name, user_id: data.user_id } : null, 
      error: error ? { code: error.code, message: error.message, details: error.details } : null 
    });

    if (error) {
      console.error('[PromptLibraryService] ❌ Insert error:', error);
      // Handle duplicate collection name
      if (error.code === '23505') {
        throw new Error(`Collection "${name}" already exists`);
      }
      throw error;
    }

    if (!data) {
      console.error('[PromptLibraryService] ❌ No data returned after insert');
      throw new Error('Failed to create collection: no data returned');
    }

    console.log('[PromptLibraryService] ✅ Collection created:', data.id);
    return data;
  }

  /**
   * Rename a collection
   */
  async renameCollection(collectionId: string, newName: string): Promise<PromptCollection> {
    const { data, error } = await this.client
      .from('prompt_collections')
      .update({ name: newName })
      .eq('id', collectionId)
      .select()
      .single();

    if (error) {
      // Handle duplicate collection name
      if (error.code === '23505') {
        throw new Error(`Collection "${newName}" already exists`);
      }
      throw error;
    }

    return data;
  }

  /**
   * Delete a collection (and all its prompts due to CASCADE)
   */
  async deleteCollection(collectionId: string): Promise<void> {
    const { error } = await this.client
      .from('prompt_collections')
      .delete()
      .eq('id', collectionId);

    if (error) throw error;
  }

  // ============================================
  // PROMPTS
  // ============================================

  /**
   * Get all prompts for the current user
   */
  async getPrompts(): Promise<SavedPromptWithCollection[]> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[PromptLibraryService] ❌ getPrompts: Not authenticated');
      throw new Error('Not authenticated');
    }

    console.log('[PromptLibraryService] Loading prompts for user:', userData.user.id);

    const { data, error } = await this.client
      .from('user_prompts_with_collections')
      .select('*')
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PromptLibraryService] ❌ Error loading prompts:', error);
      throw error;
    }

    console.log('[PromptLibraryService] ✅ Loaded', data?.length || 0, 'prompts for user:', userData.user.id);
    return data || [];
  }

  /**
   * Get prompts in a specific collection
   */
  async getPromptsByCollection(collectionId: string): Promise<SavedPrompt[]> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[PromptLibraryService] ❌ getPromptsByCollection: Not authenticated');
      throw new Error('Not authenticated');
    }

    const { data, error } = await this.client
      .from('saved_prompts')
      .select('*')
      .eq('collection_id', collectionId)
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get a single prompt by ID
   */
  async getPrompt(promptId: string): Promise<SavedPrompt | null> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[PromptLibraryService] ❌ getPrompt: Not authenticated');
      throw new Error('Not authenticated');
    }

    const { data, error } = await this.client
      .from('saved_prompts')
      .select('*')
      .eq('id', promptId)
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .single();

    if (error) throw error;
    return data;
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
    console.log('[PromptLibraryService] savePrompt called:', { collectionId, title });
    
    // STEP 1: Verify authentication
    const { data: userData, error: userError } = await this.client.auth.getUser();
    
    if (userError) {
      console.error('[PromptLibraryService] ❌ Auth error:', userError);
      throw new Error(`Authentication error: ${userError.message}`);
    }
    
    if (!userData.user) {
      console.error('[PromptLibraryService] ❌ No user found - not authenticated');
      throw new Error('Not authenticated');
    }
    
    console.log('[PromptLibraryService] ✅ User authenticated:', userData.user.id);

    // STEP 2: Verify collection exists and belongs to user
    console.log('[PromptLibraryService] Verifying collection:', collectionId);
    const collection = await this.getCollection(collectionId);
    if (!collection) {
      console.error('[PromptLibraryService] ❌ Collection not found');
      throw new Error('Collection not found');
    }
    console.log('[PromptLibraryService] ✅ Collection verified:', collection.name);

    // STEP 3: Insert prompt
    console.log('[PromptLibraryService] Inserting prompt:', {
      user_id: userData.user.id,
      collection_id: collectionId,
      title,
    });

    const { data, error } = await this.client
      .from('saved_prompts')
      .insert({
        user_id: userData.user.id,
        collection_id: collectionId,
        title,
        content,
        metadata: metadata || {},
      })
      .select()
      .single();

    // STEP 4: Log INSERT RESULT (CRITICAL DIAGNOSTIC)
    console.log('🔴 INSERT RESULT:', { 
      data: data ? { id: data.id, title: data.title, user_id: data.user_id } : null, 
      error: error ? { code: error.code, message: error.message, details: error.details } : null 
    });

    if (error) {
      console.error('[PromptLibraryService] ❌ Insert error:', error);
      throw error;
    }

    if (!data) {
      console.error('[PromptLibraryService] ❌ No data returned after insert');
      throw new Error('Failed to save prompt: no data returned');
    }

    console.log('[PromptLibraryService] ✅ Prompt saved successfully:', data.id);
    return data;
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
    const { data, error } = await this.client
      .from('saved_prompts')
      .update(updates)
      .eq('id', promptId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Delete a prompt
   */
  async deletePrompt(promptId: string): Promise<void> {
    const { error } = await this.client
      .from('saved_prompts')
      .delete()
      .eq('id', promptId);

    if (error) throw error;
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
   * Get all library data for a user (collections + prompts)
   * Useful for loading on login
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
   * Create a collection and save a prompt to it in one transaction
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
    // Create collection first
    const collection = await this.createCollection(collectionName, collectionIcon);

    // Then save prompt to it
    const prompt = await this.savePrompt(collection.id, promptTitle, promptContent, metadata);

    return { collection, prompt };
  }
}
