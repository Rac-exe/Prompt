import { SupabaseClientManager } from '../supabase-client';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryType = 'user' | 'behavioral' | 'context';
export type MemorySource = 'inferred' | 'explicit';

export interface MemoryEntry {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  source: MemorySource;
  created_at: string;
  updated_at: string;
}

export interface UserMemoryMap {
  user: Record<string, MemoryEntry>;
  behavioral: Record<string, MemoryEntry>;
  context: Record<string, MemoryEntry>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryService {
  private client = SupabaseClientManager.getClient();

  /**
   * Fetch all memory entries for the authenticated user,
   * grouped by memory_type.
   */
  async getMemory(): Promise<UserMemoryMap> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { data, error } = await this.client
      .from('user_memory')
      .select('*')
      .eq('user_id', userData.user.id)
      .order('memory_type', { ascending: true })
      .order('key', { ascending: true });

    if (error) throw error;

    const result: UserMemoryMap = { user: {}, behavioral: {}, context: {} };
    for (const entry of (data ?? []) as MemoryEntry[]) {
      result[entry.memory_type][entry.key] = entry;
    }
    return result;
  }

  /**
   * Upsert a single memory entry.
   * Uses the UNIQUE(user_id, memory_type, key) constraint for conflict resolution.
   */
  async upsertMemoryEntry(
    memoryType: MemoryType,
    key: string,
    value: string,
    source: MemorySource = 'inferred',
    confidence = 1.0,
  ): Promise<void> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { error } = await this.client
      .from('user_memory')
      .upsert(
        {
          user_id: userData.user.id,
          memory_type: memoryType,
          key,
          value,
          source,
          confidence,
        },
        { onConflict: 'user_id,memory_type,key' },
      );

    if (error) throw error;
  }

  /**
   * Delete a specific memory entry.
   * Only deletes entries belonging to the authenticated user (RLS enforced server-side too).
   */
  async deleteMemoryEntry(memoryType: MemoryType, key: string): Promise<void> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    const { error } = await this.client
      .from('user_memory')
      .delete()
      .eq('user_id', userData.user.id)
      .eq('memory_type', memoryType)
      .eq('key', key);

    if (error) throw error;
  }

  /**
   * Builds a compact memory context string suitable for injection into the
   * optimizer's custom_instructions field. Only includes high-confidence entries.
   *
   * Returns an empty string if no memory exists yet.
   */
  async buildMemoryContext(): Promise<string> {
    let memory: UserMemoryMap;
    try {
      memory = await this.getMemory();
    } catch {
      // Not authenticated or table doesn't exist yet — fail silently
      return '';
    }

    const lines: string[] = [];

    const add = (label: string, entries: Record<string, MemoryEntry>) => {
      const highConf = Object.values(entries).filter((e) => e.confidence >= 0.5);
      if (highConf.length === 0) return;
      lines.push(`${label}:`);
      for (const entry of highConf) {
        lines.push(`  - ${entry.key}: ${entry.value}`);
      }
    };

    add('User Profile', memory.user);
    add('Usage Patterns', memory.behavioral);
    add('Recurring Themes', memory.context);

    if (lines.length === 0) return '';

    return [
      '[USER MEMORY — apply where relevant to enrich the optimized prompt]',
      ...lines,
    ].join('\n');
  }
}
