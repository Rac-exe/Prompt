import { SupabaseClientManager } from '../supabase-client';
import { MemoryService } from './memory-service';

// ─────────────────────────────────────────────────────────────────────────────
// Domain keyword maps
// ─────────────────────────────────────────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  'Backend Development': ['python', 'fastapi', 'django', 'flask', 'node', 'express', 'rest api', 'api', 'backend', 'server', 'database', 'sql', 'postgres', 'mongodb'],
  'Frontend Development': ['react', 'vue', 'angular', 'html', 'css', 'javascript', 'typescript', 'ui', 'frontend', 'component', 'tailwind', 'next.js', 'vite'],
  'Machine Learning': ['machine learning', 'ml', 'ai', 'neural network', 'deep learning', 'model', 'training', 'dataset', 'classification', 'regression', 'llm', 'gpt'],
  'Data Engineering': ['pandas', 'spark', 'etl', 'pipeline', 'data', 'csv', 'json', 'bigquery', 'airflow', 'kafka'],
  'DevOps': ['docker', 'kubernetes', 'ci/cd', 'deploy', 'terraform', 'helm', 'aws', 'gcp', 'azure', 'cloud', 'infra'],
  'Mobile Development': ['react native', 'flutter', 'swift', 'kotlin', 'android', 'ios', 'mobile', 'app'],
  'Content & Marketing': ['blog', 'post', 'email', 'newsletter', 'marketing', 'copy', 'seo', 'social media'],
  'Design': ['figma', 'design', 'ui/ux', 'wireframe', 'prototype', 'branding', 'color', 'typography'],
};

const STYLE_PATTERNS: Record<string, RegExp[]> = {
  concise: [/\bconcise\b/i, /\bshort\b/i, /\bbrief\b/i, /\btl;dr\b/i],
  'step-by-step': [/\bstep.by.step\b/i, /\bsteps\b/i, /\bsequential\b/i, /\bnumbered\b/i],
  technical: [/\btechnical\b/i, /\bdetailed\b/i, /\bin.depth\b/i, /\bcomprehensive\b/i],
  examples: [/\bexample\b/i, /\bsample\b/i, /\bdemonstrate\b/i, /\bshow me\b/i],
};

// ─────────────────────────────────────────────────────────────────────────────
// Weighted scoring config
//
// Scoring uses exponential recency decay.
// Each prompt at index `i` (0 = most recent) gets weight = e^(-DECAY * i).
//
// At DECAY = 0.06 with 50 prompts:
//   - Index 0 (most recent):  weight 1.00
//   - Index 10:               weight 0.55
//   - Index 25:               weight 0.22
//   - Index 49 (oldest):      weight 0.05
//
// Effect: after ~20 prompts in a new domain, it overtakes a stale old domain
// even if the old one had months of history. Self-correcting by design.
// ─────────────────────────────────────────────────────────────────────────────

const DECAY_RATE = 0.06;

// A domain is included only if its WEIGHTED score clears MIN_WEIGHTED_SCORE.
// Raw hit threshold equivalent (at weight 1.0): roughly 2-3 recent keyword hits.
const MIN_WEIGHTED_SCORE = 1.5;

// Normalize against this total to produce a 0-1 confidence value.
// Represents a "strong signal" (e.g., 25 weighted keyword hits = full confidence).
const CONFIDENCE_NORMALIZER = 25;

// ─────────────────────────────────────────────────────────────────────────────
// Analyzer
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryAnalyzer {
  private client = SupabaseClientManager.getClient();
  private memoryService = new MemoryService();
  private optimizationsSinceLastRun = 0;
  private readonly runEveryN = 5;

  /**
   * Call this after each successful optimization. Runs the full analysis
   * every `runEveryN` calls so we don't hammer Supabase on every message.
   */
  async onNewOptimization(userId: string): Promise<void> {
    this.optimizationsSinceLastRun += 1;
    if (this.optimizationsSinceLastRun < this.runEveryN) return;
    this.optimizationsSinceLastRun = 0;
    await this.analyze(userId);
  }

  /**
   * Analyze recent optimizations using recency-weighted scoring.
   *
   * Each prompt at position i (0 = most recent) gets weight = e^(-DECAY * i).
   * This means recent prompts dominate — so if a user shifts domain, the new
   * domain rises in score within ~15-20 new optimizations, and the stale old
   * domain naturally drops below the threshold and disappears.
   *
   * Supports multi-domain: all domains that cross MIN_WEIGHTED_SCORE are kept,
   * ranked by weighted score (primary domain first).
   */
  async analyze(userId: string): Promise<void> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user || userData.user.id !== userId) return;

      // Fetch last 50 optimizations, ordered most-recent first (index 0 = newest)
      const { data, error } = await this.client
        .from('prompt_optimizations')
        .select('original_text, metadata, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !data || data.length === 0) return;

      const totalPrompts = data.length;

      // ── Recency-weighted domain scoring ────────────────────────────────
      //
      // For each prompt (index i, 0 = newest), compute its recency weight.
      // Then for each domain, accumulate weighted keyword hits per prompt.
      // This gives us a weighted score that naturally reflects recent behavior.
      //
      const domainWeightedScores: Record<string, number> = {};

      for (let i = 0; i < totalPrompts; i++) {
        const promptText = (data[i] as { original_text: string }).original_text.toLowerCase();
        const weight = Math.exp(-DECAY_RATE * i);

        for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
          const hits = keywords.reduce((acc, kw) => acc + (promptText.split(kw).length - 1), 0);
          if (hits > 0) {
            domainWeightedScores[domain] = (domainWeightedScores[domain] ?? 0) + hits * weight;
          }
        }
      }

      // ── Multi-domain selection ──────────────────────────────────────────
      //
      // Keep all domains that cross the minimum weighted score threshold.
      // Sort by weighted score so primary domain appears first.
      //
      const qualifiedDomains = Object.entries(domainWeightedScores)
        .filter(([, score]) => score >= MIN_WEIGHTED_SCORE)
        .sort(([, a], [, b]) => b - a);

      if (qualifiedDomains.length > 0) {
        const detectedDomains = qualifiedDomains.map(([domain]) => domain).join(', ');
        // Confidence based on top scorer, normalized and capped at 1.0
        const topScore = qualifiedDomains[0][1];
        const confidence = Math.min(1.0, topScore / CONFIDENCE_NORMALIZER);
        await this.memoryService.upsertMemoryEntry('behavioral', 'domains', detectedDomains, 'inferred', confidence);
        console.log(
          `[MemoryAnalyzer] ✅ Domains for user ${userId}: ${detectedDomains} ` +
          `(top score: ${topScore.toFixed(2)}, confidence: ${(confidence * 100).toFixed(0)}%, ${totalPrompts} prompts analyzed)`,
        );
      } else {
        console.log(`[MemoryAnalyzer] ℹ️ No qualifying domains found for user ${userId} (${totalPrompts} prompts analyzed)`);
      }

      // ── Style detection (also recency-weighted) ─────────────────────────
      const styleWeightedScores: Record<string, number> = {};
      for (let i = 0; i < totalPrompts; i++) {
        const promptText = (data[i] as { original_text: string }).original_text.toLowerCase();
        const weight = Math.exp(-DECAY_RATE * i);
        for (const [style, patterns] of Object.entries(STYLE_PATTERNS)) {
          const hits = patterns.reduce((acc, re) => acc + (promptText.match(re) ?? []).length, 0);
          if (hits > 0) {
            styleWeightedScores[style] = (styleWeightedScores[style] ?? 0) + hits * weight;
          }
        }
      }
      const qualifiedStyles = Object.entries(styleWeightedScores)
        .filter(([, score]) => score >= 1.0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([style]) => style);

      if (qualifiedStyles.length > 0) {
        await this.memoryService.upsertMemoryEntry('behavioral', 'preferred_style', qualifiedStyles.join(', '), 'inferred', 0.7);
      }

      // ── Optimization count context ──────────────────────────────────────
      await this.memoryService.upsertMemoryEntry(
        'context',
        'total_optimizations_analyzed',
        String(totalPrompts),
        'inferred',
        1.0,
      );
    } catch (err) {
      // Non-critical: log and continue
      console.warn('[MemoryAnalyzer] Analysis failed (non-critical):', err);
    }
  }
}
