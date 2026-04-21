import { useState, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { ShareNetwork, Check, Link as LinkIcon, CircleNotch, DeviceMobile } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

interface ShareCollectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: {
    id: string;
    name: string;
  };
}

const isElectron = typeof window !== "undefined" && window.electronAPI;

export const ShareCollectionModal = ({
  open,
  onOpenChange,
  collection,
}: ShareCollectionModalProps) => {
  const [shareUrl, setShareUrl] = useState<string>("");
  const [shareToken, setShareToken] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch / generate share link when modal opens
  useEffect(() => {
    if (!open || !collection.id) return;
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Share collection modal opened",
      level: "info",
      data: { collectionId: collection.id },
    });
    setLoading(true);
    setShareUrl("");
    setShareToken("");

    if (isElectron && window.electronAPI?.promptLibrary?.getShareLink) {
      window.electronAPI.promptLibrary
        .getShareLink(collection.id)
        .then(({ shareToken: token, shareUrl: url }) => {
          Sentry.addBreadcrumb({
            category: "sharing",
            message: "Collection share link generated",
            level: "info",
            data: { collectionId: collection.id, tokenLength: token?.length || 0 },
          });
          setShareToken(token);
          setShareUrl(url);
        })
        .catch((err: any) => {
          console.error("[ShareCollectionModal] Error generating share link:", err);
          Sentry.captureException(err, {
            tags: { component: "share-collection-modal", action: "generate-link" },
            extra: { collectionId: collection.id },
          });
          toast({
            title: "Couldn't create share link",
            description: err?.message || "Something went wrong. Please try again.",
            variant: "destructive",
          });
          onOpenChange(false);
        })
        .finally(() => setLoading(false));
    } else {
      // Web / dev fallback
      const fallbackToken = btoa(collection.id).replace(/=/g, "");
      setShareToken(fallbackToken);
      setShareUrl(`promptweaver://share/${fallbackToken}`);
      setLoading(false);
    }
  }, [open, collection.id]);

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    Sentry.addBreadcrumb({
      category: "sharing",
      message: "Collection share link copied",
      level: "info",
      data: { collectionId: collection.id, tokenLength: shareToken?.length || 0 },
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Link copied" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <ShareNetwork size={20} weight="light" className="text-emerald" />
            Share Library
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Anyone with this link can view{" "}
            <span className="font-medium text-foreground">{collection.name}</span> and save a
            copy to their account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {loading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
              <CircleNotch size={16} weight="light" className="animate-spin" />
              Generating share link…
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="share-url" className="text-foreground text-sm flex items-center gap-1.5">
                  <DeviceMobile size={14} weight="light" className="text-emerald" />
                  App Share Link
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="share-url"
                    value={shareUrl}
                    readOnly
                    className="bg-secondary border-border text-xs font-mono"
                  />
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="flex-shrink-0 border-border"
                    disabled={!shareUrl}
                  >
                    {copied ? (
                      <Check size={16} weight="light" className="text-emerald" />
                    ) : (
                      <LinkIcon size={16} weight="light" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recipient must have the <span className="font-medium text-foreground">Prmpt app</span> installed and be signed in to open this link.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-secondary/50 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-[11px] uppercase tracking-wide mb-2">
                  What recipients can do
                </p>
                <p>✓ View all prompts in the library (in-app)</p>
                <p>✓ Copy individual prompts</p>
                <p>✓ Save the library to their account</p>
                <p>✗ Edit the original library (only you can do that)</p>
                <p>✗ Open in browser (app required for collections)</p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
