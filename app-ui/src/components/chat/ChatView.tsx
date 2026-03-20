import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Sparkles, Mic, MicOff, Zap, AlertCircle, ChevronDown, Plus, WifiOff, Square, X, FileText, Image, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageBubble, Message } from "./MessageBubble";
import { FilePreviewModal, type PreviewFile } from "./FilePreviewModal";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PlusMenu } from "./PlusMenu";
import { SkillPicker } from "./SkillPicker";
import { VersionNavigator } from "./VersionNavigator";
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
  onRetryMessage?: (messageId: string) => void;
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
}

type VoiceState = "idle" | "listening" | "processing";

export const ChatView = ({
  messages, streamingMessage, generationStats,
  onSendMessage, onCopyPrompt, onSavePrompt, onFeedback,
  onEditMessage, onRetryMessage, onRegenerateMessage,
  savedPromptIds, isGenerating, isOnline = true, offlineChatUnavailable = false,
  onRetryLoad, sendError, onStopGeneration, avatarUrl,
  versionInfoMap, onNavigateVersion,
}: ChatViewProps) => {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"fast" | "thinking">("fast");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [showSlashPicker, setShowSlashPicker] = useState(false);
  // File preview modal — null = closed
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  // true = keep auto-scrolling to bottom; set to false the instant the user
  // wheels/touches upward; reset to true when a new message is sent.
  const shouldAutoScroll = useRef(true);
  // true when the current generation came from an edit/retry (not a new message)
  const isEditRetryRef = useRef(false);

  // ── Auto-resize textarea ────────────────────────────────────
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ── Scroll helper ────────────────────────────────────────────
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // ── Detect user-initiated scroll intent ─────────────────────
  // wheel / touch events are ONLY fired by the user, never by scrollTo().
  // This is the only reliable way to distinguish user scroll from programmatic.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // Scrolling up → stop auto-scroll
        shouldAutoScroll.current = false;
      } else {
        // Scrolling down — re-enable only when near the bottom
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 80) shouldAutoScroll.current = true;
      }
    };

    // Touch: track swipe direction
    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - touchStartY;
      if (dy > 0) {
        // Swiping down = scrolling up
        shouldAutoScroll.current = false;
      } else {
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 80) shouldAutoScroll.current = true;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  // ── Auto-scroll on new committed messages ───────────────────
  useEffect(() => {
    if (shouldAutoScroll.current) scrollToBottom("smooth");
  }, [messages, scrollToBottom]);

  // ── Force scroll to bottom when user sends a NEW message ────
  // Skipped for edit/retry so the user can still see earlier context.
  useEffect(() => {
    if (isGenerating) {
      if (!isEditRetryRef.current) {
        shouldAutoScroll.current = true;
        scrollToBottom("smooth");
      }
      isEditRetryRef.current = false; // reset after consuming
    }
  }, [isGenerating, scrollToBottom]);

  // ── Transcription IPC listeners ─────────────────────────────
  useEffect(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron) return;

    window.electronAPI?.transcription?.onTranscription?.((data) => {
      const text = (data.accumulated || data.text || "").trim();
      if (text) {
        setInput(text);
        if (data.type === "final") setVoiceState("idle");
      }
    });

    window.electronAPI?.transcription?.onStatus?.((status) => {
      if (status === "listening") { setVoiceState("listening"); setVoiceError(null); }
      else if (status === "processing") setVoiceState("processing");
      else if (status === "stopped") setVoiceState("idle");
    });

    window.electronAPI?.transcription?.onError?.((error) => {
      setVoiceState("idle");
      setVoiceError(error || "Transcription failed.");
      setTimeout(() => setVoiceError(null), 5000);
    });
  }, []);

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!input.trim() || isGenerating || !isOnline) return;
    onSendMessage(input.trim(), mode, attachedFiles, selectedSkill);
    setInput("");
    setShowSlashPicker(false);
    shouldAutoScroll.current = true;
    isEditRetryRef.current = false;
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
      window.electronAPI?.transcription?.stop?.();
      setVoiceState("processing");
    } else if (voiceState === "idle") {
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

  const modeLabel = mode === "fast" ? "Fast" : "Thinking";

  // ── Unified input bar (Claude style — textarea + bottom toolbar inside) ──
  const inputBar = (
    <div className="w-full max-w-4xl mx-auto">
      <div
        className={cn(
          "relative flex flex-col bg-surface border rounded-2xl transition-all overflow-hidden",
          isOnline
            ? "border-border focus-within:border-emerald/40 focus-within:shadow-[0_0_0_1px_hsl(var(--emerald)/0.1)]"
            : "border-amber-500/20"
        )}
      >
        {/* Offline pill — sits flush at the very top of the box */}
        {!isOnline && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-amber-500/15 bg-amber-500/5">
            <WifiOff className="w-3 h-3 text-amber-400/80 flex-shrink-0" />
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
                      <ZoomIn className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                    </div>
                  </button>
                      <button
                    type="button"
                    onClick={removeFile}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-background border border-border shadow flex items-center justify-center hover:bg-destructive hover:border-destructive hover:text-white transition-colors z-10"
                      >
                        <X className="h-2.5 w-2.5" />
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
                      <FileText className="h-4 w-4 text-red-400" />
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
                    <X className="h-2.5 w-2.5" />
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
            disabled={isGenerating || voiceState === "processing" || !isOnline}
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
              <Plus className="w-5 h-5" />
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

            {/* Model selector dropdown (inside the bar, like Claude) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={!isOnline}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
                >
                  {mode === "fast" ? (
                    <Zap className="w-3.5 h-3.5" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{modeLabel}</span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={8} className="w-60 bg-popover border-border shadow-elevated rounded-xl p-1">
                <DropdownMenuItem
                  onClick={() => setMode("fast")}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer",
                    mode === "fast" && "bg-secondary"
                  )}
                >
                  <Zap className="w-4 h-4 text-emerald mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Fast</p>
                    <p className="text-xs text-muted-foreground">Most efficient for everyday tasks</p>
                  </div>
                  {mode === "fast" && <span className="ml-auto text-emerald mt-0.5">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setMode("thinking")}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer",
                    mode === "thinking" && "bg-secondary"
                  )}
                >
                  <Sparkles className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Thinking</p>
                    <p className="text-xs text-muted-foreground">Think longer for complex tasks</p>
                  </div>
                  {mode === "thinking" && <span className="ml-auto text-blue-500 mt-0.5">✓</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Skill pill */}
            {selectedSkill && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-xs text-emerald-500 border border-emerald-500/20 ml-1">
                <Sparkles className="h-3 w-3" />
                <span className="capitalize">{selectedSkill}</span>
                <button
                  onClick={() => setSelectedSkill(null)}
                  className="hover:text-emerald-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Voice state indicators */}
            {voiceState === "listening" && (
              <div className="flex items-center gap-1.5 ml-1 animate-fade-in">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] text-red-400 font-medium">Listening…</span>
              </div>
            )}
            {voiceState === "processing" && (
              <div className="flex items-center gap-1.5 ml-1 animate-fade-in">
                <Loader2 className="w-3 h-3 animate-spin text-emerald" />
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
              {voiceState === "listening" ? <MicOff className="w-4 h-4" /> :
               voiceState === "processing" ? <Loader2 className="w-4 h-4 animate-spin" /> :
               <Mic className="w-4 h-4" />}
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
                <Square className="w-3 h-3 fill-current" />
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
          <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
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
              <WifiOff className="w-6 h-6 text-amber-400" />
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
        <div className="flex-1 flex flex-col items-center justify-center px-6 animate-fade-in-slow">
          <div className="w-full max-w-4xl mx-auto flex flex-col items-center gap-10">
            {/* Hero */}
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="relative inline-flex items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-emerald/10 flex items-center justify-center border border-emerald/20">
                  <Sparkles className="w-7 h-7 text-emerald" />
                </div>
                <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-background border border-border flex items-center justify-center">
                  <Zap className="w-2.5 h-2.5 text-emerald" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-[28px] font-bold text-gradient-primary tracking-tight leading-none">
                  Prompt Optimization Studio
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
      <div className="flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto scrollbar-none"
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

              return (
              <div key={message.id}>
              {/* User edit navigator — ABOVE the user bubble */}
              {message.role === "user" && versionInfo && (
                <VersionNavigator
                  current={versionInfo.current}
                  total={versionInfo.total}
                  onPrev={() => onNavigateVersion?.(versionInfo.parentId, 'prev')}
                  onNext={() => onNavigateVersion?.(versionInfo.parentId, 'next')}
                  align="right"
                />
              )}
              <MessageBubble
                message={message}
                onCopy={() => onCopyPrompt(message.id)}
                onSave={() => onSavePrompt(message.id)}
                onFeedback={onFeedback}
                isSaved={savedPromptIds.includes(message.id)}
                onEdit={message.role === "user" ? (id, content) => {
                  isEditRetryRef.current = true;
                  onEditMessage?.(id, content);
                } : undefined}
                onRetry={message.role === "user" ? (id) => {
                  isEditRetryRef.current = true;
                  onRetryMessage?.(id);
                } : undefined}
                onRegenerate={message.role === "assistant" ? onRegenerateMessage : undefined}
                isGenerating={isGenerating}
                fileContextCount={fileContextCount}
                avatarUrl={avatarUrl}
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
              <div ref={(el) => {
                // Scroll the streaming bubble into view, but ONLY if the user hasn't scrolled up
                if (el && shouldAutoScroll.current) {
                  el.scrollIntoView({ behavior: "instant", block: "end" });
                }
              }}>
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
          </div>
        </div>
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
