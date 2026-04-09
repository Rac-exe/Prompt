import { useState, useRef, useEffect } from "react";
import { Logo } from "@/components/ui/Logo";
import {
  Lightning, Plus, Books,
  SidebarSimple,
  CircleNotch, WarningCircle, DotsThree,
  Trash, PencilSimple, Check, X,
} from "@phosphor-icons/react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileMenu } from "./ProfileMenu";
import { FeedbackModal } from "@/components/feedback/FeedbackModal";

function shortTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length <= 6) return title.trim();
  return words.slice(0, 6).join(" ") + "…";
}

interface SidebarProps {
  currentView: "chat" | "library" | "settings" | "history" | "shared-library";
  onViewChange: (view: "chat" | "library" | "settings" | "history" | "shared-library") => void;
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
  currentView, onViewChange, recentChats, onSelectChat,
  selectedChatId, onNewChat, onRenameChat, onDeleteChat,
  chatsLoading = false, chatsError,
}: SidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [deleteChatId, setDeleteChatId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [openDropdownChatId, setOpenDropdownChatId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const handleFeedbackSubmit = async (rating: "positive" | "negative", comment?: string) => {
    try {
      await window.electronAPI?.feedback?.submit({ rating, comment });
    } catch {
      // non-fatal — modal already handles its own close
    }
  };

  const navItems = [
    { id: "chat" as const, label: "New Chat", icon: Plus, action: onNewChat },
    { id: "library" as const, label: "Prompt Library", icon: Books },
  ];

  useEffect(() => {
    if (renamingChatId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChatId]);

  const startRename = (chatId: string, currentTitle: string) => {
    setRenamingChatId(chatId);
    setRenameValue(currentTitle);
  };

  const confirmRename = () => {
    if (!renamingChatId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) { cancelRename(); return; }
    onRenameChat?.(renamingChatId, trimmed);
    setRenamingChatId(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingChatId(null);
    setRenameValue("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  { e.preventDefault(); confirmRename(); }
    if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
  };

  const requestDelete = (chatId: string) => {
    setDeleteChatId(chatId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (deleteChatId) onDeleteChat?.(deleteChatId);
    setDeleteDialogOpen(false);
    setDeleteChatId(null);
  };

  const chatToDelete = recentChats.find((c) => c.id === deleteChatId);

  /* ── Chat row ─────────────────────────────────────────────── */
  const renderChatRow = (chat: { id: string; title: string; date: string }) => {
    const isSelected = selectedChatId === chat.id;
    const isDropdownOpen = openDropdownChatId === chat.id;

    return (
      <div
        className={cn(
          "group flex items-center rounded-lg transition-smooth",
          isSelected
            ? "bg-sidebar-accent"
            : "hover:bg-sidebar-accent/60"
        )}
      >
        <button
          className={cn(
            "flex-1 flex items-center gap-2.5 h-8 px-2.5 text-[13px] cursor-pointer min-w-0",
            isSelected ? "text-emerald font-medium" : "text-sidebar-foreground hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-2"
          )}
          onClick={() => { onSelectChat(chat.id); onViewChange("chat"); }}
          data-testid={`chat-${chat.id}`}
        >
          {!collapsed && (
            <span className="truncate text-left" title={chat.title}>{shortTitle(chat.title)}</span>
          )}
        </button>

        {!collapsed && (
          <div
            className={cn(
              "flex-shrink-0 flex items-center justify-center w-7 h-7 mr-1 transition-opacity duration-150",
              isDropdownOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          >
            <DropdownMenu onOpenChange={(open) => setOpenDropdownChatId(open ? chat.id : null)}>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/10 dark:hover:bg-sidebar-accent hover:shadow-sm focus:outline-none transition-smooth"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DotsThree size={14} weight="light" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start" side="right" sideOffset={6}
                className="w-44 bg-popover border-border shadow-elevated z-50 rounded-lg"
              >
                <DropdownMenuItem
                  className="cursor-pointer text-sm text-foreground focus:bg-secondary gap-2 rounded-md"
                  onClick={(e) => { e.stopPropagation(); startRename(chat.id, chat.title); }}
                >
                  <PencilSimple size={14} weight="light" className="opacity-70" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border my-1" />
                <DropdownMenuItem
                  className="cursor-pointer text-sm text-destructive focus:bg-destructive/8 focus:text-destructive gap-2 rounded-md"
                  onClick={(e) => { e.stopPropagation(); requestDelete(chat.id); }}
                >
                  <Trash size={14} weight="light" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    );
  };

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
            className="h-7 text-[13px] bg-sidebar-accent border-emerald/40 focus-visible:ring-emerald/20 text-foreground flex-1 min-w-0 rounded-md"
            maxLength={100}
          />
          <button
            className="w-6 h-6 flex items-center justify-center rounded-md text-emerald hover:bg-emerald/10 transition-smooth flex-shrink-0"
            onMouseDown={(e) => { e.preventDefault(); confirmRename(); }}
          >
            <Check size={12} weight="light" />
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-smooth flex-shrink-0"
            onMouseDown={(e) => { e.preventDefault(); cancelRename(); }}
          >
            <X size={12} weight="light" />
          </button>
        </div>
      );
    }

    const row = renderChatRow(chat);
    if (collapsed) {
      return (
        <Tooltip key={chat.id}>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs">{chat.title}</TooltipContent>
        </Tooltip>
      );
    }
    return <div key={chat.id}>{row}</div>;
  };

  /* ── Shell ────────────────────────────────────────────────── */
  return (
    <>
      <div
        className={cn(
          "h-full flex flex-col bg-sidebar border-r border-sidebar-border transition-[width,padding] duration-300 ease-in-out",
          collapsed ? "w-[60px]" : "w-[240px]"
        )}
      >
        {/* ── Brand header (draggable for window movement) ── */}
        <div
          className={cn(
            "flex items-center h-14 px-3 border-b border-sidebar-border flex-shrink-0",
            collapsed ? "justify-center" : "justify-between"
          )}
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div className={cn("flex items-center gap-2.5 min-w-0", collapsed && "justify-center")}>
            <Logo size="w-8 h-8" />
            {!collapsed && (
              <div className="min-w-0 animate-fade-in">
                <p className="text-[13px] font-bold text-gradient-primary leading-none tracking-tight">Prmpt</p>
                <p className="label-xs mt-0.5">Studio</p>
              </div>
            )}
          </div>

          {!collapsed && (
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent flex-shrink-0 transition-smooth"
              onClick={() => setCollapsed(true)}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <SidebarSimple size={16} weight="light" />
            </Button>
          )}
        </div>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="px-1.5 pt-2 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
          <Button
                  variant="ghost" size="icon"
                  className="h-8 w-full text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-smooth"
            onClick={() => setCollapsed(false)}
          >
                  <SidebarSimple size={16} weight="light" />
          </Button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Expand sidebar</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* ── Navigation ── */}
        <div className={cn("px-2 pt-3 space-y-0.5 flex-shrink-0", collapsed && "px-1.5")}>
          {navItems.map((item) => {
            const isActive = item.id === currentView && item.id !== "chat";
            const Icon = item.icon;

            const button = (
              <button
                key={item.id}
                className={cn(
                  "w-full flex items-center rounded-lg h-9 text-[13px] font-medium transition-smooth",
                  collapsed ? "justify-center px-2" : "gap-2.5 px-2.5",
                  isActive
                    ? "bg-sidebar-accent text-emerald"
                    : "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/60"
                )}
                onClick={() => {
                  if (item.action) item.action();
                  else onViewChange(item.id);
                }}
                data-testid={`nav-${item.id}`}
              >
                <Icon size={16} weight="light" className="flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return button;
          })}
        </div>

        {/* ── Section divider ── */}
        <div className={cn("px-3 pt-5 pb-1.5 flex-shrink-0", collapsed && "px-2")}>
          <div className="border-t border-sidebar-border" />
          {!collapsed && (
            <p className="label-xs mt-3 px-0.5">Recent</p>
          )}
        </div>

        {/* ── Chat list ── */}
        <div className={cn("flex-1 min-h-0 overflow-hidden", collapsed ? "px-1.5" : "px-2")}>
          <div className="h-full overflow-y-auto overflow-x-hidden">
            <div className="space-y-0.5 pb-4">
              {chatsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <CircleNotch size={16} weight="light" className="animate-spin text-emerald" />
                </div>
              ) : chatsError ? (
                <div className="flex flex-col items-center justify-center py-8 px-3">
                  <WarningCircle size={16} weight="light" className="text-destructive mb-1.5" />
                  {!collapsed && <p className="text-xs text-destructive text-center">Failed to load chats</p>}
                </div>
              ) : recentChats.length === 0 ? (
                !collapsed && (
                  <div className="py-8 text-center">
                    <p className="text-xs text-muted-foreground/60">No recent chats</p>
                  </div>
                )
              ) : (
                recentChats.map((chat) => renderChatItem(chat))
              )}
            </div>
          </div>
        </div>

        {/* ── User section ── */}
        <div className={cn("flex-shrink-0 border-t border-sidebar-border", collapsed ? "p-1.5" : "p-2")}>
          <ProfileMenu
            onSettingsClick={() => onViewChange("settings")}
            onHelpClick={() => window.electronAPI?.openExternal("https://www.tryprmpt.com/help")}
            onFeedbackClick={() => setFeedbackOpen(true)}
            collapsed={collapsed}
          />
        </div>
      </div>

      {/* ── Feedback modal ── */}
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSubmit={handleFeedbackSubmit}
      />

      {/* ── Delete dialog ── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-card border-border shadow-elevated rounded-xl max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground text-base font-semibold">Delete chat?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm leading-relaxed">
              <span className="font-medium text-foreground">&ldquo;{chatToDelete?.title}&rdquo;</span> and all
              its messages will be permanently removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel
              onClick={() => { setDeleteDialogOpen(false); setDeleteChatId(null); }}
              className="h-9 bg-secondary text-foreground border-border hover:bg-secondary/80 text-sm font-medium"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm font-medium"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
