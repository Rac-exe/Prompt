import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Sparkles, Mic, MicOff, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, Message } from "./MessageBubble";
import { cn } from "@/lib/utils";

interface ChatViewProps {
  messages: Message[];
  streamingMessage?: Message | null;
  generationStats?: { ttft: number | null; total: number | null };
  onSendMessage: (content: string) => void;
  onCopyPrompt: (id: string) => void;
  onSavePrompt: (id: string) => void;
  onFeedback?: (messageId: string, rating: "positive" | "negative") => void;
  savedPromptIds: string[];
  isGenerating: boolean;
}

export const ChatView = ({
  messages, streamingMessage, generationStats,
  onSendMessage, onCopyPrompt, onSavePrompt, onFeedback,
  savedPromptIds, isGenerating,
}: ChatViewProps) => {
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transcriptionSetup = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron || transcriptionSetup.current) return;
    transcriptionSetup.current = true;

    window.electronAPI?.transcription?.onTranscription?.((data: { text: string; accumulated: string; type: string }) => {
      if (data.accumulated || data.text) setInput(data.accumulated || data.text);
    });
    window.electronAPI?.transcription?.onError?.((error: string) => {
      console.error('[Voice] Transcription error:', error);
      setIsListening(false);
    });
  }, []);

  const handleSubmit = () => {
    if (!input.trim() || isGenerating) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleVoice = useCallback(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron) return;
    if (isListening) {
      window.electronAPI?.transcription?.stop?.();
      setIsListening(false);
    } else {
      window.electronAPI?.transcription?.start?.(Date.now().toString());
      setIsListening(true);
    }
  }, [isListening]);

  const isEmpty = messages.length === 0;

  /* ── Shared input box ─────────────────────────────────────
     Rendered in both the centered empty state and the
     bottom-docked conversation state.
  ────────────────────────────────────────────────────────── */
  const inputBox = (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={cn(
          "relative bg-surface border border-border rounded-2xl overflow-hidden shadow-card transition-smooth",
          "focus-within:border-emerald/50 focus-within:shadow-[0_0_0_1px_hsl(var(--emerald)/0.15),0_0_16px_hsl(var(--emerald)/0.12)]"
        )}
      >
        {/* ── Textarea — fixed height, no resize ── */}
        <Textarea
          ref={textareaRef}
          placeholder="What do you want to generate?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isGenerating}
          className={cn(
            "w-full bg-transparent border-0 rounded-none",
            "px-4 pt-4 pb-14",
            // Fixed height — no resize handle, no min/max gymnastics
            "h-[120px] resize-none overflow-y-auto",
            "focus-visible:ring-0 focus-visible:outline-none",
            "placeholder:text-muted-foreground/45 text-foreground text-[13.5px] leading-relaxed"
          )}
        />

        {/* ── Bottom toolbar ── */}
        <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-3 py-2.5 border-t border-border/60 bg-surface">
          {/* Voice */}
          <button
            type="button"
            onClick={toggleVoice}
            disabled={isGenerating}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12px] font-medium transition-smooth",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              isListening
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent"
            )}
            title={isListening ? "Stop listening" : "Voice input"}
          >
            {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            <span>{isListening ? "Stop" : "Voice"}</span>
          </button>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {isListening && (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] text-red-400 font-medium">Listening</span>
              </div>
            )}
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || isGenerating}
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

      {/* Keyboard hint */}
      <p className="text-[11px] text-muted-foreground/30 text-center mt-2.5 select-none">
        Shift + Enter for new line · Enter to generate
      </p>
    </div>
  );

  /* ── Empty state — fully centred ─────────────────────────── */
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

              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  'Technical documentation',
                  'Creative writing assistant',
                  'Code review prompt',
                  'Data analysis template',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(`Create a ${suggestion.toLowerCase()}`)}
                    className="px-3 py-1.5 rounded-full text-[12px] font-medium bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-emerald/35 hover:bg-sidebar-accent transition-smooth"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {/* Input — sits directly below hero, everything centred together */}
            {inputBox}
          </div>
        </div>
      </div>
    );
  }

  /* ── Conversation state ───────────────────────────────────── */
  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* Messages */}
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
