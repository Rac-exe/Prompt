import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface SkillInfo {
  name: string;
  label: string;
  description: string;
}

/**
 * Extract skill metadata from markdown file.
 * - Label  : strips "SKILL FILE:" prefix, title-cases the result.
 * - Description: "Use this skill when the request involves: " +
 *                first two bullet items from the WHEN TO USE section.
 */
function parseSkillMetadata(content: string, skillName: string): SkillInfo {
  const lines = content.split('\n');

  // ── Label ──────────────────────────────────────────────────────────────────
  let label = skillName.charAt(0).toUpperCase() + skillName.slice(1).toLowerCase();
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)/);
    if (m) {
      const raw = m[1].replace(/^SKILL\s+FILE:\s*/i, '').trim();
      label = raw
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      break;
    }
  }

  // ── Description ────────────────────────────────────────────────────────────
  // Collect the first two bullet items under "## WHEN TO USE THIS SKILL"
  let description = '';
  let inSection = false;
  const bullets: string[] = [];

  for (const line of lines) {
    if (/^##\s+WHEN TO USE/i.test(line)) { inSection = true; continue; }
    if (inSection && line.startsWith('##')) break;
    if (inSection && line.startsWith('- ')) {
      const bullet = line.replace(/^-\s*/, '').trim();
      if (bullet) {
        bullets.push(bullet.charAt(0).toLowerCase() + bullet.slice(1));
        if (bullets.length >= 2) break;
      }
    }
  }

  if (bullets.length > 0) {
    // Join bullets naturally, no verbose prefix
    description = bullets.join(', ');
    if (description.length > 80) description = description.substring(0, 77) + '...';
  }

  return {
    name: skillName,
    label,
    description: description || `${label} skill for prompt optimization`,
  };
}

/**
 * Register IPC handlers for skill management.
 */
export function registerSkillHandlers() {
  ipcMain.handle('skills:list', async (): Promise<SkillInfo[]> => {
    try {
      const skillsDir = path.join(__dirname, '..', '..', '..', 'files');

      if (!fs.existsSync(skillsDir)) {
        console.error('[SkillHandlers] Skills directory not found:', skillsDir);
        return [];
      }

      const files = fs.readdirSync(skillsDir);
      const skillFiles = files.filter(f => f.startsWith('skill_') && f.endsWith('.md'));

      const skills: SkillInfo[] = [];

      for (const file of skillFiles) {
        const skillName = file.replace('skill_', '').replace('.md', '');
        const filePath = path.join(skillsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          skills.push(parseSkillMetadata(content, skillName));
        } catch (err) {
          console.error(`[SkillHandlers] Failed to read ${file}:`, err);
          skills.push({
            name: skillName,
            label: skillName.charAt(0).toUpperCase() + skillName.slice(1),
            description: `${skillName} skill`,
          });
        }
      }

      skills.sort((a, b) => a.label.localeCompare(b.label));
      console.log(`[SkillHandlers] Loaded ${skills.length} skills`);
      return skills;
    } catch (error) {
      console.error('[SkillHandlers] Error listing skills:', error);
      return [];
    }
  });
}
