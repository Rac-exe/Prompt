import { Component, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

// ── Local error boundary ──────────────────────────────────────────────────────
// If react-markdown throws on a specific message (e.g. malformed content),
// fall back to plain whitespace-pre-wrap text instead of crashing the whole app.

interface BoundaryState { hasError: boolean }

class MarkdownErrorBoundary extends Component<
  { content: string; fallbackClass: string; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <p className={cn('text-sm leading-relaxed whitespace-pre-wrap', this.props.fallbackClass)}>
          {this.props.content}
        </p>
      );
    }
    return this.props.children;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MarkdownContentProps {
  content: string;
  /** Use 'sm' for chat bubbles (default), 'xs' for compact/overlay contexts */
  size?: 'xs' | 'sm';
  className?: string;
}

const PROSE_CLASSES = (size: 'xs' | 'sm', extra?: string) =>
  cn(
    'prose dark:prose-invert max-w-none break-words',
    size === 'xs' ? 'prose-xs' : 'prose-sm',
    // First/last child margin reset — avoid extra space inside bubbles
    '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
    // Paragraphs
    'prose-p:leading-relaxed prose-p:my-2',
    // Headings — keep subdued inside chat bubbles
    'prose-headings:font-semibold prose-headings:leading-snug prose-headings:tracking-tight',
    'prose-h1:text-base prose-h2:text-sm prose-h3:text-sm',
    'prose-h1:mt-4 prose-h2:mt-3 prose-h3:mt-2',
    // Lists
    'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:leading-relaxed',
    // Inline code — accent pill
    'prose-code:before:content-none prose-code:after:content-none',
    'prose-code:bg-accent/10 prose-code:text-accent prose-code:px-1.5 prose-code:py-0.5',
    'prose-code:rounded prose-code:font-mono prose-code:text-[0.8em] prose-code:font-normal',
    // Code blocks
    'prose-pre:bg-muted prose-pre:border prose-pre:border-border',
    'prose-pre:rounded-lg prose-pre:text-[0.8em] prose-pre:my-3 prose-pre:overflow-x-auto',
    '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground/90',
    // Blockquote
    'prose-blockquote:border-l-accent/50 prose-blockquote:text-muted-foreground',
    'prose-blockquote:not-italic prose-blockquote:my-2',
    // Links
    'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
    // Tables
    'prose-table:text-sm prose-thead:border-border prose-td:border-border',
    'prose-th:border-border prose-tr:border-border',
    // HR / strong / em
    'prose-hr:border-border prose-hr:my-3',
    'prose-strong:text-foreground prose-em:text-foreground/80',
    extra,
  );

/**
 * Shared markdown renderer for main chat and overlay.
 *
 * - Wraps ReactMarkdown in a <div> (className must sit on a real DOM node,
 *   not on the ReactMarkdown component itself which renders a fragment in v9+)
 * - Local ErrorBoundary falls back to plain text on any render error so a
 *   single bad message never crashes the whole app
 * - GFM plugin: tables, strikethrough, task lists, auto-links
 * - Links open in the system browser via electronAPI.openExternal
 */
export function MarkdownContent({ content, size = 'sm', className }: MarkdownContentProps) {
  const proseClass = PROSE_CLASSES(size, className);

  return (
    <MarkdownErrorBoundary content={content} fallbackClass="text-foreground">
      <div className={proseClass}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
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
            input: ({ type, checked }) =>
              type === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mr-1.5 align-middle accent-accent"
                />
              ) : null,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}
