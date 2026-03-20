import { useState, useEffect, useRef } from "react";
import { Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SkillInfo } from "@/types/electron";

interface SkillPickerProps {
  onSelect: (skillName: string) => void;
  onClose: () => void;
  className?: string;
}

export const SkillPicker = ({ onSelect, onClose, className }: SkillPickerProps) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const skillList = await window.electronAPI.skills.list();
        setSkills(skillList);
      } catch (e) {
        console.error('[SkillPicker] Failed to load skills:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setSelectedIndex(0); }, [filter]);

  const filteredSkills = skills.filter(s =>
    s.label.toLowerCase().includes(filter.toLowerCase()) ||
    s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.description.toLowerCase().includes(filter.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filteredSkills.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filteredSkills[selectedIndex]) onSelect(filteredSkills[selectedIndex].name); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div
      className={cn(
        "w-80 rounded-lg border bg-popover shadow-lg",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2",
        !className && "absolute bottom-full left-0 mb-2",
        className
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Search */}
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search skills..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Scrollable list — fixed height so it scrolls */}
      <ScrollArea className="h-56">
        <div className="p-1">
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading skills...</div>
          ) : filteredSkills.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No skills found</div>
          ) : filteredSkills.map((skill, index) => (
            <button
              key={skill.name}
              onClick={() => onSelect(skill.name)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "w-full rounded-md px-3 py-2.5 text-left transition-colors",
                "hover:bg-accent focus:bg-accent focus:outline-none",
                selectedIndex === index && "bg-accent"
              )}
            >
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{skill.label}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {skill.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium">↑↓</span> Navigate{" "}
        <span className="font-medium">Enter</span> Select{" "}
        <span className="font-medium">Esc</span> Close
      </div>
    </div>
  );
};
