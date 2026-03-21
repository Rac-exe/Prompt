// ── Overlay-specific types ───────────────────────────────────────────────────

export interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
}

export interface OverlayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
  skill?: string | null;
  skillLabel?: string | null;
  autoSavedToChat?: boolean;
}

export interface Turn {
  userVersions: OverlayMessage[];
  userActiveIdx: number;
  /** Keyed by user version index → array of assistant messages. */
  assistantGroups: Record<number, OverlayMessage[]>;
  /** Keyed by user version index → active assistant index. */
  assistantActiveIdx: Record<number, number>;
  userGroupId: string;
  /** Keyed by user version index → UUID per assistant group. */
  assistantGroupIds: Record<number, string>;
}

export interface SkillInfo {
  name: string;
  label: string;
  description: string;
}

export interface OverlaySettings {
  theme?: string;
  font_size?: string;
  font_family?: string;
  prompt_instructions?: string;
}
