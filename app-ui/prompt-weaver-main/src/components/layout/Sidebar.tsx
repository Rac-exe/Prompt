import { useState } from "react";
import { 
  Zap, 
  Plus, 
  Library, 
  Clock, 
  LogOut, 
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Settings,
  HelpCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarProps {
  currentView: "chat" | "library" | "history" | "settings";
  onViewChange: (view: "chat" | "library" | "history" | "settings") => void;
  userEmail: string;
  onLogout: () => void;
  recentChats: { id: string; title: string; date: string }[];
  onSelectChat: (id: string) => void;
  selectedChatId: string | null;
  onNewChat: () => void;
}

export const Sidebar = ({
  currentView,
  onViewChange,
  userEmail,
  onLogout,
  recentChats,
  onSelectChat,
  selectedChatId,
  onNewChat,
}: SidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { id: "chat" as const, label: "New Chat", icon: Plus, action: onNewChat },
    { id: "library" as const, label: "Prompt Library", icon: Library },
    { id: "history" as const, label: "History", icon: Clock },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];

  const handleHelpClick = () => {
    window.open("https://docs.promptweaver.app", "_blank");
  };

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
        
        {/* Help & Docs */}
        {(() => {
          const button = (
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 h-10 transition-button text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent/50",
                collapsed && "justify-center px-2"
              )}
              onClick={handleHelpClick}
              data-testid="nav-help"
            >
              <HelpCircle className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Help & Docs</span>}
            </Button>
          );

          if (collapsed) {
            return (
              <Tooltip key="help">
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right">Help & Docs</TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })()}
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
            {recentChats.map((chat) => {
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
            })}
          </div>
        </ScrollArea>
      </div>

      {/* User Section */}
      <div className="p-3 border-t border-sidebar-border">
        <div className={cn(
          "flex items-center gap-3 p-2 rounded-lg bg-sidebar-accent/50",
          collapsed && "justify-center"
        )}>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-emerald/20 text-emerald text-sm">
              {userEmail[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0 animate-fade-in">
              <p className="text-sm font-medium text-foreground truncate">{userEmail}</p>
              <p className="text-xs text-muted-foreground">Free tier</p>
            </div>
          )}
        </div>
        
        <div className={cn("flex gap-1 mt-2", collapsed && "flex-col")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "text-muted-foreground hover:text-foreground transition-button",
                  collapsed ? "w-full justify-center" : "flex-1"
                )}
                onClick={onLogout}
                data-testid="logout-button"
              >
                <LogOut className="w-4 h-4" />
                {!collapsed && <span className="ml-2">Sign Out</span>}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Sign Out</TooltipContent>}
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
