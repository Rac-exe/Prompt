import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachedFile, OverlayMessage, Turn } from '../lib/types';

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

/** File attachment chips (read-only display inside a user bubble) */
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
                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid hsl(var(--emerald)/0.2)', display: 'block' }}
                />
              </div>
            );
          }
          // Image with no src yet — placeholder chip
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 8px', borderRadius: 8, background: 'hsl(var(--emerald)/0.06)', border: '1px solid hsl(var(--emerald)/0.15)', maxWidth: 160, flexShrink: 0 }}>
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
                background: 'hsl(var(--emerald)/0.06)', border: '1px solid hsl(var(--emerald)/0.15)', maxWidth: 160, flexShrink: 0,
                cursor: 'pointer',
              }}
              onClick={async () => {
                if (window.electronAPI?.storage?.openPdf) {
                  await window.electronAPI.storage.openPdf(storagePath);
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
            >
              <svg style={{ width: 12, height: 12, flexShrink: 0, color: 'hsl(var(--emerald))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              background: 'hsl(var(--emerald)/0.06)', border: '1px solid hsl(var(--emerald)/0.15)', maxWidth: 160, flexShrink: 0,
            }}
          >
            <svg style={{ width: 12, height: 12, flexShrink: 0, color: 'hsl(var(--emerald))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

/** Skill tag shown inside a user bubble */
const SkillTag: React.FC<{ skill?: string | null; skillLabel?: string | null }> = ({ skill, skillLabel }) => {
  if (!skill) return null;
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8, height: 20, padding: '0 7px',
        borderRadius: 20, background: 'hsl(var(--emerald)/0.1)', border: '1px solid hsl(var(--emerald)/0.25)',
        fontSize: 10, fontWeight: 600, color: 'hsl(var(--emerald))', letterSpacing: '0.02em',
      }}
    >
      <svg style={{ width: 9, height: 9, flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
      </svg>
      {skillLabel || skill}
    </div>
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
          <div className="message-bubble user-bubble">
            <FilesDisplay files={msg.attachedFiles} />
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

// ── AssistantMessage ─────────────────────────────────────────────────────────

interface AssistantMessageProps {
  msg: OverlayMessage;
  turnIdx: number;
  isOptimizing: boolean;
  onCopy: (msgId: string) => void;
  onReplace: (msgId: string) => void;
  onRegenerate: (turnIdx: number) => void;
}

const AssistantMessage: React.FC<AssistantMessageProps> = ({ msg, turnIdx, isOptimizing, onCopy, onReplace, onRegenerate }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [replaceState, setReplaceState] = useState<'idle' | 'replacing' | 'replaced' | 'clipboard' | 'error'>('idle');

  const handleCopy = useCallback(() => {
    onCopy(msg.id);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 1800);
  }, [msg.id, onCopy]);

  const handleReplace = useCallback(async () => {
    setReplaceState('replacing');
    onReplace(msg.id);
    // The actual replace result is fire-and-forget from here — the parent handles it
    // We simulate the state transition; a more robust approach would use a callback
    setTimeout(() => setReplaceState('idle'), 3000);
  }, [msg.id, onReplace]);

  return (
    <div className="chat-message">
      <div className="message-label">
        <svg style={{ width: 10, height: 10, color: 'hsl(var(--emerald))' }} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
        </svg>
        {' '}Optimized Prompt
      </div>
      <div className="message-bubble assistant-bubble">
        <div className="message-text">{msg.content}</div>
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
        {/* Replace */}
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
    </div>
  );
};

// ── StreamingMessage ─────────────────────────────────────────────────────────

const StreamingMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="chat-message">
    <div className="message-label">
      <svg style={{ width: 10, height: 10, color: 'hsl(var(--emerald))' }} fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
      </svg>
      {' '}Optimized Prompt
    </div>
    <div className="message-bubble assistant-bubble">
      <div className="message-text">{content}</div>
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
  onEditCommit: (turnIdx: number, newContent: string) => void;
  onCopy: (msgId: string) => void;
  onReplace: (msgId: string) => void;
  onRegenerate: (turnIdx: number) => void;
  onNavigateUser: (turnIdx: number, dir: 1 | -1) => void;
  onNavigateAssistant: (turnIdx: number, dir: 1 | -1) => void;
}

const TurnItem: React.FC<TurnItemProps> = ({
  turn, turnIdx, isOptimizing, isStreamingHere, streamingContent,
  onEditCommit, onCopy, onReplace, onRegenerate, onNavigateUser, onNavigateAssistant,
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
            onCopy={onCopy}
            onReplace={onReplace}
            onRegenerate={onRegenerate}
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
  onEditCommit: (turnIdx: number, newContent: string) => void;
  onCopy: (msgId: string) => void;
  onReplace: (msgId: string) => void;
  onRegenerate: (turnIdx: number) => void;
  onNavigateUser: (turnIdx: number, dir: 1 | -1) => void;
  onNavigateAssistant: (turnIdx: number, dir: 1 | -1) => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({
  turns, isOptimizing, isLoading, errorMessage, streamingTurnIdx, streamingContent,
  onEditCommit, onCopy, onReplace, onRegenerate, onNavigateUser, onNavigateAssistant,
}) => {
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when content changes
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [turns, streamingContent, isLoading]);

  const isEmpty = turns.length === 0;

  return (
    <div ref={chatAreaRef} className="chat-area">
      {/* Empty state */}
      {isEmpty && (
        <div className="empty-state">
          <div
            style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'linear-gradient(135deg, hsl(var(--emerald) / 0.12), hsl(217 91% 50% / 0.12))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg style={{ width: 20, height: 20, color: 'hsl(var(--emerald))' }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))', marginBottom: 4, letterSpacing: '-0.01em' }}>
              Prompt Optimizer
            </div>
            <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
              Type your prompt below to get an<br />optimized version. Refine with follow-ups.
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
          onEditCommit={onEditCommit}
          onCopy={onCopy}
          onReplace={onReplace}
          onRegenerate={onRegenerate}
          onNavigateUser={onNavigateUser}
          onNavigateAssistant={onNavigateAssistant}
        />
      ))}

      {/* Error banner */}
      {errorMessage && (
        <div className="error-banner" style={{ display: 'block' }}>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && <LoadingDots />}

      {/* Scroll anchor */}
      <div ref={scrollAnchorRef} />
    </div>
  );
};

export default ChatArea;
