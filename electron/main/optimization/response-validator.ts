import { PromptSession, SessionPhase } from "./session-state";

/**
 * Validates AI responses to prevent showing stale results
 */
export class ResponseValidator {
  private requestCache = new Map<string, string>();

  /**
   * Validate that a response is still relevant for the current session
   */
  validate(
    response: string,
    requestId: string,
    currentSession: PromptSession | null
  ): boolean {
    // No active session
    if (!currentSession) {
      console.log(`[ResponseValidator] Discarding - no active session`);
      return false;
    }

    // Response doesn't match current session's request
    if (currentSession.aiRequestId !== requestId) {
      console.log(
        `[ResponseValidator] Discarding stale response - requestId mismatch`,
        `(expected: ${currentSession.aiRequestId}, got: ${requestId})`
      );
      return false;
    }

    // User edited prompt after request was sent
    const requestText = this.getRequestText(requestId);
    if (requestText && currentSession.promptText !== requestText) {
      console.log(
        `[ResponseValidator] Discarding - prompt changed since request`,
        `(was: "${requestText.substring(0, 50)}...", now: "${currentSession.promptText.substring(0, 50)}...")`
      );
      return false;
    }

    // Session was reset/cancelled
    if (currentSession.phase === SessionPhase.IDLE) {
      console.log(`[ResponseValidator] Discarding - session is idle`);
      return false;
    }

    console.log(`[ResponseValidator] ✓ Response validated for request ${requestId}`);
    return true;
  }

  /**
   * Cache the prompt text associated with a request ID
   */
  cacheRequest(requestId: string, promptText: string) {
    this.requestCache.set(requestId, promptText);

    // Clean up old entries (keep last 10)
    if (this.requestCache.size > 10) {
      const firstKey = this.requestCache.keys().next().value as string;
      if (firstKey) {
        this.requestCache.delete(firstKey);
      }
    }
  }

  /**
   * Get the cached prompt text for a request
   */
  private getRequestText(requestId: string): string {
    return this.requestCache.get(requestId) || "";
  }

  /**
   * Clear all cached requests
   */
  clear() {
    this.requestCache.clear();
  }

  /**
   * Get cache size for debugging
   */
  getCacheSize(): number {
    return this.requestCache.size;
  }
}
