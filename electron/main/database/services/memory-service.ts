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
  observation_count: number;
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
          observation_count: 1, // Reset to 1 for explicit entries
        },
        { onConflict: 'user_id,memory_type,key' },
      );

    if (error) throw error;
  }

  /**
   * Check if an explicit (user-set) entry exists for a given (memoryType, key).
   * Used by the analyzer to skip overwriting user-defined facts with inferred ones.
   */
  async hasExplicitEntry(memoryType: MemoryType, key: string): Promise<boolean> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) return false;

    const { data, error } = await this.client
      .from('user_memory')
      .select('id')
      .eq('user_id', userData.user.id)
      .eq('memory_type', memoryType)
      .eq('key', key)
      .eq('source', 'explicit')
      .maybeSingle();

    if (error) return false;
    return !!data;
  }

  /**
   * Upsert an inferred memory entry, incrementing the observation_count
   * if it already exists. Skips if an explicit entry exists (explicit priority).
   * Returns true if the upsert was performed.
   */
  async upsertInferredEntry(
    memoryType: MemoryType,
    key: string,
    value: string,
    confidence = 0.7,
  ): Promise<boolean> {
    const { data: userData } = await this.client.auth.getUser();
    if (!userData.user) throw new Error('Not authenticated');

    // Check explicit priority
    const isExplicit = await this.hasExplicitEntry(memoryType, key);
    if (isExplicit) {
      console.log(`[MemoryService] Skipping inferred upsert for "${key}" — explicit entry exists`);
      return false;
    }

    // Check if entry already exists (to increment observation_count)
    const { data: existing } = await this.client
      .from('user_memory')
      .select('id, observation_count')
      .eq('user_id', userData.user.id)
      .eq('memory_type', memoryType)
      .eq('key', key)
      .maybeSingle();

    const newCount = existing ? (existing.observation_count || 1) + 1 : 1;

    const { error } = await this.client
      .from('user_memory')
      .upsert(
        {
          user_id: userData.user.id,
          memory_type: memoryType,
          key,
          value,
          source: 'inferred' as MemorySource,
          confidence,
          observation_count: newCount,
        },
        { onConflict: 'user_id,memory_type,key' },
      );

    if (error) throw error;
    return true;
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

  private static readonly PERSONA_KEYS = new Set([
    'occupation', 'role', 'job_title', 'profession', 'industry',
    'expertise', 'background', 'identity', 'title', 'position',
  ]);

  /**
   * Builds a compact memory context string suitable for injection into the
   * optimizer's custom_instructions field. Only includes high-confidence entries.
   *
   * Persona-type facts (occupation, role, etc.) get a strict "never reframe intent"
   * directive, while preference/enrichment facts get the standard "apply where relevant"
   * directive. This prevents persona memory from overriding the user's actual prompt intent.
   *
   * Returns an empty string if no memory exists yet.
   */
  async buildMemoryContext(): Promise<string> {
    let memory: UserMemoryMap;
    try {
      memory = await this.getMemory();
    } catch {
      return '';
    }

    const personaLines: string[] = [];
    const enrichmentLines: string[] = [];

    const addTo = (label: string, entries: Record<string, MemoryEntry>, target: string[]) => {
      const highConf = Object.values(entries).filter((e) => e.confidence >= 0.5);
      if (highConf.length === 0) return;
      target.push(`${label}:`);
      for (const entry of highConf) {
        target.push(`  - ${entry.key}: ${entry.value}`);
      }
    };

    const userPersona: Record<string, MemoryEntry> = {};
    const userPrefs: Record<string, MemoryEntry> = {};
    for (const [key, entry] of Object.entries(memory.user)) {
      if (MemoryService.PERSONA_KEYS.has(key.toLowerCase())) {
        userPersona[key] = entry;
      } else {
        userPrefs[key] = entry;
      }
    }

    addTo('User Identity', userPersona, personaLines);
    addTo('User Preferences', userPrefs, enrichmentLines);
    addTo('Usage Patterns', memory.behavioral, enrichmentLines);
    addTo('Recurring Themes', memory.context, enrichmentLines);

    const sections: string[] = [];

    if (personaLines.length > 0) {
      sections.push(
        '[USER PERSONA — background context only. Use to calibrate tone and technical depth. NEVER use to change the type or purpose of the prompt. If the user asks to build software, it is a coding task regardless of their occupation.]\n' +
          personaLines.join('\n'),
      );
    }

    if (enrichmentLines.length > 0) {
      sections.push(
        '[USER PREFERENCES — apply where relevant to enrich the optimized prompt.]\n' +
          enrichmentLines.join('\n'),
      );
    }

    if (sections.length === 0) return '';

    return sections.join('\n\n');
  }
}
