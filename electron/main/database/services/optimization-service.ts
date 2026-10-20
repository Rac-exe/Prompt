import { getDb, LOCAL_USER_ID, newId, nowIso, toJson } from '../local-db';

export interface PromptOptimization {
  id: string;
  user_id: string;
  original_text: string;
  optimized_text: string;
  created_at: string;
  source: 'overlay' | 'app_window' | 'api';
  applied: boolean;
  rating: number | null;
  metadata: Record<string, any>;
}

/**
 * Local log of prompt optimizations. Messages reference these rows through
 * optimization_id.
 */
export class OptimizationService {
  /**
   * Save a prompt optimization (called from overlay or app window)
   */
  async saveOptimization(
    originalText: string,
    optimizedText: string,
    source: 'overlay' | 'app_window' | 'api',
    metadata?: any
  ): Promise<PromptOptimization> {
    const optimization: PromptOptimization = {
      id: newId(),
      user_id: LOCAL_USER_ID,
      original_text: originalText,
      optimized_text: optimizedText,
      created_at: nowIso(),
      source,
      applied: false,
      rating: null,
      metadata: metadata || {},
    };
    getDb()
      .prepare(
        `INSERT INTO prompt_optimizations
           (id, user_id, original_text, optimized_text, created_at, source, applied, rating, metadata)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
      )
      .run(
        optimization.id,
        optimization.user_id,
        originalText,
        optimizedText,
        optimization.created_at,
        source,
        toJson(optimization.metadata),
      );
    return optimization;
  }
}
