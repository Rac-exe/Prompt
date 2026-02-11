import { useState } from "react";
import {
  Zap,
  Plus,
  Library,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  MoreHorizontal,
  Trash2,
  Pencil,
  Archive,
  Share
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileMenu } from "./ProfileMenu";

interface SidebarProps {
  currentView: "chat" | "library" | "settings" | "history";
  onViewChange: (view: "chat" | "library" | "settings" | "history") => void;
  recentChats: { id: string; title: string; date: string }[];
  onSelectChat: (id: string) => void;
  selectedChatId: string | null;
  onNewChat: () => void;
  chatsLoading?: boolean;
  chatsError?: string;
}

export const Sidebar = ({
  currentView,
  onViewChange,
  recentChats,
  onSelectChat,
  selectedChatId,
  onNewChat,
  chatsLoading = false,
  chatsError,
}: SidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { id: "chat" as const, label: "New Chat", icon: Plus, action: onNewChat },
    { id: "library" as const, label: "Prompt Library", icon: Library },
  ];

  const handleHelpClick = () => {
    window.open("https://docs.promptweaver.app", "_blank");
  };

  const handleSettingsClick = () => {
    onViewChange("settings");
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
            {chatsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-emerald" />
              </div>
            ) : chatsError ? (
              <div className="flex flex-col items-center justify-center py-8 px-4">
                <AlertCircle className="w-5 h-5 text-destructive mb-2" />
                {!collapsed && (
                  <p className="text-xs text-destructive text-center">
                    Failed to load chats
                  </p>
                )}
              </div>
            ) : recentChats.length === 0 ? (
              !collapsed && (
                <div className="py-8 px-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    No recent chats
                  </p>
                </div>
              )
            ) : (
              recentChats.map((chat) => {
                const isSelected = selectedChatId === chat.id;

                const ChatItem = (
                  <div key={chat.id} className="group relative">
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-start h-9 text-sm transition-button pr-8",
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

                    {!collapsed && (
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                              <MoreHorizontal className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 bg-card border-border">
                            <DropdownMenuItem className="cursor-pointer text-foreground focus:bg-sidebar-accent">
                              <Share className="mr-2 h-4 w-4" />
                              <span>Share</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer text-foreground focus:bg-sidebar-accent">
                              <Pencil className="mr-2 h-4 w-4" />
                              <span>Rename</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer text-foreground focus:bg-sidebar-accent">
                              <Archive className="mr-2 h-4 w-4" />
                              <span>Archive</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-border" />
                            <DropdownMenuItem
                              className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.electronAPI.deleteChat(chat.id);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              <span>Delete</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                );

                if (collapsed) {
                  return (
                    <Tooltip key={chat.id}>
                      <TooltipTrigger asChild>{ChatItem}</TooltipTrigger>
                      <TooltipContent side="right">{chat.title}</TooltipContent>
                    </Tooltip>
                  );
                }

                return ChatItem;
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* User Section with Profile Menu */}
      <div className="p-3 border-t border-sidebar-border">
        <ProfileMenu
          onSettingsClick={handleSettingsClick}
          onHelpClick={handleHelpClick}
          collapsed={collapsed}
        />
      </div>
    </div>
  );
};
