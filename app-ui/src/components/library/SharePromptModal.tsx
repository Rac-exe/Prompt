import { useState } from "react";
import { Share2, Copy, Check, Download, Link as LinkIcon } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";

interface SharePromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: {
    title: string;
    content: string;
  };
}

export const SharePromptModal = ({ open, onOpenChange, prompt }: SharePromptModalProps) => {
  const [copied, setCopied] = useState(false);
  const shareUrl = `https://app.promptweaver.com/shared/${btoa(prompt.title)}`;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard.`,
    });
  };

  const handleExport = () => {
    const blob = new Blob([`# ${prompt.title}\n\n${prompt.content}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prompt.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Exported!",
      description: "Prompt exported as Markdown file.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Share2 className="w-5 h-5 text-emerald" />
            Share Prompt
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Share or export your optimized prompt
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="link" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-secondary">
            <TabsTrigger value="link">Link</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="share-url" className="text-foreground">
                Share Link
              </Label>
              <div className="flex gap-2">
                <Input
                  id="share-url"
                  value={shareUrl}
                  readOnly
                  className="bg-secondary border-border"
                />
                <Button
                  onClick={() => handleCopy(shareUrl, "Link")}
                  className="flex-shrink-0"
                  variant="outline"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald" />
                  ) : (
                    <LinkIcon className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Anyone with this link can view your prompt
              </p>
            </div>
          </TabsContent>

          <TabsContent value="export" className="space-y-4 pt-4">
            <div className="space-y-4">
              <div className="p-4 bg-secondary border border-border rounded-lg">
                <p className="text-sm text-foreground mb-2">
                  <strong>{prompt.title}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Export as Markdown (.md) file
                </p>
              </div>
              <Button
                onClick={handleExport}
                className="w-full bg-emerald text-white hover:bg-emerald/90"
              >
                <Download className="w-4 h-4 mr-2" />
                Export as Markdown
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
