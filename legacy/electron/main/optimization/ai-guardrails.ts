import { PromptSession, SessionPhase } from "./session-state";
import { PythonClient } from "../api/python-client";

/**
 * Levenshtein distance for string similarity
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * AI Guardrails - prevents spam and manages optimization requests
 */
export class AIGuardrails {
  private readonly MIN_LENGTH = 10;
  private readonly SIMILARITY_THRESHOLD = 0.9;   // 90% similar = skip
  private readonly COOLDOWN_MS = 3000;           // 3s between requests
  private readonly MAX_IN_FLIGHT = 1;

  private inFlightRequests = new Map<string, Promise<string>>();
  private lastRequestTime = 0;
  private lastRequestText = "";
  private pythonClient: PythonClient;

  constructor(pythonClient: PythonClient) {
    this.pythonClient = pythonClient;
  }

  /**
   * Check if we should optimize this prompt
   */
  async shouldOptimize(
    promptText: string,
    session: PromptSession | null
  ): Promise<boolean> {
    const now = Date.now();

    // Too short
    if (promptText.length < this.MIN_LENGTH) {
      return false;
    }

    // Too similar to last request
    if (this.isSimilar(promptText, this.lastRequestText)) {
      console.log("[AIGuardrails] Skipping - too similar to last request");
      return false;
    }

    // Cooldown not elapsed
    if (now - this.lastRequestTime < this.COOLDOWN_MS) {
      console.log("[AIGuardrails] Skipping - cooldown active");
      return false;
    }

    // Already optimizing
    if (session && session.phase === SessionPhase.OPTIMIZING) {
      console.log("[AIGuardrails] Skipping - already optimizing");
      return false;
    }

    // Too many in-flight requests
    if (this.inFlightRequests.size >= this.MAX_IN_FLIGHT) {
      console.log("[AIGuardrails] Skipping - max in-flight requests");
      return false;
    }

    return true;
  }

  /**
   * Check if two strings are similar
   */
  private isSimilar(text1: string, text2: string): boolean {
    if (!text2) return false;
    if (text1 === text2) return true;

    const distance = levenshtein(text1, text2);
    const maxLen = Math.max(text1.length, text2.length);
    const similarity = 1 - (distance / maxLen);

    return similarity > this.SIMILARITY_THRESHOLD;
  }

  /**
   * Optimize a prompt with guardrails
   */
  async optimize(
    promptText: string,
    requestId: string,
    skipCache: boolean = false
  ): Promise<string> {
    // Check for in-flight request with same ID (unless skipping cache for refresh)
    if (!skipCache && this.inFlightRequests.has(requestId)) {
      console.log("[AIGuardrails] Reusing in-flight request:", requestId);
      return this.inFlightRequests.get(requestId)!;
    }

    console.log("[AIGuardrails] Starting optimization:", requestId, skipCache ? "(skip cache)" : "");

    // Create new request
    const promise = this.pythonClient.optimize(promptText, skipCache)
      .finally(() => {
        this.inFlightRequests.delete(requestId);
        console.log("[AIGuardrails] Request completed:", requestId);
      });

    this.inFlightRequests.set(requestId, promise);
    this.lastRequestTime = Date.now();
    this.lastRequestText = promptText;

    return promise;
  }

  /**
   * Get in-flight request count
   */
  getInFlightCount(): number {
    return this.inFlightRequests.size;
  }

  /**
   * Clear all in-flight requests
   */
  clear() {
    this.inFlightRequests.clear();
    this.lastRequestTime = 0;
    this.lastRequestText = "";
  }

  /**
   * Get configuration
   */
  getConfig() {
    return {
      minLength: this.MIN_LENGTH,
      similarityThreshold: this.SIMILARITY_THRESHOLD,
      cooldownMs: this.COOLDOWN_MS,
      maxInFlight: this.MAX_IN_FLIGHT
    };
  }
}
