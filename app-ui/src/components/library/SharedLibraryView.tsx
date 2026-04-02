import { useState, useEffect, useCallback } from "react";
import * as Sentry from "@sentry/react";
import {
  User,
  Books,
  Copy,
  Check,
  BookmarkSimple,
  ArrowLeft,
  CircleNotch,
  CalendarBlank,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SharedPrompt {
  id: string;
  title: string;
  content: string;
  collection_id: string;
  created_at: string;
}

interface SharedLibraryData {
  id: string;
  name: string;
  icon?: string;
  share_token: string;
  owner_name: string;
  owner_id: string;
  prompts: SharedPrompt[];
}

interface SharedLibraryViewProps {
  /** The share token extracted from the URL/route */
  token: string;
  /** Called when the user navigates back */
  onBack?: () => void;
  /** Called after successfully saving the library — receives the new collection id */
  onSaved?: (collectionId: string) => void;
}

const isElectron = typeof window !== "undefined" && window.electronAPI;

// ── Small read-only prompt row ────────────────────────────────────────────────
const SharedPromptRow = ({ prompt }: { prompt: SharedPrompt }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied!", description: "Prompt copied to clipboard." });
  };

  return (
    <div className="group bg-surface border border-border rounded-xl p-4 transition-smooth animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-[13px] font-semibold text-foreground line-clamp-1 flex-1 min-w-0 leading-snug">
          {prompt.title}
        </h4>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6 rounded-md flex-shrink-0 opacity-0 group-hover:opacity-100 transition-smooth",
            copied ? "text-emerald" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          )}
          onClick={handleCopy}
        >
          {copied ? <Check size={12} weight="light" /> : <Copy size={12} weight="light" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">
        {prompt.content}
      </p>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
        <CalendarBlank size={10} weight="light" />
        <span>{new Date(prompt.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const SharedLibraryView = ({ token, onBack, onSaved }: SharedLibraryViewProps) => {
  const [library, setLibrary] = useState<SharedLibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Fetch shared library ──────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Loading shared library view",
      level: "info",
      data: { tokenLength: token.length },
    });
    setLoading(true);
    setLoadError(null);

    const fetch = isElectron
      ? window.electronAPI.promptLibrary.getSharedCollection(token)
      : Promise.reject(new Error("Electron API not available"));

    fetch
      .then((data: SharedLibraryData) => setLibrary(data))
      .catch((err: any) => {
        console.error("[SharedLibraryView] Failed to load:", err);
        Sentry.captureException(err, {
          tags: { component: "shared-library-view", action: "load" },
          extra: { tokenLength: token.length },
        });
        setLoadError(err?.message || "Failed to load the shared library.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  // ── Save / fork library ───────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!library || saving || saved) return;
    setSaving(true);

    try {
      let result: { collection: any; alreadyExisted: boolean };

      if (isElectron && window.electronAPI?.promptLibrary?.saveSharedCollection) {
        result = await window.electronAPI.promptLibrary.saveSharedCollection(library.id);
      } else {
        throw new Error("Electron API not available");
      }

      Sentry.addBreadcrumb({
        category: "sharing",
        message: "Shared library saved by recipient",
        level: "info",
        data: { libraryId: library.id, alreadyExisted: result.alreadyExisted },
      });
      setSaved(true);
      toast({
        title: result.alreadyExisted ? "Already saved" : "Library saved!",
        description: result.alreadyExisted
          ? "You already have a copy. Redirecting…"
          : "Library saved. You can now edit and add prompts.",
      });

      onSaved?.(result.collection.id);
    } catch (err: any) {
      console.error("[SharedLibraryView] Save error:", err);
      Sentry.captureException(err, {
        tags: { component: "shared-library-view", action: "save" },
        extra: { libraryId: library?.id || "unknown" },
      });
      toast({
        title: "Error",
        description: err?.message || "Failed to save the library.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [library, saving, saved, onSaved]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <CircleNotch size={32} weight="light" className="animate-spin text-emerald" />
          <p className="text-sm">Loading shared library…</p>
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (loadError || !library) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center max-w-xs">
          <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
            <Books size={24} weight="light" className="text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-foreground">Library not found</p>
          <p className="text-xs text-muted-foreground">
            {loadError || "This share link may be invalid or the library was removed."}
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

  // ── Main view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-background min-w-0">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border bg-surface/30 flex-shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-smooth"
          >
            <ArrowLeft size={14} weight="light" />
            Back to Library
          </button>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* Creator attribution — always shown */}
            <div className="flex items-center gap-1.5 text-[11px] text-emerald font-medium mb-1.5">
              <User size={12} weight="light" />
              <span>Library created by {library.owner_name}</span>
            </div>

            <h1 className="text-xl font-bold text-foreground tracking-tight truncate">
              {library.name}
            </h1>

            <p className="text-xs text-muted-foreground mt-1">
              {library.prompts.length} prompt{library.prompts.length !== 1 ? "s" : ""} · Read-only view
            </p>
          </div>

          {/* Save button (Task 3 & 8) */}
          <Button
            onClick={handleSave}
            disabled={saving || saved}
            className={cn(
              "flex-shrink-0 gap-2 text-sm font-semibold transition-smooth",
              saved
                ? "bg-emerald/10 text-emerald border border-emerald/30 hover:bg-emerald/10 cursor-default"
                : "bg-emerald text-white hover:bg-emerald/90"
            )}
          >
            {saving ? (
              <>
                <CircleNotch size={16} weight="light" className="animate-spin" />
                Saving…
              </>
            ) : saved ? (
              <>
                <BookmarkSimple size={16} weight="fill" />
                Saved ✓
              </>
            ) : (
              <>
                <BookmarkSimple size={16} weight="light" />
                Save Library
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Prompt list ────────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="p-6">
          {library.prompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
              <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
                <Books size={24} weight="light" className="text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No prompts yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                This library doesn't have any prompts yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {library.prompts.map((prompt) => (
                <SharedPromptRow key={prompt.id} prompt={prompt} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
