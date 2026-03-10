import { useState, useEffect } from "react";
import { User, CreditCard, Palette, Moon, Sun, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { SettingsData, loadSettings, saveSettings, applySettings } from "@/lib/settings";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

/* ── Reusable section wrapper ─────────────────────────────── */
const Section = ({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-3">
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
    <div className="bg-black/5 dark:bg-white/5 border border-transparent rounded-xl overflow-hidden text-foreground/90">
      {children}
    </div>
  </div>
);

/* ── Row inside a Section ──────────────────────────────────── */
const Row = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("px-4 py-3.5 flex items-center justify-between gap-4 border-b border-border last:border-0", className)}>
    {children}
  </div>
);

const RowLabel = ({ label, hint }: { label: string; hint?: string }) => (
  <div className="space-y-0.5">
    <Label className="text-sm font-medium text-foreground">{label}</Label>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const SettingsView = () => {
  const { user } = useAuth();

  const [settings, setSettings] = useState<SettingsData>({
    theme: "dark",
    fontSize: "medium",
    fontFamily: "inter",
    promptInstructions: "",
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings()
      .then((loaded) => { setSettings(loaded); })
      .catch((err) => console.error('[SettingsView] Failed to load settings:', err))
      .finally(() => setIsLoading(false));
  }, []);

  const updateSetting = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    const newSettings = { ...settings, [key]: value };

    // 1. Update component rendering state
    setSettings(newSettings);

    // 2. Instantly apply the settings visually
    applySettings(newSettings);

    // 3. Persist setting to the backend
    saveSettings(newSettings).catch((err) => {
      console.error('[SettingsView] Failed to auto-save:', err);
      toast({ title: "Auto-save failed", description: "Changes may not persist.", variant: "destructive" });
    });

    // 4. Instantly broadcast setting payload to overlay
    if (window.electronAPI && window.electronAPI.send) {
      window.electronAPI.send('overlay:settings-update', newSettings);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* ── Page header ── */}
      <div className="h-12 border-b border-border flex items-center px-6 flex-shrink-0 bg-surface/40">
        <h2 className="text-sm font-bold text-foreground tracking-tight">Settings</h2>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="profile" className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="px-6 pt-5 pb-0 flex-shrink-0">
          <TabsList className="bg-secondary h-9 p-1 rounded-lg gap-0.5">
            <TabsTrigger
              value="profile"
              className="h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <User className="w-3.5 h-3.5 mr-1.5 opacity-70" />
              Profile
            </TabsTrigger>
            <TabsTrigger
              value="billing"
              className="h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <CreditCard className="w-3.5 h-3.5 mr-1.5 opacity-70" />
              Billing
            </TabsTrigger>
            <TabsTrigger
              value="customize"
              className="h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Palette className="w-3.5 h-3.5 mr-1.5 opacity-70" />
              Customize
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Profile tab ── */}
        <TabsContent value="profile" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6 space-y-5">
              {/* Account info */}
              <Section title="Account Information">
                <Row>
                  <RowLabel label="Username" />
                  <Input
                    defaultValue={user?.profile?.name || "User"}
                    className="w-48 h-8 text-sm bg-secondary border-border focus-visible:border-emerald/50 focus-visible:ring-emerald/15"
                  />
                </Row>
                <Row>
                  <RowLabel label="Email Address" hint="Cannot be changed" />
                  <Input
                    type="email"
                    value={user?.profile?.email || ""}
                    disabled
                    className="w-48 h-8 text-sm bg-secondary border-border opacity-60"
                  />
                </Row>
              </Section>

              {/* Password */}
              <Section title="Authentication">
                <Row>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/12 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-500 text-xs font-bold">G</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Google Account</p>
                      <p className="text-xs text-muted-foreground">Your password is managed by Google</p>
                    </div>
                  </div>
                  <Button
                    variant="outline" size="sm"
                    className="h-8 text-xs border-border hover:border-border/80"
                    onClick={() => window.open("https://myaccount.google.com", "_blank")}
                  >
                    Manage
                  </Button>
                </Row>
              </Section>

              {/* Danger zone */}
              <Section title="Danger Zone" description="Irreversible actions — proceed with caution">
                <Row className="border-destructive/15 bg-destructive/4">
                  <div>
                    <p className="text-sm font-medium text-destructive">Delete Account</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Permanently remove your account and all data</p>
                  </div>
                  <Button variant="destructive" size="sm" className="h-8 text-xs flex-shrink-0">
                    Delete Account
                  </Button>
                </Row>
              </Section>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Billing tab ── */}
        <TabsContent value="billing" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6 space-y-5">
              {/* Current plan */}
              <Section title="Current Plan">
                <Row>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Free</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Limited daily prompt generations</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-muted text-emerald text-[10px] font-semibold uppercase tracking-wide">
                      <span className="w-1 h-1 rounded-full bg-emerald" />
                      Active
                    </span>
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-emerald hover:bg-emerald/90 text-white font-semibold glow-emerald-sm"
                    >
                      Upgrade to Pro
                    </Button>
                  </div>
                </Row>
              </Section>

              {/* Pro plan card */}
              <div className="bg-surface border border-emerald/25 rounded-xl p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald/4 rounded-full translate-x-12 -translate-y-12 pointer-events-none" />

                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald/10 text-emerald text-[10px] font-bold uppercase tracking-wider mb-2">
                        <Sparkles className="w-2.5 h-2.5" />
                        Pro Plan
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-foreground">$9.99</span>
                        <span className="text-sm text-muted-foreground">/ month</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">Cancel anytime</p>
                    </div>
                  </div>

                  <div className="space-y-2.5 mb-5">
                    {[
                      { label: "Unlimited Prompts", desc: "Generate as many as you need" },
                      { label: "Premium AI Models", desc: "Claude, GPT-4, Gemini & more" },
                      { label: "Save & Organize", desc: "Unlimited library collections" },
                      { label: "Priority Support", desc: "Get help when you need it" },
                    ].map((feature) => (
                      <div key={feature.label} className="flex items-start gap-2.5">
                        <div className="w-4 h-4 rounded-full bg-emerald/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Check className="w-2.5 h-2.5 text-emerald" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground leading-none">{feature.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{feature.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button className="w-full h-9 bg-emerald hover:bg-emerald/90 text-white font-semibold text-sm glow-emerald-sm">
                    Upgrade Now
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Customize tab ── */}
        <TabsContent value="customize" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6 space-y-5">
              {/* Custom instructions */}
              <Section
                title="Custom Prompt Instructions"
                description="Appended to every optimization request as context for the AI"
              >
                <div className="p-4">
                  <Textarea
                    value={settings.promptInstructions}
                    onChange={(e) => updateSetting("promptInstructions", e.target.value)}
                    placeholder="e.g. 'Always use formal tone', 'Include examples', 'Focus on technical accuracy'…"
                    className="min-h-[100px] bg-secondary border-border font-mono text-xs resize-none focus-visible:border-emerald/50 focus-visible:ring-emerald/15 placeholder:text-muted-foreground/40 leading-relaxed"
                  />
                  <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                    {settings.promptInstructions.length} / 1000 characters
                  </p>
                </div>
              </Section>

              {/* Appearance */}
              <Section title="Appearance">
                <Row>
                  <RowLabel
                    label={settings.theme === "dark" ? "Dark Mode" : "Light Mode"}
                    hint="Toggle the application color scheme"
                  />
                  <div className="flex items-center gap-2">
                    <Sun className="w-3.5 h-3.5 text-muted-foreground" />
                    <Switch
                      checked={settings.theme === "dark"}
                      onCheckedChange={(checked) => updateSetting("theme", checked ? "dark" : "light")}
                      data-testid="theme-toggle"
                      className="data-[state=checked]:bg-emerald"
                    />
                    <Moon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                </Row>
              </Section>

              {/* Typography */}
              <Section title="Typography">
                <Row>
                  <RowLabel label="Font Size" />
                  <Select
                    value={settings.fontSize}
                    onValueChange={(v) => updateSetting("fontSize", v as SettingsData["fontSize"])}
                  >
                    <SelectTrigger className="w-40 h-8 text-xs bg-secondary border-border focus:border-emerald/50 focus:ring-emerald/15">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border shadow-elevated rounded-xl">
                      <SelectItem value="small" className="text-xs">Small (14px)</SelectItem>
                      <SelectItem value="medium" className="text-xs">Medium (16px)</SelectItem>
                      <SelectItem value="large" className="text-xs">Large (18px)</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
                <Row>
                  <RowLabel label="Font Family" hint="Includes accessibility-focused options" />
                  <Select
                    value={settings.fontFamily}
                    onValueChange={(v) => updateSetting("fontFamily", v as SettingsData["fontFamily"])}
                  >
                    <SelectTrigger className="w-40 h-8 text-xs bg-secondary border-border focus:border-emerald/50 focus:ring-emerald/15">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border shadow-elevated rounded-xl">
                      <SelectItem value="inter" className="text-xs">Default (Inter)</SelectItem>
                      <SelectItem value="mono" className="text-xs">Monospace</SelectItem>
                      <SelectItem value="serif" className="text-xs">Serif</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
              </Section>


            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>


    </div>
  );
};
