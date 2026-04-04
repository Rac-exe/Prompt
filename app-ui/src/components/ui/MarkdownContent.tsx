import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  content: string;
  /** Use 'sm' for chat bubbles (default), 'xs' for compact/overlay contexts */
  size?: 'xs' | 'sm';
  className?: string;
}

/**
 * Shared markdown renderer used across the main chat and overlay.
 *
 * Uses @tailwindcss/typography `prose` classes for correct spacing/hierarchy,
 * with overrides to match the app's design tokens (Geist font, muted colours,
 * accent-coloured inline code, etc.). Supports GFM: tables, strikethrough,
 * task lists, and auto-links.
 */
export function MarkdownContent({ content, size = 'sm', className }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn(
        'prose dark:prose-invert max-w-none break-words',
        size === 'xs'
          ? 'prose-xs'
          : 'prose-sm',
        // Typography scale overrides — stay within the bubble's visual weight
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        // Paragraphs
        'prose-p:leading-relaxed prose-p:my-2',
        // Headings — tighten to avoid dominating chat bubbles
        'prose-headings:font-semibold prose-headings:leading-snug prose-headings:tracking-tight',
        'prose-h1:text-base prose-h2:text-sm prose-h3:text-sm',
        'prose-h1:mt-4 prose-h2:mt-3 prose-h3:mt-2',
        // Lists
        'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
        'prose-li:leading-relaxed',
        // Inline code — accent pill
        'prose-code:before:content-none prose-code:after:content-none',
        'prose-code:bg-accent/10 prose-code:text-accent prose-code:px-1.5 prose-code:py-0.5',
        'prose-code:rounded prose-code:font-mono prose-code:text-[0.8em] prose-code:font-normal',
        // Code blocks
        'prose-pre:bg-muted prose-pre:border prose-pre:border-border',
        'prose-pre:rounded-lg prose-pre:text-[0.8em] prose-pre:my-3',
        'prose-pre:overflow-x-auto',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground/90',
        // Blockquote
        'prose-blockquote:border-l-accent/50 prose-blockquote:text-muted-foreground',
        'prose-blockquote:not-italic prose-blockquote:my-2',
        // Links
        'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
        // Tables
        'prose-table:text-sm prose-thead:border-border prose-td:border-border prose-th:border-border',
        'prose-tr:border-border',
        // HR
        'prose-hr:border-border prose-hr:my-3',
        // Strong / em — keep foreground colour
        'prose-strong:text-foreground prose-em:text-foreground/80',
        className,
      )}
      components={{
        // Open links in the system browser (Electron), not inside the app
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href && window.electronAPI?.openExternal) {
                window.electronAPI.openExternal(href);
              } else if (href) {
                window.open(href, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            {children}
          </a>
        ),
        // Task-list checkboxes — render as disabled visual only
        input: ({ type, checked }) => {
          if (type === 'checkbox') {
            return (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mr-1.5 align-middle accent-accent"
              />
            );
          }
          return null;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
