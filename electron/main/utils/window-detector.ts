/**
 * window-detector.ts
 *
 * Classifies a target window as "chat" or "document" based on its title bar text.
 * Used by the auto-pilot engine to decide between sequential send (chat) and
 * bulk paste (document) modes.
 */

export type WindowMode = 'chat' | 'document';

export interface WindowDetectionResult {
  mode: WindowMode;
  confidence: 'high' | 'low';
  appName: string;
}

const CHAT_PATTERNS: Array<{ pattern: string; label: string }> = [
  // IDEs with AI chat
  { pattern: 'cursor', label: 'Cursor' },
  { pattern: 'visual studio code', label: 'VS Code' },
  { pattern: 'windsurf', label: 'Windsurf' },
  { pattern: 'copilot', label: 'GitHub Copilot' },

  // Web AI chat (browser title usually includes page name)
  { pattern: 'chatgpt', label: 'ChatGPT' },
  { pattern: 'claude', label: 'Claude' },
  { pattern: 'gemini', label: 'Gemini' },
  { pattern: 'perplexity', label: 'Perplexity' },
  { pattern: 'poe -', label: 'Poe' },
  { pattern: 'deepseek', label: 'DeepSeek' },
  { pattern: 'grok', label: 'Grok' },

  // Messaging apps (Enter sends message)
  { pattern: 'slack', label: 'Slack' },
  { pattern: 'discord', label: 'Discord' },
  { pattern: 'microsoft teams', label: 'Teams' },
  { pattern: 'whatsapp', label: 'WhatsApp' },
  { pattern: 'telegram', label: 'Telegram' },
  { pattern: 'signal', label: 'Signal' },
];

const DOCUMENT_PATTERNS: Array<{ pattern: string; label: string }> = [
  { pattern: 'notepad', label: 'Notepad' },
  { pattern: '- word', label: 'Microsoft Word' },
  { pattern: 'google docs', label: 'Google Docs' },
  { pattern: 'notion', label: 'Notion' },
  { pattern: 'obsidian', label: 'Obsidian' },
  { pattern: 'sublime text', label: 'Sublime Text' },
  { pattern: 'vim', label: 'Vim' },
  { pattern: 'neovim', label: 'Neovim' },
  { pattern: 'emacs', label: 'Emacs' },
];

export function detectWindowMode(title: string): WindowDetectionResult {
  const lower = title.toLowerCase();

  for (const { pattern, label } of CHAT_PATTERNS) {
    if (lower.includes(pattern)) {
      return { mode: 'chat', confidence: 'high', appName: label };
    }
  }

  for (const { pattern, label } of DOCUMENT_PATTERNS) {
    if (lower.includes(pattern)) {
      return { mode: 'document', confidence: 'high', appName: label };
    }
  }

  // Heuristic: file extensions in title suggest a code/text editor
  if (/\.(txt|md|py|js|ts|tsx|jsx|rs|go|java|cpp|c|h|rb|php|html|css|json|yaml|yml|toml)\b/i.test(title)) {
    return { mode: 'document', confidence: 'low', appName: 'Text Editor' };
  }

  // Default to document mode (safer — pastes everything at once, no Enter key sent)
  return { mode: 'document', confidence: 'low', appName: 'Unknown' };
}
