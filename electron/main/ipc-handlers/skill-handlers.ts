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
 * Looks for first heading and first paragraph as description.
 */
function parseSkillMetadata(content: string, skillName: string): SkillInfo {
  const lines = content.split('\n');
  let label = skillName.charAt(0).toUpperCase() + skillName.slice(1);
  let description = '';

  // Try to find first heading (# Title)
  for (const line of lines) {
    const headingMatch = line.match(/^#\s+(.+)/);
    if (headingMatch) {
      label = headingMatch[1].trim();
      break;
    }
  }

  // Try to find first non-empty paragraph
  let foundHeading = false;
  for (const line of lines) {
    if (line.startsWith('#')) {
      foundHeading = true;
      continue;
    }
    if (foundHeading && line.trim() && !line.startsWith('---')) {
      description = line.trim();
      if (description.length > 100) {
        description = description.substring(0, 97) + '...';
      }
      break;
    }
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
  /**
   * List all available skills from files/skill_*.md
   */
  ipcMain.handle('skills:list', async (): Promise<SkillInfo[]> => {
    try {
      // Path to skills directory (relative to electron/main)
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
          const skillInfo = parseSkillMetadata(content, skillName);
          skills.push(skillInfo);
        } catch (err) {
          console.error(`[SkillHandlers] Failed to read ${file}:`, err);
          // Add fallback entry
          skills.push({
            name: skillName,
            label: skillName.charAt(0).toUpperCase() + skillName.slice(1),
            description: `${skillName} skill`,
          });
        }
      }

      // Sort alphabetically by label
      skills.sort((a, b) => a.label.localeCompare(b.label));

      console.log(`[SkillHandlers] Loaded ${skills.length} skills`);
      return skills;
    } catch (error) {
      console.error('[SkillHandlers] Error listing skills:', error);
      return [];
    }
  });
}
