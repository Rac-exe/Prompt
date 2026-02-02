import { useState } from "react";
import { 
  Zap, 
  Plus, 
  Library,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { ProfileMenu } from "./ProfileMenu.tsx";

interface SidebarProps {
  currentView: "chat" | "library" | "settings";
  onViewChange: (view: "chat" | "library" | "settings") => void;
  userEmail: string;
  onLogout: () => void;
  onOpenHelp: () => void;
  recentChats: { id: string; title: string; date: string }[];
  onSelectChat: (id: string) => void;
  selectedChatId: string | null;
  onNewChat: () => void;
  isLoadingChats?: boolean;
}

export const Sidebar = ({
  currentView,
  onViewChange,
  userEmail,
  onLogout,
  onOpenHelp,
  recentChats,
  onSelectChat,
  selectedChatId,
  onNewChat,
  isLoadingChats = false,
}: SidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { id: "chat" as const, label: "New Chat", icon: Plus, action: onNewChat },
    { id: "library" as const, label: "Prompt Library", icon: Library },
  ];

  return (
    <div
      className={cn(
        "h-screen flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className={cn("flex items-center gap-3", collapsed && "justify-center w-full")}>
          <div className="w-9 h-9 rounded-lg bg-emerald flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <h1 className="font-bold text-foreground">Prompt Weaver</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Optimization Studio</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(true)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Collapse expand button when collapsed */}
      {collapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="mx-auto h-8 w-8 text-muted-foreground hover:text-foreground mb-2"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      )}

      {/* Navigation */}
      <div className="px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = item.id === currentView && item.id !== "chat";
          const Icon = item.icon;
          
          const button = (
            <Button
              key={item.id}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-3 h-10 transition-button",
                isActive && "bg-sidebar-accent text-emerald",
                !isActive && "text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent/50",
                collapsed && "justify-center px-2"
              )}
              onClick={() => {
                if (item.action) {
                  item.action();
                } else {
                  onViewChange(item.id);
                }
              }}
              data-testid={`nav-${item.id}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Button>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })}
      </div>

      <Separator className="my-4 bg-sidebar-border" />

      {/* Recent Chats */}
      <div className="flex-1 overflow-hidden px-3">
        {!collapsed && (
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Recent
          </p>
        )}
        <ScrollArea className="h-full">
          <div className="space-y-1 pb-4">
            {isLoadingChats ? (
              <div className="text-center py-8">
                <div className="animate-spin w-5 h-5 border-2 border-emerald border-t-transparent rounded-full mx-auto"></div>
                {!collapsed && (
                  <p className="text-xs text-muted-foreground mt-2">Loading...</p>
                )}
              </div>
            ) : recentChats.length === 0 ? (
              !collapsed && (
                <div className="text-center py-8">
                  <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-xs text-muted-foreground">No recent chats</p>
                </div>
              )
            ) : (
              recentChats.map((chat) => {
              const isSelected = selectedChatId === chat.id;
              
              const chatButton = (
                <Button
                  key={chat.id}
                  variant="ghost"
                  className={cn(
                    "w-full justify-start h-9 text-sm transition-button",
                    isSelected && "bg-sidebar-accent text-emerald",
                    !isSelected && "text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent/50",
                    collapsed && "justify-center px-2"
                  )}
                  onClick={() => {
                    onSelectChat(chat.id);
                    onViewChange("chat");
                  }}
                  data-testid={`chat-${chat.id}`}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && (
                    <span className="ml-3 truncate">{chat.title}</span>
                  )}
                </Button>
              );

              if (collapsed) {
                return (
                  <Tooltip key={chat.id}>
                    <TooltipTrigger asChild>{chatButton}</TooltipTrigger>
                    <TooltipContent side="right">{chat.title}</TooltipContent>
                  </Tooltip>
                );
              }

              return chatButton;
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* User Section with Profile Menu */}
      <div className="p-3 border-t border-sidebar-border">
        {!collapsed ? (
          <ProfileMenu
            userEmail={userEmail}
            onOpenSettings={() => onViewChange("settings")}
            onOpenHelp={onOpenHelp}
            onLogout={onLogout}
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full h-10"
                onClick={() => onViewChange("settings")}
              >
                <span className="w-8 h-8 rounded-full bg-emerald/20 text-emerald flex items-center justify-center text-sm font-medium">
                  {userEmail[0].toUpperCase()}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Profile Menu</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
