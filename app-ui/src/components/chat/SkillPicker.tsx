import { useState, useEffect, useRef } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SKILL_ICON_MAP } from "@/lib/skillIcons";
import type { SkillInfo } from "@/types/electron";

export { SKILL_ICON_MAP } from "@/lib/skillIcons";

interface SkillPickerProps {
  onSelect: (skillName: string) => void;
  onClose: () => void;
  className?: string;
}

export const SkillPicker = ({ onSelect, onClose, className }: SkillPickerProps) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ text: string; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, skills.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (skills[selectedIndex]) onSelect(skills[selectedIndex].name); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // Calculate tooltip top position relative to the panel so it aligns with the hovered button,
  // even when the list is scrolled. Must live outside the overflow container to avoid clipping.
  const showTooltip = (skill: SkillInfo, e: React.MouseEvent<HTMLButtonElement>) => {
    if (!skill.description || !panelRef.current) return;
    const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    setTooltip({
      text: skill.description,
      top: btnRect.top - panelRect.top + btnRect.height / 2,
    });
  };

  return (
    // `relative` here is the containing block for the tooltip (NOT the scroll div).
    // No overflow clipping on this element so the tooltip can extend to the right.
    <div
      ref={panelRef}
      className={cn(
        "w-[280px] flex flex-col rounded-xl border border-border bg-popover shadow-2xl relative",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2",
        !className && "absolute bottom-full left-0 mb-2",
        className
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Scroll container — overflow-x-hidden kills the horizontal scrollbar;
          overflow-y-auto handles vertical scroll. Tooltip is NOT inside here. */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden max-h-[360px] py-1">
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground/60">Loading...</div>
        ) : skills.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground/60">No skills found</div>
        ) : skills.map((skill, index) => {
          const isSelected = selectedIndex === index;
          const Icon = SKILL_ICON_MAP[skill.name] ?? Sparkle;
          return (
            <button
              key={skill.name}
              onClick={() => onSelect(skill.name)}
              onMouseEnter={(e) => { setSelectedIndex(index); showTooltip(skill, e); }}
              onMouseLeave={() => setTooltip(null)}
              className={cn(
                "w-full max-w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors relative",
                "hover:bg-accent/50 focus:outline-none",
                isSelected && "bg-accent/40"
              )}
            >
              {/* Left accent bar */}
              {isSelected && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-emerald" />
              )}

              {/* Icon square */}
              <div className="w-8 h-8 rounded-lg bg-muted/60 border border-border/50 flex items-center justify-center flex-shrink-0">
                <Icon size={16} weight="light" className="text-emerald" />
              </div>

              {/* Name only — no description inline */}
              <span className="font-medium text-[13px] text-foreground truncate">
                {skill.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tooltip — rendered at panel level, outside the overflow container.
          Positioned absolute relative to the panel (not the scroll div),
          so overflow-x-hidden on the scroll div cannot clip it. */}
      {tooltip && (
        <div
          className="absolute left-full ml-2 z-50 pointer-events-none w-[220px] px-3 py-2 rounded-lg shadow-lg bg-[#111] border border-white/10 text-xs text-white/70 leading-relaxed"
          style={{ top: tooltip.top, transform: "translateY(-50%)" }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
};
