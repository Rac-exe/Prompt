import { MemoryService, MemoryType } from './memory-service';
import { SettingsService } from './settings-service';
import { UserService } from './user-service';
import { PythonClient } from '../../api/python-client';
import { AppWindowManager } from '../../windows/app-window-manager';

// ─────────────────────────────────────────────────────────────────────────────
// LLM-Powered Memory Analyzer
//
// Replaces the old keyword-based analyzer with LLM fact extraction.
// After each optimization, sends the raw prompt + output to
// POST /extract-memory-facts on the Python service and upserts
// the returned facts into user_memory (respecting explicit priority).
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryAnalyzer {
  private memoryService: MemoryService;
  private settingsService: SettingsService;
  private userService: UserService;
  private pythonClient: PythonClient;
  private appWindowManager: AppWindowManager | null;

  // Throttle: only run extraction every N optimizations to avoid
  // hammering the LLM endpoint on rapid-fire usage.
  private optimizationsSinceLastRun = 0;
  private readonly runEveryN = 3;

  constructor(
    pythonClient: PythonClient,
    memoryService?: MemoryService,
    settingsService?: SettingsService,
    userService?: UserService,
    appWindowManager?: AppWindowManager | null,
  ) {
    this.pythonClient = pythonClient;
    this.memoryService = memoryService ?? new MemoryService();
    this.settingsService = settingsService ?? new SettingsService();
    this.userService = userService ?? new UserService();
    this.appWindowManager = appWindowManager ?? null;
  }

  /**
   * Call this after each successful optimization.
   * Runs LLM fact extraction every `runEveryN` calls.
   *
   * @param userId     Current user ID (for validation)
   * @param rawPrompt  The user's original prompt text
   * @param optimizedText  The optimizer's output
   * @param skill      The detected/forced skill (or null)
   */
  async onNewOptimization(
    userId: string,
    rawPrompt: string,
    optimizedText: string,
    skill: string | null = null,
  ): Promise<void> {
    this.optimizationsSinceLastRun += 1;
    if (this.optimizationsSinceLastRun < this.runEveryN) return;
    this.optimizationsSinceLastRun = 0;

    try {
      await this.extractAndUpsert(userId, rawPrompt, optimizedText, skill);
    } catch (err) {
      // Non-critical: log and continue — never block the main flow
      console.warn('[MemoryAnalyzer] Extraction failed (non-critical):', err);
    }
  }

  /**
   * Core extraction logic:
   * 1. Check if memory_enabled toggle is ON
   * 2. Call Python service to extract facts via LLM
   * 3. Upsert facts into user_memory (respecting explicit priority)
   * 4. Push updated memory to the app window for live UI refresh
   */
  private async extractAndUpsert(
    userId: string,
    rawPrompt: string,
    optimizedText: string,
    skill: string | null,
  ): Promise<void> {
    // ── 1. Check toggle ─────────────────────────────────────────────────
    const isEnabled = await this.isMemoryEnabled();
    if (!isEnabled) {
      console.log('[MemoryAnalyzer] Memory disabled by user — skipping extraction');
      return;
    }

    // ── 2. Extract facts via LLM ────────────────────────────────────────
    const facts = await this.pythonClient.extractMemoryFacts(rawPrompt, optimizedText, skill);
    if (!facts || facts.length === 0) {
      console.log('[MemoryAnalyzer] No facts extracted');
      return;
    }

    console.log(`[MemoryAnalyzer] Extracted ${facts.length} facts — upserting...`);

    // ── 3. Batch upsert into user_memory (3 DB queries regardless of fact count) ──
    const eligibleFacts = facts
      .filter((f) => ['user', 'behavioral', 'context'].includes(f.category))
      .map((f) => ({
        memoryType: f.category as MemoryType,
        key: f.key,
        value: f.value,
        confidence: f.confidence,
      }));

    const upsertedCount = await this.memoryService.upsertInferredEntries(eligibleFacts);

    if (upsertedCount === 0) {
      console.log('[MemoryAnalyzer] All facts skipped (explicit priority or duplicates)');
      return;
    }

    console.log(`[MemoryAnalyzer] Upserted ${upsertedCount}/${facts.length} facts for user ${userId}`);

    // ── 4. Push to UI ───────────────────────────────────────────────────
    if (this.appWindowManager) {
      try {
        const updatedMemory = await this.memoryService.getMemory();
        this.appWindowManager.send('memory:updated', updatedMemory);
      } catch {
        // Non-critical: UI will refresh on next manual load
      }
    }
  }

  /**
   * Check if the memory toggle is enabled for the current user.
   * Returns true by default if settings can't be read (graceful degradation).
   */
  async isMemoryEnabled(): Promise<boolean> {
    try {
      const profile = await this.userService.getUserProfile();
      if (!profile) return true; // Default on if we can't determine
      const settings = await this.settingsService.getUserSettings(profile.id);
      // Default to true if memory_enabled is not set (old DB rows)
      return settings?.memory_enabled !== false;
    } catch {
      return true; // Fail-open: don't block memory if settings fetch fails
    }
  }
}
