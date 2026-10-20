import { getDb, LOCAL_USER_ID, newId, nowIso } from '../local-db';

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
  /**
   * Fetch all memory entries, grouped by memory_type.
   */
  async getMemory(): Promise<UserMemoryMap> {
    const rows = getDb()
      .prepare('SELECT * FROM user_memory WHERE user_id = ? ORDER BY memory_type ASC, key ASC')
      .all(LOCAL_USER_ID) as MemoryEntry[];

    const result: UserMemoryMap = { user: {}, behavioral: {}, context: {} };
    for (const entry of rows) {
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
    // observation_count resets to 1 for explicit entries
    MemoryService.upsertRow(memoryType, key, value, source, confidence, 1);
  }

  /**
   * Check if an explicit (user-set) entry exists for a given (memoryType, key).
   * Used by the analyzer to skip overwriting user-defined facts with inferred ones.
   */
  async hasExplicitEntry(memoryType: MemoryType, key: string): Promise<boolean> {
    const row = getDb()
      .prepare(
        "SELECT id FROM user_memory WHERE user_id = ? AND memory_type = ? AND key = ? AND source = 'explicit'",
      )
      .get(LOCAL_USER_ID, memoryType, key);
    return !!row;
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
    if (await this.hasExplicitEntry(memoryType, key)) {
      console.log(`[MemoryService] Skipping inferred upsert for "${key}" — explicit entry exists`);
      return false;
    }
    const existing = getDb()
      .prepare('SELECT observation_count FROM user_memory WHERE user_id = ? AND memory_type = ? AND key = ?')
      .get(LOCAL_USER_ID, memoryType, key);
    const newCount = existing ? (existing.observation_count || 1) + 1 : 1;
    MemoryService.upsertRow(memoryType, key, value, 'inferred', confidence, newCount);
    return true;
  }

  /**
   * Batch upsert multiple inferred memory entries in one transaction.
   * Respects explicit priority: any key that has an explicit entry is skipped.
   * Returns the number of rows actually written.
   */
  async upsertInferredEntries(
    facts: Array<{ memoryType: MemoryType; key: string; value: string; confidence: number }>,
  ): Promise<number> {
    if (facts.length === 0) return 0;
    const conn = getDb();

    const explicitRows = conn
      .prepare("SELECT memory_type, key FROM user_memory WHERE user_id = ? AND source = 'explicit'")
      .all(LOCAL_USER_ID);
    const explicitSet = new Set(explicitRows.map((r: any) => `${r.memory_type}::${r.key}`));

    const eligible = facts.filter((f) => !explicitSet.has(`${f.memoryType}::${f.key}`));
    if (eligible.length === 0) return 0;

    const existingRows = conn
      .prepare('SELECT memory_type, key, observation_count FROM user_memory WHERE user_id = ?')
      .all(LOCAL_USER_ID);
    const existingMap = new Map<string, number>(
      existingRows.map((r: any) => [`${r.memory_type}::${r.key}`, r.observation_count as number]),
    );

    // Sanitize key/value before writing (they are later injected into prompts)
    const rows = eligible
      .map((f) => ({
        memoryType: f.memoryType,
        key: MemoryService.sanitizeField(f.key, MemoryService.MAX_KEY_LEN),
        value: MemoryService.sanitizeField(f.value, MemoryService.MAX_VALUE_LEN),
        confidence: f.confidence,
        count: (existingMap.get(`${f.memoryType}::${f.key}`) ?? 0) + 1,
      }))
      .filter((r) => r.key.length > 0 && r.value.length > 0);

    conn.transaction(() => {
      for (const r of rows) {
        MemoryService.upsertRow(r.memoryType, r.key, r.value, 'inferred', r.confidence, r.count);
      }
    })();
    return rows.length;
  }

  /**
   * Delete a specific memory entry.
   */
  async deleteMemoryEntry(memoryType: MemoryType, key: string): Promise<void> {
    getDb()
      .prepare('DELETE FROM user_memory WHERE user_id = ? AND memory_type = ? AND key = ?')
      .run(LOCAL_USER_ID, memoryType, key);
  }

  private static upsertRow(
    memoryType: MemoryType,
    key: string,
    value: string,
    source: MemorySource,
    confidence: number,
    observationCount: number,
  ): void {
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO user_memory
           (id, user_id, memory_type, key, value, confidence, source, observation_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, memory_type, key) DO UPDATE SET
           value = excluded.value,
           confidence = excluded.confidence,
           source = excluded.source,
           observation_count = excluded.observation_count,
           updated_at = excluded.updated_at`,
      )
      .run(newId(), LOCAL_USER_ID, memoryType, key, value, confidence, source, observationCount, now, now);
  }

  /** Max character lengths for stored fact fields. */
  private static readonly MAX_KEY_LEN = 60;
  private static readonly MAX_VALUE_LEN = 300;

  /**
   * Sanitize a memory key or value before it is injected into a system prompt.
   * Strips characters that are commonly used in prompt injection attacks and
   * enforces a hard length cap.
   */
  private static sanitizeField(raw: string, maxLen: number): string {
    return raw
      .slice(0, maxLen)
      .replace(/\[|\]|\{|\}/g, '')                          // remove bracket markers
      .replace(/SYSTEM\s*:/gi, '')                          // strip SYSTEM: prefixes
      .replace(/IGNORE\s+(ALL\s+)?PREVIOUS/gi, '')          // strip jailbreak phrases
      .replace(/OVERRIDE\s*:/gi, '')
      .replace(/INSTRUCTION\s*:/gi, '')
      .trim();
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
        const safeKey = MemoryService.sanitizeField(entry.key, MemoryService.MAX_KEY_LEN);
        const safeVal = MemoryService.sanitizeField(entry.value, MemoryService.MAX_VALUE_LEN);
        if (safeKey && safeVal) {
          target.push(`  - ${safeKey}: ${safeVal}`);
        }
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

    const combined = sections.join('\n\n');
    // Hard cap — prevents a large injected context from overwhelming the system prompt
    return combined.slice(0, 800);
  }
}
