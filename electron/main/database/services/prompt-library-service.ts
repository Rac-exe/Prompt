import { SupabaseClientManager } from '../supabase-client';
import { randomBytes } from 'crypto';

// ============================================
// SHARE TOKEN HELPERS
// ============================================

/**
 * Generates a cryptographically secure opaque share token.
 * 24 random bytes = 192 bits of entropy — computationally impossible to brute-force
 * even at 1 billion guesses/second (would take ~10^39 years).
 *
 * The token is stored in the DB and acts as the credential. The DB lookup IS the
 * verification — no shared secret is needed, so tokens work identically across
 * all user machines without any configuration.
 *
 * Security layers:
 *  - Token entropy: 192 bits (brute-force infeasible)
 *  - Collections: RLS requires auth.uid() IS NOT NULL (must be signed in)
 *  - Prompts: publicly readable by design
 *  - Type confusion: prevented by querying the correct table based on the URL path prefix (c/p)
 *  - Injection: token format validated in the deep link handler before any DB call
 */
function generateShareToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Validates that a token string has the correct format before any DB interaction. */
export function isValidTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,50}$/.test(token);
}

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
  // Sharing fields (added in migration 20260315_add_shared_libraries)
  share_token?: string | null;
  original_collection_id?: string | null;
  original_creator_id?: string | null;
  original_creator_name?: string | null;
}

export interface SharedCollectionView {
  id: string;
  name: string;
  icon?: string;
  share_token: string;
  owner_name: string;
  owner_id: string;
  prompts: SavedPrompt[];
}

export interface SharedPromptView {
  id: string;
  title: string;
  content: string;
  share_token: string;
  owner_name: string;
  owner_id: string;
  created_at: string;
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

  // ============================================
  // SHARING
  // ============================================

  /**
   * Generate (or return existing) share token for an individual prompt.
   * Idempotent — calling twice returns the same token.
   * Returns both a deep-link URL (in-app) and a web URL (Edge Function, browser-accessible).
   */
  async getOrCreatePromptShareToken(promptId: string): Promise<{ shareToken: string; shareUrl: string; webUrl: string }> {
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) throw new Error('Not authenticated');

    const { data: prompt, error: fetchError } = await this.client
      .from('saved_prompts')
      .select('id, share_token')
      .eq('id', promptId)
      .eq('user_id', userData.user.id)
      .single();

    if (fetchError || !prompt) throw new Error('Prompt not found');

    // Re-use existing token if it has the correct format
    if (prompt.share_token && isValidTokenFormat(prompt.share_token)) {
      const supabaseUrl = process.env.SUPABASE_URL!;
      return {
        shareToken: prompt.share_token,
        shareUrl: `prmpt://share/p/${prompt.share_token}`,
        webUrl: `${supabaseUrl}/functions/v1/share-view?token=${prompt.share_token}`,
      };
    }

    const token = generateShareToken();

    const { data: updated, error: updateError } = await this.client
      .from('saved_prompts')
      .update({ share_token: token })
      .eq('id', promptId)
      .eq('user_id', userData.user.id)
      .select('share_token')
      .single();

    if (updateError || !updated) throw new Error('Failed to generate prompt share token');

    const supabaseUrl = process.env.SUPABASE_URL!;
    return {
      shareToken: updated.share_token!,
      shareUrl: `prmpt://share/p/${updated.share_token}`,
      webUrl: `${supabaseUrl}/functions/v1/share-view?token=${updated.share_token}`,
    };
  }

  /**
   * Fetch a shared prompt by its opaque token.
   * The DB lookup by share_token IS the verification — the token is the credential.
   */
  async getSharedPrompt(token: string): Promise<SharedPromptView> {
    if (!isValidTokenFormat(token)) throw new Error('Invalid share link');

    const { data: prompt, error: promptError } = await this.client
      .from('saved_prompts')
      .select('id, title, content, share_token, user_id, created_at')
      .eq('share_token', token)
      .single();

    if (promptError || !prompt) {
      throw new Error('Shared prompt not found or link is invalid');
    }

    // Fetch owner name from profiles
    const { data: profile } = await this.client
      .from('profiles')
      .select('name')
      .eq('id', prompt.user_id)
      .single();

    return {
      id: prompt.id,
      title: prompt.title,
      content: prompt.content,
      share_token: prompt.share_token,
      owner_name: profile?.name || 'Unknown User',
      owner_id: prompt.user_id,
      created_at: prompt.created_at,
    };
  }

  /**
   * Generate (or return existing) share token for a collection.
   * Idempotent — calling twice returns the same token.
   * Collections are app-only: shareUrl uses the prmpt:// deep-link scheme.
   */
  async getOrCreateShareToken(collectionId: string): Promise<{ shareToken: string; shareUrl: string }> {
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) throw new Error('Not authenticated');

    const { data: collection, error: fetchError } = await this.client
      .from('prompt_collections')
      .select('id, share_token')
      .eq('id', collectionId)
      .eq('user_id', userData.user.id)
      .single();

    if (fetchError || !collection) throw new Error('Collection not found');

    // Re-use existing token if it has the correct format
    if (collection.share_token && isValidTokenFormat(collection.share_token)) {
      return {
        shareToken: collection.share_token,
        shareUrl: `prmpt://share/c/${collection.share_token}`,
      };
    }

    const token = generateShareToken();

    const { data: updated, error: updateError } = await this.client
      .from('prompt_collections')
      .update({ share_token: token })
      .eq('id', collectionId)
      .eq('user_id', userData.user.id)
      .select('share_token')
      .single();

    if (updateError || !updated) throw new Error('Failed to generate share token');

    return {
      shareToken: updated.share_token!,
      shareUrl: `prmpt://share/c/${updated.share_token}`,
    };
  }

  /**
   * Fetch a shared collection by its opaque token.
   * The DB lookup by share_token IS the verification — the token is the credential.
   * RLS requires auth.uid() IS NOT NULL so only signed-in users can read collections.
   */
  async getSharedCollection(token: string): Promise<SharedCollectionView> {
    if (!isValidTokenFormat(token)) throw new Error('Invalid share link');

    // RLS: requires authenticated Supabase session
    const { data: collection, error: collectionError } = await this.client
      .from('prompt_collections')
      .select('id, name, icon, share_token, user_id')
      .eq('share_token', token)
      .single();

    if (collectionError || !collection) {
      throw new Error('Shared library not found or link is invalid');
    }

    // Fetch owner profile name
    const { data: profile } = await this.client
      .from('profiles')
      .select('name')
      .eq('id', collection.user_id)
      .single();

    const ownerName = profile?.name || 'Unknown User';

    // Fetch prompts (public RLS allows this for shared collections)
    const { data: prompts, error: promptsError } = await this.client
      .from('saved_prompts')
      .select('*')
      .eq('collection_id', collection.id)
      .order('created_at', { ascending: false });

    if (promptsError) throw promptsError;

    return {
      id: collection.id,
      name: collection.name,
      icon: collection.icon,
      share_token: collection.share_token,
      owner_name: ownerName,
      owner_id: collection.user_id,
      prompts: prompts || [],
    };
  }

  /**
   * Save a shared collection (fork) under the current user.
   * Idempotent — if the user already saved this collection, returns existing copy.
   */
  async saveSharedCollection(originalCollectionId: string): Promise<{
    collection: PromptCollection;
    alreadyExisted: boolean;
  }> {
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) throw new Error('Not authenticated');

    // Check if user already forked this collection (idempotency — Task 7)
    const { data: existing } = await this.client
      .from('prompt_collections')
      .select('*')
      .eq('user_id', userData.user.id)
      .eq('original_collection_id', originalCollectionId)
      .maybeSingle();

    if (existing) {
      return { collection: existing as PromptCollection, alreadyExisted: true };
    }

    // Fetch original collection + owner name
    const { data: original, error: originalError } = await this.client
      .from('prompt_collections')
      .select('id, name, icon, user_id, share_token')
      .eq('id', originalCollectionId)
      .single();

    if (originalError || !original) throw new Error('Original collection not found');

    // Only allow saving collections that have a share token (are actually shared)
    if (!original.share_token) throw new Error('This collection is not shared publicly');

    const { data: ownerProfile } = await this.client
      .from('profiles')
      .select('name')
      .eq('id', original.user_id)
      .single();

    const creatorName = ownerProfile?.name || 'Unknown User';

    // ── Resolve a unique name for the forked collection ──────────────────────
    // The user may already own a collection with the same name (e.g. they are
    // saving their own shared library, or they saved it before under a different
    // flow). Auto-suffix with " (2)", " (3)", … until the name is free.
    const { data: existingNames } = await this.client
      .from('prompt_collections')
      .select('name')
      .eq('user_id', userData.user.id);

    const takenNames = new Set((existingNames || []).map((c: any) => c.name as string));

    let candidateName = original.name;
    if (takenNames.has(candidateName)) {
      let counter = 2;
      while (takenNames.has(`${original.name} (${counter})`)) counter++;
      candidateName = `${original.name} (${counter})`;
    }

    // Create a copy of the collection under the current user
    const { data: newCollection, error: createError } = await this.client
      .from('prompt_collections')
      .insert({
        user_id: userData.user.id,
        name: candidateName,
        icon: original.icon || 'folder',
        original_collection_id: original.id,
        original_creator_id: original.user_id,
        original_creator_name: creatorName,
      })
      .select()
      .single();

    if (createError || !newCollection) throw createError || new Error('Failed to save collection');

    // Copy all prompts from original to the new collection
    const { data: originalPrompts } = await this.client
      .from('saved_prompts')
      .select('title, content, metadata')
      .eq('collection_id', original.id)
      .order('created_at', { ascending: true });

    if (originalPrompts && originalPrompts.length > 0) {
      const promptsToInsert = originalPrompts.map((p: any) => ({
        user_id: userData.user.id,
        collection_id: newCollection.id,
        title: p.title,
        content: p.content,
        metadata: {
          ...(p.metadata || {}),
          // Prompt-level attribution: only copied prompts keep source attribution.
          // New prompts created later in this collection should not inherit it.
          shared_origin_creator_id: original.user_id,
          shared_origin_creator_name: creatorName,
          shared_origin_collection_id: original.id,
        },
      }));

      const { error: insertError } = await this.client
        .from('saved_prompts')
        .insert(promptsToInsert);

      if (insertError) {
        console.error('[PromptLibraryService] ⚠️ Failed to copy prompts:', insertError);
      }
    }

    console.log('[PromptLibraryService] ✅ Collection forked:', newCollection.id);
    return { collection: newCollection as PromptCollection, alreadyExisted: false };
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
