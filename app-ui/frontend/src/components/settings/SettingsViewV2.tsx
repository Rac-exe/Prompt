import { useState, useEffect } from "react";
import { User, CreditCard, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SettingsViewProps {
  userEmail: string;
  onLogout: () => void;
  onClose?: () => void;
}

interface SettingsData {
  theme: "light" | "dark";
  fontSize: "small" | "medium" | "large";
  fontFamily: "inter" | "mono" | "serif";
  promptInstructions: string;
}

const STORAGE_KEY = "prompt-weaver-settings";

const loadSettings = (): SettingsData => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Fall through to defaults
    }
  }
  // Check system/document theme preference
  const isDark = document.documentElement.classList.contains('dark');
  return {
    theme: isDark ? "dark" : "light",
    fontSize: "medium",
    fontFamily: "inter",
    promptInstructions: "",
  };
};

const saveSettings = (settings: SettingsData) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

type TabType = "profile" | "billing" | "customize";

export const SettingsView = ({ userEmail, onLogout, onClose }: SettingsViewProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const [settings, setSettings] = useState<SettingsData>(() => loadSettings());
  const [isDirty, setIsDirty] = useState(false);

  // Initialize theme ONCE on mount - don't change it
  useEffect(() => {
    // Just load the settings state, don't apply anything yet
    const savedSettings = loadSettings();
    setSettings(savedSettings);
    // Theme is already applied from the main app or default
    // Don't reapply it here to avoid switching
  }, []); // Empty deps - run once on mount

  const handleSave = () => {
    saveSettings(settings);
    setIsDirty(false);
    
    // Apply new settings
    if (settings.theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    
    const root = document.documentElement;
    switch (settings.fontSize) {
      case "small":
        root.style.fontSize = "14px";
        break;
      case "large":
        root.style.fontSize = "18px";
        break;
      default:
        root.style.fontSize = "16px";
    }
    
    switch (settings.fontFamily) {
      case "mono":
        root.style.fontFamily = "'Courier New', monospace";
        break;
      case "serif":
        root.style.fontFamily = "'Georgia', serif";
        break;
      default:
        root.style.fontFamily = "'Inter', system-ui, sans-serif";
    }
    
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

  const tabs = [
    { id: "profile" as const, label: "Profile", icon: User },
    { id: "billing" as const, label: "Billing", icon: CreditCard },
    { id: "customize" as const, label: "Customize", icon: Palette },
  ];

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header with tabs */}
      <div className="border-b border-border bg-surface/50">
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-2xl font-bold text-foreground">Settings</h2>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </Button>
          )}
        </div>
        
        {/* Tabs */}
        <div className="flex gap-1 px-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 rounded-t-lg transition-button",
                  activeTab === tab.id
                    ? "bg-background text-emerald border-b-2 border-emerald"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                )}
                data-testid={`settings-tab-${tab.id}`}
              >
                <Icon className="w-4 h-4" />
                <span className="font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto p-8 space-y-8">
          {activeTab === "profile" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Profile Settings</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-foreground">Username</Label>
                    <Input
                      id="username"
                      type="text"
                      defaultValue="User"
                      className="bg-secondary border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-foreground">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={userEmail}
                      disabled
                      className="bg-secondary border-border"
                    />
                    <p className="text-xs text-muted-foreground">Cannot be changed</p>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-border">
                <h3 className="text-lg font-semibold text-foreground mb-2">Change Password</h3>
                <div className="flex items-center gap-3 p-4 bg-surface rounded-lg border border-border">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Password Managed by Google</p>
                    <p className="text-xs text-muted-foreground">Managed through your Google Account</p>
                  </div>
                  <Button variant="outline" className="border-border">
                    Change on Google
                  </Button>
                </div>
              </div>

              <div className="pt-6 border-t border-border">
                <h3 className="text-lg font-semibold text-destructive mb-2">Delete Account</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Permanently delete your account and all data
                </p>
                <Button
                  variant="destructive"
                  onClick={onLogout}
                  data-testid="delete-account-button"
                >
                  Delete Account
                </Button>
              </div>
            </div>
          )}

          {activeTab === "billing" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Billing & Subscription</h3>
                <div className="p-6 bg-surface rounded-xl border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-xl font-bold text-foreground">Free</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-2 h-2 rounded-full bg-emerald" />
                        <span className="text-sm text-muted-foreground">Active</span>
                      </div>
                    </div>
                    <Button variant="outline" className="border-emerald text-emerald hover:bg-emerald/10">
                      Upgrade to Pro
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">Limited daily prompts</p>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Upgrade to Pro</h3>
                <div className="p-6 bg-gradient-to-br from-emerald/5 to-emerald/10 rounded-xl border border-emerald/20">
                  <div className="mb-6">
                    <p className="text-3xl font-bold text-emerald mb-1">$9.99/month</p>
                    <p className="text-sm text-muted-foreground">Cancel anytime</p>
                  </div>
                  <Button className="w-full bg-emerald text-white hover:bg-emerald/90 mb-6">
                    Upgrade Now
                  </Button>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-emerald text-lg">∞</span>
                      </div>
                      <div>
                        <h5 className="font-medium text-foreground">Unlimited Prompts</h5>
                        <p className="text-sm text-muted-foreground">Generate as many as you need</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-emerald text-lg">👑</span>
                      </div>
                      <div>
                        <h5 className="font-medium text-foreground">Premium AI Models</h5>
                        <p className="text-sm text-muted-foreground">Claude, GPT-4, Gemini & more</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-emerald text-lg">✓</span>
                      </div>
                      <div>
                        <h5 className="font-medium text-foreground">Save & Organize</h5>
                        <p className="text-sm text-muted-foreground">Create prompt libraries</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "customize" && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Customization & Preferences</h3>
                
                {/* Prompt Instructions - Moved to TOP */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Prompt Instructions</h4>
                  <div className="p-4 bg-surface rounded-lg border border-border space-y-2">
                    <Label htmlFor="instructions" className="text-foreground">
                      Custom Instructions
                    </Label>
                    <p className="text-xs text-muted-foreground mb-2">
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

                {/* Appearance */}
                <div className="space-y-4 pt-6">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Appearance</h4>
                  <div className="p-4 bg-surface rounded-lg border border-border space-y-2">
                    <Label className="text-foreground">Theme</Label>
                    <Select
                      value={settings.theme}
                      onValueChange={(value) =>
                        updateSetting("theme", value as SettingsData["theme"])
                      }
                    >
                      <SelectTrigger className="bg-secondary border-border" data-testid="theme-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Choose your preferred color scheme</p>
                  </div>
                </div>

                {/* Typography */}
                <div className="space-y-4 pt-6">
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Typography</h4>
                  <div className="space-y-4">
                    <div className="p-4 bg-surface rounded-lg border border-border space-y-2">
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
                      <p className="text-xs text-muted-foreground">Includes accessibility-focused options for better readability</p>
                    </div>
                    
                    <div className="p-4 bg-surface rounded-lg border border-border space-y-2">
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
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Save Button */}
      {isDirty && (
        <div className="p-6 border-t border-border bg-surface/80 backdrop-blur-sm animate-slide-up">
          <div className="max-w-3xl mx-auto flex gap-2">
            <Button
              onClick={handleSave}
              style={{ backgroundColor: 'hsl(150, 60%, 45%)', color: 'white' }}
              className="hover:bg-emerald/90 shadow-lg hover:shadow-emerald/30 transition-all font-semibold px-8"
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
              className="border-border hover:bg-secondary font-medium"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
