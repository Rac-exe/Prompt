export interface SpaceProject {
  projectId: string;
  name: string;
  localPath: string;
  branch?: string;
  indexStatus?: string;
}

export interface SpaceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  feedback?: { rating: "positive" | "negative" };
}

export interface Space {
  id: string;
  name: string;
  projects: SpaceProject[];
  messages: SpaceMessage[];
  projectMode: boolean;
  createdAt: number;
  lastUsedAt: number;
}

// Spaces are intentionally restricted to a single project folder. The
// codebase-context retrieval fans out across every project in a space, but
// in practice mixing two unrelated codebases produces noisy, low-signal
// chunks that hurt the optimized prompt more than they help. This cap is
// enforced both in the UI (the "Add Folder" button hides) and respected
// by handlers (rejecting additional adds with a toast).
export const MAX_PROJECTS_PER_SPACE = 1;

export interface RetrievedChunk {
  id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  chunk_type: string;
  name: string;
  signature?: string;
  language: string;
  semantic_summary?: string;
  code_body?: string;
  concepts?: string[];
  similarity_score: number;
}

export interface RetrieveResult {
  ranked_chunks: RetrievedChunk[];
  related_chunks: RetrievedChunk[];
  branch_context?: Record<string, any>;
}

// Spaces are stored per authenticated user. Previously a single global key
// (`prmpt_spaces`) was used, which caused cross-account leakage on the same
// machine. The legacy key is migrated into the first user's scoped key on
// load so the original creator does not lose their spaces.
const LEGACY_SPACES_KEY = "prmpt_spaces";
const SPACES_KEY_PREFIX = "prmpt_spaces:";

function spacesKeyFor(userId: string): string {
  return `${SPACES_KEY_PREFIX}${userId}`;
}

function normalizeSpaces(raw: string): Space[] {
  const parsed: any[] = JSON.parse(raw);
  return parsed.map((s) => {
    if (s.history && !s.messages) {
      const messages: SpaceMessage[] = [];
      for (const entry of s.history) {
        messages.push({
          id: entry.id + "-user",
          role: "user",
          content: entry.issue,
          timestamp: entry.timestamp,
        });
        messages.push({
          id: entry.id + "-assistant",
          role: "assistant",
          content: entry.optimizedPrompt,
          timestamp: entry.timestamp,
        });
      }
      return { ...s, messages, history: undefined, projectMode: s.projectMode ?? true };
    }
    if (!s.messages) {
      return { ...s, messages: [], projectMode: s.projectMode ?? true };
    }
    return { ...s, projectMode: s.projectMode ?? true };
  });
}

export function loadSpaces(userId: string | null | undefined): Space[] {
  if (!userId) return [];
  const key = spacesKeyFor(userId);
  try {
    let raw = localStorage.getItem(key);

    // One-time migration: if the legacy unscoped key still holds data and
    // this user does not yet have a scoped entry, claim the legacy data
    // for the currently signed-in user. After migration the legacy key is
    // removed so other accounts on this machine start fresh.
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_SPACES_KEY);
      if (legacy) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_SPACES_KEY);
        raw = legacy;
      }
    }

    if (!raw) return [];
    return normalizeSpaces(raw);
  } catch {
    return [];
  }
}

export function saveSpaces(spaces: Space[], userId: string | null | undefined): void {
  if (!userId) return;
  localStorage.setItem(spacesKeyFor(userId), JSON.stringify(spaces));
}

/**
 * Debounced wrapper around `saveSpaces`. Stringifying every space (including
 * full chat history) on every keystroke caused noticeable input lag. Coalescing
 * writes inside a short window keeps the UI responsive without risking data
 * loss (storage flushes well within a tab close).
 */
const SAVE_DEBOUNCE_MS = 250;
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPayload = new Map<string, Space[]>();

export function saveSpacesDebounced(spaces: Space[], userId: string | null | undefined): void {
  if (!userId) return;
  pendingPayload.set(userId, spaces);

  const existing = pendingSaves.get(userId);
  if (existing) clearTimeout(existing);

  pendingSaves.set(
    userId,
    setTimeout(() => {
      pendingSaves.delete(userId);
      const payload = pendingPayload.get(userId);
      pendingPayload.delete(userId);
      if (payload) saveSpaces(payload, userId);
    }, SAVE_DEBOUNCE_MS),
  );
}

export function flushSpacesSaves(): void {
  for (const [userId, timer] of pendingSaves.entries()) {
    clearTimeout(timer);
    const payload = pendingPayload.get(userId);
    if (payload) saveSpaces(payload, userId);
  }
  pendingSaves.clear();
  pendingPayload.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => flushSpacesSaves());
  window.addEventListener("pagehide", () => flushSpacesSaves());
}

export function shortenPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return parts.join("/");
  return `.../${parts.slice(-3).join("/")}`;
}

export function buildTailoredPrompt(
  taskDescription: string,
  chunks: RetrievedChunk[],
  relatedChunks: RetrievedChunk[],
): string {
  const lines: string[] = [];

  lines.push(taskDescription.trim());
  lines.push("");

  if (chunks.length > 0) {
    lines.push("Here are the most relevant parts of my codebase for this task:");
    lines.push("");

    for (const chunk of chunks.slice(0, 8)) {
      const path = shortenPath(chunk.file_path);
      lines.push(
        `**${chunk.name}** (${chunk.chunk_type}) in \`${path}\` (lines ${chunk.start_line}-${chunk.end_line})`,
      );
      if (chunk.concepts && chunk.concepts.length > 0) {
        lines.push(`Concepts: ${chunk.concepts.join(", ")}`);
      }
      if (chunk.semantic_summary) {
        lines.push(`Summary: ${chunk.semantic_summary}`);
      }
      if (chunk.code_body) {
        lines.push(`\`\`\`${chunk.language}`);
        lines.push(chunk.code_body.slice(0, 2000));
        lines.push("```");
      } else if (chunk.signature) {
        lines.push(`Signature: \`${chunk.signature}\``);
      }
      lines.push("");
    }
  }

  if (relatedChunks.length > 0) {
    lines.push("Related/connected code:");
    lines.push("");
    for (const chunk of relatedChunks.slice(0, 5)) {
      const path = shortenPath(chunk.file_path);
      lines.push(`**${chunk.name}** in \`${path}\``);
      if (chunk.semantic_summary) {
        lines.push(`${chunk.semantic_summary}`);
      }
      if (chunk.code_body) {
        lines.push(`\`\`\`${chunk.language}`);
        lines.push(chunk.code_body.slice(0, 1500));
        lines.push("```");
      }
      lines.push("");
    }
  }

  lines.push(
    "Please provide a detailed, step-by-step plan considering these specific files and functions. Include exact file paths and function names in your response.",
  );

  return lines.join("\n");
}
