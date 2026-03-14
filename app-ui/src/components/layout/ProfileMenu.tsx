import { useState } from "react";
import { Settings, HelpCircle, LogOut, Camera } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AvatarUploadModal } from "@/components/profile/AvatarUploadModal";
import { toast } from "@/hooks/use-toast";

interface ProfileMenuProps {
  onSettingsClick: () => void;
  onHelpClick: () => void;
  collapsed?: boolean;
}

export const ProfileMenu = ({ onSettingsClick, onHelpClick, collapsed = false }: ProfileMenuProps) => {
  const { user, signOut } = useAuth();
  const userEmail = user?.profile?.email || "user@example.com";
  const userName = user?.profile?.name || userEmail.split("@")[0];
  const userInitial = (user?.profile?.name?.[0] || userEmail[0] || "U").toUpperCase();
  const avatarUrl = user?.profile?.avatar_url || null;

  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Save uploaded avatar URL to Supabase via the existing updateProfile IPC
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex items-center rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-smooth w-full text-foreground/90 border border-transparent hover:border-border/50",
              collapsed ? "justify-center p-1.5" : "gap-2.5 px-2 py-1.5"
            )}
          >
            {/* Avatar with hover edit indicator */}
            <div className="relative group flex-shrink-0">
              <Avatar className="h-7 w-7">
                {avatarUrl && (
                  <AvatarImage src={avatarUrl} alt={userName} className="object-cover" />
                )}
                <AvatarFallback className="bg-emerald/15 text-emerald text-xs font-semibold">
                  {userInitial}
                </AvatarFallback>
              </Avatar>
              {/* Hover edit overlay */}
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-3 h-3 text-white" />
              </div>
            </div>

            {!collapsed && (
              <div className="flex-1 min-w-0 text-left animate-fade-in">
                <p className="text-[13px] font-medium text-foreground truncate leading-none">{userName}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate leading-none">Free plan</p>
              </div>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align={collapsed ? "end" : "start"}
          side={collapsed ? "right" : "top"}
          sideOffset={8}
          className="w-52 bg-popover border-border shadow-elevated rounded-xl p-1"
        >
          <DropdownMenuLabel className="px-2 py-2">
            <div className="flex items-center gap-2.5">
              {/* Avatar in dropdown header */}
              <div className="relative group flex-shrink-0">
                <Avatar className="h-9 w-9">
                  {avatarUrl && (
                    <AvatarImage src={avatarUrl} alt={userName} className="object-cover" />
                  )}
                  <AvatarFallback className="bg-emerald/15 text-emerald text-sm font-semibold">
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground truncate">{userName}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{userEmail}</p>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 mt-1.5 px-1.5 py-0.5 rounded-full bg-emerald-muted">
              <div className="w-1 h-1 rounded-full bg-emerald" />
              <span className="text-[10px] font-semibold text-emerald tracking-wide uppercase">Free Plan</span>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator className="bg-border my-1" />

          {/* Change avatar */}
          <DropdownMenuItem
            onClick={() => setUploadModalOpen(true)}
            className="cursor-pointer text-sm text-foreground focus:bg-secondary gap-2.5 rounded-lg px-2 py-1.5 font-medium"
          >
            <Camera className="w-3.5 h-3.5 opacity-60" />
            Change Avatar
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={onSettingsClick}
            className="cursor-pointer text-sm text-foreground focus:bg-secondary gap-2.5 rounded-lg px-2 py-1.5 font-medium"
          >
            <Settings className="w-3.5 h-3.5 opacity-60" />
            Settings
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={onHelpClick}
            className="cursor-pointer text-sm text-foreground focus:bg-secondary gap-2.5 rounded-lg px-2 py-1.5 font-medium"
          >
            <HelpCircle className="w-3.5 h-3.5 opacity-60" />
            Help & Docs
          </DropdownMenuItem>

          <DropdownMenuSeparator className="bg-border my-1" />

          <DropdownMenuItem
            onClick={signOut}
            className="cursor-pointer text-sm text-destructive focus:bg-destructive/8 focus:text-destructive gap-2.5 rounded-lg px-2 py-1.5 font-medium"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Avatar upload modal */}
      <AvatarUploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        currentAvatarUrl={avatarUrl}
        onAvatarUploaded={handleAvatarUploaded}
      />
    </>
  );
};
