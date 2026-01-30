import { Clock, MessageSquare, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface HistoryItem {
  id: string;
  title: string;
  preview: string;
  date: Date;
  messageCount: number;
}

interface HistoryViewProps {
  items: HistoryItem[];
  onSelectItem: (id: string) => void;
  selectedId?: string;
}

export const HistoryView = ({ items, onSelectItem, selectedId }: HistoryViewProps) => {
  // Group items by date
  const groupedItems = items.reduce((groups, item) => {
    const now = new Date();
    const itemDate = item.date;
    const diffDays = Math.floor((now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
    
    let dateKey: string;
    if (diffDays === 0) {
      dateKey = "Today";
    } else if (diffDays === 1) {
      dateKey = "Yesterday";
    } else if (diffDays < 7) {
      dateKey = itemDate.toLocaleDateString("en-US", { weekday: "long" });
    } else {
      dateKey = itemDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: itemDate.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      });
    }
    
    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(item);
    return groups;
  }, {} as Record<string, HistoryItem[]>);

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-border bg-surface/50">
        <h2 className="text-2xl font-bold text-foreground mb-1">History</h2>
        <p className="text-muted-foreground">
          Your prompt optimization sessions
        </p>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {items.length === 0 ? (
            <div className="text-center py-12 animate-fade-in">
              <Clock className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No history yet</p>
              <p className="text-sm text-muted-foreground/70">
                Start a chat to see your history here
              </p>
            </div>
          ) : (
            Object.entries(groupedItems).map(([date, dateItems]) => (
              <div key={date} className="animate-fade-in">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  {date}
                </h3>
                <div className="space-y-2">
                  {dateItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onSelectItem(item.id)}
                      className={cn(
                        "w-full text-left p-4 rounded-xl border transition-button group",
                        selectedId === item.id
                          ? "bg-secondary border-emerald/50 glow-emerald"
                          : "bg-surface border-border hover:border-emerald/30 hover:bg-surface-hover"
                      )}
                      data-testid={`history-item-${item.id}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-foreground line-clamp-1">
                          {item.title}
                        </h4>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-emerald transition-colors" />
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                        {item.preview}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>
                            {item.date.toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          <span>{item.messageCount} messages</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
