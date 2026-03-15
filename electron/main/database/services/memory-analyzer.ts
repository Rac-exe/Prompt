import { SupabaseClientManager } from '../supabase-client';
import { MemoryService } from './memory-service';

// ─────────────────────────────────────────────────────────────────────────────
// Domain keyword maps — used for heuristic analysis
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
// Analyzer
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryAnalyzer {
  private client = SupabaseClientManager.getClient();
  private memoryService = new MemoryService();
  private optimizationsSinceLastRun = 0;
  private readonly runEveryN = 5; // analyze once per N new optimizations

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
   * Analyze recent optimizations and write inferred memory facts.
   * All writes use source='inferred' and confidence derived from frequency.
   */
  async analyze(userId: string): Promise<void> {
    try {
      const { data: userData } = await this.client.auth.getUser();
      if (!userData.user || userData.user.id !== userId) return;

      // Fetch last 50 optimizations for this user
      const { data, error } = await this.client
        .from('prompt_optimizations')
        .select('original_text, optimized_text, metadata')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !data || data.length === 0) return;

      const allText = data.map((r: { original_text: string }) => r.original_text.toLowerCase()).join(' ');

      // ── Multi-domain detection ───────────────────────────────────────
      // Collect ALL domains that cross the minimum keyword-hit threshold.
      // A person can work across multiple domains simultaneously.
      const MIN_DOMAIN_HITS = 3;
      const domainScores: { domain: string; count: number }[] = [];

      for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
        const count = keywords.reduce((acc, kw) => acc + (allText.split(kw).length - 1), 0);
        if (count >= MIN_DOMAIN_HITS) {
          domainScores.push({ domain, count });
        }
      }

      if (domainScores.length > 0) {
        // Sort descending by keyword hit count
        domainScores.sort((a, b) => b.count - a.count);
        const detectedDomains = domainScores.map((d) => d.domain).join(', ');
        // Confidence is based on the top scorer, capped at 1.0
        const confidence = Math.min(1.0, domainScores[0].count / 15);
        await this.memoryService.upsertMemoryEntry('behavioral', 'domains', detectedDomains, 'inferred', confidence);
      }


      // ── Style detection ─────────────────────────────────────────────
      const styleHits: { style: string; count: number }[] = [];
      for (const [style, patterns] of Object.entries(STYLE_PATTERNS)) {
        const count = patterns.reduce((acc, re) => acc + (allText.match(re) ?? []).length, 0);
        if (count >= 2) styleHits.push({ style, count });
      }
      if (styleHits.length > 0) {
        styleHits.sort((a, b) => b.count - a.count);
        const topStyles = styleHits.slice(0, 2).map((s) => s.style).join(', ');
        await this.memoryService.upsertMemoryEntry('behavioral', 'preferred_style', topStyles, 'inferred', 0.7);
      }

      // ── Optimization count context ──────────────────────────────────
      await this.memoryService.upsertMemoryEntry(
        'context',
        'total_optimizations_analyzed',
        String(data.length),
        'inferred',
        1.0,
      );

      console.log(`[MemoryAnalyzer] ✅ Memory updated for user ${userId}: domains=[${domainScores.map((d) => d.domain).join(', ')}]`);

    } catch (err) {
      // Non-critical: log and continue
      console.warn('[MemoryAnalyzer] Analysis failed (non-critical):', err);
    }
  }
}
