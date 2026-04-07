import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import darkLogo from "@/assets/logos/dark-logo-svg.svg";
import lightLogo from "@/assets/logos/light-logo-svg.svg";
import { useIsDark } from "@/hooks/useIsDark";
import type { AttachedFile, OverlayMessage, Turn } from '../lib/types';
import { SKILL_ICON_SVGS, DEFAULT_SKILL_ICON } from '../lib/constants';
import { useScrollController } from '../../hooks/useScrollController';
import { MarkdownContent } from '@/components/ui/MarkdownContent';
import { ClarificationCard } from '@/components/chat/ClarificationCard';

// ── Inline sub-components (small, tightly coupled to overlay) ────────────────

/** Bouncing dots loading indicator */
const LoadingDots: React.FC = () => (
  <div className="loading-indicator" style={{ display: 'flex' }}>
    <div className="dot-container">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  </div>
);

/** Version navigator ← n / m → */
const VersionNav: React.FC<{
  current: number;
  total: number;
  align: 'left' | 'right';
  onPrev: () => void;
  onNext: () => void;
}> = ({ current, total, align, onPrev, onNext }) => {
  if (total <= 1) return null;
  return (
    <div className={`version-nav ${align === 'right' ? 'align-right' : 'align-left'}`}>
      <button className="btn-vnav" disabled={current <= 1} onClick={onPrev}>
        <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="vnav-label">{current} / {total}</span>
      <button className="btn-vnav" disabled={current >= total} onClick={onNext}>
        <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
};

/** File attachment chips displayed above a user bubble */
const FilesDisplay: React.FC<{ files?: AttachedFile[] }> = ({ files }) => {
  if (!files || files.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
      {files.map((f, i) => {
        const cloudinaryUrl: string | undefined = (f as any).cloudinaryUrl;
        const storagePath: string | undefined = (f as any).storagePath;

        if (f.mimeType.startsWith('image/')) {
          // Prefer Cloudinary URL, fall back to base64 data-URI
          const src = cloudinaryUrl
            ? cloudinaryUrl
            : f.base64 ? `data:${f.mimeType};base64,${f.base64}` : null;
          if (src) {
            return (
              <div key={i} style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
                <img
                  src={src}
                  alt={f.name}
                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid hsl(var(--accent)/0.2)', display: 'block' }}
                />
              </div>
            );
          }
          // Image with no src yet — placeholder chip
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 8px', borderRadius: 8, background: 'hsl(var(--accent)/0.06)', border: '1px solid hsl(var(--accent)/0.15)', maxWidth: 160, flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'hsl(var(--foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            </div>
          );
        }

        // PDF — clickable if storagePath available
        if (storagePath) {
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 8px', borderRadius: 8,
                background: 'hsl(var(--accent)/0.06)', border: '1px solid hsl(var(--accent)/0.15)', maxWidth: 160, flexShrink: 0,
                cursor: 'pointer',
              }}
              onClick={async () => {
                if (window.electronAPI?.storage?.openPdf) {
                  await window.electronAPI.storage.openPdf(storagePath);
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
            >
              <svg style={{ width: 12, height: 12, flexShrink: 0, color: 'hsl(var(--accent))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'hsl(var(--foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
            </div>
          );
        }

        // PDF or other — static chip
        return (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 8px', borderRadius: 8,
              background: 'hsl(var(--accent)/0.06)', border: '1px solid hsl(var(--accent)/0.15)', maxWidth: 160, flexShrink: 0,
            }}
          >
            <svg style={{ width: 12, height: 12, flexShrink: 0, color: 'hsl(var(--accent))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'hsl(var(--foreground))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.name}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Skill tag shown inside a user bubble — same SVG paths as input skill pill */
const SkillTag: React.FC<{ skill?: string | null; skillLabel?: string | null }> = ({ skill, skillLabel }) => {
  if (!skill) return null;
  const iconPath = SKILL_ICON_SVGS[skill] || DEFAULT_SKILL_ICON;
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8, height: 20, padding: '0 7px',
        borderRadius: 20, background: 'hsl(var(--accent)/0.1)', border: '1px solid hsl(var(--accent)/0.25)',
        fontSize: 10, fontWeight: 600, color: 'hsl(var(--accent))', letterSpacing: '0.02em',
      }}
    >
      <svg
        style={{ width: 9, height: 9, flexShrink: 0, color: 'hsl(var(--accent))' }}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        dangerouslySetInnerHTML={{ __html: iconPath }}
      />
      {skillLabel || skill}
    </div>
  );
};

/** Inline label icon: dark logo on light theme, light logo on dark theme (matches main app Logo) */
const AssistantBrandMark: React.FC<{ size: number }> = ({ size }) => {
  const isDark = useIsDark();
  return (
    <img
      src={isDark ? lightLogo : darkLogo}
      alt=""
      width={size}
      height={size}
      style={{ objectFit: 'contain', display: 'block' }}
    />
  );
};

// ── UserMessage ──────────────────────────────────────────────────────────────

interface UserMessageProps {
  msg: OverlayMessage;
  turnIdx: number;
  isOptimizing: boolean;
  onEdit: (turnIdx: number, newContent: string) => void;
}

const UserMessage: React.FC<UserMessageProps> = ({ msg, turnIdx, isOptimizing, onEdit }) => {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const openEdit = useCallback(() => {
    setEditText(msg.content);
    setEditing(true);
  }, [msg.content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditText(msg.content);
  }, [msg.content]);

  const sendEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === msg.content) {
      cancelEdit();
      return;
    }
    setEditing(false);
    onEdit(turnIdx, trimmed);
  }, [editText, msg.content, cancelEdit, onEdit, turnIdx]);

  // auto-resize textarea
  useEffect(() => {
    if (editing && taRef.current) {
      const ta = taRef.current;
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
    }
  }, [editing]);

  return (
    <div className="chat-message">
      <div className="message-label">You</div>

      {/* Display mode */}
      {!editing && (
        <div>
          <FilesDisplay files={msg.attachedFiles} />
          <div className="message-bubble user-bubble">
            <SkillTag skill={msg.skill} skillLabel={msg.skillLabel} />
            <div className="message-text">{msg.content}</div>
          </div>
          <div className="user-message-actions">
            {!isOptimizing && (
              <button className="btn-user-action" onClick={openEdit}>
                <svg style={{ width: 10, height: 10 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            )}
          </div>
        </div>
      )}

      {/* Edit mode */}
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            ref={taRef}
            className="user-edit-textarea"
            rows={1}
            value={editText}
            onChange={(e) => {
              setEditText(e.target.value);
              // auto-resize
              const ta = e.target;
              ta.style.height = 'auto';
              ta.style.height = ta.scrollHeight + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendEdit(); }
              if (e.key === 'Escape') cancelEdit();
            }}
          />
          <div className="user-edit-actions">
            <button className="btn-edit-cancel" onClick={cancelEdit}>Cancel</button>
            <button className="btn-edit-send" onClick={sendEdit} disabled={!editText.trim()}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Section parsing (mirrors main app's MessageBubble) ───────────────────────

interface ParsedSection { title: string; content: string }

function parseSections(text: string): ParsedSection[] | null {
  const sectionRegex = /^## (.+)$/gm;
  const matches = [...text.matchAll(sectionRegex)];
  if (matches.length < 2) return null;

  const sections: ParsedSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const content = text.slice(start, end).trim();
    if (content) sections.push({ title, content });
  }
  return sections.length >= 2 ? sections : null;
}

const OverlaySectionCopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '2px 6px', borderRadius: 5,
        border: 'none', background: 'transparent',
        fontSize: 10, fontWeight: 500, cursor: 'pointer',
        color: copied ? 'hsl(var(--accent))' : 'hsl(var(--muted-foreground) / 0.5)',
        transition: 'color 0.15s',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {copied ? (
        <svg style={{ width: 10, height: 10 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
      ) : (
        <svg style={{ width: 10, height: 10 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const OverlaySectionInsertButton: React.FC<{
  text: string;
  inserted: boolean;
  onInsert: (text: string) => void;
}> = ({ text, inserted, onInsert }) => {
  const [inserting, setInserting] = useState(false);

  const handleInsert = useCallback(async () => {
    setInserting(true);
    onInsert(text);
    setTimeout(() => setInserting(false), 2000);
  }, [text, onInsert]);

  return (
    <button
      onClick={handleInsert}
      disabled={inserting}
      style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '2px 6px', borderRadius: 5,
        border: 'none', background: 'transparent',
        fontSize: 10, fontWeight: 500, cursor: inserted ? 'default' : 'pointer',
        color: inserted ? 'hsl(142 71% 45%)' : inserting ? 'hsl(var(--accent))' : 'hsl(var(--muted-foreground) / 0.5)',
        transition: 'color 0.15s',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {inserted ? (
        <svg style={{ width: 10, height: 10 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
      ) : (
        <svg style={{ width: 10, height: 10 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
      )}
      {inserted ? 'Inserted' : inserting ? 'Inserting…' : 'Insert'}
    </button>
  );
};

interface OverlaySectionedContentProps {
  content: string;
  showReplace?: boolean;
  insertedSections?: Set<number>;
  onInsertSection?: (sectionIdx: number, text: string) => void;
}

const OverlaySectionedContent: React.FC<OverlaySectionedContentProps> = ({
  content, showReplace, insertedSections, onInsertSection,
}) => {
  const sections = useMemo(() => parseSections(content), [content]);

  if (!sections) {
    return <MarkdownContent content={content} size="sm" className="message-text" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {sections.map((section, idx) => {
        const isInserted = insertedSections?.has(idx) ?? false;
        const sectionText = `${section.title}\n\n${section.content}`;

        return (
          <div
            key={idx}
            style={{
              padding: '10px 14px',
              borderTop: idx > 0 ? '1px solid hsl(var(--border) / 0.4)' : undefined,
              opacity: isInserted ? 0.5 : 1,
              transition: 'opacity 0.3s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: 5,
                  background: isInserted ? 'hsl(142 71% 45% / 0.15)' : 'hsl(var(--accent) / 0.1)',
                  fontSize: 10, fontWeight: 700,
                  color: isInserted ? 'hsl(142 71% 45%)' : 'hsl(var(--accent))',
                }}>
                  {isInserted ? '✓' : idx + 1}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'hsl(var(--foreground))', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {section.title}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {showReplace && onInsertSection && (
                  <OverlaySectionInsertButton
                    text={sectionText}
                    inserted={isInserted}
                    onInsert={() => onInsertSection(idx, sectionText)}
                  />
                )}
                <OverlaySectionCopyButton text={sectionText} />
              </div>
            </div>
            <MarkdownContent content={section.content} size="sm" />
          </div>
        );
      })}
    </div>
  );
};

// ── AssistantMessage ─────────────────────────────────────────────────────────

// ── Auto-pilot progress bar ──────────────────────────────────────────────────

interface AutopilotProgress {
  status: string;
  currentSection: number;
  totalSections: number;
  waitRemaining: number;
  error?: string;
}

interface AutopilotBarProps {
  sourceInfo: { appName: string; detectedMode: 'chat' | 'document'; confidence: 'high' | 'low' } | null;
  autopilotProgress: AutopilotProgress | null;
  sections: ParsedSection[];
  onStartAutopilot: (mode: 'chat' | 'document', waitSeconds: number, sections: string[]) => void;
  onStopAutopilot: () => void;
}

const AutopilotBar: React.FC<AutopilotBarProps> = ({
  sourceInfo, autopilotProgress, sections, onStartAutopilot, onStopAutopilot,
}) => {
  const [selectedMode, setSelectedMode] = useState<'chat' | 'document'>(sourceInfo?.detectedMode ?? 'document');
  const [waitSeconds, setWaitSeconds] = useState(45);

  useEffect(() => {
    if (sourceInfo?.detectedMode) setSelectedMode(sourceInfo.detectedMode);
  }, [sourceInfo?.detectedMode]);

  const isRunning = autopilotProgress?.status === 'running' || autopilotProgress?.status === 'paused';
  const isCompleted = autopilotProgress?.status === 'completed';
  const isError = autopilotProgress?.status === 'error';

  const handleStart = useCallback(() => {
    const sectionTexts = sections.map(s => `${s.title}\n\n${s.content}`);
    onStartAutopilot(selectedMode, waitSeconds, sectionTexts);
  }, [sections, selectedMode, waitSeconds, onStartAutopilot]);

  if (isCompleted) {
    return (
      <div style={{
        padding: '8px 12px', margin: '6px 0',
        borderRadius: 8, border: '1px solid hsl(142 71% 45% / 0.3)',
        background: 'hsl(142 71% 45% / 0.06)',
        fontSize: 11, color: 'hsl(142 71% 45%)', fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
        Auto-pilot complete — all {autopilotProgress.totalSections} sections delivered
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{
        padding: '8px 12px', margin: '6px 0',
        borderRadius: 8, border: '1px solid hsl(0 72% 51% / 0.3)',
        background: 'hsl(0 72% 51% / 0.06)',
        fontSize: 11, color: 'hsl(0 72% 51%)', fontWeight: 500,
      }}>
        Auto-pilot failed — {autopilotProgress?.error || 'target window may have been closed'}
      </div>
    );
  }

  if (isRunning && autopilotProgress) {
    const pct = ((autopilotProgress.currentSection + 1) / autopilotProgress.totalSections) * 100;
    const waiting = autopilotProgress.status === 'paused';

    return (
      <div style={{
        padding: '10px 12px', margin: '6px 0',
        borderRadius: 8, border: '1px solid hsl(var(--accent) / 0.2)',
        background: 'hsl(var(--accent) / 0.04)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
            Auto-pilot {waiting ? 'waiting' : 'running'}
          </span>
          <button
            onClick={onStopAutopilot}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 5,
              border: '1px solid hsl(0 72% 51% / 0.3)', background: 'hsl(0 72% 51% / 0.08)',
              fontSize: 10, fontWeight: 500, cursor: 'pointer', color: 'hsl(0 72% 51%)',
            }}
          >
            Stop
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
          Section {autopilotProgress.currentSection + 1} of {autopilotProgress.totalSections}
          {waiting && ` — waiting ${autopilotProgress.waitRemaining}s`}
        </div>
        <div style={{
          height: 3, borderRadius: 2, background: 'hsl(var(--border) / 0.3)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            background: 'hsl(var(--accent))',
            width: `${Math.min(pct, 100)}%`,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
    );
  }

  // Idle state — show configuration
  return (
    <div style={{
      padding: '10px 12px', margin: '6px 0',
      borderRadius: 8, border: '1px solid hsl(var(--border) / 0.3)',
      background: 'hsl(var(--card) / 0.5)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'hsl(var(--foreground))' }}>
          Auto-pilot
        </span>
        {sourceInfo && (
          <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
            Target: {sourceInfo.appName}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={() => setSelectedMode('chat')}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 500,
            cursor: 'pointer', transition: 'all 0.15s',
            border: selectedMode === 'chat' ? '1px solid hsl(var(--accent) / 0.4)' : '1px solid hsl(var(--border) / 0.3)',
            background: selectedMode === 'chat' ? 'hsl(var(--accent) / 0.1)' : 'transparent',
            color: selectedMode === 'chat' ? 'hsl(var(--accent))' : 'hsl(var(--muted-foreground))',
          }}
        >
          Chat Mode
        </button>
        <button
          onClick={() => setSelectedMode('document')}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 500,
            cursor: 'pointer', transition: 'all 0.15s',
            border: selectedMode === 'document' ? '1px solid hsl(var(--accent) / 0.4)' : '1px solid hsl(var(--border) / 0.3)',
            background: selectedMode === 'document' ? 'hsl(var(--accent) / 0.1)' : 'transparent',
            color: selectedMode === 'document' ? 'hsl(var(--accent))' : 'hsl(var(--muted-foreground))',
          }}
        >
          Paste All
        </button>
      </div>

      {selectedMode === 'chat' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>Wait between sections:</span>
          <select
            value={waitSeconds}
            onChange={(e) => setWaitSeconds(Number(e.target.value))}
            style={{
              padding: '2px 4px', borderRadius: 4, fontSize: 10,
              border: '1px solid hsl(var(--border) / 0.4)',
              background: 'hsl(var(--background))', color: 'hsl(var(--foreground))',
              cursor: 'pointer',
            }}
          >
            <option value={15}>15s</option>
            <option value={30}>30s</option>
            <option value={45}>45s</option>
            <option value={60}>60s</option>
            <option value={90}>90s</option>
            <option value={120}>2 min</option>
            <option value={180}>3 min</option>
          </select>
        </div>
      )}

      <button
        onClick={handleStart}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          padding: '6px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
          cursor: 'pointer', transition: 'all 0.15s',
          border: '1px solid hsl(var(--accent) / 0.3)',
          background: 'hsl(var(--accent) / 0.1)',
          color: 'hsl(var(--accent))',
        }}
      >
        <svg style={{ width: 11, height: 11 }} fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        {selectedMode === 'chat' ? 'Start Auto-pilot' : 'Paste All Sections'}
      </button>
    </div>
  );
};

// ── AssistantMessage ─────────────────────────────────────────────────────────

interface AssistantMessageProps {
  msg: OverlayMessage;
  turnIdx: number;
  isOptimizing: boolean;
  showReplace: boolean;
  onCopy: (msgId: string) => void;
  onReplace: (msgId: string) => void;
  onRegenerate: (turnIdx: number) => void;
  onInsertSection?: (sectionIdx: number, text: string) => void;
  insertedSections?: Set<number>;
  sourceInfo?: { appName: string; detectedMode: 'chat' | 'document'; confidence: 'high' | 'low' } | null;
  autopilotProgress?: AutopilotProgress | null;
  onStartAutopilot?: (mode: 'chat' | 'document', waitSeconds: number, sections: string[]) => void;
  onStopAutopilot?: () => void;
}

const AssistantMessage: React.FC<AssistantMessageProps> = ({
  msg, turnIdx, isOptimizing, showReplace, onCopy, onReplace, onRegenerate,
  onInsertSection, insertedSections, sourceInfo, autopilotProgress, onStartAutopilot, onStopAutopilot,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [replaceState, setReplaceState] = useState<'idle' | 'replacing' | 'replaced' | 'clipboard' | 'error'>('idle');

  const sections = useMemo(() => parseSections(msg.content), [msg.content]);
  const hasSections = sections !== null && sections.length >= 2;

  const handleCopy = useCallback(() => {
    onCopy(msg.id);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 1800);
  }, [msg.id, onCopy]);

  const handleReplace = useCallback(async () => {
    setReplaceState('replacing');
    onReplace(msg.id);
    setTimeout(() => setReplaceState('idle'), 3000);
  }, [msg.id, onReplace]);

  return (
    <div className="chat-message">
      <div className="message-label">
        <AssistantBrandMark size={10} />
        {' '}Optimized Prompt
      </div>
      <div className="message-bubble assistant-bubble">
        <OverlaySectionedContent
          content={msg.content}
          showReplace={showReplace}
          insertedSections={insertedSections}
          onInsertSection={onInsertSection}
        />
      </div>
      <div className="message-actions">
        {/* Copy */}
        <button
          className={`btn-msg-action${copyState === 'copied' ? ' action-success' : ''}`}
          onClick={handleCopy}
        >
          {copyState === 'copied' ? (
            <>
              <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
              {' '}Copied!
            </>
          ) : (
            <>
              <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              {' '}Copy
            </>
          )}
        </button>
        {/* Replace — only for non-sectioned output (single prompt) */}
        {showReplace && !hasSections && (
          <button className="btn-msg-action" onClick={handleReplace} disabled={replaceState === 'replacing'}>
            {replaceState === 'replacing' ? (
              <>
                <svg style={{ width: 12, height: 12 }} fill="none" viewBox="0 0 24 24" className="animate-spin"><circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path style={{ opacity: 0.8 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                {' '}Replacing…
              </>
            ) : (
              <>
                <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                {' '}Replace
              </>
            )}
          </button>
        )}
        {/* Regenerate */}
        <button className="btn-msg-action" onClick={() => onRegenerate(turnIdx)} disabled={isOptimizing}>
          <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          {' '}Regenerate
        </button>
        {/* Auto-saved badge */}
        {msg.autoSavedToChat && (
          <span className="btn-msg-action action-success" style={{ pointerEvents: 'none', cursor: 'default' }}>
            <svg style={{ width: 11, height: 11 }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            {' '}Saved to chat
          </span>
        )}
      </div>

      {/* Auto-pilot bar for sectioned output */}
      {showReplace && hasSections && sections && onStartAutopilot && onStopAutopilot && (
        <AutopilotBar
          sourceInfo={sourceInfo ?? null}
          autopilotProgress={autopilotProgress ?? null}
          sections={sections}
          onStartAutopilot={onStartAutopilot}
          onStopAutopilot={onStopAutopilot}
        />
      )}
    </div>
  );
};

// ── StreamingMessage ─────────────────────────────────────────────────────────

const StreamingMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="chat-message">
    <div className="message-label">
      <AssistantBrandMark size={10} />
      {' '}Optimized Prompt
    </div>
    <div className="message-bubble assistant-bubble">
      <OverlaySectionedContent content={content} />
    </div>
  </div>
);

// ── TurnItem ─────────────────────────────────────────────────────────────────

interface TurnItemProps {
  turn: Turn;
  turnIdx: number;
  isOptimizing: boolean;
  isStreamingHere: boolean;
  streamingContent: string;
  showReplace: boolean;
  onEditCommit: (turnIdx: number, newContent: string) => void;
  onCopy: (msgId: string) => void;
  onReplace: (msgId: string) => void;
  onRegenerate: (turnIdx: number) => void;
  onNavigateUser: (turnIdx: number, dir: 1 | -1) => void;
  onNavigateAssistant: (turnIdx: number, dir: 1 | -1) => void;
  onInsertSection?: (sectionIdx: number, text: string) => void;
  insertedSections?: Set<number>;
  sourceInfo?: { appName: string; detectedMode: 'chat' | 'document'; confidence: 'high' | 'low' } | null;
  autopilotProgress?: AutopilotProgress | null;
  onStartAutopilot?: (mode: 'chat' | 'document', waitSeconds: number, sections: string[]) => void;
  onStopAutopilot?: () => void;
}

const TurnItem: React.FC<TurnItemProps> = ({
  turn, turnIdx, isOptimizing, isStreamingHere, streamingContent, showReplace,
  onEditCommit, onCopy, onReplace, onRegenerate, onNavigateUser, onNavigateAssistant,
  onInsertSection, insertedSections, sourceInfo, autopilotProgress, onStartAutopilot, onStopAutopilot,
}) => {
  const uIdx = turn.userActiveIdx;
  const assistGroup = turn.assistantGroups[uIdx];
  const assistActiveIdx = turn.assistantActiveIdx[uIdx] ?? 0;

  return (
    <div style={{ marginBottom: 0 }}>
      {/* Render all user versions (only active visible) */}
      {turn.userVersions.map((uMsg, i) => (
        <div key={uMsg.id} style={{ display: i === turn.userActiveIdx ? undefined : 'none' }}>
          <UserMessage
            msg={uMsg}
            turnIdx={turnIdx}
            isOptimizing={isOptimizing}
            onEdit={onEditCommit}
          />
        </div>
      ))}

      {/* User version navigator */}
      <VersionNav
        current={turn.userActiveIdx + 1}
        total={turn.userVersions.length}
        align="right"
        onPrev={() => onNavigateUser(turnIdx, -1)}
        onNext={() => onNavigateUser(turnIdx, 1)}
      />

      {/* Render all assistant versions for active user (only active visible) */}
      {assistGroup?.map((aMsg, i) => (
        <div key={aMsg.id} style={{ display: i === assistActiveIdx ? undefined : 'none' }}>
          <AssistantMessage
            msg={aMsg}
            turnIdx={turnIdx}
            isOptimizing={isOptimizing}
            showReplace={showReplace}
            onCopy={onCopy}
            onReplace={onReplace}
            onRegenerate={onRegenerate}
            onInsertSection={onInsertSection}
            insertedSections={insertedSections}
            sourceInfo={sourceInfo}
            autopilotProgress={autopilotProgress}
            onStartAutopilot={onStartAutopilot}
            onStopAutopilot={onStopAutopilot}
          />
        </div>
      ))}

      {/* Streaming message */}
      {isStreamingHere && streamingContent && <StreamingMessage content={streamingContent} />}

      {/* Assistant version navigator */}
      <VersionNav
        current={(assistGroup?.length ?? 0) > 0 ? assistActiveIdx + 1 : 0}
        total={assistGroup?.length ?? 0}
        align="left"
        onPrev={() => onNavigateAssistant(turnIdx, -1)}
        onNext={() => onNavigateAssistant(turnIdx, 1)}
      />
    </div>
  );
};

// ── ChatArea (main export) ───────────────────────────────────────────────────

interface ChatAreaProps {
  turns: Turn[];
  isOptimizing: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  streamingTurnIdx: number;
  streamingContent: string;
  showReplace: boolean;
  onEditCommit: (turnIdx: number, newContent: string) => void;
  onCopy: (msgId: string) => void;
  onReplace: (msgId: string) => void;
  onRegenerate: (turnIdx: number) => void;
  onNavigateUser: (turnIdx: number, dir: 1 | -1) => void;
  onNavigateAssistant: (turnIdx: number, dir: 1 | -1) => void;
  clarificationData?: any;
  onSubmitClarification?: (answers: Record<string, string>, wantsSections: boolean) => void;
  onSkipClarification?: () => void;
  onInsertSection?: (sectionIdx: number, text: string) => void;
  insertedSections?: Set<number>;
  sourceInfo?: { appName: string; detectedMode: 'chat' | 'document'; confidence: 'high' | 'low' } | null;
  autopilotProgress?: AutopilotProgress | null;
  onStartAutopilot?: (mode: 'chat' | 'document', waitSeconds: number, sections: string[]) => void;
  onStopAutopilot?: () => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({
  turns, isOptimizing, isLoading, errorMessage, streamingTurnIdx, streamingContent, showReplace,
  onEditCommit, onCopy, onReplace, onRegenerate, onNavigateUser, onNavigateAssistant,
  clarificationData, onSubmitClarification, onSkipClarification,
  onInsertSection, insertedSections, sourceInfo, autopilotProgress, onStartAutopilot, onStopAutopilot,
}) => {
  const isDark = useIsDark();
  const chatAreaRef = useRef<HTMLDivElement>(null);

  const { handleScroll, scrollToBottom, showScrollButton } = useScrollController(
    chatAreaRef,
    {
      isStreaming: streamingTurnIdx >= 0,
      messageCount: turns.length + (clarificationData ? 1 : 0),
      streamingTrigger: streamingContent,
    },
  );

  const isEmpty = turns.length === 0;

  return (
    <div ref={chatAreaRef} className="chat-area" onScroll={handleScroll} style={{ position: 'relative' }}>
      {/* Empty state */}
      {isEmpty && (
        <div className="empty-state">
          <img
            src={isDark ? lightLogo : darkLogo}
            alt="Prmpt"
            style={{ width: 52, height: 52, objectFit: 'contain' }}
          />
          <div style={{ textAlign: 'center' }}>
            <div className="text-gradient-primary" style={{ fontSize: 20, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.02em' }}>
              Welcome to Prmpt!!
            </div>
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
              Transform rough ideas into precisely engineered prompts.
            </div>
          </div>
        </div>
      )}

      {/* Turn items */}
      {turns.map((turn, i) => (
        <TurnItem
          key={i}
          turn={turn}
          turnIdx={i}
          isOptimizing={isOptimizing}
          isStreamingHere={streamingTurnIdx === i}
          streamingContent={streamingTurnIdx === i ? streamingContent : ''}
          showReplace={showReplace}
          onEditCommit={onEditCommit}
          onCopy={onCopy}
          onReplace={onReplace}
          onRegenerate={onRegenerate}
          onNavigateUser={onNavigateUser}
          onNavigateAssistant={onNavigateAssistant}
          onInsertSection={onInsertSection}
          insertedSections={insertedSections}
          sourceInfo={sourceInfo}
          autopilotProgress={autopilotProgress}
          onStartAutopilot={onStartAutopilot}
          onStopAutopilot={onStopAutopilot}
        />
      ))}

      {/* Clarification card */}
      {clarificationData?.should_clarify && clarificationData.questions?.length > 0 && onSubmitClarification && onSkipClarification && (
        <ClarificationCard
          questions={clarificationData.questions}
          isComplex={clarificationData.is_complex}
          suggestedSections={clarificationData.suggested_sections || []}
          onSubmit={onSubmitClarification}
          onSkip={onSkipClarification}
          compact
        />
      )}

      {/* Error banner */}
      {errorMessage && (
        <div className="error-banner" style={{ display: 'block' }}>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && <LoadingDots />}

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          style={{
            position: 'sticky',
            bottom: 8,
            alignSelf: 'center',
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--background) / 0.9)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10,
            transition: 'opacity 0.15s',
          }}
        >
          <svg style={{ width: 14, height: 14, color: 'hsl(var(--foreground))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default ChatArea;
