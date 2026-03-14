import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Sparkles, Mic, MicOff, Zap, AlertCircle, ChevronDown, Plus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, Message } from "./MessageBubble";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatViewProps {
  messages: Message[];
  streamingMessage?: Message | null;
  generationStats?: { ttft: number | null; total: number | null };
  onSendMessage: (content: string, mode: "fast" | "thinking") => void;
  onCopyPrompt: (id: string) => void;
  onSavePrompt: (id: string) => void;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
  savedPromptIds: string[];
  isGenerating: boolean;
  isOnline?: boolean;
  offlineChatUnavailable?: boolean;
  onRetryLoad?: () => void;
  sendError?: string | null;
}

type VoiceState = "idle" | "listening" | "processing";

export const ChatView = ({
  messages, streamingMessage, generationStats,
  onSendMessage, onCopyPrompt, onSavePrompt, onFeedback,
  savedPromptIds, isGenerating, isOnline = true, offlineChatUnavailable = false,
  onRetryLoad, sendError,
}: ChatViewProps) => {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"fast" | "thinking">("fast");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Auto-resize textarea ────────────────────────────────────
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  // ── Scroll to bottom on new messages ────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
    onSendMessage(input.trim(), mode);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
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

  const isEmpty = messages.length === 0;
  const canSend = input.trim().length > 0 && !isGenerating && voiceState !== "processing" && isOnline;

  const modeLabel = mode === "fast" ? "Fast" : "Thinking";

  // ── Unified input bar (Claude style — textarea + bottom toolbar inside) ──
  const inputBar = (
    <div className="w-full max-w-2xl mx-auto">
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

        {/* Textarea area */}
        <textarea
          ref={textareaRef}
          placeholder={
            !isOnline
              ? "Messaging unavailable while offline…"
              : voiceState === "processing"
              ? "Transcribing your voice…"
              : isEmpty ? "How can I help you today?" : "Ask anything"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating || voiceState === "processing" || !isOnline}
          rows={2}
          className={cn(
            "w-full bg-transparent border-0 outline-none resize-none",
            "px-5 pt-4 pb-2 text-[14px] leading-relaxed text-foreground",
            "placeholder:text-muted-foreground/40",
            "disabled:opacity-40",
            "scrollbar-none"
          )}
          style={{ minHeight: "72px", maxHeight: "200px", overflow: input.split("\n").length > 6 ? "auto" : "hidden" }}
        />

        {/* Bottom toolbar inside the box (like Claude) */}
        <div className="flex items-center justify-between px-3 py-2.5">
          {/* Left side: plus button + model dropdown */}
          <div className="flex items-center gap-1">
            {/* Plus / attach */}
            <button
              type="button"
              disabled={!isOnline}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
              title="Attach"
            >
              <Plus className="w-5 h-5" />
            </button>

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

            {/* Send button (circular) */}
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
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              )}
            </button>
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
          <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-10">
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
      </div>
    );
  }

  // ── Conversation state ──────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onCopy={() => onCopyPrompt(message.id)}
                onSave={() => onSavePrompt(message.id)}
                onFeedback={onFeedback}
                isSaved={savedPromptIds.includes(message.id)}
              />
            ))}

            {isGenerating && !streamingMessage && (
              <div className="flex items-center gap-3 animate-fade-in pl-1">
                <div className="w-8 h-8 rounded-lg bg-emerald/10 border border-emerald/20 flex items-center justify-center flex-shrink-0">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald" />
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}

            {streamingMessage && (
              <MessageBubble
                key={streamingMessage.id}
                message={streamingMessage}
                onCopy={() => onCopyPrompt(streamingMessage.id)}
                onSave={() => onSavePrompt(streamingMessage.id)}
                onFeedback={onFeedback}
                isSaved={false}
              />
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Docked input */}
      <div className="flex-shrink-0 px-6 pb-5 pt-3 bg-background">
        {inputBar}
      </div>
    </div>
  );
};
