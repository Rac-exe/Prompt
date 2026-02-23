import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Sparkles, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, Message } from "./MessageBubble";

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
  messages,
  streamingMessage,
  generationStats,
  onSendMessage,
  onCopyPrompt,
  onSavePrompt,
  onFeedback,
  savedPromptIds,
  isGenerating,
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

  // Set up transcription listener once
  useEffect(() => {
    const isElectron = !!(window as any).electronAPI;
    if (!isElectron || transcriptionSetup.current) return;
    transcriptionSetup.current = true;

    window.electronAPI?.transcription?.onTranscription?.((data: { text: string; accumulated: string; type: string }) => {
      if (data.accumulated || data.text) {
        setInput(data.accumulated || data.text);
      }
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
      // Stop
      window.electronAPI?.transcription?.stop?.();
      setIsListening(false);
    } else {
      // Start
      const sessionId = Date.now().toString();
      window.electronAPI?.transcription?.start?.(sessionId);
      setIsListening(true);
    }
  }, [isListening]);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Status bar */}
      <div className="h-12 border-b border-border flex items-center px-6 bg-surface/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald animate-pulse-subtle" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
            System Operational
          </span>
          {generationStats && (generationStats.ttft || generationStats.total) && (
            <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground/70 font-mono">
              {generationStats.ttft && <span>TTFT: {generationStats.ttft}ms</span>}
              {generationStats.total && <span>Total: {generationStats.total}ms</span>}
            </div>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 animate-fade-in">
            <div className="text-center max-w-xl">
              <div className="mb-6 inline-block">
                <Sparkles className="w-16 h-16 text-emerald animate-pulse-subtle" />
              </div>
              <h2 className="text-4xl md:text-5xl font-bold text-gradient-primary mb-4">
                Prompt Optimization Studio
              </h2>
              <p className="text-muted-foreground text-lg">
                Transform your ideas into precisely engineered prompts.
                <br />
                Built for clarity, optimized for results.
              </p>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full" ref={scrollRef}>
            <div className="max-w-3xl mx-auto py-6 px-6 space-y-6">
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

              {isGenerating && (
                <div className="flex items-center gap-2 text-muted-foreground animate-fade-in">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald" />
                  <span className="text-sm">Optimizing your prompt...</span>
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
        )}
      </div>

      {/* Input area - Centered when empty */}
      <div className={`p-6 border-t border-border ${isEmpty ? 'flex items-center' : ''}`}>
        <div className="max-w-3xl mx-auto w-full">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <Textarea
                ref={textareaRef}
                placeholder="Describe the prompt you need... (e.g., 'Create a technical documentation prompt for API endpoints')"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-surface border border-border rounded-xl p-4 pr-14 resize-y focus-visible:border-emerald/50 focus-visible:glow-emerald placeholder:text-muted-foreground/70 min-h-[60px] max-h-[300px] transition-all"
                disabled={isGenerating}
              />
              {/* Voice button inside textarea */}
              <button
                type="button"
                onClick={toggleVoice}
                disabled={isGenerating}
                className={`absolute right-3 bottom-3 z-10 w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed border ${
                  isListening
                    ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25 border-red-500/30 animate-pulse'
                    : 'bg-surface border-border text-muted-foreground hover:bg-muted hover:text-foreground hover:border-emerald/30'
                }`}
                title={isListening ? 'Stop listening' : 'Voice input'}
              >
                {isListening ? (
                  <MicOff className="w-[18px] h-[18px]" />
                ) : (
                  <Mic className="w-[18px] h-[18px]" />
                )}
              </button>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || isGenerating}
              className="bg-emerald text-white hover:bg-emerald/90 active:scale-95 transition-button disabled:opacity-50 disabled:cursor-not-allowed h-[60px] px-6 glow-emerald flex-shrink-0"
              data-testid="generate-prompt-button"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Generate
                  <Send className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </div>
          {/* Voice status indicator */}
          {isListening && (
            <div className="flex items-center gap-2 mt-2 animate-fade-in">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-400 font-medium">Listening — click mic to stop</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
