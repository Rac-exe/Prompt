import { useState, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { Share2, Link as LinkIcon, Check, Loader2, Globe } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

interface SharePromptLinkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: { id: string; title: string };
}

const isElectron = typeof window !== "undefined" && window.electronAPI;

export const SharePromptLinkModal = ({
  open,
  onOpenChange,
  prompt,
}: SharePromptLinkModalProps) => {
  const [webUrl, setWebUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate / fetch share link when modal opens
  useEffect(() => {
    if (!open || !prompt.id) return;
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Share prompt modal opened",
      level: "info",
      data: { promptId: prompt.id },
    });
    setLoading(true);
    setWebUrl("");

    const req =
      isElectron && window.electronAPI?.promptLibrary?.getPromptShareLink
        ? window.electronAPI.promptLibrary.getPromptShareLink(prompt.id)
        : Promise.reject(new Error("Electron API not available"));

    req
      .then(({ webUrl: url }: { webUrl: string }) => {
        Sentry.addBreadcrumb({
          category: "sharing",
          message: "Prompt web share link generated",
          level: "info",
          data: { promptId: prompt.id },
        });
        setWebUrl(url);
      })
      .catch((err: any) => {
        console.error("[SharePromptLinkModal] Error:", err);
        Sentry.captureException(err, {
          tags: { component: "share-prompt-modal", action: "generate-link" },
          extra: { promptId: prompt.id },
        });
        toast({
          title: "Error",
          description: err?.message || "Failed to generate share link.",
          variant: "destructive",
        });
        onOpenChange(false);
      })
      .finally(() => setLoading(false));
  }, [open, prompt.id]);

  const handleCopy = () => {
    if (!webUrl) return;
    navigator.clipboard.writeText(webUrl);
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Prompt web share link copied",
      level: "info",
      data: { promptId: prompt.id },
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copied!", description: "Share link copied to clipboard." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Share2 className="w-4 h-4 text-emerald" />
            Share Prompt
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Anyone with this link can view{" "}
            <span className="font-medium text-foreground">"{prompt.title}"</span> — no app required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {loading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating link…
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm text-foreground flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-emerald" />
                  Web Share Link
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={webUrl}
                    readOnly
                    className="bg-secondary border-border text-xs font-mono"
                  />
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="flex-shrink-0 border-border"
                    disabled={!webUrl}
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald" />
                    ) : (
                      <LinkIcon className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Opens in any browser — no account or app needed.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-secondary/50 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-[11px] uppercase tracking-wide mb-2">
                  What recipients can do
                </p>
                <p>✓ Read the full prompt in their browser</p>
                <p>✓ Copy it to their clipboard</p>
                <p>✗ Edit the original (only you can do that)</p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
