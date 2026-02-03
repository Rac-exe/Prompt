import { useState, useEffect } from "react";
import { User, CreditCard, Palette, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
      </div>

      {/* Tabs Navigation */}
      <Tabs defaultValue="profile" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-6 flex-shrink-0">
          <TabsList className="grid w-full max-w-md grid-cols-3 bg-secondary">
            <TabsTrigger value="profile" className="gap-2">
              <User className="w-4 h-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-2">
              <CreditCard className="w-4 h-4" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="customize" className="gap-2">
              <Palette className="w-4 h-4" />
              Customize
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Profile Tab */}
        <TabsContent value="profile" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-2xl mx-auto p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Profile Settings</h3>
                <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username" className="text-foreground">Username</Label>
                    <Input
                      id="username"
                      defaultValue="Racoon"
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

              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Change Password</h3>
                <div className="bg-surface border border-border rounded-xl p-6">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-500 font-bold">G</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-blue-400 font-medium">Password Managed by Google</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Managed through your Google Account
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 border-border"
                        onClick={() => window.open("https://myaccount.google.com", "_blank")}
                      >
                        Change on Google
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-destructive mb-4">Delete Account</h3>
                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6">
                  <p className="text-sm text-destructive mb-3">
                    Permanently delete your account and all data
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                  >
                    Delete Account
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-2xl mx-auto p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Billing & Subscription</h3>
                <div className="bg-surface border border-border rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="text-base font-semibold text-foreground">Free</h4>
                      <p className="text-sm text-emerald">Active</p>
                    </div>
                    <Button className="bg-emerald text-white hover:bg-emerald/90">
                      Upgrade to Pro
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">Limited daily prompts</p>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Upgrade to Pro</h3>
                <div className="bg-surface border border-emerald/20 rounded-xl p-6 space-y-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-emerald">$9.99</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Cancel anytime</p>
                  <Button className="w-full bg-emerald text-white hover:bg-emerald/90">
                    Upgrade Now
                  </Button>
                  <div className="space-y-2 mt-4">
                    <div className="flex items-start gap-2">
                      <span className="text-emerald">∞</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">Unlimited Prompts</p>
                        <p className="text-xs text-muted-foreground">Generate as many as you need</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald">👑</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">Premium AI Models</p>
                        <p className="text-xs text-muted-foreground">Claude, GPT-4, Gemini & more</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald">✓</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">Save & Organize</p>
                        <p className="text-xs text-muted-foreground">Create prompt libraries</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Customize Tab */}
        <TabsContent value="customize" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-2xl mx-auto p-6 space-y-6">
              {/* Personalized Prompt Instructions */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded bg-emerald/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-emerald text-sm">📋</span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Personalized Prompt Instructions
                  </h3>
                </div>
                <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-foreground font-medium">Custom Instructions</Label>
                    <p className="text-xs text-muted-foreground">
                      These instructions will be appended to every optimization request
                    </p>
                    <Textarea
                      value={settings.promptInstructions}
                      onChange={(e) => updateSetting("promptInstructions", e.target.value)}
                      placeholder="Enter custom instructions here... (e.g., 'Always use formal tone', 'Include examples', 'Focus on technical accuracy')"
                      className="min-h-[120px] bg-secondary border-border font-mono text-sm resize-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  <Palette className="w-5 h-5 inline mr-2 text-emerald" />
                  Appearance
                </h3>
                <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
                  {/* Theme Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Dark Mode</Label>
                      <p className="text-sm text-muted-foreground">
                        Dark color scheme
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
              </div>

              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Typography</h3>
                <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
                  {/* Font Size */}
                  <div className="space-y-2">
                    <Label className="text-foreground">Font Size</Label>
                    <Select
                      value={settings.fontSize}
                      onValueChange={(value) =>
                        updateSetting("fontSize", value as SettingsData["fontSize"])
                      }
                    >
                      <SelectTrigger className="bg-secondary border-border">
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
                      <SelectTrigger className="bg-secondary border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="inter">Default Font</SelectItem>
                        <SelectItem value="mono">Monospace</SelectItem>
                        <SelectItem value="serif">Serif</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Includes accessibility-focused options for better readability
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Interface</h3>
                <div className="bg-surface border border-border rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Beta Features</Label>
                      <p className="text-sm text-muted-foreground">
                        Early access to experimental features
                      </p>
                    </div>
                    <Switch defaultChecked={false} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-foreground">Animations</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable smooth transitions and animations
                      </p>
                    </div>
                    <Switch defaultChecked={true} />
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      {isDirty && (
        <div className="p-6 border-t border-border bg-surface/50 animate-slide-up">
          <div className="max-w-2xl mx-auto flex gap-2">
            <Button
              onClick={handleSave}
              className="bg-emerald text-white hover:bg-emerald/90 transition-button glow-emerald"
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
