import { useState, useEffect } from "react";
import { User, Palette, Type, FileText, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { SettingsData, loadSettings, saveSettings, applySettings } from "@/lib/settings";

interface SettingsViewProps {
  userEmail: string;
  onLogout: () => void;
}

export const SettingsView = ({ userEmail, onLogout }: SettingsViewProps) => {
  const [settings, setSettings] = useState<SettingsData>(loadSettings());
  const [isDirty, setIsDirty] = useState(false);

  // Apply settings when they change (for live preview)
  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  const handleSave = () => {
    saveSettings(settings);
    setIsDirty(false);
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated.",
    });
  };

  const updateSetting = <K extends keyof SettingsData>(
    key: K,
    value: SettingsData[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-border bg-surface/50">
        <h2 className="text-2xl font-bold text-foreground mb-1">Settings</h2>
        <p className="text-muted-foreground">
          Manage your account and preferences
        </p>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-2xl mx-auto p-6 space-y-8">
          {/* Profile Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-emerald" />
              <h3 className="text-lg font-semibold text-foreground">Profile</h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={userEmail}
                  disabled
                  className="bg-secondary border-border"
                />
              </div>
              <Button
                variant="outline"
                onClick={onLogout}
                className="border-border hover:bg-destructive hover:text-destructive-foreground"
                data-testid="settings-logout-button"
              >
                Sign Out
              </Button>
            </div>
          </section>

          <Separator className="bg-border" />

          {/* Appearance Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-emerald" />
              <h3 className="text-lg font-semibold text-foreground">Appearance</h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
              {/* Theme Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-foreground">Theme</Label>
                  <p className="text-sm text-muted-foreground">
                    Switch between light and dark mode
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Sun className="w-4 h-4 text-muted-foreground" />
                  <Switch
                    checked={settings.theme === "dark"}
                    onCheckedChange={(checked) =>
                      updateSetting("theme", checked ? "dark" : "light")
                    }
                    data-testid="theme-toggle"
                  />
                  <Moon className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          </section>

          <Separator className="bg-border" />

          {/* Typography Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Type className="w-5 h-5 text-emerald" />
              <h3 className="text-lg font-semibold text-foreground">Typography</h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
              {/* Font Size */}
              <div className="space-y-2">
                <Label className="text-foreground">Font Size</Label>
                <Select
                  value={settings.fontSize}
                  onValueChange={(value) =>
                    updateSetting("fontSize", value as SettingsData["fontSize"])
                  }
                >
                  <SelectTrigger className="bg-secondary border-border" data-testid="font-size-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="small">Small (14px)</SelectItem>
                    <SelectItem value="medium">Medium (16px)</SelectItem>
                    <SelectItem value="large">Large (18px)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Font Family */}
              <div className="space-y-2">
                <Label className="text-foreground">Font Family</Label>
                <Select
                  value={settings.fontFamily}
                  onValueChange={(value) =>
                    updateSetting("fontFamily", value as SettingsData["fontFamily"])
                  }
                >
                  <SelectTrigger className="bg-secondary border-border" data-testid="font-family-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="inter">Inter (Sans-serif)</SelectItem>
                    <SelectItem value="mono">Monospace</SelectItem>
                    <SelectItem value="serif">Serif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <Separator className="bg-border" />

          {/* Prompt Instructions Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald" />
              <h3 className="text-lg font-semibold text-foreground">
                Personalized Prompt Instructions
              </h3>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="instructions" className="text-foreground">
                  Custom Instructions
                </Label>
                <p className="text-sm text-muted-foreground">
                  These instructions will be appended to every optimization request
                </p>
                <Textarea
                  id="instructions"
                  placeholder="e.g., Always use a professional tone, include examples, target audience is developers..."
                  value={settings.promptInstructions}
                  onChange={(e) =>
                    updateSetting("promptInstructions", e.target.value)
                  }
                  className="min-h-[120px] bg-secondary border-border resize-none"
                  data-testid="prompt-instructions-textarea"
                />
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>

      {/* Save Button */}
      {isDirty && (
        <div className="p-6 border-t border-border bg-surface/50 animate-slide-up">
          <div className="max-w-2xl mx-auto flex gap-2">
            <Button
              onClick={handleSave}
              className="bg-emerald text-white hover:bg-emerald/90 transition-button glow-emerald"
              data-testid="save-settings-button"
            >
              Save Changes
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSettings(loadSettings());
                setIsDirty(false);
              }}
              className="border-border"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
