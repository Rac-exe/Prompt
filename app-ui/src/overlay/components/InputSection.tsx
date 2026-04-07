import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import type { AttachedFile, SkillInfo } from '../lib/types';
import { SKILL_ICON_SVGS, DEFAULT_SKILL_ICON, MAX_ATTACHED_FILES, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from '../lib/constants';
import { fileToBase64, resizeImageIfNeeded } from '../lib/utils';

// ── Mode Dropdown ────────────────────────────────────────────────────────────

interface ModeDropdownProps {
  currentMode: string;
  open: boolean;
  anchorRect: DOMRect | null;
  onSelect: (mode: string) => void;
}

const ModeDropdown: React.FC<ModeDropdownProps> = ({ currentMode, open, anchorRect, onSelect }) => {
  if (!open || !anchorRect) return null;

  const dropH = 110;
  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchorRect.left,
    top: anchorRect.top - dropH - 6,
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <div className="mode-dropdown open" style={style}>
      <button className={`mode-dropdown-item${currentMode === 'fast' ? ' selected' : ''}`} type="button" onClick={() => onSelect('fast')}>
        <svg className="mode-icon" fill="none" stroke="hsl(var(--accent))" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Fast</div>
          <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>Most efficient for everyday tasks</div>
        </div>
        {currentMode === 'fast' && <span className="mode-check">✓</span>}
      </button>
      <button className={`mode-dropdown-item${currentMode === 'thinking' ? ' selected' : ''}`} type="button" onClick={() => onSelect('thinking')}>
        <svg className="mode-icon" fill="none" stroke="hsl(var(--accent))" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Thinking</div>
          <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>Think longer for complex tasks</div>
        </div>
        {currentMode === 'thinking' && <span className="mode-check">✓</span>}
      </button>
    </div>
  );
};

// ── Skill Picker ─────────────────────────────────────────────────────────────

interface SkillPickerProps {
  skills: SkillInfo[];
  onSelect: (name: string, label: string) => void;
}

const SkillPicker: React.FC<SkillPickerProps> = ({ skills, onSelect }) => {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [tooltipSkill, setTooltipSkill] = useState<{ description: string; top: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, skills.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const s = skills[highlightIndex];
        if (s) onSelect(s.name, s.label);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [skills, highlightIndex, onSelect]);

  if (skills.length === 0) {
    return (
      <div className="skill-picker-panel">
        <div className="skill-list" style={{ maxHeight: 320, padding: '4px 0' }}>
          <div style={{ padding: 20, textAlign: 'center', color: 'hsl(var(--muted-foreground) / 0.5)', fontSize: 12 }}>No skills found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="skill-picker-panel" style={{ position: 'relative' }}>
      <div ref={listRef} className="skill-list" style={{ maxHeight: 320, padding: '4px 0' }}>
        {skills.map((skill, index) => {
          const isHighlighted = index === highlightIndex;
          const iconPath = SKILL_ICON_SVGS[skill.name] || DEFAULT_SKILL_ICON;
          return (
            <button
              key={skill.name}
              className={`skill-item${isHighlighted ? ' highlighted' : ''}`}
              type="button"
              style={{ position: 'relative' }}
              onClick={() => onSelect(skill.name, skill.label)}
              onMouseEnter={(e) => {
                setHighlightIndex(index);
                if (skill.description && listRef.current) {
                  const btnRect = e.currentTarget.getBoundingClientRect();
                  const panelRect = listRef.current.getBoundingClientRect();
                  setTooltipSkill({ description: skill.description, top: btnRect.top - panelRect.top + btnRect.height / 2 });
                }
              }}
              onMouseLeave={() => setTooltipSkill(null)}
            >
              {isHighlighted && (
                <span style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: 'hsl(var(--accent))' }} />
              )}
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'hsl(var(--muted)/0.6)', border: '1px solid hsl(var(--border)/0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg style={{ width: 14, height: 14, color: 'hsl(var(--accent))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: iconPath }} />
              </div>
              <span className="skill-item-name">{skill.label}</span>
            </button>
          );
        })}
      </div>
      {tooltipSkill && (
        <div className="skill-tooltip" style={{ display: 'block', top: tooltipSkill.top }}>
          {tooltipSkill.description}
        </div>
      )}
    </div>
  );
};

// ── Plus Menu ────────────────────────────────────────────────────────────────

interface PlusMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  skills: SkillInfo[];
  onAttachFiles: () => void;
  onSelectSkill: (name: string, label: string) => void;
  onClose: () => void;
}

const PlusMenu: React.FC<PlusMenuProps> = ({ open, anchorRect, skills, onAttachFiles, onSelectSkill, onClose }) => {
  const [showSkills, setShowSkills] = useState(false);

  // Reset to main view when menu opens
  useEffect(() => {
    if (open) setShowSkills(false);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showSkills) {
          setShowSkills(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, showSkills, onClose]);

  if (!open || !anchorRect) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: anchorRect.left,
    bottom: window.innerHeight - anchorRect.top + 6,
    display: 'flex',
    flexDirection: 'column',
  };

  const handleSkillSelect = (name: string, label: string) => {
    onSelectSkill(name, label);
    onClose();
  };

  return (
    <div className="plus-menu open" style={style}>
      {!showSkills ? (
        <div style={{ padding: 2 }}>
          <button className="plus-menu-item" type="button" onClick={() => { onAttachFiles(); onClose(); }}>
            <svg style={{ width: 14, height: 14, flexShrink: 0, color: 'hsl(var(--muted-foreground))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            <span>Add photos &amp; files</span>
          </button>
          <button className="plus-menu-item" type="button" onClick={() => setShowSkills(true)}>
            <svg style={{ width: 14, height: 14, flexShrink: 0, color: 'hsl(var(--muted-foreground))' }} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
            </svg>
            <span>Choose skill</span>
          </button>
        </div>
      ) : (
        <SkillPicker skills={skills} onSelect={handleSkillSelect} />
      )}
    </div>
  );
};

// ── File Attachments Row ─────────────────────────────────────────────────────

interface AttachmentsRowProps {
  files: AttachedFile[];
  onRemove: (index: number) => void;
}

const AttachmentsRow: React.FC<AttachmentsRowProps> = ({ files, onRemove }) => {
  if (files.length === 0) return null;
  return (
    <div className="attachments-row" style={{ display: 'flex' }}>
      {files.map((file, idx) => {
        const isImage = file.mimeType.startsWith('image/');
        if (isImage) {
          return (
            <div key={idx} className="file-chip-img">
              <img src={`data:${file.mimeType};base64,${file.base64}`} alt={file.name} />
              <button className="file-chip-remove" type="button" title="Remove" onClick={() => onRemove(idx)}>✕</button>
            </div>
          );
        }
        return (
          <div key={idx} className="file-chip-pdf">
            <div className="file-chip-pdf-icon">
              <svg style={{ width: 11, height: 11, color: 'hsl(0 72% 51%)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="file-chip-pdf-name">{file.name}</span>
            <button className="file-chip-remove" type="button" title="Remove" onClick={() => onRemove(idx)}>✕</button>
          </div>
        );
      })}
    </div>
  );
};

// ── Skill Pill ───────────────────────────────────────────────────────────────

interface SkillPillProps {
  skill: string | null;
  skillLabel: string | null;
  onRemove: () => void;
}

const SkillPill: React.FC<SkillPillProps> = ({ skill, skillLabel, onRemove }) => {
  if (!skill) return null;
  const iconPath = SKILL_ICON_SVGS[skill] || DEFAULT_SKILL_ICON;
  return (
    <div className="skill-pill" style={{ display: 'inline-flex' }}>
      <svg style={{ width: 10, height: 10, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: iconPath }} />
      <span>{skillLabel || skill}</span>
      <button className="skill-pill-remove" type="button" title="Remove skill" onClick={onRemove}>✕</button>
    </div>
  );
};

// ── Context Pill Row ─────────────────────────────────────────────────────────

interface ContextPillRowProps {
  isAuthenticated: boolean;
  chatId: string | null;
  chatName: string;
  onAttach: () => void;
  onRemove: () => void;
}

const ContextPillRow: React.FC<ContextPillRowProps> = ({ isAuthenticated, chatId, chatName, onAttach, onRemove }) => {
  if (!isAuthenticated) return null;
  return (
    <div className="context-pill-row" style={{ display: '' }}>
      {chatId ? (
        <div>
          <span className="context-pill">
            <svg style={{ width: 11, height: 11, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="context-pill-name">{chatName}</span>
            <button className="context-pill-remove" title="Remove context" onClick={onRemove}>✕</button>
          </span>
        </div>
      ) : (
        <button className="btn-attach-context" onClick={onAttach}>
          <svg style={{ width: 11, height: 11 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
          </svg>
          Attach Chat Context
        </button>
      )}
    </div>
  );
};

// ── InputSection (main export) ───────────────────────────────────────────────

interface InputSectionProps {
  isOptimizing: boolean;
  isOnline: boolean;
  isAuthenticated: boolean;
  currentMode: string;
  attachedFiles: AttachedFile[];
  selectedSkill: string | null;
  selectedSkillLabel: string | null;
  selectedChatId: string | null;
  selectedChatName: string;
  skills: SkillInfo[];
  onSend: (text: string) => void;
  onStop: () => void;
  onModeChange: (mode: string) => void;
  onAttachFiles: (files: AttachedFile[]) => void;
  onRemoveFile: (index: number) => void;
  onSelectSkill: (name: string, label: string) => void;
  onRemoveSkill: () => void;
  onAttachContext: () => void;
  onRemoveContext: () => void;
  /** Ref so parent can set prefill text */
  inputRef?: React.RefObject<HTMLTextAreaElement>;
}

const InputSection: React.FC<InputSectionProps> = ({
  isOptimizing, isOnline, isAuthenticated, currentMode,
  attachedFiles, selectedSkill, selectedSkillLabel,
  selectedChatId, selectedChatName, skills,
  onSend, onStop, onModeChange, onAttachFiles, onRemoveFile,
  onSelectSkill, onRemoveSkill, onAttachContext, onRemoveContext,
  inputRef: externalInputRef,
}) => {
  const internalInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const modeBtnRef = useRef<HTMLButtonElement>(null);

  const [inputValue, setInputValue] = useState('');
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [modeBtnRect, setModeBtnRect] = useState<DOMRect | null>(null);
  const [plusBtnRect, setPlusBtnRect] = useState<DOMRect | null>(null);

  // Voice state
  const [isListening, setIsListening] = useState(false);
  const voiceActiveRef = useRef(false);
  const transcriptionSessionIdRef = useRef<string | null>(null);

  const canSend = !!inputValue.trim() && !isOptimizing && isOnline;

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const newH = Math.min(ta.scrollHeight, 160);
    ta.style.height = newH + 'px';
    ta.style.overflowY = ta.scrollHeight > 160 ? 'auto' : 'hidden';
  }, [inputRef]);

  // Handle send
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isOptimizing) return;
    if (isListening) {
      Sentry.addBreadcrumb({ category: 'transcription', message: 'Send pressed while voice active — stopping transcription', level: 'info', data: { window: 'overlay' } });
      voiceActiveRef.current = false;
      setIsListening(false);
      window.electronAPI?.transcription?.stop?.();
      transcriptionSessionIdRef.current = null;
    }
    onSend(text);
    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = '';
      inputRef.current.style.overflowY = 'hidden';
    }
  }, [inputValue, isOptimizing, isListening, onSend, inputRef]);

  // Handle file input change
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const remaining = MAX_ATTACHED_FILES - attachedFiles.length;
    const newFiles: AttachedFile[] = [];
    for (let i = 0; i < Math.min(fileList.length, remaining); i++) {
      const file = fileList[i];
      if (!ALLOWED_MIME_TYPES.includes(file.type)) continue;
      // PDFs: hard size cap, no resize possible
      if (file.type === 'application/pdf') {
        if (file.size > MAX_FILE_SIZE) {
          console.warn('[Overlay] PDF too large (max 32 MB):', file.name);
          continue;
        }
        try {
          const base64 = await fileToBase64(file);
          newFiles.push({ name: file.name, mimeType: file.type, base64, sizeBytes: file.size });
        } catch {
          console.warn('[Overlay] Failed to read PDF:', file.name);
        }
        continue;
      }
      // Images: auto-resize if above 4.5 MB
      try {
        const { base64, sizeBytes, mimeType } = await resizeImageIfNeeded(file);
        newFiles.push({ name: file.name, mimeType, base64, sizeBytes });
      } catch {
        console.warn('[Overlay] Failed to process image:', file.name);
      }
    }
    if (newFiles.length > 0) onAttachFiles(newFiles);
    e.target.value = '';
  }, [attachedFiles.length, onAttachFiles]);

  // Mode dropdown toggle
  const toggleModeDropdown = useCallback(() => {
    setPlusMenuOpen(false);
    if (!modeDropdownOpen && modeBtnRef.current) {
      setModeBtnRect(modeBtnRef.current.getBoundingClientRect());
    }
    setModeDropdownOpen((prev) => !prev);
  }, [modeDropdownOpen]);

  const handleModeSelect = useCallback((mode: string) => {
    onModeChange(mode);
    setModeDropdownOpen(false);
  }, [onModeChange]);

  // Plus menu toggle
  const togglePlusMenu = useCallback(() => {
    setModeDropdownOpen(false);
    if (!plusMenuOpen && plusBtnRef.current) {
      setPlusBtnRect(plusBtnRef.current.getBoundingClientRect());
    }
    setPlusMenuOpen((prev) => !prev);
  }, [plusMenuOpen]);

  // Close menus on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (plusMenuOpen && !target.closest('.plus-menu') && !target.closest('.btn-toolbar[data-plus]')) {
        setPlusMenuOpen(false);
      }
      if (modeDropdownOpen && !target.closest('.mode-dropdown') && !target.closest('.mode-select-btn')) {
        setModeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [plusMenuOpen, modeDropdownOpen]);

  // Voice input
  const toggleVoice = useCallback(() => {
    if (isListening) {
      Sentry.addBreadcrumb({ category: 'transcription', message: 'Mic toggled off by user', level: 'info', data: { window: 'overlay' } });
      voiceActiveRef.current = false;
      setIsListening(false);
      window.electronAPI?.transcription?.stop?.();
      transcriptionSessionIdRef.current = null;
    } else {
      Sentry.addBreadcrumb({ category: 'transcription', message: 'Mic toggled on by user', level: 'info', data: { window: 'overlay' } });
      voiceActiveRef.current = true;
      setIsListening(true);
      const sessionId = Date.now().toString();
      transcriptionSessionIdRef.current = sessionId;
      window.electronAPI?.transcription?.start?.(sessionId);
    }
  }, [isListening]);

  // Listen for transcription updates
  useEffect(() => {
    const api = window.electronAPI?.transcription;
    if (!api?.onTranscription) return;
    api.onTranscription((data) => {
      if (!voiceActiveRef.current) return;
      if (data.text) {
        setInputValue(data.accumulated || data.text);
      }
    });
    api.onStatus?.((status) => {
      Sentry.addBreadcrumb({ category: 'transcription', message: `Voice status: ${status}`, level: 'info', data: { window: 'overlay' } });
      if (status === 'listening') {
        voiceActiveRef.current = true;
      } else {
        voiceActiveRef.current = false;
      }
      setIsListening(status === 'listening');
    });
    api.onError?.((error) => {
      Sentry.addBreadcrumb({ category: 'transcription', message: 'Voice transcription error', level: 'error', data: { error, window: 'overlay' } });
      voiceActiveRef.current = false;
      setIsListening(false);
    });
  }, []);

  // Sync input ref value for external prefill
  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== inputValue) {
      // External code may set ref value directly
    }
  }, [inputRef, inputValue]);

  return (
    <div className="input-section">
      <ContextPillRow
        isAuthenticated={isAuthenticated}
        chatId={selectedChatId}
        chatName={selectedChatName}
        onAttach={onAttachContext}
        onRemove={onRemoveContext}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <AttachmentsRow files={attachedFiles} onRemove={onRemoveFile} />

      <div className="chat-input-box">
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          rows={2}
          placeholder="How can I help you today?"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); autoResize(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          disabled={!isOnline}
        />

        <div className="input-toolbar">
          <div className="input-toolbar-left" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Plus button */}
            <button
              ref={plusBtnRef}
              className="btn-toolbar"
              type="button"
              title="Add files or choose skill"
              data-plus="true"
              disabled={isOptimizing}
              onClick={togglePlusMenu}
            >
              <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Pro Mode badge */}
            <div className="mode-select-btn" title="You don't need any other mode !!" style={{ cursor: 'default', userSelect: 'none' }}>
              <svg style={{ width: 13, height: 13 }} fill="currentColor" stroke="currentColor" viewBox="0 0 256 256">
                <path d="M196,128a68.2,68.2,0,0,1-13.1,40.2l21.6,21.5a8.1,8.1,0,0,1,0,11.4,8.2,8.2,0,0,1-11.4,0l-21.5-21.6A68,68,0,0,1,60,128a8.2,8.2,0,0,1,2.1-5.3l29.5-33.2L73.9,52.2a8,8,0,0,1,12.2-10.4l19.4,22.8L128,37.3l22.5,27.3,19.4-22.8a8,8,0,1,1,12.2,10.4l-17.7,37.3,29.5,33.2A8.2,8.2,0,0,1,196,128Z" />
              </svg>
              <span>Pro Mode</span>
            </div>

            {/* Skill pill */}
            <SkillPill skill={selectedSkill} skillLabel={selectedSkillLabel} onRemove={onRemoveSkill} />
          </div>

          <div className="input-toolbar-right">
            {/* Voice button */}
            <button
              className={`btn-toolbar${isListening ? ' listening' : ''}`}
              title="Voice Input"
              type="button"
              onClick={toggleVoice}
            >
              {isListening ? (
                <svg style={{ width: 15, height: 15, color: 'hsl(0 72% 51%)' }} fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="5" />
                </svg>
              ) : (
                <svg style={{ width: 15, height: 15 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>

            {/* Send / Stop buttons */}
            {isOptimizing ? (
              <button className="btn-stop visible" title="Stop generation" type="button" onClick={onStop}>
                <svg style={{ width: 12, height: 12 }} fill="currentColor" viewBox="0 0 24 24">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </button>
            ) : (
              <button className="btn-send" disabled={!canSend} title="Send (Enter)" type="button" onClick={handleSend}>
                <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mode dropdown — disabled for Pro Mode
      <ModeDropdown
        currentMode={currentMode}
        open={modeDropdownOpen}
        anchorRect={modeBtnRect}
        onSelect={handleModeSelect}
      />
      */}

      {/* Plus menu */}
      <PlusMenu
        open={plusMenuOpen}
        anchorRect={plusBtnRect}
        skills={skills}
        onAttachFiles={() => fileInputRef.current?.click()}
        onSelectSkill={onSelectSkill}
        onClose={() => setPlusMenuOpen(false)}
      />
    </div>
  );
};

export default InputSection;
