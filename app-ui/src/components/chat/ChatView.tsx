import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Sparkles, Mic, MicOff, Zap, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, Message } from "./MessageBubble";
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
}

// Voice states:
//   idle        — mic is off
//   listening   — mic is active, audio is being captured
//   processing  — mic stopped, Whisper is still running
type VoiceState = "idle" | "listening" | "processing";

export const ChatView = ({
  messages, streamingMessage, generationStats,
  onSendMessage, onCopyPrompt, onSavePrompt, onFeedback,
  savedPromptIds, isGenerating,
}: ChatViewProps) => {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"fast" | "thinking">("fast");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Scroll to bottom on new messages ──────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ── Transcription IPC listeners ───────────────────────────────
  // Re-register on every mount so listeners are always fresh.
  // IPC channels use ipcRenderer.on which stacks listeners, so
  // the preload always pushes to the latest closure.
  useEffect(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron) return;

    console.log('[ChatView] Registering transcription listeners');

    window.electronAPI?.transcription?.onTranscription?.((data) => {
      console.log(`[ChatView] onTranscription — type=${data.type} text="${data.text}" accumulated="${data.accumulated}"`);
      const text = (data.accumulated || data.text || "").trim();
      if (text) {
        setInput(text);
        // Final result received — return to idle
        if (data.type === "final") {
          console.log('[ChatView] Final transcription received — going idle');
          setVoiceState("idle");
        }
      }
    });

    // Status messages from Python: 'listening' | 'processing' | 'stopped'
    window.electronAPI?.transcription?.onStatus?.((status) => {
      console.log(`[ChatView] onStatus — ${status}`);
      if (status === "listening") {
        setVoiceState("listening");
        setVoiceError(null);
      } else if (status === "processing") {
        setVoiceState("processing");
      } else if (status === "stopped") {
        // 'stopped' arrives after 'final' — make sure we're idle
        setVoiceState("idle");
      }
    });

    window.electronAPI?.transcription?.onError?.((error) => {
      console.error('[ChatView] Transcription error:', error);
      setVoiceState("idle");
      setVoiceError(error || "Transcription failed. Please try again.");
      // Auto-clear the error after 5 s
      setTimeout(() => setVoiceError(null), 5000);
    });
  }, []);

  // ── Submit ─────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!input.trim() || isGenerating) return;
    onSendMessage(input.trim(), mode);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ── Voice toggle ───────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron) return;

    if (voiceState === "listening") {
      console.log('[ChatView] Stopping voice input');
      window.electronAPI?.transcription?.stop?.();
      // UI immediately shows "processing" — the server confirms it
      setVoiceState("processing");
    } else if (voiceState === "idle") {
      console.log('[ChatView] Starting voice input');
      setVoiceError(null);
      const sessionId = Date.now().toString();
      window.electronAPI?.transcription?.start?.(sessionId);
      // Server will send status:listening to confirm
    }
    // If processing, ignore click — we're waiting for the result
  }, [voiceState]);

  const isEmpty = messages.length === 0;

  // ── Voice button appearance ────────────────────────────────────
  const voiceButtonContent = () => {
    if (voiceState === "listening") {
      return (
        <>
          <MicOff className="w-3.5 h-3.5" />
          <span>Stop</span>
        </>
      );
    }
    if (voiceState === "processing") {
      return (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Processing…</span>
        </>
      );
    }
    return (
      <>
        <Mic className="w-3.5 h-3.5" />
        <span>Voice</span>
      </>
    );
  };

  const voiceButtonClass = cn(
    "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium transition-smooth",
    "disabled:opacity-40 disabled:cursor-not-allowed",
    voiceState === "listening"
      ? "bg-red-500/10 text-red-400 border border-red-500/20"
      : voiceState === "processing"
        ? "bg-emerald/8 text-emerald border border-emerald/20 cursor-not-allowed"
        : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
  );

  // ── Shared input box ───────────────────────────────────────────
  const inputBox = (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={cn(
          "relative bg-surface border border-border rounded-2xl overflow-hidden shadow-card transition-smooth",
          "focus-within:border-emerald/50 focus-within:shadow-[0_0_0_1px_hsl(var(--emerald)/0.15),0_0_16px_hsl(var(--emerald)/0.12)]"
        )}
      >
        {/* Textarea */}
        <Textarea
          ref={textareaRef}
          placeholder={
            voiceState === "processing"
              ? "Transcribing your voice…"
              : "What do you want to generate?"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating || voiceState === "processing"}
          className={cn(
            "w-full bg-transparent border-0 rounded-none",
            "px-4 pt-4 pb-14",
            "h-[120px] resize-none overflow-y-auto",
            "focus-visible:ring-0 focus-visible:outline-none",
            "placeholder:text-muted-foreground/45 text-foreground text-[13.5px] leading-relaxed",
            voiceState === "processing" && "opacity-60"
          )}
        />

        {/* Bottom toolbar */}
        <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-3 py-2.5 border-t border-border/60 bg-surface">
          {/* Voice button */}
          <button
            type="button"
            onClick={toggleVoice}
            disabled={isGenerating || voiceState === "processing"}
            className={voiceButtonClass}
            title={
              voiceState === "listening" ? "Stop recording"
                : voiceState === "processing" ? "Processing transcription…"
                  : "Voice input"
            }
          >
            {voiceButtonContent()}
          </button>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Mode Toggle */}
            <div className="flex bg-secondary/30 rounded-lg p-0.5 border border-border/40 mr-1">
              <button
                type="button"
                onClick={() => setMode("fast")}
                className={cn(
                  "px-2.5 py-[3px] text-[11px] font-medium rounded-md transition-all",
                  mode === "fast"
                    ? "bg-emerald text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                )}
                title="Fast Mode: Optimize immediately with adaptive templates"
              >
                Fast
              </button>
              <button
                type="button"
                onClick={() => setMode("thinking")}
                className={cn(
                  "px-2.5 py-[3px] text-[11px] font-medium rounded-md transition-all flex items-center gap-1",
                  mode === "thinking"
                    ? "bg-blue-500 text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                )}
                title="Thinking Mode: Deeper reasoning, summarization, and task orchestration"
              >
                <Sparkles className="w-2.5 h-2.5" />
                Thinking
              </button>
            </div>

            {/* Listening pulse indicator */}
            {voiceState === "listening" && (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] text-red-400 font-medium">Listening</span>
              </div>
            )}

            {/* Processing indicator */}
            {voiceState === "processing" && (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <Loader2 className="w-3 h-3 animate-spin text-emerald" />
                <span className="text-[11px] text-emerald font-medium">Transcribing…</span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || isGenerating || voiceState === "processing"}
              size="sm"
              className={cn(
                "h-7 px-3.5 bg-emerald hover:bg-emerald/90 text-white text-[12px] font-semibold",
                "rounded-lg transition-smooth",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
                "shadow-[0_0_0_1px_hsl(var(--emerald)/0.2),0_0_10px_hsl(var(--emerald)/0.15)]",
                "hover:shadow-[0_0_0_1px_hsl(var(--emerald)/0.3),0_0_16px_hsl(var(--emerald)/0.25)]"
              )}
              data-testid="generate-prompt-button"
            >
              {isGenerating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span className="flex items-center gap-1.5">
                  Generate
                  <Send className="w-3 h-3" />
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {voiceError && (
        <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20 animate-slide-up">
          <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
          <span className="text-[12px] text-destructive leading-snug">{voiceError}</span>
        </div>
      )}

    </div>
  );

  // ── Empty state ────────────────────────────────────────────────
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

              <div className="flex flex-wrap gap-2 justify-center" />
            </div>

            {inputBox}
          </div>
        </div>
      </div>
    );
  }

  // ── Conversation state ─────────────────────────────────────────
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
      <div className="flex-shrink-0 px-6 pb-5 pt-4 bg-background">
        {inputBox}
      </div>
    </div>
  );
};
