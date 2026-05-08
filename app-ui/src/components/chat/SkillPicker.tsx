import { useState, useEffect, useRef } from "react";
import * as Sentry from "@sentry/react";
import { Sparkle, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SKILL_ICON_MAP } from "@/lib/skillIcons";
import type { SkillInfo } from "@/types/electron";

export { SKILL_ICON_MAP } from "@/lib/skillIcons";

const MAX_SKILLS = 2;

interface SkillPickerProps {
  onToggle: (skillName: string) => void;
  activeSkills: string[];
  onClose: () => void;
  className?: string;
}

export const SkillPicker = ({ onToggle, activeSkills, onClose, className }: SkillPickerProps) => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ text: string; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const atCap = activeSkills.length >= MAX_SKILLS;

  useEffect(() => {
    (async () => {
      try {
        const skillList = await window.electronAPI.skills.list();
        setSkills(skillList);
      } catch (e) {
        console.error('[SkillPicker] Failed to load skills:', e);
        Sentry.captureException(e, { tags: { component: 'skill-picker', op: 'load-skills' } });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHoveredIndex(i => Math.min(i + 1, skills.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHoveredIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const skill = skills[hoveredIndex];
      if (skill) {
        const isActive = activeSkills.includes(skill.name);
        if (isActive || !atCap) onToggle(skill.name);
      }
    }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

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
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden max-h-[360px] py-1">
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground/60">Loading...</div>
        ) : skills.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground/60">No skills found</div>
        ) : skills.map((skill, index) => {
          const isHovered = hoveredIndex === index;
          const isActive = activeSkills.includes(skill.name);
          const isDisabled = atCap && !isActive;
          const Icon = SKILL_ICON_MAP[skill.name] ?? Sparkle;
          return (
            <button
              key={skill.name}
              onClick={() => { if (!isDisabled) onToggle(skill.name); }}
              onMouseEnter={(e) => { setHoveredIndex(index); showTooltip(skill, e); }}
              onMouseLeave={() => setTooltip(null)}
              className={cn(
                "w-full max-w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors relative",
                "hover:bg-black/5 dark:hover:bg-accent/50 focus:outline-none",
                isHovered && "bg-black/5 dark:bg-accent/40",
                isDisabled && "opacity-40 cursor-not-allowed"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-emerald" />
              )}

              <div className={cn(
                "w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0",
                isActive
                  ? "bg-emerald/15 border-emerald/30"
                  : "bg-muted/60 border-border/50"
              )}>
                <Icon size={16} weight="light" className="text-emerald" />
              </div>

              <span className="font-medium text-[13px] text-foreground truncate flex-1">
                {skill.label}
              </span>

              {isActive && (
                <Check size={14} weight="bold" className="text-emerald flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {atCap && (
        <div className="px-3 py-2 border-t border-border/50 text-[11px] text-muted-foreground/60 text-center">
          Max {MAX_SKILLS} skills selected
        </div>
      )}

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
