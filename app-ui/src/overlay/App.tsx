import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import Header from './components/Header';
import AuthGate from './components/AuthGate';
import OfflineBanner from './components/OfflineBanner';
import ChatArea from './components/ChatArea';
import InputSection from './components/InputSection';
import ChatPicker from './components/ChatPicker';
import CollectionPicker from './components/CollectionPicker';
import { useTurns } from './hooks/useTurns';
import type { AttachedFile, SkillInfo, OverlaySettings } from './lib/types';

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
  const [currentMode, setCurrentMode] = useState<string>('fast');

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
      const autoSaved = !!selectedChatIdRef.current;
      registerAssistantMessage(optimized, autoSaved);
      setStreamingContent('');
      streamingTurnIdxRef.current = -1;
    });

    // ── Optimization error ──
    const cleanupError = api.overlay?.onOptimizationError?.((data: { error: string }) => {
      setIsOptimizing(false);
      setIsLoading(false);
      setStreamingContent('');
      streamingTurnIdxRef.current = -1;
      setErrorMessage(data.error || 'Optimization failed. Please try again.');
      setTimeout(() => setErrorMessage(null), 5000);
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
        if (chatPickerOpen || collectionPickerOpen) return;
        window.electronAPI?.overlay?.close?.();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [chatPickerOpen, collectionPickerOpen]);

  // ── New session ──
  const handleNewSession = useCallback(() => {
    clearAll();
    setAttachedFiles([]);
    setSelectedSkill(null);
    setSelectedSkillLabel(null);
    setSelectedChatId(null);
    setSelectedChatName('');
    setIsOptimizing(false);
    setIsLoading(false);
    setStreamingContent('');
    setErrorMessage(null);
    streamingTurnIdxRef.current = -1;
    window.electronAPI?.overlay?.newSession?.();
    requestAnimationFrame(() => setTimeout(() => inputRef.current?.focus(), 80));
  }, [clearAll]);

  // ── Send message ──
  const handleSend = useCallback((text: string) => {
    if (!text.trim() || isOptimizing) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');

    const filesToSend = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
    const skillToSend = selectedSkill || undefined;

    const { turnIdx, userGroupId, assistantGroupId } = addUserMessage(text, filesToSend, skillToSend, selectedSkillLabel);
    streamingTurnIdxRef.current = turnIdx;

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

    // Clear attached files after sending
    setAttachedFiles([]);
  }, [isOptimizing, attachedFiles, selectedSkill, selectedSkillLabel, addUserMessage, currentMode, selectedChatId]);

  // ── Stop generation ──
  const handleStop = useCallback(() => {
    if (!isOptimizing) return;
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
  const handleEditCommit = useCallback((turnIdx: number, newContent: string) => {
    const result = commitEdit(turnIdx, newContent);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    streamingTurnIdxRef.current = turnIdx;

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
  }, [commitEdit, currentMode, selectedChatId]);

  // ── Regenerate ──
  const handleRegenerate = useCallback((turnIdx: number) => {
    if (isOptimizing) return;
    const result = prepareRegenerate(turnIdx);
    if (!result) return;

    setIsOptimizing(true);
    setErrorMessage(null);
    setIsLoading(true);
    setStreamingContent('');
    streamingTurnIdxRef.current = turnIdx;

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
  }, [isOptimizing, prepareRegenerate, currentMode, selectedChatId]);

  // ── Copy message ──
  const handleCopy = useCallback((msgId: string) => {
    const content = getMessageContent(msgId);
    if (content) window.electronAPI?.overlay?.copy?.(content);
  }, [getMessageContent]);

  // ── Replace (insert into original app) ──
  const handleReplace = useCallback(async (msgId: string) => {
    const content = getMessageContent(msgId);
    if (!content) return;
    try {
      await window.electronAPI?.overlay?.insert?.(content);
    } catch (err) {
      // Fallback to clipboard
      window.electronAPI?.overlay?.copy?.(content);
    }
  }, [getMessageContent]);

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
                onNavigateUser={navigateUserVersion}
                onNavigateAssistant={navigateAssistantVersion}
              />

              <InputSection
                isOptimizing={isOptimizing}
                isOnline={isOnline}
                isAuthenticated={isAuthenticated}
                currentMode={currentMode}
                attachedFiles={attachedFiles}
                selectedSkill={selectedSkill}
                selectedSkillLabel={selectedSkillLabel}
                selectedChatId={selectedChatId}
                selectedChatName={selectedChatName}
                skills={skills}
                onSend={handleSend}
                onStop={handleStop}
                onModeChange={setCurrentMode}
                onAttachFiles={handleAttachFiles}
                onRemoveFile={handleRemoveFile}
                onSelectSkill={handleSelectSkill}
                onRemoveSkill={handleRemoveSkill}
                onAttachContext={handleAttachContext}
                onRemoveContext={handleRemoveContext}
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

        {/* Collection picker modal */}
        <CollectionPicker
          open={collectionPickerOpen}
          promptContent={collectionPromptContent}
          onClose={() => setCollectionPickerOpen(false)}
          onSaved={() => {}}
        />
      </div>
    </div>
    </Sentry.ErrorBoundary>
  );
};

export default OverlayApp;
