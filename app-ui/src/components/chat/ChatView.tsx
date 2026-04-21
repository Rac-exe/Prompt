import { useState, useRef, useEffect, useCallback } from "react";
import * as Sentry from "@sentry/react";
import { PaperPlaneRight, Sparkle, Microphone, MicrophoneSlash, Atom, WarningCircle, Plus, WifiSlash, Square, X, FileText, ImageSquare, MagnifyingGlassPlus, CircleNotch, ArrowDown, CaretRight } from "@phosphor-icons/react";
import { Logo } from "@/components/ui/Logo";
import { useScrollController } from "@/hooks/useScrollController";
import { Button } from "@/components/ui/button";
import { MessageBubble, Message } from "./MessageBubble";
import { FilePreviewModal, type PreviewFile } from "./FilePreviewModal";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PlusMenu } from "./PlusMenu";
import { SkillPicker, SKILL_ICON_MAP } from "./SkillPicker";
import { VersionNavigator } from "./VersionNavigator";
import { ClarificationCard, type ClarifyQuestion } from "./ClarificationCard";
import { ClarificationSummaryCard } from "./ClarificationSummaryCard";
import type { AttachedFile } from "@/types/electron";
import type { VersionInfo } from "@/hooks/useMessageTree";

const PASTE_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

interface ChatViewProps {
  messages: Message[];
  streamingMessage?: Message | null;
  generationStats?: { ttft: number | null; total: number | null };
  onSendMessage: (
    content: string, 
    mode: "fast" | "thinking",
    attachedFiles?: AttachedFile[],
    selectedSkill?: string | null
  ) => void;
  onCopyPrompt: (id: string) => void;
  onSavePrompt: (id: string) => void;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  savedPromptIds: string[];
  isGenerating: boolean;
  isOnline?: boolean;
  offlineChatUnavailable?: boolean;
  onRetryLoad?: () => void;
  sendError?: string | null;
  onStopGeneration?: () => void;
  avatarUrl?: string | null;
  versionInfoMap?: Map<string, VersionInfo>;
  onNavigateVersion?: (parentId: string, direction: 'prev' | 'next') => void;
  // Per-chat UI state (managed by parent)
  input: string;
  setInput: (value: string) => void;
  mode: "fast" | "thinking";
  attachedFiles: AttachedFile[];
  setAttachedFiles: (files: AttachedFile[]) => void;
  selectedSkill: string | null;
  setSelectedSkill: (skill: string | null) => void;
  // Clarification
  clarificationData?: any;
  onSubmitClarification?: (answers: Record<string, string>, wantsSections: boolean) => void;
  clarificationAnswersMap?: Record<string, { questions: ClarifyQuestion[]; answers: Record<string, string>; mode: 'single' | 'tasks' }>;
  onReoptimize?: (userMessageId: string, answers: Record<string, string>, wantsSections: boolean) => void;
}

type VoiceState = "idle" | "listening" | "processing";

export const ChatView = ({
  messages, streamingMessage, generationStats,
  onSendMessage, onCopyPrompt, onSavePrompt, onFeedback,
  onEditMessage, onRegenerateMessage,
  savedPromptIds, isGenerating, isOnline = true, offlineChatUnavailable = false,
  onRetryLoad, sendError, onStopGeneration, avatarUrl,
  versionInfoMap, onNavigateVersion,
  // Per-chat UI state
  input, setInput, mode, attachedFiles, setAttachedFiles, selectedSkill, setSelectedSkill,
  clarificationData, onSubmitClarification, clarificationAnswersMap, onReoptimize,
}: ChatViewProps) => {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceActiveRef = useRef(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [showSlashPicker, setShowSlashPicker] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);

  // ── Auto-resize textarea ────────────────────────────────────
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ── Scroll controller (single source of truth) ──────────────
  const { handleScroll, scrollToBottom, showScrollButton } = useScrollController(
    scrollRef,
    {
      isStreaming: !!streamingMessage,
      messageCount: messages.length,
      streamingTrigger: streamingMessage?.content,
    },
  );

  // The "active project" concept lives in the Spaces section only — the new
  // chat screen is intentionally project-agnostic. Folder add/remove inside
  // a Space updates its own SpaceWorkspace UI; this view should never react
  // to project:status-update broadcasts. (Previously a chip with the active
  // project name leaked in here whenever a folder was added in Spaces.)

  // ── Transcription IPC listeners ─────────────────────────────
  useEffect(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron) return;

    window.electronAPI?.transcription?.onTranscription?.((data) => {
      if (!voiceActiveRef.current) return;
      const text = (data.accumulated || data.text || "").trim();
      if (text) {
        setInput(text);
        if (data.type === "final") {
          Sentry.addBreadcrumb({ category: "transcription", message: "Final transcription received (ChatView)", level: "info" });
          voiceActiveRef.current = false;
          setVoiceState("idle");
        }
      }
    });

    window.electronAPI?.transcription?.onStatus?.((status) => {
      Sentry.addBreadcrumb({ category: "transcription", message: `Voice status: ${status}`, level: "info", data: { window: "main" } });
      if (status === "listening") {
        voiceActiveRef.current = true;
        setVoiceState("listening");
        setVoiceError(null);
      } else if (status === "processing") {
        setVoiceState("processing");
      } else if (status === "stopped") {
        voiceActiveRef.current = false;
        setVoiceState("idle");
      }
    });

    window.electronAPI?.transcription?.onError?.((error) => {
      Sentry.addBreadcrumb({ category: "transcription", message: "Voice transcription error", level: "error", data: { error, window: "main" } });
      setVoiceState("idle");
      setVoiceError(error || "Transcription failed.");
      setTimeout(() => setVoiceError(null), 5000);
    });
  }, []);

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!input.trim() || isGenerating || !isOnline) return;
    if (voiceState === "listening") {
      Sentry.addBreadcrumb({ category: "transcription", message: "Send pressed while voice active — stopping transcription", level: "info", data: { window: "main" } });
      voiceActiveRef.current = false;
      window.electronAPI?.transcription?.stop?.();
      setVoiceState("idle");
    }
    Sentry.addBreadcrumb({ category: "app.action", message: "Message sent", level: "info", data: { mode, hasFiles: attachedFiles.length > 0, skill: selectedSkill || 'auto' } });
    onSendMessage(input.trim(), mode, attachedFiles, selectedSkill);
    setInput("");
    setAttachedFiles([]);
    setShowSlashPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    
    // Slash command for skill picker
    if (e.key === "/" && input.length === 0) {
      e.preventDefault();
      setShowSlashPicker(true);
      return;
    }
    
    // Escape to close slash picker
    if (e.key === "Escape" && showSlashPicker) {
      e.preventDefault();
      setShowSlashPicker(false);
      return;
    }
  };

  // ── Voice toggle ────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron) return;
    if (voiceState === "listening") {
      Sentry.addBreadcrumb({ category: "transcription", message: "Mic toggled off by user", level: "info", data: { window: "main" } });
      window.electronAPI?.transcription?.stop?.();
      setVoiceState("processing");
    } else if (voiceState === "idle") {
      Sentry.addBreadcrumb({ category: "transcription", message: "Mic toggled on by user", level: "info", data: { window: "main" } });
      setVoiceError(null);
      window.electronAPI?.transcription?.start?.(Date.now().toString());
    }
  }, [voiceState]);

  // ── Clipboard paste handler ────────────────────────────────
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const fileItems = items.filter(item => PASTE_ALLOWED_TYPES.includes(item.type));
    if (fileItems.length === 0) return; // let normal text paste proceed

    e.preventDefault();
    const newFiles: AttachedFile[] = [];

    for (const item of fileItems) {
      const file = item.getAsFile();
      if (!file) continue;
      if (file.size > 10_000_000) continue; // skip oversized

      try {
        const base64 = await fileToBase64(file);
        const ext = file.type.split('/')[1] || 'img';
        const name = file.name || `pasted-image.${ext}`;
        newFiles.push({ name, mimeType: file.type, base64, sizeBytes: file.size });
      } catch {
        // silently skip failed items
      }
    }

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles].slice(0, 5));
    }
  }, []);

  const isEmpty = messages.length === 0;
  const canSend = input.trim().length > 0 && !isGenerating && voiceState !== "processing" && isOnline;

  // ── Unified input bar (Claude style — textarea + bottom toolbar inside) ──
  const inputBar = (
    <div className="w-full max-w-4xl mx-auto">
      <div
        className={cn(
          "relative flex flex-col bg-surface border rounded-2xl transition-all overflow-hidden",
          isOnline
            ? "border-border focus-within:border-emerald/40 focus-within:shadow-[0_0_0_1px_hsl(var(--accent)/0.1)]"
            : "border-amber-500/20"
        )}
      >
        {/* Offline pill — sits flush at the very top of the box */}
        {!isOnline && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-amber-500/15 bg-amber-500/5">
            <WifiSlash size={12} weight="light" className="text-amber-400/80 flex-shrink-0" />
            <span className="text-[11px] text-amber-400/80 font-medium">
              You're offline — messaging is unavailable
            </span>
          </div>
        )}

        {/* File pills — thumbnails for images, PDF cards — all clickable for preview */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-5 pt-3">
            {attachedFiles.map((file, idx) => {
              const isImage = file.mimeType.startsWith('image/');
              const openPreview = () => setPreviewFile({ name: file.name, mimeType: file.mimeType, base64: file.base64, sizeBytes: file.sizeBytes });
              const removeFile = (e: React.MouseEvent) => {
                e.stopPropagation();
                setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
              };
              return isImage ? (
                /* ── Image thumbnail ── */
                <div key={idx} className="relative group flex-shrink-0" style={{ width: 64, height: 64 }}>
                  <button
                    type="button"
                    onClick={openPreview}
                    className="w-full h-full rounded-xl overflow-hidden cursor-zoom-in focus:outline-none border border-border/50 hover:border-border transition-colors"
                  >
                      <img
                        src={`data:${file.mimeType};base64,${file.base64}`}
                        alt={file.name}
                      className="w-full h-full object-cover"
                      />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 rounded-xl transition-colors flex items-center justify-center">
                      <MagnifyingGlassPlus size={16} weight="light" className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                    </div>
                  </button>
                      <button
                    type="button"
                    onClick={removeFile}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-background border border-border shadow flex items-center justify-center hover:bg-destructive hover:border-destructive hover:text-white transition-colors z-10"
                      >
                        <X size={10} weight="light" />
                      </button>
                    </div>
                  ) : (
                /* ── PDF card (ChatGPT style) ── */
                <div key={idx} className="relative group flex-shrink-0">
                  <button
                    type="button"
                    onClick={openPreview}
                    className="flex items-center gap-2.5 h-14 px-3 pr-8 rounded-xl bg-secondary border border-border hover:border-border/80 hover:bg-secondary/80 transition-colors max-w-[220px] focus:outline-none"
                    title={`${file.name} — click to preview`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-red-500/12 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                      <FileText size={16} weight="light" className="text-red-400" />
                    </div>
                    <div className="min-w-0 text-left">
                      <p className="text-xs font-medium text-foreground truncate max-w-[140px]">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {file.sizeBytes ? `${(file.sizeBytes / 1024).toFixed(0)} KB · ` : ""}PDF
                      </p>
                    </div>
                  </button>
                      <button
                    type="button"
                    onClick={removeFile}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-background border border-border shadow flex items-center justify-center hover:bg-destructive hover:border-destructive hover:text-white transition-colors z-10"
                      >
                    <X size={10} weight="light" />
                      </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Textarea area */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            placeholder={
              !isOnline
                ? "Messaging unavailable while offline…"
                : voiceState === "processing"
                ? "Transcribing your voice…"
                : isEmpty ? "How can I help you today?" : "Ask anything, or paste an image"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={voiceState === "processing" || !isOnline}
            rows={2}
            className={cn(
              "w-full bg-transparent border-0 outline-none resize-none",
              "px-5 pt-4 pb-2 text-[14px] leading-relaxed text-foreground",
              "placeholder:text-muted-foreground/60",
              "disabled:opacity-40",
              "scrollbar-none"
            )}
            style={{ minHeight: "72px", maxHeight: "200px", overflow: input.split("\n").length > 6 ? "auto" : "hidden" }}
          />
          
          {/* Slash command skill picker */}
          {showSlashPicker && (
            <div className="absolute bottom-full left-0 mb-2">
              <SkillPicker
                onSelect={(skillName) => {
                  setSelectedSkill(skillName);
                  setShowSlashPicker(false);
                  setInput("");
                  textareaRef.current?.focus();
                }}
                onClose={() => setShowSlashPicker(false)}
              />
            </div>
          )}
        </div>

        {/* Bottom toolbar inside the box (like Claude) */}
        <div className="flex items-center justify-between px-3 py-2.5">
          {/* Left side: plus button + model dropdown */}
          <div className="flex items-center gap-1">
            {/* Plus / attach */}
            <button
              ref={plusButtonRef}
              type="button"
              disabled={!isOnline}
              onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
              title="Add files or pick skill"
            >
              <Plus size={20} weight="light" />
            </button>
            
            {/* Plus Menu */}
            <PlusMenu
              isOpen={isPlusMenuOpen}
              onClose={() => setIsPlusMenuOpen(false)}
              onFilesSelected={(files) => {
                setAttachedFiles(prev => [...prev, ...files].slice(0, 5));
              }}
              onSkillSelected={(skillName) => {
                setSelectedSkill(skillName);
              }}
              anchorRef={plusButtonRef}
            />

            {/* Pro Mode badge */}
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="group relative inline-flex items-center gap-1.5 h-8 px-3 pr-5 rounded-lg text-xs font-medium text-muted-foreground cursor-default select-none transition-colors duration-150 hover:bg-muted hover:text-foreground">
                    <Atom size={14} weight="duotone" className="text-emerald" />
                    <span>Pro Mode</span>
                    <CaretRight
                      size={9}
                      weight="bold"
                      className="absolute top-1 right-1 text-muted-foreground/30 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-rotate-90 group-hover:text-muted-foreground/60"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  You don't need any other mode !!
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Skill pill — shows skill-specific icon */}
            {selectedSkill && (() => {
              const SkillIcon = SKILL_ICON_MAP[selectedSkill] ?? Sparkle;
              return (
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-xs text-emerald-500 border border-emerald-500/20 ml-1">
                  <SkillIcon size={12} weight="light" />
                  <span className="capitalize">{selectedSkill}</span>
                  <button
                    onClick={() => setSelectedSkill(null)}
                    className="hover:text-emerald-400 transition-colors"
                  >
                    <X size={12} weight="light" />
                  </button>
                </div>
              );
            })()}

            {/* Voice state indicators */}
            {voiceState === "listening" && (
              <div className="flex items-center gap-1.5 ml-1 animate-fade-in">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] text-red-400 font-medium">Listening…</span>
              </div>
            )}
            {voiceState === "processing" && (
              <div className="flex items-center gap-1.5 ml-1 animate-fade-in">
                <CircleNotch size={12} weight="light" className="animate-spin text-emerald" />
                <span className="text-[11px] text-emerald font-medium">Transcribing…</span>
              </div>
            )}
          </div>

          {/* Right side: voice + send */}
          <div className="flex items-center gap-1">
            {/* Voice button */}
            <button
              type="button"
              onClick={toggleVoice}
              disabled={isGenerating || voiceState === "processing" || !isOnline}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                voiceState === "listening"
                  ? "bg-red-500/10 text-red-400"
                  : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary",
                (!isOnline) && "opacity-30 pointer-events-none"
              )}
              title={voiceState === "listening" ? "Stop recording" : "Voice input"}
            >
              {voiceState === "listening" ? <MicrophoneSlash size={16} weight="light" /> :
               voiceState === "processing" ? <CircleNotch size={16} weight="light" className="animate-spin" /> :
               <Microphone size={16} weight="light" />}
            </button>

            {/* Send / Stop button (circular) */}
            {isGenerating ? (
              <button
                type="button"
                onClick={onStopGeneration}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-all
                           bg-foreground text-background hover:bg-foreground/80"
                title="Stop generation"
              >
                <Square size={12} weight="fill" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSend}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                  canSend
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "bg-muted text-muted-foreground/40 cursor-not-allowed"
                )}
                title="Send (Enter)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status strip — voice errors or send errors, never a toast */}
      {(voiceError || sendError) && (
        <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20 animate-slide-up">
          <WarningCircle size={14} weight="light" className="text-destructive flex-shrink-0" />
          <span className="text-[12px] text-destructive leading-snug">
            {sendError || voiceError}
          </span>
        </div>
      )}
    </div>
  );

  // ── Offline uncached-chat empty state ───────────────────────
  if (offlineChatUnavailable) {
    return (
      <div className="flex-1 flex flex-col h-full bg-background">
        <div className="flex-1 flex flex-col items-center justify-center px-6 animate-fade-in-slow">
          <div className="flex flex-col items-center gap-5 text-center max-w-xs">
            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <WifiSlash size={24} weight="light" className="text-amber-400" />
            </div>

            {/* Text */}
            <div className="space-y-1.5">
              <h2 className="text-[17px] font-semibold text-foreground tracking-tight">
                You're offline
              </h2>
              <p className="text-[13px] text-muted-foreground/70 leading-relaxed">
                This chat isn't available offline.<br />Reconnect to load it.
              </p>
            </div>

            {/* Retry / refresh button */}
            <button
              type="button"
              onClick={onRetryLoad}
              disabled={!onRetryLoad}
              className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg
                         text-[13px] font-medium text-amber-400
                         bg-amber-500/10 border border-amber-500/20
                         hover:bg-amber-500/15 hover:border-amber-500/30
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors duration-150"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col h-full bg-background">
        <div className="flex-1 flex flex-col items-center px-6 pt-[12%] pb-8 animate-fade-in-slow">
          <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-8">
            {/* Hero */}
            <div className="flex flex-col items-center gap-5 text-center">
              <Logo size="w-20 h-20" />
              <div className="space-y-2">
                <h2 className="text-[28px] font-bold text-gradient-primary tracking-tight leading-none">
                  Welcome to Prmpt!!
                </h2>
                <p className="text-[14px] text-muted-foreground/70 leading-relaxed">
                  Transform rough ideas into precisely engineered prompts.
                </p>
              </div>
            </div>
            {inputBar}
          </div>
        </div>

        {/* File preview modal */}
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          allFiles={attachedFiles.map(f => ({ name: f.name, mimeType: f.mimeType, base64: f.base64, sizeBytes: f.sizeBytes }))}
        />
      </div>
    );
  }

  // ── Conversation state ──────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto scrollbar-none"
          onScroll={handleScroll}
        >
          <div className="max-w-4xl mx-auto py-8 px-6 space-y-6">
            {messages.map((message, idx) => {
              // For assistant messages, look back for the most recent preceding
              // user message to determine if files were included in context.
              const fileContextCount = message.role === "assistant"
                ? (() => {
                    for (let i = idx - 1; i >= 0; i--) {
                      if (messages[i].role === "user") {
                        return messages[i].attachedFiles?.length ?? 0;
                      }
                    }
                    return 0;
                  })()
                : undefined;

              const versionInfo = versionInfoMap?.get(message.id);

              // Choices are keyed by assistant ID — find the next assistant in the list.
              // Fall back to a temp "_pending_" key during streaming (before assistant ID is known).
              const nextAssistantId = message.role === "user" ? messages[idx + 1]?.id : undefined;
              const clarificationInfo = message.role === "user"
                ? (nextAssistantId && clarificationAnswersMap?.[nextAssistantId])
                  || clarificationAnswersMap?.[`_pending_${message.id}`]
                  || undefined
                : undefined;

              return (
              <div key={message.id} className="space-y-4">
              {message.role === "user" && clarificationInfo && (
                <ClarificationSummaryCard
                  info={clarificationInfo}
                  onReoptimize={onReoptimize ? (answers, wantsSections) => onReoptimize(message.id, answers, wantsSections) : undefined}
                  isGenerating={isGenerating}
                />
              )}
              <MessageBubble
                message={message}
                onCopy={() => onCopyPrompt(message.id)}
                onSave={() => onSavePrompt(message.id)}
                onFeedback={onFeedback}
                isSaved={savedPromptIds.includes(message.id)}
                onEdit={message.role === "user" ? (id, content) => {
                  onEditMessage?.(id, content);
                } : undefined}
                onRegenerate={message.role === "assistant" ? onRegenerateMessage : undefined}
                isGenerating={isGenerating}
                fileContextCount={fileContextCount}
                avatarUrl={avatarUrl}
                versionInfo={message.role === "user" && versionInfo ? versionInfo : undefined}
                onNavigateVersion={message.role === "user" ? onNavigateVersion : undefined}
              />
              {/* Assistant regenerate navigator — BELOW the assistant bubble */}
              {message.role === "assistant" && versionInfo && (
                <VersionNavigator
                  current={versionInfo.current}
                  total={versionInfo.total}
                  onPrev={() => onNavigateVersion?.(versionInfo.parentId, 'prev')}
                  onNext={() => onNavigateVersion?.(versionInfo.parentId, 'next')}
                  align="left"
                />
              )}
              </div>
              );
            })}

            {isGenerating && !streamingMessage && (
              <div className="flex items-center gap-3 animate-fade-in pl-1">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}

            {streamingMessage && (
              <div>
                <MessageBubble
                  key={streamingMessage.id}
                  message={streamingMessage}
                  onCopy={() => onCopyPrompt(streamingMessage.id)}
                  onSave={() => onSavePrompt(streamingMessage.id)}
                  onFeedback={onFeedback}
                  isSaved={false}
                  avatarUrl={avatarUrl}
                />
              </div>
            )}

            {clarificationData && !isGenerating && onSubmitClarification && (
              <ClarificationCard
                questions={clarificationData.questions || []}
                isComplex={clarificationData.is_complex || false}
                suggestedSections={clarificationData.suggested_sections || []}
                onSubmit={onSubmitClarification}
                onSkip={() => onSubmitClarification({}, false)}
              />
            )}
          </div>
        </div>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 w-8 h-8 rounded-full
                       bg-background/90 backdrop-blur border border-border shadow-md
                       flex items-center justify-center
                       text-muted-foreground hover:text-foreground hover:bg-secondary
                       transition-all duration-150"
            aria-label="Scroll to bottom"
          >
            <ArrowDown size={16} weight="light" />
          </button>
        )}
      </div>

      {/* Docked input */}
      <div className="flex-shrink-0 px-6 pb-5 pt-3 bg-background">
        {inputBar}
      </div>

      {/* File preview modal */}
      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        allFiles={attachedFiles.map(f => ({ name: f.name, mimeType: f.mimeType, base64: f.base64, sizeBytes: f.sizeBytes }))}
      />
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
