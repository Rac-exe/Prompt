/**
 * Shared TypeScript types for User, Auth, and related data structures
 * Can be imported by both main process and renderer
 */

// ============================================
// AUTH TYPES
// ============================================

export interface SignUpData {
  name: string;
  dob: string; // ISO date string (YYYY-MM-DD)
  email: string;
  password: string;
}

export interface SignInData {
  email: string;
  password: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: CompleteUserData | null;
  error?: string;
}

// ============================================
// USER PROFILE TYPES
// ============================================

export interface UserProfile {
  id: string;
  name: string;
  dob: string | null;
  email: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  user_id: string;
  personalization_prompt: string | null;
  ui_settings: UISettings;
  updated_at: string;
}

export interface UISettings {
  theme: 'light' | 'dark' | 'system';
  default_model: string;
  shortcuts: {
    overlay_toggle: string;
    [key: string]: string;
  };
  optimization_preferences: {
    auto_optimize: boolean;
    show_diff: boolean;
    min_prompt_length: number;
  };
  privacy: {
    store_history: boolean;
    sync_across_devices: boolean;
  };
}

export interface CompleteUserData {
  profile: UserProfile;
  preferences: UserPreferences;
}

// ============================================
// CHAT TYPES
// ============================================

export interface Chat {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  metadata: ChatMetadata;
}

export interface ChatMetadata {
  tags: string[];
  folder: string | null;
  color: string;
  statistics: {
    total_messages: number;
    total_optimizations: number;
    avg_response_time_ms: number;
  };
}

export interface Message {
  id: string;
  chat_id: string;
  user_id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  created_at: string;
  optimization_id: string | null;
  metadata: MessageMetadata;
}

export interface MessageMetadata {
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  timing: {
    duration_ms: number;
  };
  source_app?: string;
  trigger_type?: string;
}

// ============================================
// OPTIMIZATION TYPES
// ============================================

export interface PromptOptimization {
  id: string;
  user_id: string;
  original_text: string;
  optimized_text: string;
  created_at: string;
  source: 'overlay' | 'app_window' | 'api';
  applied: boolean;
  rating: number | null;
  metadata: OptimizationMetadata;
}

export interface OptimizationMetadata {
  model: string;
  latency_ms: number;
  source_context: Record<string, any>;
  optimization_params?: Record<string, any>;
  diff_stats?: {
    chars_added: number;
    chars_removed: number;
    words_added: number;
    words_removed: number;
  };
}

export interface PromptVersion {
  id: string;
  optimization_id: string;
  version_number: number;
  optimized_text: string;
  created_at: string;
  is_selected: boolean;
  metadata: VersionMetadata;
}

export interface VersionMetadata {
  regeneration_count: number;
  temperature: number;
  variation_prompt: string | null;
}

// ============================================
// IPC TYPES
// ============================================

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Auth IPC
export interface AuthSignUpRequest extends SignUpData {}
export interface AuthSignInRequest extends SignInData {}
export interface AuthStateChangeEvent extends AuthState {}

// User IPC
export interface UserProfileUpdateRequest {
  name?: string;
  dob?: string;
  avatar_url?: string;
}

export interface UserPreferencesUpdateRequest {
  personalization_prompt?: string;
  ui_settings?: Partial<UISettings>;
}

// Chat IPC
export interface ChatCreateRequest {
  title?: string;
}

export interface MessageCreateRequest {
  chat_id: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  optimization_id?: string;
  metadata?: Partial<MessageMetadata>;
}

// Optimization IPC
export interface OptimizationRequest {
  text: string;
  isRegenerate?: boolean;
  usePersonalization?: boolean;
}

export interface OptimizationResponse {
  original: string;
  optimized: string;
  error?: string;
}

// ============================================
// HELPER TYPES
// ============================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

// ============================================
// CONSTANTS
// ============================================

export const DEFAULT_UI_SETTINGS: UISettings = {
  theme: 'dark',
  default_model: 'llama3.2',
  shortcuts: {
    overlay_toggle: 'Ctrl+5',
  },
  optimization_preferences: {
    auto_optimize: true,
    show_diff: true,
    min_prompt_length: 10,
  },
  privacy: {
    store_history: true,
    sync_across_devices: false,
  },
};

export const OPTIMIZATION_SOURCES = ['overlay', 'app_window', 'api'] as const;
export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;
