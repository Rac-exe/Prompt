import { useState, useEffect, useCallback } from "react";
import { User, Palette, Moon, Sun, Check, Sparkles, Camera, Brain, Github, Link, Unlink, KeyRound, Loader2, Mail } from "lucide-react";
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
  const [localInstructions, setLocalInstructions] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const [identities, setIdentities] = useState<any[]>([]);
  const [identityLoading, setIdentityLoading] = useState<string | null>(null);

  const fetchIdentities = useCallback(async () => {
    if (!window.electronAPI?.getIdentities) return;
    try {
      const { identities: ids } = await window.electronAPI.getIdentities();
      setIdentities(ids ?? []);
    } catch { /* offline or not available */ }
  }, []);

  useEffect(() => {
    if (user?.identities) setIdentities(user.identities);
    else fetchIdentities();
  }, [user, fetchIdentities]);

  const handleLinkIdentity = async (provider: 'google' | 'github') => {
    if (identityLoading) return;
    setIdentityLoading(provider);
    try {
      const result = await window.electronAPI?.linkIdentity(provider);
      if (result?.error) {
        toast({ title: "Connection failed", description: result.error, variant: "destructive" });
      } else {
        toast({ title: `${provider === 'google' ? 'Google' : 'GitHub'} connected`, description: "Your account has been linked." });
        setTimeout(fetchIdentities, 2000);
      }
    } catch {
      toast({ title: "Error", description: "Failed to connect account", variant: "destructive" });
    } finally {
      setIdentityLoading(null);
    }
  };

  const handleUnlinkIdentity = async (identityId: string, providerLabel: string) => {
    if (identityLoading) return;
    setIdentityLoading(identityId);
    try {
      const result = await window.electronAPI?.unlinkIdentity(identityId);
      if (result?.error) {
        toast({ title: "Disconnect failed", description: result.error, variant: "destructive" });
      } else {
        toast({ title: `${providerLabel} disconnected`, description: "The account has been unlinked." });
        await fetchIdentities();
      }
    } catch {
      toast({ title: "Error", description: "Failed to disconnect account", variant: "destructive" });
    } finally {
      setIdentityLoading(null);
    }
  };

  const handleSetPassword = async () => {
    if (!userEmail) return;
    setIdentityLoading('password');
    try {
      const result = await window.electronAPI?.resetPassword(userEmail);
      if (result?.error) {
        toast({ title: "Failed", description: result.error, variant: "destructive" });
      } else {
        toast({ title: "Email sent", description: "Check your inbox for a password reset link." });
      }
    } catch {
      toast({ title: "Error", description: "Failed to send reset email", variant: "destructive" });
    } finally {
      setIdentityLoading(null);
    }
  };

  const avatarUrl = user?.profile?.avatar_url || null;
  const userName = user?.profile?.name || "User";
  const userEmail = user?.profile?.email || "";
  const userInitial = (userName[0] || "U").toUpperCase();

  useEffect(() => {
    loadSettings()
      .then((loaded) => {
        setSettings(loaded);
        setLocalInstructions(loaded.promptInstructions ?? "");
      })
      .catch((err) => console.error('[SettingsView] Failed to load settings:', err))
      .finally(() => setIsLoading(false));
  }, []);

  const instructionsDirty = localInstructions !== settings.promptInstructions;

  const saveInstructions = () => {
    updateSetting("promptInstructions", localInstructions);
  };

  const discardInstructions = () => {
    setLocalInstructions(settings.promptInstructions ?? "");
  };

  const updateSetting = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    applySettings(newSettings);
    saveSettings(newSettings).catch((err) => {
      console.error('[SettingsView] Failed to auto-save:', err);
      toast({ title: "Auto-save failed", description: "Changes may not persist.", variant: "destructive" });
    });
    if (window.electronAPI && window.electronAPI.send) {
      window.electronAPI.send('overlay:settings-update', newSettings);
    }
  };

  const handleAvatarUploaded = (url: string) => {
    if (window.electronAPI?.updateProfile) {
      window.electronAPI.updateProfile({ avatar_url: url });
      toast({
        title: "Avatar updated",
        description: "Your profile picture has been changed successfully.",
      });
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
              value="customize"
              className="h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Palette className="w-3.5 h-3.5 mr-1.5 opacity-70" />
              Customize
            </TabsTrigger>
            <TabsTrigger
              value="memory"
              className="h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Brain className="w-3.5 h-3.5 mr-1.5 opacity-70" />
              Memory
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Profile tab ── */}
        <TabsContent value="profile" className="flex-1 mt-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="max-w-xl mx-auto px-6 py-6 space-y-5">

              {/* Avatar + Identity */}
              <Section title="Profile">
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
                        <Camera className="w-5 h-5 text-white" />
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{userName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{userEmail}</p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs flex-shrink-0"
                      onClick={() => setUploadModalOpen(true)}
                    >
                      <Camera className="w-3.5 h-3.5 mr-1.5" />
                      Change Avatar
                    </Button>
                  </div>
                </div>
              </Section>

              {/* Account info */}
              <Section title="Account Information">
                <Row>
                  <RowLabel label="Username" />
                  <Input
                    defaultValue={userName}
                    className="w-48 h-8 text-sm bg-secondary border-border focus-visible:border-emerald/50 focus-visible:ring-emerald/15"
                  />
                </Row>
                <Row>
                  <RowLabel label="Email Address" hint="Cannot be changed" />
                  <Input
                    type="email"
                    value={userEmail}
                    disabled
                    className="w-48 h-8 text-sm bg-secondary border-border opacity-60"
                  />
                </Row>
              </Section>

              {/* Connected Accounts */}
              <Section title="Connected Accounts" description="Manage sign-in methods linked to your account">
                {/* Google */}
                {(() => {
                  const googleIdentity = identities.find((i: any) => i.provider === 'google');
                  return (
                    <Row>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/12 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Google</p>
                          <p className="text-xs text-muted-foreground">
                            {googleIdentity ? (googleIdentity.identity_data?.email || 'Connected') : 'Not connected'}
                          </p>
                        </div>
                      </div>
                      {googleIdentity ? (
                        <Button
                          variant="outline" size="sm"
                          className="h-8 text-xs border-border hover:border-destructive/50 hover:text-destructive"
                          disabled={identities.length <= 1 || identityLoading === googleIdentity.id}
                          title={identities.length <= 1 ? 'Add another sign-in method first' : undefined}
                          onClick={() => handleUnlinkIdentity(googleIdentity.id, 'Google')}
                        >
                          {identityLoading === googleIdentity.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5 mr-1.5" />}
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          variant="outline" size="sm"
                          className="h-8 text-xs border-border"
                          disabled={!!identityLoading}
                          onClick={() => handleLinkIdentity('google')}
                        >
                          {identityLoading === 'google' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Link className="w-3.5 h-3.5 mr-1.5" />}
                          Connect
                        </Button>
                      )}
                    </Row>
                  );
                })()}

                {/* GitHub */}
                {(() => {
                  const githubIdentity = identities.find((i: any) => i.provider === 'github');
                  return (
                    <Row>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-foreground/8 border border-foreground/12 flex items-center justify-center flex-shrink-0">
                          <Github className="w-4 h-4 text-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">GitHub</p>
                          <p className="text-xs text-muted-foreground">
                            {githubIdentity ? (githubIdentity.identity_data?.email || githubIdentity.identity_data?.user_name || 'Connected') : 'Not connected'}
                          </p>
                        </div>
                      </div>
                      {githubIdentity ? (
                        <Button
                          variant="outline" size="sm"
                          className="h-8 text-xs border-border hover:border-destructive/50 hover:text-destructive"
                          disabled={identities.length <= 1 || identityLoading === githubIdentity.id}
                          title={identities.length <= 1 ? 'Add another sign-in method first' : undefined}
                          onClick={() => handleUnlinkIdentity(githubIdentity.id, 'GitHub')}
                        >
                          {identityLoading === githubIdentity.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5 mr-1.5" />}
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          variant="outline" size="sm"
                          className="h-8 text-xs border-border"
                          disabled={!!identityLoading}
                          onClick={() => handleLinkIdentity('github')}
                        >
                          {identityLoading === 'github' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Link className="w-3.5 h-3.5 mr-1.5" />}
                          Connect
                        </Button>
                      )}
                    </Row>
                  );
                })()}

                {/* Email & Password */}
                {(() => {
                  const emailIdentity = identities.find((i: any) => i.provider === 'email');
                  return (
                    <Row>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald/12 border border-emerald/20 flex items-center justify-center flex-shrink-0">
                          <KeyRound className="w-4 h-4 text-emerald" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">Email & Password</p>
                          <p className="text-xs text-muted-foreground">
                            {emailIdentity ? 'Password is set' : 'No password set'}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline" size="sm"
                        className="h-8 text-xs border-border"
                        disabled={identityLoading === 'password'}
                        onClick={handleSetPassword}
                      >
                        {identityLoading === 'password' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Mail className="w-3.5 h-3.5 mr-1.5" />}
                        {emailIdentity ? 'Reset Password' : 'Set Password'}
                      </Button>
                    </Row>
                  );
                })()}
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
                        <Button size="sm" onClick={saveInstructions} className="h-7 px-3 text-xs bg-emerald hover:bg-emerald/90 text-white font-semibold">
                          Save
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Section>

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

