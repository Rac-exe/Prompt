import { useState, useEffect, useCallback, useRef } from "react";
import { User, Palette, Moon, Sun, Check, Sparkle, Camera, Brain, GithubLogo, Link, LinkBreak, Key, CircleNotch, Envelope, ArrowLeft } from "@phosphor-icons/react";
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
import { OtpVerification } from "@/components/auth/OtpVerification";
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

  const [settings, setSettings] = useState<SettingsData>(() => {
    try {
      const stored = localStorage.getItem('prompt-weaver-settings');
      if (stored) return JSON.parse(stored) as SettingsData;
    } catch {}
    return { theme: "light", fontSize: "medium", fontFamily: "inter", promptInstructions: "" };
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

  // OTP password reset flow state
  type ResetStep = 'idle' | 'otp' | 'new-password';
  const [resetStep, setResetStep] = useState<ResetStep>('idle');
  const [resetOtp, setResetOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  const handleSetPassword = async () => {
    if (!userEmail) return;
    setIdentityLoading('password');
    try {
      const result = await window.electronAPI?.sendResetOtp(userEmail);
      if (result?.error) {
        toast({ title: "Failed", description: result.error, variant: "destructive" });
      } else {
        setResetStep('otp');
        setOtpError('');
        toast({ title: "Code sent", description: "Check your inbox for the verification code." });
      }
    } catch {
      toast({ title: "Error", description: "Failed to send reset code", variant: "destructive" });
    } finally {
      setIdentityLoading(null);
    }
  };

  const handleVerifyResetOtp = async (otp: string) => {
    setOtpError('');
    setResetOtp(otp);
    setResetStep('new-password');
    setNewPassword('');
    setConfirmNewPassword('');
    setResetPasswordError('');
  };

  const handleResendResetOtp = async () => {
    if (!userEmail) return;
    try {
      const result = await window.electronAPI?.sendResetOtp(userEmail);
      if (result?.error) {
        setOtpError(result.error);
      } else {
        toast({ title: "Code resent", description: "A new verification code has been sent." });
      }
    } catch {
      setOtpError('Failed to resend code.');
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPasswordError('');

    if (newPassword.length < 6) {
      setResetPasswordError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setResetPasswordError('Passwords do not match');
      return;
    }

    setResetPasswordLoading(true);
    try {
      const result = await window.electronAPI?.verifyResetOtp(userEmail, resetOtp, newPassword);
      if (result?.error) {
        setResetPasswordError(result.error);
        if (result.error.toLowerCase().includes('code') || result.error.toLowerCase().includes('expired')) {
          setResetStep('otp');
          setOtpError(result.error);
        }
      } else {
        toast({ title: "Password updated", description: "Your password has been changed successfully." });
        setResetStep('idle');
        setResetOtp('');
      }
    } catch {
      setResetPasswordError('Failed to update password. Please try again.');
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const avatarUrl = user?.profile?.avatar_url || null;
  const userName = user?.profile?.name || "User";
  const userEmail = user?.profile?.email || "";
  const userInitial = (userName[0] || "U").toUpperCase();

  const settingsReadyRef = useRef(false);

  useEffect(() => {
    loadSettings()
      .then((loaded) => {
        setSettings(loaded);
        setLocalInstructions(loaded.promptInstructions ?? "");
      })
      .catch((err) => console.error('[SettingsView] Failed to load settings:', err))
      .finally(() => {
        setIsLoading(false);
        // Allow saves only after the next animation frame so Radix Switch's
        // BubbleInput phantom toggle (fired in a useEffect after the re-render
        // caused by setSettings) is safely discarded.
        requestAnimationFrame(() => { settingsReadyRef.current = true; });
      });
  }, []);

  const instructionsDirty = localInstructions !== settings.promptInstructions;

  const saveInstructions = () => {
    updateSetting("promptInstructions", localInstructions);
  };

  const discardInstructions = () => {
    setLocalInstructions(settings.promptInstructions ?? "");
  };

  const updateSetting = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    if (!settingsReadyRef.current) return;
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
              <User size={14} weight="light" className="mr-1.5 opacity-70" />
              Profile
            </TabsTrigger>
            <TabsTrigger
              value="customize"
              className="h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Palette size={14} weight="light" className="mr-1.5 opacity-70" />
              Customize
            </TabsTrigger>
            <TabsTrigger
              value="memory"
              className="h-7 px-3.5 text-xs font-medium rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Brain size={14} weight="light" className="mr-1.5 opacity-70" />
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
                        <Camera size={20} weight="light" className="text-white" />
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
                      <Camera size={14} weight="light" className="mr-1.5" />
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
                          {identityLoading === googleIdentity.id ? <CircleNotch size={14} weight="light" className="animate-spin" /> : <LinkBreak size={14} weight="light" className="mr-1.5" />}
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          variant="outline" size="sm"
                          className="h-8 text-xs border-border"
                          disabled={!!identityLoading}
                          onClick={() => handleLinkIdentity('google')}
                        >
                          {identityLoading === 'google' ? <CircleNotch size={14} weight="light" className="animate-spin mr-1.5" /> : <Link size={14} weight="light" className="mr-1.5" />}
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
                          <GithubLogo size={16} weight="light" className="text-foreground" />
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
                          {identityLoading === githubIdentity.id ? <CircleNotch size={14} weight="light" className="animate-spin" /> : <LinkBreak size={14} weight="light" className="mr-1.5" />}
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          variant="outline" size="sm"
                          className="h-8 text-xs border-border"
                          disabled={!!identityLoading}
                          onClick={() => handleLinkIdentity('github')}
                        >
                          {identityLoading === 'github' ? <CircleNotch size={14} weight="light" className="animate-spin mr-1.5" /> : <Link size={14} weight="light" className="mr-1.5" />}
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
                          <Key size={16} weight="light" className="text-emerald" />
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
                        {identityLoading === 'password' ? <CircleNotch size={14} weight="light" className="animate-spin mr-1.5" /> : <Envelope size={14} weight="light" className="mr-1.5" />}
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

      {/* Password reset OTP flow */}
      {resetStep !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-[400px] bg-background border border-border rounded-2xl shadow-elevated p-6 space-y-5 animate-slide-up">
            {resetStep === 'otp' && (
              <OtpVerification
                email={userEmail}
                purpose="reset"
                isLoading={false}
                error={otpError}
                onVerify={handleVerifyResetOtp}
                onResend={handleResendResetOtp}
                onBack={() => { setResetStep('idle'); setOtpError(''); }}
              />
            )}

            {resetStep === 'new-password' && (
              <>
                <button
                  onClick={() => { setResetStep('otp'); setResetPasswordError(''); }}
                  disabled={resetPasswordLoading}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <ArrowLeft size={16} weight="light" />
                  Back
                </button>

                <div className="flex flex-col items-center text-center space-y-3">
                  <div className="w-14 h-14 rounded-full bg-emerald/10 flex items-center justify-center">
                    <Key size={28} weight="light" className="text-emerald" />
                  </div>
                  <div className="space-y-1.5">
                    <h2 className="text-xl font-bold text-foreground tracking-tight">Set new password</h2>
                    <p className="text-sm text-muted-foreground">Choose a strong password for your account</p>
                  </div>
                </div>

                {resetPasswordError && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/8 border border-destructive/20">
                    <div className="w-4 h-4 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-destructive" />
                    </div>
                    <p className="text-sm text-destructive leading-snug">{resetPasswordError}</p>
                  </div>
                )}

                <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="settings-new-pw" className="text-sm font-medium text-foreground">New password</Label>
                    <Input
                      id="settings-new-pw" type="password" placeholder="••••••••"
                      value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                      required minLength={6} disabled={resetPasswordLoading}
                      className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60"
                    />
                    <p className="text-xs text-muted-foreground">Minimum 6 characters</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="settings-confirm-pw" className="text-sm font-medium text-foreground">Confirm new password</Label>
                    <Input
                      id="settings-confirm-pw" type="password" placeholder="••••••••"
                      value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)}
                      required minLength={6} disabled={resetPasswordLoading}
                      className="h-10 bg-surface border-border focus-visible:border-emerald/60 focus-visible:ring-emerald/20 text-foreground placeholder:text-muted-foreground/60"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button" variant="outline"
                      onClick={() => { setResetStep('idle'); setResetPasswordError(''); }}
                      disabled={resetPasswordLoading}
                      className="flex-1 h-10"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit" disabled={resetPasswordLoading}
                      className="flex-1 h-10 bg-emerald hover:bg-emerald/90 text-white font-semibold"
                    >
                      {resetPasswordLoading ? (
                        <CircleNotch size={16} weight="light" className="animate-spin" />
                      ) : 'Update Password'}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

