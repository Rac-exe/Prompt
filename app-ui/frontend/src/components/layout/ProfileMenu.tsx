import { useState } from "react";
import { User, Settings, HelpCircle, LogOut, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Avatar, AvatarFallback } from "@/components/ui/avatar.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";

interface ProfileMenuProps {
  userEmail: string;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onLogout: () => void;
}

export const ProfileMenu = ({
  userEmail,
  onOpenSettings,
  onOpenHelp,
  onLogout,
}: ProfileMenuProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between gap-2 h-auto p-2 hover:bg-sidebar-accent/50 transition-button"
          data-testid="profile-menu-trigger"
        >
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-emerald/20 text-emerald text-sm">
                {userEmail[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-foreground truncate">{userEmail}</p>
              <p className="text-xs text-muted-foreground">Free tier</p>
            </div>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent
        align="end"
        side="top"
        className="w-56 bg-card border-border"
      >
        <DropdownMenuItem
          onClick={onOpenSettings}
          className="cursor-pointer"
          data-testid="profile-menu-settings"
        >
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </DropdownMenuItem>
        
        <DropdownMenuItem
          onClick={onOpenHelp}
          className="cursor-pointer"
          data-testid="profile-menu-help"
        >
          <HelpCircle className="w-4 h-4 mr-2" />
          Help & Docs
        </DropdownMenuItem>
        
        <DropdownMenuSeparator className="bg-border" />
        
        <DropdownMenuItem
          onClick={onLogout}
          className="cursor-pointer text-destructive focus:text-destructive"
          data-testid="profile-menu-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
