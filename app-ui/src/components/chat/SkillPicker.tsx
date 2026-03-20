import { useState, useEffect, useRef } from "react";
import { Search, Settings2, Briefcase, MessageSquare, Palette, GraduationCap, FlaskConical, Code2, ImageIcon, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SkillInfo } from "@/types/electron";

interface SkillPickerProps {
  onSelect: (skillName: string) => void;
  onClose: () => void;
  className?: string;
}

// Map skill names to specific icons
const SKILL_ICON_MAP: Record<string, React.ElementType> = {
  automation:    Settings2,
  business:      Briefcase,
  communication: MessageSquare,
  creative:      Palette,
  educational:   GraduationCap,
  research:      FlaskConical,
  technical:     Code2,
  visual:        ImageIcon,
};

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
        "w-[500px] flex flex-col rounded-xl border border-border bg-popover shadow-2xl",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2",
        !className && "absolute bottom-full left-0 mb-2",
        className
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Search */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search skills..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-9 h-10 bg-background border-border text-sm"
          />
        </div>
      </div>

      {/* Skill list — plain scrollable div, no ScrollArea wrapper */}
      <div className="flex-1 min-h-0 overflow-y-auto max-h-[400px] py-1">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">Loading skills...</div>
        ) : filteredSkills.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">No skills found</div>
        ) : filteredSkills.map((skill, index) => {
          const isSelected = selectedIndex === index;
          const Icon = SKILL_ICON_MAP[skill.name] ?? Sparkles;
          return (
            <button
              key={skill.name}
              onClick={() => onSelect(skill.name)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "w-full flex items-center gap-4 px-4 py-3.5 text-left transition-colors relative",
                "hover:bg-accent/50 focus:outline-none",
                isSelected && "bg-accent/40"
              )}
            >
              {/* Left accent bar */}
              {isSelected && (
                <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-emerald" />
              )}

              {/* Icon square */}
              <div className="w-11 h-11 rounded-xl bg-muted/60 border border-border/50 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-emerald" />
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[15px] leading-snug text-foreground">
                  {skill.label}
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed whitespace-normal break-words line-clamp-2 mt-0.5">
                  {skill.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[11px] text-muted-foreground/50 flex-shrink-0">
        <span><kbd className="font-semibold text-muted-foreground/70">↑↓</kbd> navigate</span>
        <span><kbd className="font-semibold text-muted-foreground/70">↵</kbd> select</span>
        <span><kbd className="font-semibold text-muted-foreground/70">esc</kbd> close</span>
      </div>
    </div>
  );
};
