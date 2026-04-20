import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import Header from './components/Header';
import AuthGate from './components/AuthGate';
import OfflineBanner from './components/OfflineBanner';
import ChatArea from './components/ChatArea';
import InputSection from './components/InputSection';
import ChatPicker from './components/ChatPicker';
import SpacePicker from './components/SpacePicker';
import CollectionPicker from './components/CollectionPicker';
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

// ── App ──────────────────────────────────────────────────────────────────────

const OverlayApp: React.FC = () => {
  // ── Auth & connection state ──────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [triggeredByHook, setTriggeredByHook] = useState(false);

  // ── Optimization state ───────────────────────────────────────────────────
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentMode] = useState<string>('thinking');

  // ── Clarification state ─────────────────────────────────────────────────
  const [clarificationData, setClarificationData] = useState<any>(null);
  const clarificationDataRef = useRef<any>(null);
  clarificationDataRef.current = clarificationData;
  const [clarificationAnswersByTurn, setClarificationAnswersByTurn] = useState<Record<number, { questions: ClarifyQuestion[]; answers: Record<string, string>; mode: 'single' | 'tasks' }>>({});

  // ── Section insert state ────────────────────────────────────────────────
  const [insertedSections, setInsertedSections] = useState<Set<number>>(new Set());
  const [sourceInfo, setSourceInfo] = useState<{ appName: string; detectedMode: 'chat' | 'document'; confidence: 'high' | 'low' } | null>(null);

  // ── Turn-based versioning ────────────────────────────────────────────────
  const {
    turns, messages: messagesRef,
    pendingTurnIdx, pendingUserVerIdx, pendingIsRegen,
    addUserMessage, registerAssistantMessage, commitEdit, prepareRegenerate,
    navigateUserVersion, navigateAssistantVersion,
    getMessageContent, clearAll,
  } = useTurns();

  // ── Input state lifted so App can coordinate ─────────────────────────────
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [selectedSkillLabel, setSelectedSkillLabel] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  // ── Chat context state ───────────────────────────────────────────────────
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChatName, setSelectedChatName] = useState('');
  const selectedChatIdRef = useRef<string | null>(null);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);

  // ── Space context state ─────────────────────────────────────────────────
  // The user can attach one Space at a time. When attached, the overlay:
  //   1. Routes optimization through the same retrieval + tailored-prompt
  //      pipeline that SpaceWorkspace uses (so the LLM sees the user's
  //      codebase instead of just raw chat history).
  //   2. Skips the auto-created "overlay session chat" persistence path
  //      and instead syncs each completed turn back to `space.messages`
  //      via the spaces bridge — so what the user types here shows up in
  //      the Spaces UI as if they had typed it there.
  //   3. Subscribes to the project-status broadcast so the chip's dot
  //      reflects stale → indexing → ready in real time.
  const [selectedSpace, setSelectedSpace] = useState<AttachedSpace | null>(null);
  const [selectedSpaceStatus, setSelectedSpaceStatus] = useState<string | null>(null);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  // Mirror state into refs so the long-lived IPC listeners (registered
  // once with [] deps) can read the freshest values without re-subscribing.
  const selectedSpaceRef = useRef<AttachedSpace | null>(null);

  // ── Pending space-sync metadata ─────────────────────────────────────
  // Populated at submit / edit / regenerate time, consumed when the
  // assistant message completes. We sync the *final* user + assistant pair
  // (or just the assistant on regen) to `space.messages` once we have the
  // optimized text — syncing on every chunk would either spam the bridge
  // or require a separate "replace" channel.
  interface PendingSpaceSync {
    spaceId: string;
    userGroupId: string;
    userVersionIndex: number;
    assistantGroupId: string;
    assistantVersionIndex: number;
    /** When true, only the assistant message is appended (regeneration —
     *  the user message of this turn is already in the space). */
    skipUser: boolean;
    /** Stable user-message id we generate in the renderer so the synced
     *  payload uses the same id as the in-overlay message. Allows the
     *  Spaces UI's `useMessageTree` to reconstruct the branch correctly. */
    userMsgId: string;
    userContent: string;
    /** Stable assistant id so the Spaces UI's tree can reference it later
     *  for further regenerations. */
    assistantMsgId: string;
  }
  const pendingSpaceSyncRef = useRef<PendingSpaceSync | null>(null);

  // ── Collection picker state ──────────────────────────────────────────────
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collectionPromptContent, setCollectionPromptContent] = useState('');

  // ── Streaming turn ref (for the ChatArea to know which turn is streaming)
  const streamingTurnIdxRef = useRef(-1);

  // ── Input ref (for prefill from "Optimize Again") ────────────────────────
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      // Reset section insert state on new session
      setInsertedSections(new Set());
      if (data.triggeredByHook) {
        api.overlay?.getSourceInfo?.().then((info: any) => {
          if (info?.hwnd) setSourceInfo(info);
        }).catch(() => {});
      }
      if (auth) {
        if (data.prefill?.text && inputRef.current) {
          inputRef.current.value = data.prefill.text;
          inputRef.current.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (data.prefill?.chatId) {
          setSelectedChatId(data.prefill.chatId);
          setSelectedChatName(data.prefill.chatName || 'Chat');
        }
        api.overlay?.getSettings?.().then(applySettings).catch(() => {});
        requestAnimationFrame(() => setTimeout(() => inputRef.current?.focus(), 80));
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
      // The "Saved to chat" badge is strictly for chat-context turns —
      // showing it for space-attached turns is misleading because those
      // messages live in the Space, not in a chat. The space itself
      // already exposes the conversation in its own UI, so an extra
      // badge here adds nothing but visual noise.
      const autoSaved = !!selectedChatIdRef.current;
      registerAssistantMessage(optimized, autoSaved);
      setStreamingContent('');
      streamingTurnIdxRef.current = -1;

      // ── Space sync ────────────────────────────────────────────────
      // If this turn was issued with a Space attached, append the final
      // user + assistant pair (or just the assistant for a regen) into
      // `space.messages` via the bridge. The app window applies this to
      // its in-memory state and the existing 250ms debounced save
      // persists to localStorage — making the Spaces UI show the turn
      // as if it were typed there directly.
      const pending = pendingSpaceSyncRef.current;
      if (pending && optimized) {
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
      }
    });

    // ── Optimization error ──
    const cleanupError = api.overlay?.onOptimizationError?.((data: { error: string }) => {
      setIsOptimizing(false);
      setIsLoading(false);
      setStreamingContent('');
      streamingTurnIdxRef.current = -1;
      setErrorMessage(data.error || 'Optimization failed. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
      // Drop any pending space-sync for this turn — the assistant message
      // never arrived so there's nothing meaningful to ship across the
      // bridge, and leaving the ref populated would risk syncing the
      // wrong turn the next time something completes.
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

    // Remove all IPC listeners when the component unmounts (or in dev StrictMode
    // remount cycles) so they don't accumulate and fire multiple times.
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

  // Keep ref in sync with state for IPC callbacks
  useEffect(() => { selectedChatIdRef.current = selectedChatId; }, [selectedChatId]);
  useEffect(() => { selectedSpaceRef.current = selectedSpace; }, [selectedSpace]);

  // ── Live status for the attached Space's project ───────────────────
  // The overlay BrowserWindow receives `overlay:project-status` (NOT the
  // app-window-only `project:status-update`). When a space is attached we:
  //   1. Pull the current status once via project.status() so the chip is
  //      not stuck on "Unknown" while we wait for the first broadcast.
  //   2. Subscribe to the overlay status channel and filter to the
  //      attached project — other projects in the user's account also
  //      broadcast on this channel and we don't want their state churn
  //      flipping our dot.
  // Detaching the space tears down both — the dependency array on
  // selectedSpace?.projects[0]?.projectId triggers the cleanup.
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
      // Defensive: the auto-detect side of the broadcast occasionally
      // sends a null payload to clear stale state. Ignore those — we
      // only care about updates that name a projectId.
      if (!data?.projectId) return;
      if (data.projectId !== project.projectId) return;
      const next = data.status as string | undefined;
      if (next) setSelectedSpaceStatus(next);
    });
    return () => { cancelled = true; unsub?.(); };
  }, [selectedSpace?.projects[0]?.projectId]);

  // Clear error timeout on unmount
  useEffect(() => {
    return () => { clearTimeout(glowTimeoutRef.current); };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Close overlay ──
  const handleClose = useCallback(() => {
    window.electronAPI?.overlay?.close?.();
  }, []);

  // ── Open main app ──
  const handleOpenApp = useCallback(() => {
    window.electronAPI?.overlay?.openApp?.();
  }, []);

  // ── Escape to close ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't close if a modal is open
        if (chatPickerOpen || collectionPickerOpen || spacePickerOpen) return;
        window.electronAPI?.overlay?.close?.();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [chatPickerOpen, collectionPickerOpen, spacePickerOpen]);

  // ── New session ──
  const handleNewSession = useCallback(() => {
    clearAll();
    setAttachedFiles([]);
    setSelectedSkill(null);
    setSelectedSkillLabel(null);
    setSelectedChatId(null);
    setSelectedChatName('');
    // Detach any space — a "new session" should mean a clean slate; the
    // user can re-attach via the button if they want the next turn to
    // route through the same Space.
    setSelectedSpace(null);
    setSelectedSpaceStatus(null);
    pendingSpaceSyncRef.current = null;
    setIsOptimizing(false);
    setIsLoading(false);
    setStreamingContent('');
    setErrorMessage(null);
    setClarificationData(null);
    // Reset per-turn auxiliary state. These maps/sets are keyed by
    // turnIdx, but `clearAll` resets the turns array — meaning the
    // very next prompt becomes turnIdx 0 and would inherit whatever
    // entries the previous session left behind at index 0. The most
    // visible symptom is the "Your preferences" clarification summary
    // card from the prior session reappearing above a brand-new turn.
    setClarificationAnswersByTurn({});
    setInsertedSections(new Set());
    setSourceInfo(null);
    streamingTurnIdxRef.current = -1;
    window.electronAPI?.overlay?.newSession?.();
    requestAnimationFrame(() => setTimeout(() => inputRef.current?.focus(), 80));
  }, [clearAll]);

  // ── Submit clarification answers ──
  const handleSubmitClarification = useCallback((answers: Record<string, string>, wantsSections: boolean) => {
    Sentry.addBreadcrumb({ category: 'overlay.clarification', message: 'Clarification submitted', data: { answerCount: Object.keys(answers).length, wantsSections } });
    const currentClarification = clarificationDataRef.current;
    const turnIdx = turns.length - 1;
    if (turnIdx >= 0) {
      const questions: ClarifyQuestion[] = (currentClarification?.questions || []).map((q: any) => ({
        id: q.id,
        question: q.question,
        type: q.type,
        options: q.options || [],
        optional: q.optional ?? false,
      }));
      setClarificationAnswersByTurn(prev => ({ ...prev, [turnIdx]: { questions, answers, mode: wantsSections ? 'tasks' : 'single' } }));
    }
    const choicesPayload = turnIdx >= 0
      ? { questions: (currentClarification?.questions || []).map((q: any) => ({ id: q.id, question: q.question, type: q.type, options: q.options || [], optional: q.optional ?? false })), answers, mode: wantsSections ? 'tasks' : 'single' }
      : undefined;

    setClarificationData(null);
    setIsOptimizing(true);
    setIsLoading(true);
    setErrorMessage(null);
    setStreamingContent('');
    window.electronAPI?.overlay?.submitClarification?.({ answers, wantsSections, clarificationChoices: choicesPayload });
  }, [turns.length]);

  // ── Skip clarification ──
  const handleSkipClarification = useCallback(() => {
    Sentry.addBreadcrumb({ category: 'overlay.clarification', message: 'Clarification skipped' });
    handleSubmitClarification({}, false);
  }, [handleSubmitClarification]);

  // ── Re-optimize with changed clarification answers ──
  const handleReoptimize = useCallback((turnIdx: number, newAnswers: Record<string, string>, wantsSections: boolean) => {
    if (isOptimizing) return;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Re-optimize triggered', data: { turnIdx, wantsSections } });
    const turn = turns[turnIdx];
    if (!turn) return;

    const activeUserVer = turn.userVersions[turn.userActiveIdx];
    if (!activeUserVer) return;

    // Update stored choices
    const prevInfo = clarificationAnswersByTurn[turnIdx];
    setClarificationAnswersByTurn(prev => ({
      ...prev,
      [turnIdx]: {
        questions: prevInfo?.questions || [],
        answers: newAnswers,
        mode: wantsSections ? 'tasks' : 'single',
      },
    }));

    // Format answers for the backend
    const formattedAnswers = Object.entries(newAnswers)
      .filter(([, v]) => v && v.trim())
      .map(([key, val]) => `- ${key}: ${val}`)
      .join('\n');

    // Use the regenerate flow with clarification answers
    const result = prepareRegenerate(turnIdx);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    streamingTurnIdxRef.current = turnIdx;

    const choicesPayload = {
      questions: prevInfo?.questions || [],
      answers: newAnswers,
      mode: wantsSections ? 'tasks' : 'single',
    };

    window.electronAPI?.overlay?.optimize?.({
      text: activeUserVer.content,
      isRegenerate: true,
      mode: currentMode,
      chatId: selectedChatId || undefined,
      attachedFiles: activeUserVer.attachedFiles?.length ? activeUserVer.attachedFiles : undefined,
      forcedSkill: activeUserVer.skill || undefined,
      assistantGroupId: result.assistGroupId,
      assistantVersionIndex: result.assistVerIdx,
      previousOutput: result.previousAssistantContent || undefined,
      clarificationAnswers: formattedAnswers || undefined,
      wantsSections,
      clarificationChoices: choicesPayload,
    });
  }, [isOptimizing, turns, clarificationAnswersByTurn, prepareRegenerate, currentMode, selectedChatId]);

  // ── Build the actual text we send to overlay:optimize ──────────────
  // When a Space is attached we replicate exactly what SpaceWorkspace
  // does: fan retrieval out across each project in the space, sort the
  // ranked chunks globally, then call `buildTailoredPrompt` to embed
  // that context into the prompt. The main process knows to skip chat
  // history on the strength of the `spaceMode` flag we pass alongside.
  //
  // Failure modes:
  //   * Every retrieval fails → fall through with the raw query rather
  //     than blocking the user (matches SpaceWorkspace behaviour).
  //   * The space has no projects → just use the raw query.
  // Returns `null` only when the space-attach path is hit but the
  // electron API for retrieval is unexpectedly absent (extremely
  // unlikely outside of broken test harnesses).
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

  // ── Send message ──
  const handleSend = useCallback((text: string) => {
    if (!text.trim() || isOptimizing) return;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Message sent' });

    setClarificationData(null);
    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');

    const filesToSend = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
    const skillToSend = selectedSkill || undefined;

    const { msg: userMsg, turnIdx, userGroupId, assistantGroupId } = addUserMessage(text, filesToSend, skillToSend, selectedSkillLabel);
    streamingTurnIdxRef.current = turnIdx;

    const space = selectedSpace;

    // Pre-stage the assistant id we'll use for the cross-window sync so
    // the Spaces UI can later re-target a regeneration at the right node.
    const assistantMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (space) {
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

      // Retrieval can take a few hundred ms — fire it in the background
      // and dispatch the optimize call once the tailored prompt is ready.
      // We deliberately do NOT add the unresolved promise to React state:
      // the existing `isOptimizing` flag covers UI-side debouncing.
      buildSpacePrompt(text, space)
        .then((tailored) => {
          window.electronAPI?.overlay?.optimize?.({
            text: tailored,
            isRegenerate: false,
            mode: currentMode,
            // No chatId in spaceMode — see overlay-ipc-handlers comment.
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
          // Fall back to raw text so the user isn't left hanging.
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

    // Clear attached files after sending
    setAttachedFiles([]);
  }, [isOptimizing, attachedFiles, selectedSkill, selectedSkillLabel, addUserMessage, currentMode, selectedChatId, selectedSpace, buildSpacePrompt]);

  // ── Stop generation ──
  const handleStop = useCallback(() => {
    if (!isOptimizing) return;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Generation stopped' });
    window.electronAPI?.overlay?.stopGeneration?.();

    const sc = streamingContent;
    if (sc) {
      const autoSaved = !!selectedChatId;
      registerAssistantMessage(sc, autoSaved);
    }

    setIsOptimizing(false);
    setIsLoading(false);
    setStreamingContent('');
    streamingTurnIdxRef.current = -1;
  }, [isOptimizing, streamingContent, selectedChatId, registerAssistantMessage]);

  // ── Edit commit ──
  // Editing a user message produces a new user version (sibling branch
  // in tree terms). When a Space is attached we need to:
  //   1. Re-do retrieval with the *new* prompt text (the edit may have
  //      shifted intent enough that the previously-retrieved chunks are
  //      no longer the most relevant).
  //   2. Sync the new user version + the upcoming assistant message
  //      back to `space.messages` with fresh group/version metadata so
  //      the Spaces UI's `useMessageTree` reconstructs the same branch
  //      structure the overlay just displayed.
  const handleEditCommit = useCallback((turnIdx: number, newContent: string) => {
    const result = commitEdit(turnIdx, newContent);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    streamingTurnIdxRef.current = turnIdx;

    const space = selectedSpace;
    const assistantMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (space) {
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
        chatId: selectedChatId || undefined,
        attachedFiles: result.newMsg.attachedFiles && result.newMsg.attachedFiles.length > 0 ? result.newMsg.attachedFiles : undefined,
        forcedSkill: result.newMsg.skill || undefined,
        userGroupId: result.turn.userGroupId,
        userVersionIndex: result.newUserVerIdx,
        assistantGroupId: result.turn.assistantGroupIds[result.newUserVerIdx],
        assistantVersionIndex: 0,
      });
    }
  }, [commitEdit, currentMode, selectedChatId, selectedSpace, buildSpacePrompt]);

  // ── Regenerate ──
  // Regeneration only produces a new ASSISTANT version — the user message
  // is unchanged, so the bridge sync sets `skipUser: true`. We still need
  // to know the user message's groupId to compute the right sibling
  // versionIndex on the Spaces side, which the SpaceWorkspace tree
  // derives by counting existing assistant messages in the same group.
  const handleRegenerate = useCallback((turnIdx: number) => {
    if (isOptimizing) return;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Regenerate requested', data: { turnIdx } });
    const result = prepareRegenerate(turnIdx);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    streamingTurnIdxRef.current = turnIdx;

    const space = selectedSpace;
    const assistantMsgId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (space) {
      pendingSpaceSyncRef.current = {
        spaceId: space.id,
        // User-side metadata is unused when skipUser=true but we still
        // populate it so the type stays well-formed.
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
        chatId: selectedChatId || undefined,
        attachedFiles: result.userVer.attachedFiles && result.userVer.attachedFiles.length > 0 ? result.userVer.attachedFiles : undefined,
        forcedSkill: result.userVer.skill || undefined,
        assistantGroupId: result.assistGroupId,
        assistantVersionIndex: result.assistVerIdx,
        previousOutput: result.previousAssistantContent || undefined,
      });
    }
  }, [isOptimizing, prepareRegenerate, currentMode, selectedChatId, selectedSpace, buildSpacePrompt]);

  // ── Copy message ──
  const handleCopy = useCallback((msgId: string) => {
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Prompt copied', data: { msgId } });
    const content = getMessageContent(msgId);
    if (content) window.electronAPI?.overlay?.copy?.(content);
  }, [getMessageContent]);

  // ── Save to prompt library ──
  // Opens the CollectionPicker modal pre-loaded with this message's
  // content. The modal handles collection selection / creation and the
  // actual `electronAPI.overlay.save` call. We just stage the content
  // and flip the modal open.
  const handleSaveLibrary = useCallback((msgId: string) => {
    const content = getMessageContent(msgId);
    if (!content) return;
    Sentry.addBreadcrumb({ category: 'overlay.action', message: 'Open save-to-library picker', level: 'info', data: { msgId, contentLen: content.length } });
    setCollectionPromptContent(content);
    setCollectionPickerOpen(true);
  }, [getMessageContent]);

  // ── Replace (insert into original app) ──
  const handleReplace = useCallback(async (msgId: string) => {
    const content = getMessageContent(msgId);
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
  }, [getMessageContent]);

  // ── Section insert (per-section paste without closing overlay) ──
  const handleInsertSection = useCallback(async (sectionIdx: number, text: string) => {
    Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Section insert IPC invoked', level: 'info', data: { sectionIdx, textLen: text.length } });
    try {
      const result = await window.electronAPI?.overlay?.insertSection?.(text);
      if (result?.success) {
        setInsertedSections(prev => new Set(prev).add(sectionIdx));
        Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Section insert succeeded', level: 'info', data: { sectionIdx } });
      } else {
        Sentry.addBreadcrumb({ category: 'overlay.ipc', message: 'Section insert returned failure', level: 'warning', data: { sectionIdx } });
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { component: 'overlay-app', op: 'insert-section' }, extra: { sectionIdx } });
      window.electronAPI?.overlay?.copy?.(text);
    }
  }, []);

  // ── File attachment ──
  const handleAttachFiles = useCallback((newFiles: AttachedFile[]) => {
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Skill selection ──
  const handleSelectSkill = useCallback((name: string, label: string) => {
    setSelectedSkill(name);
    setSelectedSkillLabel(label);
  }, []);

  const handleRemoveSkill = useCallback(() => {
    setSelectedSkill(null);
    setSelectedSkillLabel(null);
  }, []);

  // ── Chat context ──
  const handleAttachContext = useCallback(() => {
    setChatPickerOpen(true);
  }, []);

  const handleRemoveContext = useCallback(() => {
    setSelectedChatId(null);
    setSelectedChatName('');
  }, []);

  const handleChatPickerConfirm = useCallback((chatId: string, chatName: string) => {
    setSelectedChatId(chatId);
    setSelectedChatName(chatName);
    setChatPickerOpen(false);
  }, []);

  // ── Space context handlers ──
  const handleAttachSpace = useCallback(() => {
    setSpacePickerOpen(true);
  }, []);

  const handleRemoveSpace = useCallback(() => {
    setSelectedSpace(null);
    setSelectedSpaceStatus(null);
    pendingSpaceSyncRef.current = null;
  }, []);

  const handleSpacePickerConfirm = useCallback((spaceId: string, spaceName: string) => {
    // We need the full space record (including the project list) to do
    // retrieval, so re-query the bridge for the current snapshot rather
    // than asking the picker to thread that data through.
    const api = window.electronAPI?.spaces;
    if (!api?.list) {
      setSpacePickerOpen(false);
      return;
    }
    api.list()
      .then((spaces) => {
        const target = spaces.find((s: any) => s.id === spaceId);
        if (!target) {
          // Race: the user deleted the space in the main app between
          // opening the picker and confirming. Bail silently.
          setSpacePickerOpen(false);
          return;
        }
        const projects = (target.projects || []).map((p: any) => ({
          projectId: p.projectId,
          name: p.name,
          localPath: p.localPath,
          branch: p.branch,
        }));
        setSelectedSpace({
          id: target.id,
          name: target.name || spaceName,
          projects,
        });
        setSpacePickerOpen(false);

        // Defense-in-depth: a space the user *creates* during this session
        // and then attaches in the overlay (without ever opening the
        // Spaces tab afterwards) would otherwise skip the cold-start
        // hash-diff scan and never get a chokidar watcher started for its
        // projects. Kicking ensureFresh on attach is cheap — it
        // short-circuits when nothing has drifted — and the existing
        // onOverlayStatus subscription will surface any indexing/ready
        // transitions on the chip.
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
  }, []);

  // ── Self-heal: drop the attached space if the user deletes it from
  // the main app while the overlay is open. We listen to publishSnapshot
  // implicitly by re-listing after each update; the simpler approach is
  // to verify on every snapshot tick that the attached id still exists.
  // Achieved indirectly: the next time the user opens the picker, the
  // missing id falls through harmlessly. No proactive listener needed
  // because deleting a space the user is actively typing into is a rare
  // edge case and a stale chip just produces a "space not found" no-op
  // on the bridge side.

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
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
          <Header onClose={handleClose} onNewSession={handleNewSession} />

          {!isAuthenticated ? (
            <AuthGate onOpenApp={handleOpenApp} />
          ) : (
            <div className="view active" style={{ flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <OfflineBanner visible={!isOnline} />

              <ChatArea
                turns={turns}
                isOptimizing={isOptimizing}
                isLoading={isLoading}
                errorMessage={errorMessage}
                streamingTurnIdx={streamingTurnIdxRef.current}
                streamingContent={streamingContent}
                showReplace={triggeredByHook}
                onEditCommit={handleEditCommit}
                onCopy={handleCopy}
                onReplace={handleReplace}
                onRegenerate={handleRegenerate}
                onSaveLibrary={handleSaveLibrary}
                onNavigateUser={navigateUserVersion}
                onNavigateAssistant={navigateAssistantVersion}
                clarificationData={clarificationData}
                onSubmitClarification={handleSubmitClarification}
                onSkipClarification={handleSkipClarification}
                onInsertSection={handleInsertSection}
                insertedSections={insertedSections}
                sourceInfo={sourceInfo}
                clarificationAnswersByTurn={clarificationAnswersByTurn}
                onReoptimize={handleReoptimize}
              />

              <InputSection
                isOptimizing={isOptimizing}
                isOnline={isOnline}
                isAuthenticated={isAuthenticated}
                attachedFiles={attachedFiles}
                selectedSkill={selectedSkill}
                selectedSkillLabel={selectedSkillLabel}
                selectedChatId={selectedChatId}
                selectedChatName={selectedChatName}
                selectedSpaceId={selectedSpace?.id ?? null}
                selectedSpaceName={selectedSpace?.name ?? ''}
                selectedSpaceStatus={selectedSpaceStatus}
                skills={skills}
                onSend={handleSend}
                onStop={handleStop}
                onAttachFiles={handleAttachFiles}
                onRemoveFile={handleRemoveFile}
                onSelectSkill={handleSelectSkill}
                onRemoveSkill={handleRemoveSkill}
                onAttachContext={handleAttachContext}
                onRemoveContext={handleRemoveContext}
                onAttachSpace={handleAttachSpace}
                onRemoveSpace={handleRemoveSpace}
                inputRef={inputRef}
              />
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

        {/* Space picker modal — opens when the user clicks "Attach Space".
            Lists Spaces published to main by ProjectsView and routes
            optimization through the same retrieval pipeline as the
            in-app Spaces UI when one is selected. */}
        <SpacePicker
          open={spacePickerOpen}
          onClose={() => setSpacePickerOpen(false)}
          onConfirm={handleSpacePickerConfirm}
          initialSpaceId={selectedSpace?.id ?? null}
        />

        {/* Collection picker modal */}
        <CollectionPicker
          open={collectionPickerOpen}
          promptContent={collectionPromptContent}
          onClose={() => setCollectionPickerOpen(false)}
          onSaved={() => {}}
        />
      </div>

      <ZoomIndicator />
    </div>
    </Sentry.ErrorBoundary>
  );
};

export default OverlayApp;
