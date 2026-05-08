import * as Sentry from '@sentry/electron/main';
import { SupabaseClientManager } from '../supabase-client';

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

export class ChatService {
  private client = SupabaseClientManager.getClient();

  /**
   * Get all chats for current user
   */
  async getChats(): Promise<Chat[]> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[ChatService] ❌ getChats: Not authenticated');
      throw new Error('Not authenticated');
    }

    console.log('[ChatService] Loading chats for user:', userData.user.id);

    const { data, error } = await this.client
      .from('chats')
      .select('*')
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[ChatService] ❌ Error loading chats:', error);
      throw error;
    }

    console.log('[ChatService] ✅ Loaded', data?.length || 0, 'chats for user:', userData.user.id);
    return data || [];
  }

  /**
   * Get a single chat by ID
   */
  async getChat(chatId: string): Promise<Chat | null> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[ChatService] ❌ getChat: Not authenticated');
      throw new Error('Not authenticated');
    }

    const { data, error } = await this.client
      .from('chats')
      .select('*')
      .eq('id', chatId)
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create a new chat
   */
  async createChat(title?: string): Promise<Chat> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { data, error } = await this.client
      .from('chats')
      .insert({
        user_id: userData.user.id,
        title: title || 'New Chat',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Bump a chat's updated_at to now so it floats to the top of the recents list.
   */
  async touchChat(chatId: string): Promise<void> {
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) throw new Error('Not authenticated');

    const { error } = await this.client
      .from('chats')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId)
      .eq('user_id', userData.user.id);

    if (error) throw error;
  }

  /**
   * Update chat title
   */
  async updateChatTitle(chatId: string, title: string): Promise<void> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[ChatService] ❌ updateChatTitle: Not authenticated');
      throw new Error('Not authenticated');
    }

    const { error } = await this.client
      .from('chats')
      .update({ title })
      .eq('id', chatId)
      .eq('user_id', userData.user.id); // ✅ EXPLICIT user scoping

    if (error) throw error;
  }

  /**
   * Delete a chat
   */
  async deleteChat(chatId: string): Promise<void> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[ChatService] ❌ deleteChat: Not authenticated');
      throw new Error('Not authenticated');
    }

    const { error } = await this.client
      .from('chats')
      .delete()
      .eq('id', chatId)
      .eq('user_id', userData.user.id); // ✅ EXPLICIT user scoping

    if (error) throw error;
  }

  /**
   * Get messages for a chat
   */
  async getMessages(chatId: string): Promise<Message[]> {
    // SECURITY: Explicitly verify auth and scope to user
    const { data: userData, error: authError } = await this.client.auth.getUser();
    if (authError || !userData.user) {
      console.error('[ChatService] ❌ getMessages: Not authenticated');
      throw new Error('Not authenticated');
    }

    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .eq('user_id', userData.user.id) // ✅ EXPLICIT user scoping
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) throw error;
    return data || [];
  }

  /**
   * Add a message to a chat.
   * Pass `id` to use a pre-generated UUID (avoids a separate PATCH after upload).
   */
  async addMessage(
    chatId: string,
    content: string,
    role: 'user' | 'assistant' | 'system',
    optimizationId?: string,
    metadata?: any,
    id?: string,
  ): Promise<Message> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { data, error } = await this.client
      .from('messages')
      .insert({
        ...(id ? { id } : {}),          // use caller-supplied ID when provided
        chat_id: chatId,
        user_id: userData.user.id,
        content,
        role,
        optimization_id: optimizationId || null,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Find or create a default "Quick Optimizations" chat
   */
  async getOrCreateQuickOptimizationsChat(): Promise<Chat> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    // Try to find existing quick optimizations chat
    const { data: existingChats } = await this.client
      .from('chats')
      .select('*')
      .eq('user_id', userData.user.id)
      .eq('title', 'Quick Optimizations')
      .limit(1);

    if (existingChats && existingChats.length > 0) {
      return existingChats[0];
    }

    // Create new one
    return this.createChat('Quick Optimizations');
  }
  /**
   * Save user feedback to a message
   */
  async saveFeedback(messageId: string, rating: 'positive' | 'negative'): Promise<void> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    // First fetch current metadata
    const { data: currentMessage, error: fetchError } = await this.client
        .from('messages')
        .select('metadata')
        .eq('id', messageId)
        .eq('user_id', userData.user.id)
        .single();
        
    if (fetchError) throw fetchError;
    
    // Merge new feedback into existing metadata
    const currentMetadata = currentMessage?.metadata || {};
    const updatedMetadata = {
        ...currentMetadata,
        feedback: { rating }
    };

    // Update the message
    const { error: updateError } = await this.client
        .from('messages')
        .update({ metadata: updatedMetadata })
        .eq('id', messageId)
        .eq('user_id', userData.user.id);
        
    if (updateError) throw updateError;
  }

  /**
   * Count how many user-role messages exist in a chat.
   * Used to decide whether the title should still be updated on follow-up messages.
   */
  async countUserMessages(chatId: string): Promise<number> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { count, error } = await this.client
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .eq('user_id', userData.user.id)
      .eq('role', 'user');

    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Update only the attachedFiles metadata on an existing message.
   * Used to backfill Cloudinary/Supabase URLs after background uploads complete.
   */
  async updateMessageAttachments(messageId: string, attachedFiles: any[]): Promise<void> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { data: current, error: fetchError } = await this.client
        .from('messages')
        .select('metadata')
        .eq('id', messageId)
        .eq('user_id', userData.user.id)
        .single();

    if (fetchError) {
      Sentry.captureException(fetchError, { tags: { component: 'chat-service', op: 'updateMessageAttachments-fetch' }, extra: { messageId } });
      throw fetchError;
    }

    const { error: updateError } = await this.client
        .from('messages')
        .update({ metadata: { ...(current?.metadata || {}), attachedFiles } })
        .eq('id', messageId)
        .eq('user_id', userData.user.id);

    if (updateError) {
      Sentry.captureException(updateError, { tags: { component: 'chat-service', op: 'updateMessageAttachments-update' }, extra: { messageId } });
      throw updateError;
    }
  }
}
