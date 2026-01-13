/**
 * Session phases for prompt optimization lifecycle
 */
export enum SessionPhase {
  IDLE = "idle",
  DETECTING = "detecting",       // @prompt found, waiting for stability
  STABLE = "stable",             // User stopped typing, ready to optimize
  OPTIMIZING = "optimizing",     // AI request in-flight
  SHOWING = "showing"            // Result displayed
}

/**
 * Prompt session state
 */
export interface PromptSession {
  phase: SessionPhase;
  promptText: string;
  triggerPosition: number;

  // Timing
  detectedAt: number;
  lastEditAt: number;
  stabilizedAt: number;

  // AI state
  aiRequestId: string | null;
  lastOptimized: string;

  // Stability tracking
  editCount: number;
  stableFor: number;  // ms since last edit
}

/**
 * Create a new prompt session
 */
export function createSession(
  promptText: string,
  triggerPosition: number,
  now: number
): PromptSession {
  return {
    phase: SessionPhase.DETECTING,
    promptText,
    triggerPosition,
    detectedAt: now,
    lastEditAt: now,
    stabilizedAt: 0,
    aiRequestId: null,
    lastOptimized: "",
    editCount: 0,
    stableFor: 0
  };
}

/**
 * Update session with new text
 */
export function updateSession(
  session: PromptSession,
  newText: string,
  now: number
): PromptSession {
  return {
    ...session,
    promptText: newText,
    lastEditAt: now,
    editCount: session.editCount + 1,
    // Reset to detecting if not currently optimizing
    phase: session.phase === SessionPhase.OPTIMIZING
      ? SessionPhase.OPTIMIZING
      : SessionPhase.DETECTING,
    stableFor: 0
  };
}

/**
 * Mark session as stable
 */
export function markStable(session: PromptSession, now: number): PromptSession {
  return {
    ...session,
    phase: SessionPhase.STABLE,
    stabilizedAt: now
  };
}

/**
 * Mark session as optimizing
 */
export function markOptimizing(session: PromptSession, requestId: string): PromptSession {
  return {
    ...session,
    phase: SessionPhase.OPTIMIZING,
    aiRequestId: requestId
  };
}

/**
 * Mark session as showing result
 */
export function markShowing(session: PromptSession, optimized: string): PromptSession {
  return {
    ...session,
    phase: SessionPhase.SHOWING,
    lastOptimized: optimized
  };
}

/**
 * Update stability duration
 */
export function updateStability(session: PromptSession, now: number): PromptSession {
  return {
    ...session,
    stableFor: now - session.lastEditAt
  };
}
