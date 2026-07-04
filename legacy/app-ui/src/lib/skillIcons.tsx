import type { ElementType } from "react";
import {
  GearSix,
  Briefcase,
  ChatText,
  Palette,
  GraduationCap,
  Flask,
  Code,
  ImageSquare,
} from "@phosphor-icons/react";

/** Phosphor icon per skill id — shared by composer, message bubbles, and pickers */
export const SKILL_ICON_MAP: Record<string, ElementType> = {
  automation: GearSix,
  business: Briefcase,
  communication: ChatText,
  creative: Palette,
  educational: GraduationCap,
  research: Flask,
  technical: Code,
  visual: ImageSquare,
};
