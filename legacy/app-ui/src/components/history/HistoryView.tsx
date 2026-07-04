import { Clock, ChatText, CaretRight } from "@phosphor-icons/react";
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
  const groupedItems = items.reduce((groups, item) => {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - item.date.getTime()) / (1000 * 60 * 60 * 24));

    let dateKey: string;
    if (diffDays === 0)      dateKey = "Today";
    else if (diffDays === 1) dateKey = "Yesterday";
    else if (diffDays < 7)  dateKey = item.date.toLocaleDateString("en-US", { weekday: "long" });
    else                    dateKey = item.date.toLocaleDateString("en-US", {
      month: "long", day: "numeric",
      year: item.date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });

    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(item);
    return groups;
  }, {} as Record<string, HistoryItem[]>);

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-6 flex-shrink-0 bg-surface/40">
        <h2 className="text-sm font-bold text-foreground tracking-tight">History</h2>
        {items.length > 0 && (
          <span className="ml-2 px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground text-[10px] font-semibold">
            {items.length}
          </span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
              <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
                <Clock size={24} weight="light" className="text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No history yet</p>
              <p className="text-xs text-muted-foreground">Start a chat to see your optimization sessions here</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-2xl mx-auto">
              {Object.entries(groupedItems).map(([date, dateItems]) => (
                <div key={date} className="animate-fade-in">
                  <p className="label-sm mb-2.5">{date}</p>
                  <div className="space-y-2">
                    {dateItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => onSelectItem(item.id)}
                        className={cn(
                          "w-full text-left px-4 py-3.5 rounded-xl border transition-smooth group",
                          selectedId === item.id
                            ? "bg-surface border-emerald/40 glow-emerald-sm"
                            : "bg-surface border-border hover:border-emerald/30 hover:bg-surface-hover"
                        )}
                        data-testid={`history-item-${item.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-foreground truncate leading-snug">
                              {item.title}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5 leading-relaxed">
                              {item.preview}
                            </p>
                          </div>
                          <CaretRight size={16} weight="light" className="text-muted-foreground/40 group-hover:text-emerald transition-smooth flex-shrink-0 mt-0.5" />
                        </div>

                        <div className="flex items-center gap-4 mt-2.5">
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                            <Clock size={10} weight="light" />
                            <span>{item.date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                            <ChatText size={10} weight="light" />
                            <span>{item.messageCount} messages</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
