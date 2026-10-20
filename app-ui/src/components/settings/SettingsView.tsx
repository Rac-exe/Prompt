import { useState, useEffect, useRef } from "react";
import { User, Palette, Moon, Sun, Check, Camera, Brain, CircleNotch, Robot } from "@phosphor-icons/react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/hooks/use-toast";
import { SettingsData, loadSettings, saveSettings, applySettings } from "@/lib/settings";
import { useAuth } from "@/context/AuthContext";
import { AvatarUploadModal } from "@/components/profile/AvatarUploadModal";
import { MemoryView } from "@/components/settings/MemoryView";
import { AIProviderForm } from "@/components/settings/AIProviderForm";
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

const TAB_TRIGGER_CLASS =
  "h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm";

export const SettingsView = () => {
  const { user } = useAuth();

  const [tab, setTab] = useState("profile");
  const [settings, setSettings] = useState<SettingsData>(() => {
    try {
      const stored = localStorage.getItem('prompt-weaver-settings');
      if (stored) return JSON.parse(stored) as SettingsData;
    } catch {}
    return { theme: "light", fontSize: "medium", fontFamily: "inter", promptInstructions: "" };
  });
  const [localInstructions, setLocalInstructions] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);

  const avatarUrl = user?.profile?.avatar_url || null;
  const userName = user?.profile?.name || "User";
  const userInitial = (userName[0] || "U").toUpperCase();

  const [editedName, setEditedName] = useState(userName);
  const nameChanged = editedName.trim() !== userName;

  useEffect(() => { setEditedName(userName); }, [userName]);

  // Open on the AI provider tab until a key is configured
  useEffect(() => {
    window.electronAPI?.aiSettings?.get().then((ai) => {
      if (!ai.configured) setTab("ai");
    }).catch(() => {});
  }, []);

  const saveName = () => {
    const trimmed = editedName.trim();
    if (!trimmed || trimmed === userName) return;
    setNameSaving(true);
    try {
      window.electronAPI?.updateProfile?.({ name: trimmed });
      toast({ title: "Name updated" });
    } finally {
      setNameSaving(false);
    }
  };

  const settingsReadyRef = useRef(false);

  // Auto-launch (start-at-login) is a per-machine system setting, kept
  // separate from the app settings.
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(true);
  const [autoLaunchSaving, setAutoLaunchSaving] = useState(false);

  useEffect(() => {
    loadSettings()
      .then((loaded) => {
        setSettings(loaded);
        setLocalInstructions(loaded.promptInstructions ?? "");
      })
      .catch((err) => console.error('[SettingsView] Failed to load settings:', err))
      .finally(() => {
        // Allow saves only after the next animation frame so Radix Switch's
        // BubbleInput phantom toggle (fired in a useEffect after the re-render
        // caused by setSettings) is safely discarded.
        requestAnimationFrame(() => { settingsReadyRef.current = true; });
      });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.autoLaunch?.get) return;
    window.electronAPI.autoLaunch.get()
      .then((res) => setAutoLaunchEnabled(!!res?.enabled))
      .catch((err) => console.error('[SettingsView] autoLaunch.get failed:', err));
  }, []);

  const toggleAutoLaunch = async (next: boolean) => {
    if (!window.electronAPI?.autoLaunch?.set) return;
    const previous = autoLaunchEnabled;
    setAutoLaunchEnabled(next);
    setAutoLaunchSaving(true);
    try {
      await window.electronAPI.autoLaunch.set(next);
    } catch (err) {
      setAutoLaunchEnabled(previous);
      console.error('[SettingsView] auto-launch toggle failed:', err);
      toast({ title: "Couldn't update startup setting", description: "Please try again.", variant: "destructive" });
    } finally {
      setAutoLaunchSaving(false);
    }
  };

  const instructionsDirty = localInstructions !== settings.promptInstructions;

  const updateSetting = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    if (!settingsReadyRef.current) return;
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    applySettings(newSettings);
    saveSettings(newSettings, user?.profile?.id).catch((err) => {
      console.error('[SettingsView] Failed to auto-save:', err);
      toast({ title: "Couldn't save settings", description: "Your last change wasn't stored. Try again.", variant: "destructive" });
    });
    if (window.electronAPI && window.electronAPI.send) {
      window.electronAPI.send('overlay:settings-update', newSettings);
    }
  };

  const saveInstructions = () => {
    updateSetting("promptInstructions", localInstructions);
  };

  const discardInstructions = () => {
    setLocalInstructions(settings.promptInstructions ?? "");
  };

  const handleAvatarUploaded = (url: string) => {
    window.electronAPI?.updateProfile?.({ avatar_url: url });
    toast({ title: "Avatar updated" });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* ── Page header ── */}
      <div className="h-12 border-b border-border flex items-center px-6 flex-shrink-0 bg-surface/40">
        <h2 className="text-sm font-bold text-foreground tracking-tight">Settings</h2>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-5 pb-0 flex-shrink-0">
          <TabsList className="bg-secondary h-9 p-1 rounded-lg gap-0.5">
            <TabsTrigger value="profile" className={TAB_TRIGGER_CLASS}>
              <User size={14} weight="light" className="mr-1.5 opacity-70" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="ai" className={TAB_TRIGGER_CLASS}>
              <Robot size={14} weight="light" className="mr-1.5 opacity-70" />
              AI provider
            </TabsTrigger>
            <TabsTrigger value="customize" className={TAB_TRIGGER_CLASS}>
              <Palette size={14} weight="light" className="mr-1.5 opacity-70" />
              Customize
            </TabsTrigger>
            <TabsTrigger value="memory" className={TAB_TRIGGER_CLASS}>
              <Brain size={14} weight="light" className="mr-1.5 opacity-70" />
              Memory
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Profile tab ── */}
        <TabsContent value="profile" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6 space-y-5">
              <Section title="Profile" description="Stored only on this computer">
                <div className="px-4 py-5">
                  <div className="flex items-center gap-5">
                    {/* Avatar with edit overlay */}
                    <div
                      className="relative group cursor-pointer flex-shrink-0"
                      onClick={() => setUploadModalOpen(true)}
                    >
                      <Avatar className="h-16 w-16">
                        {avatarUrl && (
                          <AvatarImage src={avatarUrl} alt={userName} className="object-cover" />
                        )}
                        <AvatarFallback className="bg-emerald/15 text-emerald text-lg font-semibold">
                          {userInitial}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera size={20} weight="light" className="text-white" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{userName}</p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs flex-shrink-0"
                      onClick={() => setUploadModalOpen(true)}
                    >
                      <Camera size={14} weight="light" className="mr-1.5" />
                      Change Avatar
                    </Button>
                  </div>
                </div>
                <Row>
                  <RowLabel label="Name" hint="Shown in greetings" />
                  <div className="flex items-center gap-2">
                    <Input
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      className="w-48 h-8 text-sm bg-secondary border-border focus-visible:border-emerald/50 focus-visible:ring-emerald/15"
                    />
                    {nameChanged && (
                      <Button
                        size="sm"
                        onClick={saveName}
                        disabled={nameSaving || !editedName.trim()}
                        className="h-8 px-3 text-xs bg-emerald hover:bg-emerald/90 text-white font-semibold"
                      >
                        {nameSaving ? <CircleNotch size={14} weight="light" className="animate-spin" /> : <Check size={14} weight="bold" />}
                      </Button>
                    )}
                  </div>
                </Row>
              </Section>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── AI provider tab ── */}
        <TabsContent value="ai" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6 space-y-5">
              <Section
                title="AI provider"
                description="Your OpenRouter key and the models Prmpt uses. Keys stay on this computer."
              >
                <div className="p-4">
                  <AIProviderForm variant="settings" />
                </div>
              </Section>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── Customize tab ── */}
        <TabsContent value="customize" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6 space-y-5">
              <Section
                title="Custom Instructions"
                description="Added to every optimization as secondary context"
              >
                <div className="p-4 space-y-2.5">
                  <Textarea
                    value={localInstructions}
                    onChange={(e) => setLocalInstructions(e.target.value)}
                    placeholder="e.g. 'Always use formal tone', 'Include code examples', 'Prefer concise responses'…"
                    className="min-h-[110px] bg-secondary border-border font-mono text-xs resize-none focus-visible:border-emerald/50 focus-visible:ring-emerald/15 placeholder:text-muted-foreground/60 leading-relaxed"
                    maxLength={1000}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground/50">
                      {localInstructions.length} / 1000
                    </p>
                    {instructionsDirty && (
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" onClick={discardInstructions} className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground">
                          Discard
                        </Button>
                        <Button size="sm" onClick={saveInstructions} className="h-7 px-3 text-xs border border-input text-foreground hover:bg-muted font-semibold">
                          Save
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Section>

              <Section title="Startup" description="Control how Prmpt behaves when you sign in to your computer">
                <Row>
                  <RowLabel
                    label="Launch at login"
                    hint="Run Prmpt automatically in the system tray when you sign in"
                  />
                  <Switch
                    checked={autoLaunchEnabled}
                    disabled={autoLaunchSaving}
                    onCheckedChange={toggleAutoLaunch}
                    data-testid="auto-launch-toggle"
                    className="data-[state=checked]:bg-emerald"
                  />
                </Row>
              </Section>

              <Section title="Appearance">
                <Row>
                  <RowLabel
                    label={settings.theme === "dark" ? "Dark Mode" : "Light Mode"}
                    hint="Toggle the application color scheme"
                  />
                  <div className="flex items-center gap-2">
                    <Sun size={14} weight="light" className="text-muted-foreground" />
                    <Switch
                      checked={settings.theme === "dark"}
                      onCheckedChange={(checked) => updateSetting("theme", checked ? "dark" : "light")}
                      data-testid="theme-toggle"
                      className="data-[state=checked]:bg-emerald"
                    />
                    <Moon size={14} weight="light" className="text-muted-foreground" />
                  </div>
                </Row>
              </Section>

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

        {/* ── Memory tab ── */}
        <TabsContent value="memory" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6">
              <MemoryView />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Avatar upload modal */}
      <AvatarUploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        currentAvatarUrl={avatarUrl}
        onAvatarUploaded={handleAvatarUploaded}
      />
    </div>
  );
};
