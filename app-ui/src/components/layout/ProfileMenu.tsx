import { Settings, HelpCircle, LogOut, CreditCard } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-smooth w-full text-foreground/90 border border-transparent hover:border-border/50",
            collapsed ? "justify-center p-1.5" : "gap-2.5 px-2 py-1.5"
          )}
        >
          <Avatar className="h-7 w-7 flex-shrink-0">
            <AvatarFallback className="bg-emerald/15 text-emerald text-xs font-semibold">
              {userInitial}
            </AvatarFallback>
          </Avatar>
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
          <p className="text-[13px] font-semibold text-foreground truncate">{userName}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{userEmail}</p>
          <div className="inline-flex items-center gap-1.5 mt-1.5 px-1.5 py-0.5 rounded-full bg-emerald-muted">
            <div className="w-1 h-1 rounded-full bg-emerald" />
            <span className="text-[10px] font-semibold text-emerald tracking-wide uppercase">Free Plan</span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="bg-border my-1" />

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
  );
};
