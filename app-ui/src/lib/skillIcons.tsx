import type { ElementType } from "react";
import {
  Settings2,
  Briefcase,
  MessageSquare,
  Palette,
  GraduationCap,
  FlaskConical,
  Code2,
  ImageIcon,
} from "lucide-react";

/** Lucide icon per skill id — shared by composer, message bubbles, and pickers */
export const SKILL_ICON_MAP: Record<string, ElementType> = {
  automation: Settings2,
  business: Briefcase,
  communication: MessageSquare,
  creative: Palette,
  educational: GraduationCap,
  research: FlaskConical,
  technical: Code2,
  visual: ImageIcon,
};
