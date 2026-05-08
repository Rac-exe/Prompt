import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import Header, { type OverlayMode } from './components/Header';
import AuthGate from './components/AuthGate';
import OfflineBanner from './components/OfflineBanner';
import ChatArea from './components/ChatArea';
import InputSection from './components/InputSection';
import ChatPicker from './components/ChatPicker';
import SpacePicker from './components/SpacePicker';
import { SavePromptModal } from '@/components/chat/SavePromptModal';
import { useTurns } from './hooks/useTurns';
import type { AttachedFile, SkillInfo, OverlaySettings } from './lib/types';
import type { ClarifyQuestion } from '@/components/chat/ClarificationCard';
import { ZoomIndicator } from '@/components/layout/ZoomIndicator';
import { buildTailoredPrompt, type RetrieveResult } from '@/components/projects/types';

// ── Space attach: minimal shape we need from the bridge ──
// Mirrors `SpaceSummary` published by ProjectsView. Kept inline to avoid
// dragging the projects components module into the overlay bundle.
interface AttachedSpaceProject {
  projectId: string;
  name: string;
  localPath: string;
  branch?: string;
}
interface AttachedSpace {
  id: string;
  name: string;
  projects: AttachedSpaceProject[];
}

// ── Per-turn clarification record (used in both modes) ──
interface ClarificationAnswerRecord {
  questions: ClarifyQuestion[];
  answers: Record<string, string>;
  mode: 'single' | 'tasks';
}

// ── Mode persistence ────────────────────────────────────────────────────────
// The overlay remembers which mode (Chat / Spaces) the user last left it
// in and lands back there on the next open. Written to localStorage so it
// survives BrowserWindow hide/show cycles and full reloads alike.
const MODE_STORAGE_KEY = 'overlay-active-mode';
const ALL_MODES: OverlayMode[] = ['chat', 'spaces'];

function loadInitialMode(): OverlayMode {
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    if (raw && (ALL_MODES as string[]).includes(raw)) return raw as OverlayMode;
  } catch { /* noop — private mode / quota → fall through to default */ }
  return 'chat';
}

function persistMode(mode: OverlayMode) {
  try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* noop */ }
}

// ── Settings helpers ─────────────────────────────────────────────────────────

function applySettings(settings: OverlaySettings | null) {
  if (!settings) return;
  const root = document.documentElement;

  if (settings.theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');

  if (settings.font_size === 'small') root.style.fontSize = '14px';
  else if (settings.font_size === 'large') root.style.fontSize = '18px';
  else root.style.fontSize = '16px';

  if (settings.font_family === 'mono')
    root.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  else if (settings.font_family === 'serif')
    root.style.fontFamily = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';
  else root.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

  try {
    localStorage.setItem(
      'prompt-weaver-settings',
      JSON.stringify({ theme: settings.theme || 'dark', fontSize: settings.font_size || 'medium', fontFamily: settings.font_family || 'inter' }),
    );
  } catch { /* noop */ }
}

// ── Space status palette (for the in-view top bar) ──
const SPACE_STATUS_META: Record<string, { dot: string; label: string }> = {
  ready:    { dot: 'hsl(142 70% 45%)',  label: 'Ready' },
  indexing: { dot: 'hsl(38 92% 50%)',   label: 'Indexing' },
  stale:    { dot: 'hsl(38 92% 50%)',   label: 'Stale — will re-index' },
  error:    { dot: 'hsl(0 72% 51%)',    label: 'Error' },
};
function spaceStatusMeta(status: string | null | undefined) {
  if (!status) return { dot: 'hsl(var(--muted-foreground) / 0.4)', label: 'Unknown' };
  return SPACE_STATUS_META[status] ?? { dot: 'hsl(var(--muted-foreground) / 0.4)', label: status };
}

// ── App ──────────────────────────────────────────────────────────────────────

const OverlayApp: React.FC = () => {
  // ── Auth & connection state ──────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [triggeredByHook, setTriggeredByHook] = useState(false);

  // ── Active mode ──────────────────────────────────────────────────────────
  // The overlay runs two parallel "sessions" — one for Chat (the classic
  // no-context optimization flow) and one for Spaces (folder-aware). The
  // user toggles between them via the header; each session retains its
  // own turn history, attached files, skill, clarification answers and
  // inserted-section tracking. Only one is rendered interactively at a
  // time; the other lives under `display: none` so scroll position and
  // composer text are preserved when the user flips back.
  const [activeMode, setActiveMode] = useState<OverlayMode>(() => loadInitialMode());
  const activeModeRef = useRef<OverlayMode>(activeMode);
  activeModeRef.current = activeMode;

  // ── Optimization state (shared — only one stream at a time) ──────────────
  // These flags intentionally do NOT split per-mode: only one optimization
  // can be in flight against the backend, and both modes' InputSections
  // gate sending on the shared `isOptimizing`. Routing of the streamed
  // output back to the *originating* mode is handled via `streamingModeRef`.
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentMode] = useState<string>('thinking');
  /** Mode that initiated the currently-in-flight stream. Read by the IPC
   *  chunk/complete/error/clarification listeners to decide which mode's
   *  turn bank to write into — stays correct even if the user toggles
   *  modes mid-stream. */
  const streamingModeRef = useRef<OverlayMode | null>(null);

  // ── Clarification state ──────────────────────────────────────────────────
  // Single-slot: only one clarification modal may be open at a time. We
  // tag it with the mode that produced it so the modal is only rendered
  // inside the originating mode's ChatArea. If the user flips modes while
  // waiting for their answers, the modal stays pinned to its source mode.
  const [clarificationData, setClarificationData] = useState<any>(null);
  const [clarificationMode, setClarificationMode] = useState<OverlayMode | null>(null);
  const clarificationDataRef = useRef<any>(null);
  clarificationDataRef.current = clarificationData;

  // ── Per-mode state ────────────────────────────────────────────────────────
  const chatTurns = useTurns();
  const spacesTurns = useTurns();
  const turnsByMode = useMemo(
    () => ({ chat: chatTurns, spaces: spacesTurns } as const),
    [chatTurns, spacesTurns],
  );

  const [attachedFilesByMode, setAttachedFilesByMode] = useState<Record<OverlayMode, AttachedFile[]>>({ chat: [], spaces: [] });
  const [selectedSkillsByMode, setSelectedSkillsByMode] = useState<Record<OverlayMode, string[]>>({ chat: [], spaces: [] });
  const [selectedSkillLabelsByMode, setSelectedSkillLabelsByMode] = useState<Record<OverlayMode, string[]>>({ chat: [], spaces: [] });
  const [clarificationAnswersByMode, setClarificationAnswersByMode] = useState<Record<OverlayMode, Record<number, ClarificationAnswerRecord>>>({ chat: {}, spaces: {} });
  const [insertedSectionsByMode, setInsertedSectionsByMode] = useState<Record<OverlayMode, Set<number>>>({ chat: new Set(), spaces: new Set() });
  /** Index of the turn currently receiving streamed chunks, per mode.
   *  Only the originating mode's slot is set during a stream — the other
   *  is -1 so its ChatArea never shows the live transcript. */
  const [streamingTurnIdxByMode, setStreamingTurnIdxByMode] = useState<Record<OverlayMode, number>>({ chat: -1, spaces: -1 });

  const [skills, setSkills] = useState<SkillInfo[]>([]);

  // ── Chat-mode-only state ──
  // The chat-attach affordance is chat-exclusive — picking a chat in the
  // picker scopes the optimization to that chat's history. Stored as a
  // single value (not per-mode) because only the chat mode reads it.
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChatName, setSelectedChatName] = useState('');
  const selectedChatIdRef = useRef<string | null>(null);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);

  // ── Spaces-mode-only state ──
  // Only one Space can be attached in Spaces mode at a time.
  const [selectedSpace, setSelectedSpace] = useState<AttachedSpace | null>(null);
  const [selectedSpaceStatus, setSelectedSpaceStatus] = useState<string | null>(null);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const selectedSpaceRef = useRef<AttachedSpace | null>(null);

  // ── Pending space-sync metadata ─────────────────────────────────────
  // Populated at submit / edit / regenerate time for Spaces mode, consumed
  // when the assistant message completes. We sync the *final* user +
  // assistant pair (or just the assistant on regen) to `space.messages`
  // once we have the optimized text — syncing on every chunk would either
  // spam the bridge or require a separate "replace" channel.
  interface PendingSpaceSync {
    spaceId: string;
    userGroupId: string;
    userVersionIndex: number;
    assistantGroupId: string;
    assistantVersionIndex: number;
    skipUser: boolean;
    userMsgId: string;
    userContent: string;
    assistantMsgId: string;
  }
  const pendingSpaceSyncRef = useRef<PendingSpaceSync | null>(null);

  // ── Shared source-info + save-to-library modal state ──
  const [sourceInfo, setSourceInfo] = useState<{ appName: string; detectedMode: 'chat' | 'document'; confidence: 'high' | 'low' } | null>(null);
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collectionPromptContent, setCollectionPromptContent] = useState('');
  const [collectionPromptMsgId, setCollectionPromptMsgId] = useState<string | null>(null);
  const [collections, setCollections] = useState<{ id: string; name: string; icon?: string }[]>([]);
  const [savedMsgIds, setSavedMsgIds] = useState<Set<string>>(new Set());

  // ── Input refs (per mode so each composer keeps its textarea value) ──
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const spacesInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRefByMode = useMemo(
    () => ({ chat: chatInputRef, spaces: spacesInputRef } as const),
    [],
  );

  // ── Glow state ───────────────────────────────────────────────────────────
  const glowWrapperRef = useRef<HTMLDivElement>(null);
  const glowTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOW EFFECT
  // ═══════════════════════════════════════════════════════════════════════════
  const updateGlow = useCallback((x: number, y: number) => {
    const el = glowWrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xPct = (x / rect.width) * 100;
    const yPct = (y / rect.height) * 100;
    el.style.background = `radial-gradient(circle 200px at ${xPct}% ${yPct}%, hsl(var(--accent) / 0.8), hsl(var(--accent) / 0.3) 40%, hsl(var(--border)) 70%)`;
    clearTimeout(glowTimeoutRef.current);
    glowTimeoutRef.current = setTimeout(() => { el.style.background = 'hsl(var(--border))'; }, 1500);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => updateGlow(e.clientX, e.clientY);
    const onLeave = () => { if (glowWrapperRef.current) glowWrapperRef.current.style.background = 'hsl(var(--border))'; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseleave', onLeave); };
  }, [updateGlow]);

  // ═══════════════════════════════════════════════════════════════════════════
  // IPC LISTENERS (one-time setup)
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    // Helper: figure out which mode a streamed event belongs to. Falls
    // back to the current activeMode only if the streamingModeRef was
    // never set (shouldn't happen under normal flow but keeps edge
    // cases from silently corrupting the wrong turn bank).
    const targetMode = (): OverlayMode => streamingModeRef.current ?? activeModeRef.current;

    // ── Pre-warm auth state so AuthGate never flashes on first open ──
    api.overlay?.checkAuth?.().then((data: { isAuthenticated: boolean }) => {
      if (data?.isAuthenticated) setIsAuthenticated(true);
    }).catch(() => {});

    // ── Cursor glow via IPC ──
    api.overlay?.onCursorPos?.(({ x, y }: { x: number; y: number }) => updateGlow(x, y));

    // ── Overlay opened ──
    const cleanupOpened = api.overlay?.onOpened?.((data: any) => {
      const auth = !!data.isAuthenticated;
      setIsAuthenticated(auth);
      setTriggeredByHook(!!data.triggeredByHook);
      // Reset section insert state on new session (both modes — the
      // open event is the signal that we're (re)entering the overlay
      // afresh from the user's POV).
      setInsertedSectionsByMode({ chat: new Set(), spaces: new Set() });
      if (data.triggeredByHook) {
        api.overlay?.getSourceInfo?.().then((info: any) => {
          if (info?.hwnd) setSourceInfo(info);
        }).catch(() => {});
      }
      if (auth) {
        // Prefill ALWAYS targets Chat mode — the hook-triggered path is
        // a chat-style optimization. If the user was last in Spaces
        // mode, flip them back to Chat so the prefilled text is visible.
        if (data.prefill?.text) {
          setActiveMode('chat');
          const el = chatInputRef.current;
          if (el) {
            el.value = data.prefill.text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (data.prefill?.chatId) {
          setSelectedChatId(data.prefill.chatId);
          setSelectedChatName(data.prefill.chatName || 'Chat');
        }
        api.overlay?.getSettings?.().then(applySettings).catch(() => {});
        requestAnimationFrame(() => setTimeout(() => {
          const m = activeModeRef.current;
          inputRefByMode[m].current?.focus();
        }, 80));
      }
    });

    // ── Auth state changes ──
    const cleanupAuthState = api.overlay?.onAuthState?.((data: { isAuthenticated: boolean }) => {
      setIsAuthenticated(data.isAuthenticated);
    });

    // ── Clarification required ──
    const cleanupClarification = api.overlay?.onClarificationRequired?.((data: any) => {
      setIsOptimizing(false);
      setIsLoading(false);
      setClarificationMode(targetMode());
      setClarificationData(data);
    });

    // ── Streaming chunks ──
    const cleanupChunk = api.overlay?.onOptimizationChunk?.((data: { chunk: string; accumulated: string }) => {
      setIsLoading(false);
      setStreamingContent(data.accumulated);
    });

    // ── Optimization complete ──
    const cleanupComplete = api.overlay?.onOptimizationComplete?.((data: { original: string; optimized: string }) => {
      setIsOptimizing(false);
      setIsLoading(false);
      const optimized = data.optimized || '';
      const mode = targetMode();
      // "Saved to chat" only makes sense when we actually piped the turn
      // into a Chat — i.e. chat mode with a chatId attached. Spaces mode
      // persists into a Space (not a chat) so the badge is never relevant
      // there.
      const autoSaved = mode === 'chat' && !!selectedChatIdRef.current;
      turnsByMode[mode].registerAssistantMessage(optimized, autoSaved);
      setStreamingContent('');
      setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: -1 }));
      streamingModeRef.current = null;

      // ── Space sync ────────────────────────────────────────────────
      const pending = pendingSpaceSyncRef.current;
      if (pending && optimized && mode === 'spaces') {
        try {
          const messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number; groupId?: string; versionIndex?: number }> = [];
          if (!pending.skipUser) {
            messages.push({
              id: pending.userMsgId,
              role: 'user',
              content: pending.userContent,
              timestamp: Date.now(),
              groupId: pending.userGroupId,
              versionIndex: pending.userVersionIndex,
            });
          }
          messages.push({
            id: pending.assistantMsgId,
            role: 'assistant',
            content: optimized,
            timestamp: Date.now(),
            groupId: pending.assistantGroupId,
            versionIndex: pending.assistantVersionIndex,
          });
          window.electronAPI?.spaces?.appendMessages?.({ spaceId: pending.spaceId, messages });
        } catch (err) {
          Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'space-sync-on-complete' } });
        } finally {
          pendingSpaceSyncRef.current = null;
        }
      } else {
        pendingSpaceSyncRef.current = null;
      }
    });

    // ── Optimization error ──
    const cleanupError = api.overlay?.onOptimizationError?.((data: { error: string }) => {
      setIsOptimizing(false);
      setIsLoading(false);
      setStreamingContent('');
      const mode = targetMode();
      setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: -1 }));
      streamingModeRef.current = null;
      setErrorMessage(data.error || 'Optimization failed. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
      pendingSpaceSyncRef.current = null;
    });

    // ── File upload partial failure ──
    const cleanupUploadFailure = api.overlay?.onUploadPartialFailure?.((data: { failedFiles: string[] }) => {
      const names = data.failedFiles.join(', ');
      setErrorMessage(`Some files failed to upload: ${names}. Check your connection and try again.`);
      setTimeout(() => setErrorMessage(null), 7000);
    });

    // ── Network status ──
    api.onNetworkStatus?.((data: { isOnline: boolean }) => setIsOnline(data.isOnline));
    api.onNetworkReconnected?.(() => setIsOnline(true));

    // ── Settings updates ──
    const cleanupSettings = api.overlay?.onSettingsUpdate?.(applySettings);

    // ── Initial settings load ──
    api.overlay?.getSettings?.().then(applySettings).catch(() => {});

    // Load skills once
    if (api.skills?.list) {
      api.skills.list().then((s: SkillInfo[]) => setSkills(s || [])).catch(() => {});
    }

    return () => {
      cleanupOpened?.();
      cleanupAuthState?.();
      cleanupClarification?.();
      cleanupChunk?.();
      cleanupComplete?.();
      cleanupError?.();
      cleanupUploadFailure?.();
      cleanupSettings?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep refs in sync with state for IPC callbacks
  useEffect(() => { selectedChatIdRef.current = selectedChatId; }, [selectedChatId]);
  useEffect(() => { selectedSpaceRef.current = selectedSpace; }, [selectedSpace]);

  // ── Persist active mode ─────────────────────────────────────────────
  useEffect(() => { persistMode(activeMode); }, [activeMode]);

  // ── Live status for the attached Space's project ───────────────────
  useEffect(() => {
    const project = selectedSpace?.projects[0];
    if (!project) {
      setSelectedSpaceStatus(null);
      return;
    }
    const projectApi = window.electronAPI?.project;
    if (!projectApi) return;

    let cancelled = false;
    projectApi.status?.(project.projectId)
      .then((s: any) => {
        if (cancelled) return;
        if (s?.index_status) setSelectedSpaceStatus(s.index_status);
      })
      .catch(() => {});

    const unsub = projectApi.onOverlayStatus?.((data: any) => {
      if (!data?.projectId) return;
      if (data.projectId !== project.projectId) return;
      const next = data.status as string | undefined;
      if (next) setSelectedSpaceStatus(next);
    });
    return () => { cancelled = true; unsub?.(); };
  }, [selectedSpace?.projects[0]?.projectId]);

  useEffect(() => {
    return () => { clearTimeout(glowTimeoutRef.current); };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const handleClose = useCallback(() => {
    window.electronAPI?.overlay?.close?.();
  }, []);

  const handleOpenApp = useCallback(() => {
    window.electronAPI?.overlay?.openApp?.();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (chatPickerOpen || collectionPickerOpen || spacePickerOpen) return;
        window.electronAPI?.overlay?.close?.();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [chatPickerOpen, collectionPickerOpen, spacePickerOpen]);

  // ── Mode switch ───────────────────────────────────────────────────────────
  // Purely a UI swap — turns, attachedFiles, and composer text for the
  // previous mode stay in memory for when the user flips back. Any
  // in-flight stream continues running in its originating mode (routed
  // via streamingModeRef) even though the user is now looking at a
  // different conversation.
  const handleModeChange = useCallback((next: OverlayMode) => {
    setActiveMode((prev) => {
      if (prev === next) return prev;
      // Dismiss any stray clarification modal that belongs to the
      // *other* mode — keeping it open across the swap would disorient
      // the user (its card would disappear along with the rest of that
      // mode's UI) without ever giving a clear resolution path.
      // Crucially we only null it out if the clarification was for the
      // mode we're LEAVING; leaving clarificationData intact when it
      // belongs to the mode we're entering would trigger a doubled
      // prompt on return.
      // No-op today: clarificationMode is tagged and rendered in its
      // own mode only, so flipping doesn't leak it.
      requestAnimationFrame(() => setTimeout(() => {
        inputRefByMode[next].current?.focus();
      }, 60));
      return next;
    });
  }, [inputRefByMode]);

  // ── New session (mode-scoped) ────────────────────────────────────────────
  // Clears ONLY the active mode's bundle. The other mode's conversation
  // and attachments are preserved so switching there reveals the exact
  // state the user left behind.
  const handleNewSession = useCallback(() => {
    const mode = activeModeRef.current;
    turnsByMode[mode].clearAll();
    setAttachedFilesByMode((prev) => ({ ...prev, [mode]: [] }));
    setSelectedSkillsByMode((prev) => ({ ...prev, [mode]: [] }));
    setSelectedSkillLabelsByMode((prev) => ({ ...prev, [mode]: [] }));
    setClarificationAnswersByMode((prev) => ({ ...prev, [mode]: {} }));
    setInsertedSectionsByMode((prev) => ({ ...prev, [mode]: new Set() }));
    setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: -1 }));

    if (mode === 'chat') {
      setSelectedChatId(null);
      setSelectedChatName('');
    } else {
      setSelectedSpace(null);
      setSelectedSpaceStatus(null);
      pendingSpaceSyncRef.current = null;
    }

    // Drop any in-flight stream that originated from this mode; streams
    // from the *other* mode keep running (they'll complete into their
    // own turn bank, untouched).
    if (streamingModeRef.current === mode) {
      setIsOptimizing(false);
      setIsLoading(false);
      setStreamingContent('');
      streamingModeRef.current = null;
    }
    // Clear the clarification modal only if it was bound to this mode.
    if (clarificationMode === mode) {
      setClarificationData(null);
      setClarificationMode(null);
    }

    // Wipe saved-msg badges on a new session so the UI doesn't show
    // "Saved" for messages that no longer exist in either mode's turn
    // list. It's fine to do this globally — the badges track session
    // state, not durable library state.
    setSavedMsgIds(new Set());

    // Only the main-side "new session" ping should fire when we're
    // resetting Chat mode; Spaces mode's persistence is handled
    // independently through the spaces bridge.
    if (mode === 'chat') {
      window.electronAPI?.overlay?.newSession?.();
    }
    requestAnimationFrame(() => setTimeout(() => {
      inputRefByMode[mode].current?.focus();
    }, 80));
  }, [turnsByMode, inputRefByMode, clarificationMode]);

  // ── Submit clarification answers ─────────────────────────────────────────
  const handleSubmitClarification = useCallback((answers: Record<string, string>, wantsSections: boolean) => {
    Sentry.addBreadcrumb({ category: 'overlay.clarification', message: 'Clarification submitted', data: { answerCount: Object.keys(answers).length, wantsSections } });
    const mode = clarificationMode ?? activeModeRef.current;
    const currentClarification = clarificationDataRef.current;
    const turns = turnsByMode[mode].turns;
    const turnIdx = turns.length - 1;
    if (turnIdx >= 0) {
      const questions: ClarifyQuestion[] = (currentClarification?.questions || []).map((q: any) => ({
        id: q.id,
        question: q.question,
        type: q.type,
        options: q.options || [],
        optional: q.optional ?? false,
      }));
      setClarificationAnswersByMode((prev) => ({
        ...prev,
        [mode]: { ...prev[mode], [turnIdx]: { questions, answers, mode: wantsSections ? 'tasks' : 'single' } },
      }));
    }
    const choicesPayload = turnIdx >= 0
      ? { questions: (currentClarification?.questions || []).map((q: any) => ({ id: q.id, question: q.question, type: q.type, options: q.options || [], optional: q.optional ?? false })), answers, mode: wantsSections ? 'tasks' : 'single' }
      : undefined;

    setClarificationData(null);
    setClarificationMode(null);
    setIsOptimizing(true);
    setIsLoading(true);
    setErrorMessage(null);
    setStreamingContent('');
    // streamingModeRef stays set from the original send — the submit
    // reuses the same stream, so chunks continue routing correctly.
    window.electronAPI?.overlay?.submitClarification?.({ answers, wantsSections, clarificationChoices: choicesPayload });
  }, [clarificationMode, turnsByMode]);

  const handleSkipClarification = useCallback(() => {
    Sentry.addBreadcrumb({ category: 'overlay.clarification', message: 'Clarification skipped' });
    handleSubmitClarification({}, false);
  }, [handleSubmitClarification]);

  // ── Re-optimize with changed clarification answers ───────────────────────
  // Fires from a turn-level "redo with different answers" button inside
  // the active mode's ChatArea. Scoped entirely to the active mode.
  const handleReoptimize = useCallback((turnIdx: number, newAnswers: Record<string, string>, wantsSections: boolean) => {
    if (isOptimizing) return;
    const mode = activeModeRef.current;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Re-optimize triggered', data: { turnIdx, wantsSections, mode } });
    const bundle = turnsByMode[mode];
    const turn = bundle.turns[turnIdx];
    if (!turn) return;

    const activeUserVer = turn.userVersions[turn.userActiveIdx];
    if (!activeUserVer) return;

    const prevInfo = clarificationAnswersByMode[mode][turnIdx];
    setClarificationAnswersByMode((prev) => ({
      ...prev,
      [mode]: {
        ...prev[mode],
        [turnIdx]: {
          questions: prevInfo?.questions || [],
          answers: newAnswers,
          mode: wantsSections ? 'tasks' : 'single',
        },
      },
    }));

    const formattedAnswers = Object.entries(newAnswers)
      .filter(([, v]) => v && v.trim())
      .map(([key, val]) => `- ${key}: ${val}`)
      .join('\n');

    const result = bundle.prepareRegenerate(turnIdx);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: turnIdx }));
    streamingModeRef.current = mode;

    const choicesPayload = {
      questions: prevInfo?.questions || [],
      answers: newAnswers,
      mode: wantsSections ? 'tasks' : 'single',
    };

    // Re-optimize paths currently only pipe through the non-space
    // branch — space-mode re-optimize would require re-running retrieval
    // with the same cleanup semantics as handleEditCommit, which is out
    // of scope for this specific button (Spaces UI doesn't surface it
    // either). The active-mode guard above keeps behavior parity.
    window.electronAPI?.overlay?.optimize?.({
      text: activeUserVer.content,
      isRegenerate: true,
      mode: currentMode,
      chatId: mode === 'chat' ? (selectedChatId || undefined) : undefined,
      attachedFiles: activeUserVer.attachedFiles?.length ? activeUserVer.attachedFiles : undefined,
      forcedSkill: activeUserVer.skill || undefined,
      assistantGroupId: result.assistGroupId,
      assistantVersionIndex: result.assistVerIdx,
      previousOutput: result.previousAssistantContent || undefined,
      clarificationAnswers: formattedAnswers || undefined,
      wantsSections,
      clarificationChoices: choicesPayload,
    });
  }, [isOptimizing, turnsByMode, clarificationAnswersByMode, currentMode, selectedChatId]);

  // ── Build the actual text we send to overlay:optimize (spaces mode) ─────
  const buildSpacePrompt = useCallback(async (rawQuery: string, space: AttachedSpace): Promise<string> => {
    const projectApi = window.electronAPI?.project;
    if (!projectApi?.retrieve || space.projects.length === 0) return rawQuery;

    let ranked: any[] = [];
    let related: any[] = [];
    let fails = 0;
    for (const proj of space.projects) {
      try {
        const d: RetrieveResult = await projectApi.retrieve({
          project_id: proj.projectId,
          query: rawQuery,
          branch: proj.branch || undefined,
          limit: 10,
        });
        if (d?.ranked_chunks) ranked.push(...d.ranked_chunks);
        if (d?.related_chunks) related.push(...d.related_chunks);
      } catch (err) {
        Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'space-retrieve' }, extra: { projectId: proj.projectId } });
        fails++;
      }
    }
    if (fails === space.projects.length) return rawQuery;

    ranked.sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0));
    ranked = ranked.slice(0, 10);
    related = related.slice(0, 5);
    return buildTailoredPrompt(rawQuery, ranked, related);
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────
  const handleSend = useCallback((text: string) => {
    if (!text.trim() || isOptimizing) return;
    const mode = activeModeRef.current;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Message sent', data: { mode } });

    // Spaces mode hard-gate: no Space → refuse to send. The composer is
    // also disabled in that state, but double-gating here keeps the
    // function safe against programmatic calls.
    if (mode === 'spaces' && !selectedSpace) return;

    setClarificationData(null);
    setClarificationMode(null);
    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');

    const bundle = turnsByMode[mode];
    const files = attachedFilesByMode[mode];
    const filesToSend = files.length > 0 ? [...files] : undefined;
    const skillsArr = selectedSkillsByMode[mode];
    const skillToSend = skillsArr.length > 0 ? skillsArr.join(',') : undefined;
    const labelsArr = selectedSkillLabelsByMode[mode];
    const skillLabel = labelsArr.length > 0 ? labelsArr.join(', ') : null;

    const { msg: userMsg, turnIdx, userGroupId, assistantGroupId } = bundle.addUserMessage(text, filesToSend, skillToSend, skillLabel);
    setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: turnIdx }));
    streamingModeRef.current = mode;

    const assistantMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (mode === 'spaces') {
      const space = selectedSpace!; // guarded above
      pendingSpaceSyncRef.current = {
        spaceId: space.id,
        userGroupId,
        userVersionIndex: 0,
        assistantGroupId,
        assistantVersionIndex: 0,
        skipUser: false,
        userMsgId: userMsg.id,
        userContent: text,
        assistantMsgId,
      };

      buildSpacePrompt(text, space)
        .then((tailored) => {
          window.electronAPI?.overlay?.optimize?.({
            text: tailored,
            isRegenerate: false,
            mode: currentMode,
            attachedFiles: filesToSend,
            forcedSkill: skillToSend,
            userGroupId,
            userVersionIndex: 0,
            assistantGroupId,
            assistantVersionIndex: 0,
            spaceMode: true,
            spaceId: space.id,
          });
        })
        .catch((err) => {
          Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'build-space-prompt' } });
          window.electronAPI?.overlay?.optimize?.({
            text,
            isRegenerate: false,
            mode: currentMode,
            attachedFiles: filesToSend,
            forcedSkill: skillToSend,
            userGroupId,
            userVersionIndex: 0,
            assistantGroupId,
            assistantVersionIndex: 0,
            spaceMode: true,
            spaceId: space.id,
          });
        });
    } else {
      window.electronAPI?.overlay?.optimize?.({
        text,
        isRegenerate: false,
        mode: currentMode,
        chatId: selectedChatId || undefined,
        attachedFiles: filesToSend,
        forcedSkill: skillToSend,
        userGroupId,
        userVersionIndex: 0,
        assistantGroupId,
        assistantVersionIndex: 0,
      });
    }

    setAttachedFilesByMode((prev) => ({ ...prev, [mode]: [] }));
  }, [isOptimizing, attachedFilesByMode, selectedSkillsByMode, selectedSkillLabelsByMode, turnsByMode, currentMode, selectedChatId, selectedSpace, buildSpacePrompt]);

  // ── Stop generation ──────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    if (!isOptimizing) return;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Generation stopped' });
    window.electronAPI?.overlay?.stopGeneration?.();

    const mode = streamingModeRef.current ?? activeModeRef.current;
    const sc = streamingContent;
    if (sc) {
      const autoSaved = mode === 'chat' && !!selectedChatId;
      turnsByMode[mode].registerAssistantMessage(sc, autoSaved);
    }

    setIsOptimizing(false);
    setIsLoading(false);
    setStreamingContent('');
    setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: -1 }));
    streamingModeRef.current = null;
  }, [isOptimizing, streamingContent, selectedChatId, turnsByMode]);

  // ── Edit commit (create new user version, re-optimize) ───────────────────
  const handleEditCommit = useCallback((turnIdx: number, newContent: string) => {
    const mode = activeModeRef.current;
    const bundle = turnsByMode[mode];
    const result = bundle.commitEdit(turnIdx, newContent);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: turnIdx }));
    streamingModeRef.current = mode;

    const assistantMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (mode === 'spaces' && selectedSpace) {
      const space = selectedSpace;
      pendingSpaceSyncRef.current = {
        spaceId: space.id,
        userGroupId: result.turn.userGroupId,
        userVersionIndex: result.newUserVerIdx,
        assistantGroupId: result.turn.assistantGroupIds[result.newUserVerIdx],
        assistantVersionIndex: 0,
        skipUser: false,
        userMsgId: result.newMsg.id,
        userContent: newContent,
        assistantMsgId,
      };
      buildSpacePrompt(newContent, space)
        .then((tailored) => {
          window.electronAPI?.overlay?.optimize?.({
            text: tailored,
            isRegenerate: false,
            mode: currentMode,
            attachedFiles: result.newMsg.attachedFiles && result.newMsg.attachedFiles.length > 0 ? result.newMsg.attachedFiles : undefined,
            forcedSkill: result.newMsg.skill || undefined,
            userGroupId: result.turn.userGroupId,
            userVersionIndex: result.newUserVerIdx,
            assistantGroupId: result.turn.assistantGroupIds[result.newUserVerIdx],
            assistantVersionIndex: 0,
            spaceMode: true,
            spaceId: space.id,
          });
        })
        .catch(() => {
          window.electronAPI?.overlay?.optimize?.({
            text: newContent,
            isRegenerate: false,
            mode: currentMode,
            attachedFiles: result.newMsg.attachedFiles && result.newMsg.attachedFiles.length > 0 ? result.newMsg.attachedFiles : undefined,
            forcedSkill: result.newMsg.skill || undefined,
            userGroupId: result.turn.userGroupId,
            userVersionIndex: result.newUserVerIdx,
            assistantGroupId: result.turn.assistantGroupIds[result.newUserVerIdx],
            assistantVersionIndex: 0,
            spaceMode: true,
            spaceId: space.id,
          });
        });
    } else {
      window.electronAPI?.overlay?.optimize?.({
        text: newContent,
        isRegenerate: false,
        mode: currentMode,
        chatId: mode === 'chat' ? (selectedChatId || undefined) : undefined,
        attachedFiles: result.newMsg.attachedFiles && result.newMsg.attachedFiles.length > 0 ? result.newMsg.attachedFiles : undefined,
        forcedSkill: result.newMsg.skill || undefined,
        userGroupId: result.turn.userGroupId,
        userVersionIndex: result.newUserVerIdx,
        assistantGroupId: result.turn.assistantGroupIds[result.newUserVerIdx],
        assistantVersionIndex: 0,
      });
    }
  }, [turnsByMode, currentMode, selectedChatId, selectedSpace, buildSpacePrompt]);

  // ── Regenerate (new assistant version, same user message) ────────────────
  const handleRegenerate = useCallback((turnIdx: number) => {
    if (isOptimizing) return;
    const mode = activeModeRef.current;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Regenerate requested', data: { turnIdx, mode } });
    const bundle = turnsByMode[mode];
    const result = bundle.prepareRegenerate(turnIdx);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    setStreamingTurnIdxByMode((prev) => ({ ...prev, [mode]: turnIdx }));
    streamingModeRef.current = mode;

    const assistantMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (mode === 'spaces' && selectedSpace) {
      const space = selectedSpace;
      pendingSpaceSyncRef.current = {
        spaceId: space.id,
        userGroupId: result.userVer.id,
        userVersionIndex: 0,
        assistantGroupId: result.assistGroupId,
        assistantVersionIndex: result.assistVerIdx,
        skipUser: true,
        userMsgId: result.userVer.id,
        userContent: result.userVer.content,
        assistantMsgId,
      };
      buildSpacePrompt(result.userVer.content, space)
        .then((tailored) => {
          window.electronAPI?.overlay?.optimize?.({
            text: tailored,
            isRegenerate: true,
            mode: currentMode,
            attachedFiles: result.userVer.attachedFiles && result.userVer.attachedFiles.length > 0 ? result.userVer.attachedFiles : undefined,
            forcedSkill: result.userVer.skill || undefined,
            assistantGroupId: result.assistGroupId,
            assistantVersionIndex: result.assistVerIdx,
            previousOutput: result.previousAssistantContent || undefined,
            spaceMode: true,
            spaceId: space.id,
          });
        })
        .catch(() => {
          window.electronAPI?.overlay?.optimize?.({
            text: result.userVer.content,
            isRegenerate: true,
            mode: currentMode,
            attachedFiles: result.userVer.attachedFiles && result.userVer.attachedFiles.length > 0 ? result.userVer.attachedFiles : undefined,
            forcedSkill: result.userVer.skill || undefined,
            assistantGroupId: result.assistGroupId,
            assistantVersionIndex: result.assistVerIdx,
            previousOutput: result.previousAssistantContent || undefined,
            spaceMode: true,
            spaceId: space.id,
          });
        });
    } else {
      window.electronAPI?.overlay?.optimize?.({
        text: result.userVer.content,
        isRegenerate: true,
        mode: currentMode,
        chatId: mode === 'chat' ? (selectedChatId || undefined) : undefined,
        attachedFiles: result.userVer.attachedFiles && result.userVer.attachedFiles.length > 0 ? result.userVer.attachedFiles : undefined,
        forcedSkill: result.userVer.skill || undefined,
        assistantGroupId: result.assistGroupId,
        assistantVersionIndex: result.assistVerIdx,
        previousOutput: result.previousAssistantContent || undefined,
      });
    }
  }, [isOptimizing, turnsByMode, currentMode, selectedChatId, selectedSpace, buildSpacePrompt]);

  // ── Copy message ─────────────────────────────────────────────────────────
  // Reads from whichever mode is currently active — copy is always
  // initiated from the visible ChatArea.
  const handleCopy = useCallback((msgId: string) => {
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Prompt copied', data: { msgId } });
    const content = turnsByMode[activeModeRef.current].getMessageContent(msgId);
    if (content) window.electronAPI?.overlay?.copy?.(content);
  }, [turnsByMode]);

  // ── Save to prompt library ───────────────────────────────────────────────
  const handleSaveLibrary = useCallback(async (msgId: string) => {
    const content = turnsByMode[activeModeRef.current].getMessageContent(msgId);
    if (!content) return;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Open save-to-library picker', level: 'info', data: { msgId, contentLen: content.length } });
    setCollectionPromptContent(content);
    setCollectionPromptMsgId(msgId);
    try {
      const result = await window.electronAPI?.overlay?.getCollections?.();
      setCollections(Array.isArray(result) ? result : []);
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'load-collections' } });
      setCollections([]);
    }
    setCollectionPickerOpen(true);
  }, [turnsByMode]);

  const handleSavePrompt = useCallback(async (collectionId: string, title: string, newCollectionName?: string) => {
    const msgId = collectionPromptMsgId;
    if (!msgId) return;
    try {
      let targetCollectionId = collectionId;
      if (collectionId === 'new' && newCollectionName) {
        const created = await window.electronAPI?.overlay?.createCollection?.(newCollectionName);
        if (created?.id) {
          targetCollectionId = created.id;
          setCollections((prev) => [...prev, { id: created.id, name: created.name || newCollectionName, icon: created.icon }]);
        } else {
          throw new Error('Failed to create collection');
        }
      }
      await window.electronAPI?.overlay?.save?.({
        title,
        content: collectionPromptContent,
        collectionId: targetCollectionId,
      });
      setSavedMsgIds((prev) => {
        const next = new Set(prev);
        next.add(msgId);
        return next;
      });
      Sentry.addBreadcrumb({
        category: 'overlay.action',
        message: 'Prompt saved to library',
        level: 'info',
        data: { msgId, collectionId: targetCollectionId, createdNewCollection: collectionId === 'new' },
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'save-prompt' }, extra: { msgId } });
      setErrorMessage('Could not save prompt. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
    }
  }, [collectionPromptMsgId, collectionPromptContent]);

  // ── Replace (insert into original app) ───────────────────────────────────
  const handleReplace = useCallback(async (msgId: string) => {
    const content = turnsByMode[activeModeRef.current].getMessageContent(msgId);
    if (!content) return;
    Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Replace IPC invoked', level: 'info', data: { msgId, contentLen: content.length } });
    try {
      const result = await window.electronAPI?.overlay?.insert?.(content);
      if (!result?.success) {
        Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Replace IPC returned failure', level: 'warning' });
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'replace' } });
      window.electronAPI?.overlay?.copy?.(content);
    }
  }, [turnsByMode]);

  // ── Section insert (per-section paste without closing overlay) ───────────
  const handleInsertSection = useCallback(async (sectionIdx: number, text: string) => {
    const mode = activeModeRef.current;
    Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Section insert IPC invoked', level: 'info', data: { sectionIdx, textLen: text.length, mode } });
    try {
      const result = await window.electronAPI?.overlay?.insertSection?.(text);
      if (result?.success) {
        setInsertedSectionsByMode((prev) => ({
          ...prev,
          [mode]: new Set(prev[mode]).add(sectionIdx),
        }));
        Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Section insert succeeded', level: 'info', data: { sectionIdx } });
      } else {
        Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Section insert returned failure', level: 'warning', data: { sectionIdx } });
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'insert-section' }, extra: { sectionIdx } });
      window.electronAPI?.overlay?.copy?.(text);
    }
  }, []);

  // ── File attachment (per-mode) ───────────────────────────────────────────
  const handleAttachFiles = useCallback((newFiles: AttachedFile[]) => {
    const mode = activeModeRef.current;
    setAttachedFilesByMode((prev) => ({ ...prev, [mode]: [...prev[mode], ...newFiles] }));
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    const mode = activeModeRef.current;
    setAttachedFilesByMode((prev) => ({
      ...prev,
      [mode]: prev[mode].filter((_, i) => i !== index),
    }));
  }, []);

  // ── Skill selection (per-mode) ───────────────────────────────────────────
  const handleSelectSkill = useCallback((name: string, label: string) => {
    const mode = activeModeRef.current;
    setSelectedSkillsByMode((prev) => {
      const current = prev[mode];
      if (current.includes(name)) return { ...prev, [mode]: current.filter(s => s !== name) };
      if (current.length >= 2) return prev;
      return { ...prev, [mode]: [...current, name] };
    });
    setSelectedSkillLabelsByMode((prev) => {
      const current = prev[mode];
      if (current.includes(label)) return { ...prev, [mode]: current.filter(l => l !== label) };
      if (current.length >= 2) return prev;
      return { ...prev, [mode]: [...current, label] };
    });
  }, []);

  const handleRemoveSkill = useCallback((name?: string) => {
    const mode = activeModeRef.current;
    if (name) {
      setSelectedSkillsByMode((prev) => ({ ...prev, [mode]: prev[mode].filter(s => s !== name) }));
      setSelectedSkillLabelsByMode((prev) => {
        const skills = selectedSkillsByMode[mode];
        const idx = skills.indexOf(name);
        if (idx === -1) return prev;
        return { ...prev, [mode]: prev[mode].filter((_, i) => i !== idx) };
      });
    } else {
      setSelectedSkillsByMode((prev) => ({ ...prev, [mode]: [] }));
      setSelectedSkillLabelsByMode((prev) => ({ ...prev, [mode]: [] }));
    }
  }, [selectedSkillsByMode]);

  // ── Chat context (chat-mode only) ────────────────────────────────────────
  const handleAttachContext = useCallback(() => setChatPickerOpen(true), []);
  const handleRemoveContext = useCallback(() => {
    setSelectedChatId(null);
    setSelectedChatName('');
  }, []);
  const handleChatPickerConfirm = useCallback((chatId: string, chatName: string) => {
    setSelectedChatId(chatId);
    setSelectedChatName(chatName);
    setChatPickerOpen(false);
  }, []);

  // ── Space context (spaces-mode only) ─────────────────────────────────────
  // In the new design, this is the PRIMARY way to attach a Space. The
  // Spaces-mode empty state + the "Change" icon in the top bar both
  // open the same picker.
  const handleOpenSpacePicker = useCallback(() => setSpacePickerOpen(true), []);

  const handleRemoveSpace = useCallback(() => {
    setSelectedSpace(null);
    setSelectedSpaceStatus(null);
    pendingSpaceSyncRef.current = null;
  }, []);

  const handleSpacePickerConfirm = useCallback((spaceId: string, spaceName: string) => {
    const api = window.electronAPI?.spaces;
    if (!api?.list) {
      setSpacePickerOpen(false);
      return;
    }
    api.list()
      .then((spaces) => {
        const target = spaces.find((s: any) => s.id === spaceId);
        if (!target) {
          setSpacePickerOpen(false);
          return;
        }
        const projects = (target.projects || []).map((p: any) => ({
          projectId: p.projectId,
          name: p.name,
          localPath: p.localPath,
          branch: p.branch,
        }));

        // ── Swapping spaces = fresh session ─────────────────────────
        // The overlay's spaces-mode conversation belongs to whatever
        // space is currently attached. When the user picks a different
        // space, carrying the previous space's turns over would be
        // nonsense — the codebase context has changed entirely. Treat
        // the swap like a new session: clear the spaces bundle (turns,
        // files, skill, clarification answers, inserted-section state,
        // streaming ghost). Picking the *same* space is a no-op so an
        // accidental click in the picker doesn't nuke the user's work.
        // We also clear on first attach (prev-id === null) so stale
        // turns left over from a prior detach path don't resurrect
        // against an unrelated codebase.
        const prevId = selectedSpaceRef.current?.id ?? null;
        const isDifferentSpace = prevId !== target.id;
        if (isDifferentSpace) {
          spacesTurns.clearAll();
          setAttachedFilesByMode((p) => ({ ...p, spaces: [] }));
          setSelectedSkillsByMode((p) => ({ ...p, spaces: [] }));
          setSelectedSkillLabelsByMode((p) => ({ ...p, spaces: [] }));
          setClarificationAnswersByMode((p) => ({ ...p, spaces: {} }));
          setInsertedSectionsByMode((p) => ({ ...p, spaces: new Set() }));
          setStreamingTurnIdxByMode((p) => ({ ...p, spaces: -1 }));
          pendingSpaceSyncRef.current = null;
          if (streamingModeRef.current === 'spaces') {
            setIsOptimizing(false);
            setIsLoading(false);
            setStreamingContent('');
            streamingModeRef.current = null;
          }
          if (clarificationMode === 'spaces') {
            setClarificationData(null);
            setClarificationMode(null);
          }
        }

        setSelectedSpace({
          id: target.id,
          name: target.name || spaceName,
          projects,
        });
        if (isDifferentSpace) {
          setSelectedSpaceStatus(null); // will re-resolve via the status effect
        }
        setSpacePickerOpen(false);

        // Defense-in-depth — see rationale in previous commit (cold-start
        // reindex flow). Kicks a hash-diff scan + starts watchers for a
        // Space the user attaches without ever visiting the Spaces tab.
        try {
          const projectApi = window.electronAPI?.project as any;
          const toCheck = projects
            .filter((p) => p.projectId && p.localPath)
            .map((p) => ({ projectId: p.projectId, localPath: p.localPath }));
          if (projectApi?.ensureFresh && toCheck.length > 0) {
            projectApi.ensureFresh(toCheck).catch((err: unknown) => {
              Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'attach-ensure-fresh' } });
            });
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'attach-ensure-fresh' } });
        }
      })
      .catch((err) => {
        Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'space-picker-confirm' } });
        setSpacePickerOpen(false);
      });
  }, [spacesTurns, clarificationMode]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  // Derived values — one-line convenience lookups for the active mode.
  // Streaming content + the shared flags are passed to whichever mode
  // owns the current stream; the other mode's `streamingTurnIdxByMode`
  // slot is -1 so its ChatArea renders no streaming ghost.
  const chatMeta = spaceStatusMeta(selectedSpaceStatus);

  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div style={{ padding: 20, textAlign: 'center', fontFamily: 'Inter, sans-serif', color: '#ccc' }}>
          <p>Something went wrong</p>
          <button onClick={resetError} style={{ marginTop: 8, cursor: 'pointer' }}>Try Again</button>
        </div>
      )}
    >
    <div id="panel">
      <div className="panel-glow-wrapper" ref={glowWrapperRef}>
        <div className="overlay-panel">
          <Header
            onClose={handleClose}
            onNewSession={handleNewSession}
            activeMode={activeMode}
            onModeChange={handleModeChange}
            spaceStatus={selectedSpaceStatus}
          />

          {!isAuthenticated ? (
            <AuthGate onOpenApp={handleOpenApp} />
          ) : (
            <div className="view active" style={{ flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <OfflineBanner visible={!isOnline} />

              {/* ─────────────── CHAT MODE ─────────────── */}
              <div
                aria-hidden={activeMode !== 'chat'}
                style={{
                  display: activeMode === 'chat' ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                <ChatArea
                  turns={chatTurns.turns}
                  isOptimizing={isOptimizing && streamingModeRef.current === 'chat'}
                  isLoading={isLoading && streamingModeRef.current === 'chat'}
                  errorMessage={streamingModeRef.current === 'chat' ? errorMessage : null}
                  streamingTurnIdx={streamingTurnIdxByMode.chat}
                  streamingContent={streamingModeRef.current === 'chat' ? streamingContent : ''}
                  showReplace={triggeredByHook}
                  onEditCommit={handleEditCommit}
                  onCopy={handleCopy}
                  onReplace={handleReplace}
                  onRegenerate={handleRegenerate}
                  onSaveLibrary={handleSaveLibrary}
                  savedMsgIds={savedMsgIds}
                  onNavigateUser={chatTurns.navigateUserVersion}
                  onNavigateAssistant={chatTurns.navigateAssistantVersion}
                  clarificationData={clarificationMode === 'chat' ? clarificationData : null}
                  onSubmitClarification={handleSubmitClarification}
                  onSkipClarification={handleSkipClarification}
                  onInsertSection={handleInsertSection}
                  insertedSections={insertedSectionsByMode.chat}
                  sourceInfo={sourceInfo}
                  clarificationAnswersByTurn={clarificationAnswersByMode.chat}
                  onReoptimize={handleReoptimize}
                />

                <InputSection
                  isOptimizing={isOptimizing}
                  isOnline={isOnline}
                  isAuthenticated={isAuthenticated}
                  attachedFiles={attachedFilesByMode.chat}
                  selectedSkills={selectedSkillsByMode.chat}
                  selectedSkillLabels={selectedSkillLabelsByMode.chat}
                  selectedChatId={selectedChatId}
                  selectedChatName={selectedChatName}
                  selectedSpaceId={null}
                  selectedSpaceName=""
                  selectedSpaceStatus={null}
                  skills={skills}
                  onSend={handleSend}
                  onStop={handleStop}
                  onAttachFiles={handleAttachFiles}
                  onRemoveFile={handleRemoveFile}
                  onSelectSkill={handleSelectSkill}
                  onRemoveSkill={handleRemoveSkill}
                  onAttachContext={handleAttachContext}
                  onRemoveContext={handleRemoveContext}
                  onAttachSpace={() => { /* no-op in chat mode */ }}
                  onRemoveSpace={() => { /* no-op in chat mode */ }}
                  showChatAttach
                  showSpaceAttach={false}
                  inputRef={chatInputRef}
                />
              </div>

              {/* ─────────────── SPACES MODE ─────────────── */}
              <div
                aria-hidden={activeMode !== 'spaces'}
                style={{
                  display: activeMode === 'spaces' ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                {/* Top strip: space chip + status + a change button.
                    Only rendered when a Space is actually attached —
                    the no-space case is handled by the richer empty
                    state below, so a second info line would be noise. */}
                {selectedSpace && (
                  <SpacesTopStrip
                    space={selectedSpace}
                    status={selectedSpaceStatus}
                    statusMeta={chatMeta}
                    onChangeSpace={handleOpenSpacePicker}
                  />
                )}

                {selectedSpace ? (
                  <>
                    <ChatArea
                      turns={spacesTurns.turns}
                      isOptimizing={isOptimizing && streamingModeRef.current === 'spaces'}
                      isLoading={isLoading && streamingModeRef.current === 'spaces'}
                      errorMessage={streamingModeRef.current === 'spaces' ? errorMessage : null}
                      streamingTurnIdx={streamingTurnIdxByMode.spaces}
                      streamingContent={streamingModeRef.current === 'spaces' ? streamingContent : ''}
                      showReplace={triggeredByHook}
                      onEditCommit={handleEditCommit}
                      onCopy={handleCopy}
                      onReplace={handleReplace}
                      onRegenerate={handleRegenerate}
                      onSaveLibrary={handleSaveLibrary}
                      savedMsgIds={savedMsgIds}
                      onNavigateUser={spacesTurns.navigateUserVersion}
                      onNavigateAssistant={spacesTurns.navigateAssistantVersion}
                      clarificationData={clarificationMode === 'spaces' ? clarificationData : null}
                      onSubmitClarification={handleSubmitClarification}
                      onSkipClarification={handleSkipClarification}
                      onInsertSection={handleInsertSection}
                      insertedSections={insertedSectionsByMode.spaces}
                      sourceInfo={sourceInfo}
                      clarificationAnswersByTurn={clarificationAnswersByMode.spaces}
                      onReoptimize={handleReoptimize}
                    />

                    <InputSection
                      isOptimizing={isOptimizing}
                      isOnline={isOnline}
                      isAuthenticated={isAuthenticated}
                      attachedFiles={attachedFilesByMode.spaces}
                      selectedSkills={selectedSkillsByMode.spaces}
                      selectedSkillLabels={selectedSkillLabelsByMode.spaces}
                      selectedChatId={null}
                      selectedChatName=""
                      selectedSpaceId={selectedSpace.id}
                      selectedSpaceName={selectedSpace.name}
                      selectedSpaceStatus={selectedSpaceStatus}
                      skills={skills}
                      onSend={handleSend}
                      onStop={handleStop}
                      onAttachFiles={handleAttachFiles}
                      onRemoveFile={handleRemoveFile}
                      onSelectSkill={handleSelectSkill}
                      onRemoveSkill={handleRemoveSkill}
                      onAttachContext={() => { /* no-op in spaces mode */ }}
                      onRemoveContext={() => { /* no-op in spaces mode */ }}
                      onAttachSpace={handleOpenSpacePicker}
                      onRemoveSpace={handleRemoveSpace}
                      showChatAttach={false}
                      showSpaceAttach={false}
                      inputRef={spacesInputRef}
                    />
                  </>
                ) : (
                  <SpacesEmptyState
                    hasExistingTurns={spacesTurns.turns.length > 0}
                    onPickSpace={handleOpenSpacePicker}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Chat context picker modal */}
        <ChatPicker
          open={chatPickerOpen}
          onClose={() => setChatPickerOpen(false)}
          onConfirm={handleChatPickerConfirm}
          initialChatId={selectedChatId}
        />

        {/* Space picker modal — opened from the Spaces empty-state CTA
            or the top-strip "Change" button. */}
        <SpacePicker
          open={spacePickerOpen}
          onClose={() => setSpacePickerOpen(false)}
          onConfirm={handleSpacePickerConfirm}
          initialSpaceId={selectedSpace?.id ?? null}
        />

        <SavePromptModal
          open={collectionPickerOpen}
          onClose={() => {
            setCollectionPickerOpen(false);
            setCollectionPromptMsgId(null);
          }}
          collections={collections}
          onSave={handleSavePrompt}
          promptPreview={collectionPromptContent}
          compact
        />
      </div>

      <ZoomIndicator />
    </div>
    </Sentry.ErrorBoundary>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTING COMPONENTS — Spaces mode chrome
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slim top bar shown at the top of the Spaces-mode view. Renders two
 * shapes: a compact prompt when no Space is attached (matches the
 * composer-row affordances in feel) and a chip when a Space IS attached
 * (space name + live status dot/label + change + detach controls).
 *
 * Kept as a small internal component purely to keep App.tsx's render
 * path readable — it has no reusable value outside this file.
 */
interface SpacesTopStripProps {
  space: AttachedSpace;
  status: string | null;
  statusMeta: { dot: string; label: string };
  onChangeSpace: () => void;
}
const SpacesTopStrip: React.FC<SpacesTopStripProps> = ({ space, status, statusMeta, onChangeSpace }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px 8px 18px',
        borderBottom: '1px solid hsl(var(--border) / 0.35)',
        background: 'hsl(var(--muted) / 0.22)',
        flexShrink: 0,
      }}
    >
      <svg style={{ width: 13, height: 13, flexShrink: 0, color: 'hsl(var(--muted-foreground))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'hsl(var(--foreground))',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={space.name}
      >
        {space.name}
      </span>
      <span
        aria-label={statusMeta.label}
        title={statusMeta.label}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: statusMeta.dot,
          boxShadow: `0 0 0 2px ${statusMeta.dot}33`,
          flexShrink: 0,
          animation: status === 'indexing' ? 'overlay-status-pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          color: 'hsl(var(--muted-foreground))',
          letterSpacing: '0.01em',
          textTransform: 'uppercase',
        }}
      >
        {statusMeta.label}
      </span>
      <button
        className="btn-ghost"
        onClick={onChangeSpace}
        title="Change space"
        style={{
          marginLeft: 'auto',
          height: 24,
          padding: '0 10px',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 10.5,
          fontWeight: 600,
          color: 'hsl(var(--muted-foreground))',
          letterSpacing: '0.01em',
        }}
      >
        <svg style={{ width: 11, height: 11 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v6h6M20 20v-6h-6M5 15a8 8 0 0014 3M19 9A8 8 0 005 6" />
        </svg>
        Change
      </button>
    </div>
  );
};

/**
 * Centered empty state for Spaces mode when no Space is attached.
 * Primary CTA opens the existing SpacePicker modal. If the user has an
 * existing Spaces-mode conversation from before detaching, a small hint
 * tells them it's preserved and will come back once they pick a space.
 */
interface SpacesEmptyStateProps {
  hasExistingTurns: boolean;
  onPickSpace: () => void;
}
const SpacesEmptyState: React.FC<SpacesEmptyStateProps> = ({ hasExistingTurns, onPickSpace }) => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      overflow: 'auto',
    }}
  >
    <div
      style={{
        maxWidth: 360,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          background: 'hsl(var(--accent) / 0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'hsl(var(--accent))',
        }}
      >
        <svg style={{ width: 22, height: 22 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '-0.01em' }}>
          Pick a space to start
        </div>
        <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
          Spaces optimize your prompt using retrieval over the folder you
          attach. Your chat-mode conversation is untouched on the other
          tab.
        </div>
      </div>
      <button
        onClick={onPickSpace}
        className="btn-primary"
        style={{
          marginTop: 4,
          height: 34,
          padding: '0 14px',
          borderRadius: 10,
          fontSize: 12,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        Choose Space
      </button>
      {hasExistingTurns && (
        <div style={{ fontSize: 10.5, color: 'hsl(var(--muted-foreground) / 0.7)', marginTop: 2 }}>
          Your previous Spaces conversation is saved and will reappear
          when you attach a space.
        </div>
      )}
      <div style={{ fontSize: 10.5, color: 'hsl(var(--muted-foreground) / 0.55)' }}>
        No spaces yet? Create one from the Spaces tab in the main app.
      </div>
    </div>
  </div>
);

export default OverlayApp;
