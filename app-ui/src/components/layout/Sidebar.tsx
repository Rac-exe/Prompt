import { useState, useRef, useEffect } from "react";
import {
  Zap,
  Plus,
  Library,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  MoreVertical,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileMenu } from "./ProfileMenu";

/** Truncate a title to at most 4 words for sidebar display */
function shortTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length <= 4) return title.trim();
  return words.slice(0, 4).join(" ") + "…";
}

interface SidebarProps {
  currentView: "chat" | "library" | "settings" | "history";
  onViewChange: (view: "chat" | "library" | "settings" | "history") => void;
  recentChats: { id: string; title: string; date: string }[];
  onSelectChat: (id: string) => void;
  selectedChatId: string | null;
  onNewChat: () => void;
  onRenameChat?: (chatId: string, newTitle: string) => void;
  onDeleteChat?: (chatId: string) => void;
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
  onRenameChat,
  onDeleteChat,
  chatsLoading = false,
  chatsError,
}: SidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);

  // Rename state
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deleteChatId, setDeleteChatId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Track which dropdown is open so the dots icon stays visible
  const [openDropdownChatId, setOpenDropdownChatId] = useState<string | null>(null);

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

  // --- Rename handlers ---
  const startRename = (chatId: string, currentTitle: string) => {
    setRenamingChatId(chatId);
    setRenameValue(currentTitle);
  };

  useEffect(() => {
    if (renamingChatId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChatId]);

  const confirmRename = () => {
    if (!renamingChatId) return;
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      cancelRename();
      return;
    }
    if (onRenameChat) {
      onRenameChat(renamingChatId, trimmed);
    }
    setRenamingChatId(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingChatId(null);
    setRenameValue("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  };

  // --- Delete handlers ---
  const requestDelete = (chatId: string) => {
    setDeleteChatId(chatId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (deleteChatId && onDeleteChat) {
      onDeleteChat(deleteChatId);
    }
    setDeleteDialogOpen(false);
    setDeleteChatId(null);
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setDeleteChatId(null);
  };

  const chatToDelete = recentChats.find((c) => c.id === deleteChatId);

  // --- Render a single chat row ---
  const renderChatRow = (chat: { id: string; title: string; date: string }) => {
    const isSelected = selectedChatId === chat.id;
    const isDropdownOpen = openDropdownChatId === chat.id;

    return (
      <div
        className={cn(
          "group flex items-center rounded-md transition-button",
          isSelected && "bg-sidebar-accent",
          !isSelected && "hover:bg-sidebar-accent/50"
        )}
      >
        {/* Chat click target */}
        <button
          className={cn(
            "flex-1 flex items-center gap-3 h-9 px-3 text-sm cursor-pointer",
            isSelected && "text-emerald",
            !isSelected && "text-sidebar-foreground hover:text-foreground",
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
            <span className="whitespace-nowrap text-left">
              {shortTitle(chat.title)}
            </span>
          )}
        </button>

        {/* 3-dot menu */}
        {!collapsed && (
          <div
            className={cn(
              "flex-shrink-0 flex items-center justify-center w-7 transition-opacity duration-150",
              isDropdownOpen
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            )}
          >
            <DropdownMenu
              onOpenChange={(open) =>
                setOpenDropdownChatId(open ? chat.id : null)
              }
            >
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="right"
                sideOffset={4}
                className="w-48 bg-card border-border z-50"
              >
                <DropdownMenuItem
                  className="cursor-pointer text-foreground focus:bg-sidebar-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(chat.id, chat.title);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDelete(chat.id);
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
  };

  // --- Render a single chat item (rename mode or normal) ---
  const renderChatItem = (chat: { id: string; title: string; date: string }) => {
    const isRenaming = renamingChatId === chat.id;

    if (isRenaming && !collapsed) {
      return (
        <div key={chat.id} className="flex items-center gap-1 px-1 py-0.5">
          <Input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={confirmRename}
            className="h-8 text-sm bg-sidebar-accent border-emerald/50 focus-visible:ring-emerald/30 text-foreground flex-1 min-w-0"
            maxLength={100}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0 text-emerald hover:text-emerald hover:bg-emerald/10"
            onMouseDown={(e) => {
              e.preventDefault();
              confirmRename();
            }}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              cancelRename();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }

    const row = renderChatRow(chat);

    if (collapsed) {
      return (
        <Tooltip key={chat.id}>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent side="right">{chat.title}</TooltipContent>
        </Tooltip>
      );
    }

    return <div key={chat.id}>{row}</div>;
  };

  return (
    <>
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
        <div className="flex-1 min-h-0 overflow-hidden px-3">
          {!collapsed && (
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 px-3">
              Recent
            </p>
          )}
          <div className="h-full overflow-y-auto overflow-x-hidden">
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
                recentChats.map((chat) => renderChatItem(chat))
              )}
            </div>
          </div>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Delete Chat</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                &ldquo;{chatToDelete?.title}&rdquo;
              </span>
              ? This action cannot be undone and all messages in this chat will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={cancelDelete}
              className="bg-sidebar-accent text-foreground border-border hover:bg-sidebar-accent/80"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
