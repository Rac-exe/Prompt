import { SupabaseClientManager } from '../supabase-client';

export interface PromptOptimization {
  id: string;
  user_id: string;
  original_text: string;
  optimized_text: string;
  created_at: string;
  source: 'overlay' | 'app_window' | 'api';
  applied: boolean;
  rating: number | null;
  metadata: {
    model: string;
    latency_ms: number;
    source_context: {
      app?: string;
      window_title?: string;
      cursor_position?: number;
    };
    optimization_params: {
      temperature?: number;
      max_tokens?: number;
      system_prompt_version?: string;
    };
    diff_stats: {
      original_length: number;
      optimized_length: number;
      improvement_score?: number;
    };
  };
}

export interface PromptVersion {
  id: string;
  optimization_id: string;
  version_number: number;
  optimized_text: string;
  created_at: string;
  is_selected: boolean;
  metadata: {
    regeneration_count: number;
    temperature: number;
    variation_prompt: string | null;
  };
}

export class OptimizationService {
  private client = SupabaseClientManager.getClient();

  /**
   * Save a prompt optimization (called from overlay or app window)
   */
  async saveOptimization(
    originalText: string,
    optimizedText: string,
    source: 'overlay' | 'app_window' | 'api',
    metadata?: any
  ): Promise<PromptOptimization> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { data, error } = await this.client
      .from('prompt_optimizations')
      .insert({
        user_id: userData.user.id,
        original_text: originalText,
        optimized_text: optimizedText,
        source,
        applied: false,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Mark optimization as applied (user clicked "Replace")
   */
  async markAsApplied(optimizationId: string): Promise<void> {
    const { error } = await this.client
      .from('prompt_optimizations')
      .update({ applied: true })
      .eq('id', optimizationId);

    if (error) throw error;
  }

  /**
   * Rate an optimization
   */
  async rateOptimization(optimizationId: string, rating: number): Promise<void> {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    const { error } = await this.client
      .from('prompt_optimizations')
      .update({ rating })
      .eq('id', optimizationId);

    if (error) throw error;
  }

  /**
   * Get recent optimizations for user
   */
  async getRecentOptimizations(limit: number = 50): Promise<PromptOptimization[]> {
    const { data, error } = await this.client
      .from('prompt_optimizations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get optimization by ID
   */
  async getOptimization(optimizationId: string): Promise<PromptOptimization | null> {
    const { data, error } = await this.client
      .from('prompt_optimizations')
      .select('*')
      .eq('id', optimizationId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create a new version of an optimization (regeneration)
   */
  async createVersion(
    optimizationId: string,
    optimizedText: string,
    versionNumber: number,
    metadata?: any
  ): Promise<PromptVersion> {
    const { data, error } = await this.client
      .from('prompt_versions')
      .insert({
        optimization_id: optimizationId,
        version_number: versionNumber,
        optimized_text: optimizedText,
        is_selected: false,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get all versions for an optimization
   */
  async getVersions(optimizationId: string): Promise<PromptVersion[]> {
    const { data, error } = await this.client
      .from('prompt_versions')
      .select('*')
      .eq('optimization_id', optimizationId)
      .order('version_number', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Select a version (mark others as not selected)
   */
  async selectVersion(optimizationId: string, versionId: string): Promise<void> {
    // First, unselect all versions for this optimization
    await this.client
      .from('prompt_versions')
      .update({ is_selected: false })
      .eq('optimization_id', optimizationId);

    // Then select the chosen version
    const { error } = await this.client
      .from('prompt_versions')
      .update({ is_selected: true })
      .eq('id', versionId);

    if (error) throw error;
  }
}
