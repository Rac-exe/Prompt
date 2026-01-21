import { useState, useCallback, useEffect, useRef } from "react";
import {
  X,
  Pencil,
  Copy,
  Mic,
  Sparkles,
  RefreshCw,
  ArrowLeftRight,
  Check,
} from "lucide-react";
import BrandLogo from "./BrandLogo";
import { toast } from "sonner";

const QuickOptimize = () => {
  // -----------------------------
  // UI STATE
  // -----------------------------
  const [inputPrompt, setInputPrompt] = useState("");
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [status, setStatus] = useState<"idle" | "ready" | "optimizing">("idle");
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [copiedInput, setCopiedInput] = useState(false);

  // NEW: State management for panel visibility
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // -----------------------------
  // ELECTRON IPC INTEGRATION
  // -----------------------------
  useEffect(() => {
    // Check if running in Electron environment
    if (typeof window !== 'undefined' && window.electronAPI) {

      // NEW: Listen for expand-to-input event from main process
      window.electronAPI.onExpandToInput(() => {
        console.log("[Renderer] Received expand-to-input event");
        setIsPanelExpanded(true);
        setStatus("idle");
        setInputPrompt(""); // Clear any previous input
        setOptimizedPrompt(""); // Clear previous optimized text
      });

      // NEW: Listen for focus-input event from main process
      window.electronAPI.onFocusInput(() => {
        console.log("[Renderer] Received focus-input event");
        // Focus the input field
        if (inputRef.current) {
          inputRef.current.focus();
        }
      });

      // NEW: Listen for ESC key to dismiss panel
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          console.log("[Renderer] ESC pressed - dismissing panel");
          dismissPanel();
        }
      };

      document.addEventListener('keydown', handleKeyDown);

      // Cleanup
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, []);

  // -----------------------------
  // NEW: DISMISS PANEL
  // -----------------------------
  const dismissPanel = useCallback(() => {
    if (window.electronAPI) {
      window.electronAPI.send('floating-panel:dismiss', {});
      // Reset state
      setInputPrompt("");
      setOptimizedPrompt("");
      setStatus("idle");
      setIsPanelExpanded(false);
    }
  }, []);

  // -----------------------------
  // MAIN ACTION: OPTIMIZE PROMPT
  // -----------------------------
  const optimizePrompt = useCallback(async () => {
    if (!inputPrompt.trim()) {
      toast.error("Please enter a prompt first");
      return;
    }

    setIsOptimizing(true);
    setStatus("optimizing");
    setOptimizedPrompt("");

    try {
      // NEW: Send prompt to main process for optimization
      // Main process will call triggerManualOptimization()
      if (window.electronAPI) {
        // Send prompt-submit event (existing handler in floating-panel.ts)
        window.electronAPI.send('floating-panel:prompt-submit', inputPrompt);

        // NOTE: The optimization result will be returned via optimization-completed event
        // For now, we'll use a mock response. You'll need to add a listener for the result.

        // TEMPORARY: Mock optimization for demo
        // In production, you'd listen for an event from main process with the result
        setTimeout(() => {
          // This is where you'd receive the optimized text from main process
          // For now, using placeholder
          const mockOptimized = `[Optimized] ${inputPrompt}`;
          setOptimizedPrompt(mockOptimized);
          setStatus("ready");
          setIsOptimizing(false);
          toast.success("Prompt optimized!");
        }, 2000);
      } else {
        // Fallback for non-Electron environment
        throw new Error("Electron API not available");
      }
    } catch (error) {
      toast.error("Optimization failed");
      setStatus("idle");
      setIsOptimizing(false);
    }
  }, [inputPrompt]);

  // -----------------------------
  // CLIPBOARD (UI ONLY)
  // -----------------------------
  const copyToClipboard = async (text: string, type: "input" | "output") => {
    if (window.electronAPI) {
      // Use Electron clipboard API
      window.electronAPI.send('copy-to-clipboard', text);
    } else {
      // Fallback to web clipboard API
      await navigator.clipboard.writeText(text);
    }

    if (type === "output") {
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
    } else {
      setCopiedInput(true);
      setTimeout(() => setCopiedInput(false), 2000);
    }

    toast.success("Copied to clipboard!");
  };

  // -----------------------------
  // NEW: REPLACE ORIGINAL (@prompt → optimized text)
  // This is the key function that triggers text replacement in the original window
  // -----------------------------
  const replaceOriginal = () => {
    if (!optimizedPrompt) return;

    console.log("[Renderer] Replace Original clicked");

    if (window.electronAPI) {
      // NEW: Send floating-panel:replace-text event to main process
      window.electronAPI.send('floating-panel:replace-text', {
        optimizedText: optimizedPrompt
      });

      // The main process will:
      // 1. Hide the floating panel
      // 2. Restore focus to original window (ChatGPT/Notepad)
      // 3. Delete @prompt (7 backspaces)
      // 4. Paste optimized text (Ctrl+V)

      toast.success("Text replacement in progress...");

      // Reset state after sending
      setInputPrompt("");
      setOptimizedPrompt("");
      setStatus("idle");
    } else {
      // Fallback: just update local state (non-Electron environment)
      setInputPrompt(optimizedPrompt);
      setOptimizedPrompt("");
      setStatus("idle");
      toast.success("Original prompt replaced!");
    }
  };

  // -----------------------------
  // RENDER
  // -----------------------------
  return (
    <div className="glass-panel bg-obsidian-glass w-full max-w-[460px] rounded-2xl flex flex-col overflow-hidden silver-edge">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <BrandLogo />
          <h1 className="text-foreground text-lg font-bold tracking-tight">
            Quick Optimize
          </h1>
        </div>
        <button
          onClick={dismissPanel}
          className="text-white/30 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="p-6 space-y-8">
        {/* Input */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-white/40 text-[10px] font-bold tracking-[0.2em] uppercase">
              Your Prompt
            </h3>
            <div className="flex items-center gap-2">
              <button className="text-white/30 hover:text-white">
                <Pencil className="w-[18px] h-[18px]" />
              </button>
              <button
                onClick={() => copyToClipboard(inputPrompt, "input")}
                className="text-white/30 hover:text-white"
                disabled={!inputPrompt}
              >
                {copiedInput ? (
                  <Check className="w-[18px] h-[18px] text-green-400" />
                ) : (
                  <Copy className="w-[18px] h-[18px]" />
                )}
              </button>
            </div>
          </div>

          <div className="relative">
            <textarea
              ref={inputRef}
              className="w-full input-area rounded-xl p-5 pb-12 text-white/90 text-sm resize-none min-h-[110px] bg-transparent focus:outline-none focus:ring-1 focus:ring-white/20"
              placeholder="Type your prompt to optimize..."
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={(e) => {
                // Submit on Ctrl+Enter or Cmd+Enter
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  optimizePrompt();
                }
              }}
            />
            <button className="absolute bottom-4 right-4 p-2 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white">
              <Mic className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={optimizePrompt}
          disabled={isOptimizing || !inputPrompt.trim()}
          className="w-full h-12 btn-silver rounded-xl flex items-center justify-center gap-2 border border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles className={`w-5 h-5 ${isOptimizing ? "animate-spin" : ""}`} />
          <span className="text-sm font-bold tracking-wide uppercase">
            {isOptimizing ? "Optimizing..." : "Generate"}
          </span>
        </button>

        {/* Output */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-bold tracking-[0.2em] uppercase text-white">
              Optimized Prompt
            </h3>
            <div className="flex items-center gap-1.5">
              <span
                className={`size-1.5 rounded-full ${
                  status === "ready"
                    ? "bg-white animate-pulse"
                    : status === "optimizing"
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-white/30"
                }`}
              />
              <span className="text-white/30 text-[10px]">
                {status === "ready"
                  ? "Ready"
                  : status === "optimizing"
                  ? "Processing..."
                  : "Waiting"}
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-5 min-h-[150px] flex flex-col justify-between">
            <p className="text-white text-sm leading-relaxed font-light">
              {isOptimizing ? (
                <span className="italic text-white/40">
                  Optimizing your prompt...
                </span>
              ) : optimizedPrompt ? (
                optimizedPrompt
              ) : (
                <span className="italic text-white/20">
                  Click the sparkle button to optimize your prompt
                </span>
              )}
            </p>
            <div className="flex justify-end pt-4">
              {optimizedPrompt && (
                <span className="text-[9px] text-white/20 font-medium uppercase tracking-wider">
                  Enhanced for Production
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 pb-8 pt-2">
        <div className="flex gap-3">
          <button
            onClick={optimizePrompt}
            disabled={!inputPrompt.trim() || isOptimizing}
            className="flex-1 h-12 btn-ghost rounded-xl flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Re-optimize the prompt"
          >
            <RefreshCw className="w-5 h-5" />
            <span className="text-xs font-semibold">Retry</span>
          </button>

          <button
            onClick={() => copyToClipboard(optimizedPrompt, "output")}
            disabled={!optimizedPrompt}
            className="flex-1 h-12 btn-ghost rounded-xl flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Copy optimized prompt to clipboard"
          >
            {copiedOutput ? (
              <Check className="w-5 h-5 text-green-400" />
            ) : (
              <Copy className="w-5 h-5" />
            )}
            <span className="text-xs font-semibold">Copy</span>
          </button>

          <button
            onClick={replaceOriginal}
            disabled={!optimizedPrompt}
            className="flex-[1.6] h-12 btn-silver rounded-xl flex items-center justify-center gap-2 border border-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Replace @prompt with optimized text in original window"
          >
            <ArrowLeftRight className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-wider">
              Replace Original
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default QuickOptimize;
