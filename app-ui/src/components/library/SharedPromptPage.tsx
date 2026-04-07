import { useState, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { Copy, Check, ArrowLeft, CircleNotch, FileText, User, CalendarBlank } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SharedPromptData {
  id: string;
  title: string;
  content: string;
  share_token: string;
  owner_name: string;
  owner_id: string;
  created_at: string;
}

interface SharedPromptPageProps {
  token: string;
  onBack?: () => void;
}

const isElectron = typeof window !== "undefined" && window.electronAPI;

export const SharedPromptPage = ({ token, onBack }: SharedPromptPageProps) => {
  const [prompt, setPrompt] = useState<SharedPromptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Loading shared prompt view",
      level: "info",
      data: { tokenLength: token.length },
    });
    setLoading(true);
    setLoadError(null);

    const req =
      isElectron && window.electronAPI?.promptLibrary?.getSharedPrompt
        ? window.electronAPI.promptLibrary.getSharedPrompt(token)
        : Promise.reject(new Error("Electron API not available"));

    req
      .then((data: SharedPromptData) => setPrompt(data))
      .catch((err: any) => {
        console.error("[SharedPromptPage] Failed to load:", err);
        Sentry.captureException(err, {
          tags: { component: "shared-prompt-page", action: "load" },
          extra: { tokenLength: token.length },
        });
        setLoadError(err?.message || "Failed to load the shared prompt.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleCopy = () => {
    if (!prompt) return;
    navigator.clipboard.writeText(prompt.content);
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Shared prompt copied",
      level: "info",
      data: { promptId: prompt.id },
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied!", description: "Prompt copied to clipboard." });
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <CircleNotch size={32} weight="light" className="animate-spin text-emerald" />
          <p className="text-sm">Loading shared prompt…</p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (loadError || !prompt) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center max-w-xs">
          <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
            <FileText size={24} weight="light" className="text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-foreground">Prompt not found</p>
          <p className="text-xs text-muted-foreground">
            {loadError || "This share link may be invalid or the prompt was removed."}
          </p>
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack} className="mt-2">
              <ArrowLeft size={14} weight="light" className="mr-2" />
              Go back
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-background min-w-0">
      {/* Header */}
      <div className="px-6 py-5 border-b border-border bg-surface/30 flex-shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-smooth"
          >
            <ArrowLeft size={14} weight="light" />
            Back
          </button>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* Creator attribution */}
            <div className="flex items-center gap-1.5 text-[11px] text-emerald font-medium mb-1.5">
              <User size={12} weight="light" />
              <span>Shared by {prompt.owner_name}</span>
            </div>

            <h1 className="text-xl font-bold text-foreground tracking-tight truncate flex items-center gap-2">
              <FileText size={20} weight="light" className="text-emerald flex-shrink-0" />
              {prompt.title}
            </h1>

            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 mt-1.5">
              <CalendarBlank size={12} weight="light" />
              <span>Created {new Date(prompt.created_at).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Copy button */}
          <Button
            onClick={handleCopy}
            className={cn(
              "flex-shrink-0 gap-2 text-sm font-semibold transition-smooth",
              copied
                ? "bg-emerald/10 text-emerald border border-emerald/30 hover:bg-emerald/10"
                : "border border-input text-foreground hover:bg-muted"
            )}
          >
            {copied ? (
              <>
                <Check size={16} weight="light" />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} weight="light" />
                Copy Prompt
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Prompt content */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          <div className="bg-surface border border-border rounded-xl p-5">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {prompt.content}
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
