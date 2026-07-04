/**
 * window-detector.ts
 *
 * Classifies a target window as "chat" or "document" based on its title bar text.
 * Used to decide whether to show "Paste All Sections" (document) or per-section
 * Insert buttons only (chat).
 */

import * as Sentry from '@sentry/electron/main';

export type WindowMode = 'chat' | 'document';

export interface WindowDetectionResult {
  mode: WindowMode;
  confidence: 'high' | 'low';
  appName: string;
}

const CHAT_PATTERNS: Array<{ pattern: string; label: string }> = [
  { pattern: 'cursor', label: 'Cursor' },
  { pattern: 'visual studio code', label: 'VS Code' },
  { pattern: 'windsurf', label: 'Windsurf' },
  { pattern: 'copilot', label: 'GitHub Copilot' },

  { pattern: 'chatgpt', label: 'ChatGPT' },
  { pattern: 'claude', label: 'Claude' },
  { pattern: 'gemini', label: 'Gemini' },
  { pattern: 'perplexity', label: 'Perplexity' },
  { pattern: 'poe -', label: 'Poe' },
  { pattern: 'deepseek', label: 'DeepSeek' },
  { pattern: 'grok', label: 'Grok' },

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
      const result: WindowDetectionResult = { mode: 'chat', confidence: 'high', appName: label };
      Sentry.addBreadcrumb({ category: 'window-detector', message: 'Window classified', level: 'info', data: { ...result, title } });
      return result;
    }
  }

  for (const { pattern, label } of DOCUMENT_PATTERNS) {
    if (lower.includes(pattern)) {
      const result: WindowDetectionResult = { mode: 'document', confidence: 'high', appName: label };
      Sentry.addBreadcrumb({ category: 'window-detector', message: 'Window classified', level: 'info', data: { ...result, title } });
      return result;
    }
  }

  if (/\.(txt|md|py|js|ts|tsx|jsx|rs|go|java|cpp|c|h|rb|php|html|css|json|yaml|yml|toml)\b/i.test(title)) {
    const result: WindowDetectionResult = { mode: 'document', confidence: 'low', appName: 'Text Editor' };
    Sentry.addBreadcrumb({ category: 'window-detector', message: 'Window classified (file extension)', level: 'info', data: { ...result, title } });
    return result;
  }

  const result: WindowDetectionResult = { mode: 'document', confidence: 'low', appName: 'Unknown' };
  Sentry.addBreadcrumb({ category: 'window-detector', message: 'Window unrecognized — defaulting to document', level: 'warning', data: { title } });
  return result;
}
