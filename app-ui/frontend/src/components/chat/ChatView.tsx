import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { MessageBubble, Message } from "./MessageBubble.tsx";
import { FeedbackWidget } from "./FeedbackWidget.tsx";

interface ChatViewProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  onCopyPrompt: (id: string) => void;
  onSavePrompt: (id: string) => void;
  savedPromptIds: string[];
  isGenerating: boolean;
}

export const ChatView = ({
  messages,
  onSendMessage,
  onCopyPrompt,
  onSavePrompt,
  savedPromptIds,
  isGenerating,
}: ChatViewProps) => {
  const [input, setInput] = useState("");
  const [dismissedFeedback, setDismissedFeedback] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = () => {
    if (!input.trim() || isGenerating) return;
    onSendMessage(input.trim());
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDismissFeedback = (messageId: string) => {
    setDismissedFeedback((prev) => new Set([...prev, messageId]));
  };

  const isEmpty = messages.length === 0;
  
  // Show feedback for assistant messages that aren't dismissed
  const shouldShowFeedback = (message: Message) => {
    return message.role === "assistant" && !dismissedFeedback.has(message.id);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Status bar */}
      <div className="h-12 border-b border-border flex items-center px-6 bg-surface/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald animate-pulse-subtle" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
            System Operational
          </span>
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
              {messages.map((message, index) => (
                <div key={message.id} className="space-y-3">
                  <MessageBubble
                    message={message}
                    onCopy={() => onCopyPrompt(message.id)}
                    onSave={() => onSavePrompt(message.id)}
                    isSaved={savedPromptIds.includes(message.id)}
                  />
                  
                  {/* Show feedback widget after assistant messages */}
                  {shouldShowFeedback(message) && index === messages.length - 1 && (
                    <div className="flex justify-start max-w-[80%]">
                      <FeedbackWidget
                        messageId={message.id}
                        onDismiss={() => handleDismissFeedback(message.id)}
                      />
                    </div>
                  )}
                </div>
              ))}
              {isGenerating && (
                <div className="flex items-center gap-2 text-muted-foreground animate-fade-in">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald" />
                  <span className="text-sm">Optimizing your prompt...</span>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Input area - Centered when empty */}
      <div className={`p-6 border-t border-border ${isEmpty ? 'flex items-center' : ''}`}>
        <div className="max-w-3xl mx-auto w-full">
          <div className="relative bg-surface rounded-xl border border-border focus-within:border-emerald/50 focus-within:glow-emerald transition-all">
            <div className="flex items-start gap-3 p-4">
              <Sparkles className="w-5 h-5 text-emerald mt-0.5 flex-shrink-0" />
              <Textarea
                ref={textareaRef}
                placeholder="Describe the prompt you need... (e.g., 'Create a technical documentation prompt for API endpoints')"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent border-0 p-0 resize-y focus-visible:ring-0 placeholder:text-muted-foreground/70 min-h-[24px] max-h-[300px]"
                rows={1}
                disabled={isGenerating}
                data-testid="chat-input-textarea"
              />
              <Button
                onClick={handleSubmit}
                disabled={!input.trim() || isGenerating}
                className="bg-emerald text-white hover:bg-emerald/90 active:scale-95 transition-button disabled:opacity-50 disabled:cursor-not-allowed px-6 glow-emerald"
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
          </div>
        </div>
      </div>
    </div>
  );
};
