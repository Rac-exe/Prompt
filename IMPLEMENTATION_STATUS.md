# Plus Menu Implementation Status

## ✅ Completed (Commits 0-2)

### Python Backend
- [x] [`requirements.txt`](python-service/requirements.txt) — Cleaned duplicates, added PyMuPDF>=1.24.13 and Pillow>=10.3.0
- [x] [`document_parser.py`](python-service/pipeline_v2/document_parser.py) — NEW file with:
  - Magic-byte validation (defense-in-depth)
  - 10 MB size limit enforcement
  - 8,000 token cap with sanitization
  - PDF text extraction (PyMuPDF)
  - Image vision API support + Pillow fallback
  - Graceful error handling
- [x] [`optimizer.py`](python-service/pipeline_v2/optimizer.py) — Modified to accept:
  - `attached_files: List[Dict]` parameter
  - `forced_skill: str | None` parameter
  - Vision model detection (`supports_vision()`)
  - File context prepending as `[ATTACHED CONTEXT]`
  - Vision message parts insertion for multimodal models
- [x] [`main.py`](python-service/app/main.py) — WebSocket handler updated:
  - Accepts `attached_files` and `forced_skill` from JSON payload
  - Validates max 5 files before forwarding
  - Passes params to `pipeline_optimize()`

### Electron IPC Layer
- [x] [`skill-handlers.ts`](electron/main/ipc-handlers/skill-handlers.ts) — NEW file:
  - `skills:list` IPC handler
  - Reads `files/skill_*.md` files
  - Parses metadata (label, description)
  - Returns sorted skill list
- [x] [`chat-handlers.ts`](electron/main/ipc-handlers/chat-handlers.ts) — Modified:
  - Added `AttachedFile` interface
  - Added `validateAttachedFiles()` function (size, type, count limits)
  - Updated `app:send-message` handler to accept `attachedFiles` and `forcedSkill`
  - Forwards validated data to `pythonClient.optimizeStream()`
- [x] [`python-client.ts`](electron/main/api/python-client.ts) — Modified:
  - `optimizeStream()` signature extended with `attachedFiles` and `forcedSkill` params
  - WebSocket payload includes new fields
- [x] [`preload.ts`](electron/preload.ts) — Modified:
  - `sendMessage()` signature extended
  - Added `skills.list()` IPC bridge
  - Added type definitions in Window interface
- [x] [`electron.d.ts`](app-ui/src/types/electron.d.ts) — Modified:
  - Added `AttachedFile` interface
  - Added `SkillInfo` interface
  - Extended `ElectronAPI.sendMessage()` signature
  - Added `ElectronAPI.skills.list()`
- [x] [`index-new.ts`](electron/main/index-new.ts) — Modified:
  - Imported `registerSkillHandlers`
  - Called `registerSkillHandlers()` in initialization

### React UI Components
- [x] [`SkillPicker.tsx`](app-ui/src/components/chat/SkillPicker.tsx) — NEW component:
  - Loads skills via `window.electronAPI.skills.list()`
  - Filterable search
  - Keyboard navigation (↑↓ Enter Esc)
  - Hover state tracking
- [x] [`PlusMenu.tsx`](app-ui/src/components/chat/PlusMenu.tsx) — NEW component:
  - Two-section popover (Add Files / Pick Skill)
  - Hidden file input with native picker
  - File validation (size, type)
  - Base64 conversion
  - Skill picker integration
  - Click-outside and Escape to close

---

## 🚧 Remaining Work (Commit 3-4)

### React UI Integration

#### [`ChatView.tsx`](app-ui/src/components/chat/ChatView.tsx) — NEEDS MODIFICATION

**Add state:**
```typescript
const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
const [showSlashPicker, setShowSlashPicker] = useState(false);
const plusButtonRef = useRef<HTMLButtonElement>(null);
```

**Add imports:**
```typescript
import { PlusMenu } from "./PlusMenu";
import { SkillPicker } from "./SkillPicker";
import type { AttachedFile, SkillInfo } from "@/types/electron";
import { X } from "lucide-react";
```

**Modify Plus button (line ~235-242):**
```typescript
<button
  ref={plusButtonRef}
  type="button"
  disabled={!isOnline}
  onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
  title="Add files or pick skill"
>
  <Plus className="w-5 h-5" />
</button>
```

**Add PlusMenu component (after Plus button):**
```typescript
<PlusMenu
  isOpen={isPlusMenuOpen}
  onClose={() => setIsPlusMenuOpen(false)}
  onFilesSelected={(files) => {
    setAttachedFiles(prev => [...prev, ...files].slice(0, 5));
  }}
  onSkillSelected={(skillName) => {
    setSelectedSkill(skillName);
  }}
  anchorRef={plusButtonRef}
/>
```

**Add file pills (above textarea, line ~205):**
```typescript
{/* File pills */}
{attachedFiles.length > 0 && (
  <div className="flex flex-wrap gap-2 px-5 pt-3">
    {attachedFiles.map((file, idx) => (
      <div
        key={idx}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary text-xs"
      >
        {file.mimeType === 'application/pdf' ? (
          <FileText className="h-3 w-3" />
        ) : (
          <Image className="h-3 w-3" />
        )}
        <span className="max-w-[150px] truncate">{file.name}</span>
        <button
          onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
          className="hover:text-destructive transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    ))}
  </div>
)}
```

**Add skill pill (in toolbar, after mode dropdown, line ~290):**
```typescript
{/* Skill pill */}
{selectedSkill && (
  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-xs text-emerald-500 border border-emerald-500/20">
    <Sparkles className="h-3 w-3" />
    <span className="capitalize">{selectedSkill}</span>
    <button
      onClick={() => setSelectedSkill(null)}
      className="hover:text-emerald-400 transition-colors"
    >
      <X className="h-3 w-3" />
    </button>
  </div>
)}
```

**Add slash command detection in textarea onKeyDown:**
```typescript
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // Existing Enter key logic...
  
  // Slash command for skill picker
  if (e.key === "/" && input.endsWith("/")) {
    e.preventDefault();
    setShowSlashPicker(true);
    return;
  }
  
  // Escape to close slash picker
  if (e.key === "Escape" && showSlashPicker) {
    setShowSlashPicker(false);
    return;
  }
};
```

**Add slash picker popover (near textarea):**
```typescript
{showSlashPicker && (
  <div className="absolute bottom-full left-0 mb-2">
    <SkillPicker
      onSelect={(skillName) => {
        setSelectedSkill(skillName);
        setShowSlashPicker(false);
        // Remove the trailing slash
        setInput(prev => prev.slice(0, -1));
        textareaRef.current?.focus();
      }}
      onClose={() => setShowSlashPicker(false)}
    />
  </div>
)}
```

**Modify onSendMessage call:**
```typescript
const handleSend = () => {
  if (!input.trim() || isGenerating || !isOnline) return;
  
  // Extended signature
  onSendMessage(input.trim(), mode, attachedFiles, selectedSkill);
  
  // Clear ephemeral state
  setInput("");
  setAttachedFiles([]);
  setSelectedSkill(null);
  setShowSlashPicker(false);
  
  shouldAutoScroll.current = true;
  isEditRetryRef.current = false;
};
```

**Update ChatViewProps interface:**
```typescript
interface ChatViewProps {
  // ... existing props
  onSendMessage: (
    content: string, 
    mode: "fast" | "thinking",
    attachedFiles?: AttachedFile[],
    selectedSkill?: string | null
  ) => void;
  // ... rest
}
```

**Clear state on chat switch (add useEffect):**
```typescript
useEffect(() => {
  setAttachedFiles([]);
  setSelectedSkill(null);
  setShowSlashPicker(false);
  setIsPlusMenuOpen(false);
}, [messages.length === 0]); // Proxy for chat switch
```

---

### Overlay Window

#### [`overlay.html`](electron/renderer/overlay.html) — NEEDS MODIFICATION

**CSS additions (inside existing `<style>` block, after line ~100):**
```css
/* ======== PLUS MENU ======== */
.plus-menu {
  position: fixed;
  z-index: 9999;
  width: 256px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  animation: fadeIn 0.15s ease-out;
}

.plus-menu-section-label {
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
  letter-spacing: 0.5px;
}

.plus-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  margin: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.plus-menu-item:hover {
  background: hsl(var(--accent));
}

.skill-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  margin: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.skill-item:hover,
.skill-item.focused {
  background: hsl(var(--accent));
}

.skill-item-icon {
  width: 16px;
  height: 16px;
  color: hsl(var(--emerald));
  flex-shrink: 0;
  margin-top: 2px;
}

.skill-item-content {
  flex: 1;
  min-width: 0;
}

.skill-item-label {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.skill-item-desc {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* File pills */
.file-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 16px;
  background: hsl(var(--secondary));
  font-size: 12px;
  color: hsl(var(--foreground));
}

.file-pill-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-pill-remove {
  width: 14px;
  height: 14px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.file-pill-remove:hover {
  opacity: 1;
  color: hsl(var(--destructive));
}

/* Skill pill */
.skill-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background: hsl(var(--emerald) / 0.1);
  border: 1px solid hsl(var(--emerald) / 0.2);
  font-size: 11px;
  color: hsl(var(--emerald));
  font-weight: 500;
  text-transform: capitalize;
}

.skill-pill-remove {
  width: 12px;
  height: 12px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.skill-pill-remove:hover {
  opacity: 1;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**HTML additions (inside `.input-toolbar-left`, before mode button, line ~130):**
```html
<!-- Plus / attach button -->
<button id="btn-plus" class="btn-toolbar" title="Add files or pick skill" type="button">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
</button>

<!-- Plus menu popover (hidden by default) -->
<div id="plus-menu" class="plus-menu" style="display:none">
  <!-- Section 1: Add Files -->
  <div>
    <div class="plus-menu-section-label">Add Files</div>
    <div class="plus-menu-item" id="menu-attach-files">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
      <div>
        <div style="font-size: 13px; font-weight: 500;">Attach Files</div>
        <div style="font-size: 11px; color: hsl(var(--muted-foreground));">PDF, PNG, JPG, WEBP</div>
      </div>
    </div>
  </div>
  
  <!-- Divider -->
  <div style="height: 1px; background: hsl(var(--border)); margin: 4px 0;"></div>
  
  <!-- Section 2: Pick Skill -->
  <div>
    <div class="plus-menu-section-label">Pick a Skill</div>
    <div class="plus-menu-item" id="menu-pick-skill">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: hsl(var(--emerald));">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
      </svg>
      <div>
        <div style="font-size: 13px; font-weight: 500;">Select Skill</div>
        <div style="font-size: 11px; color: hsl(var(--muted-foreground));">Override auto-selection</div>
      </div>
    </div>
  </div>
</div>

<!-- Skill picker popover (hidden by default) -->
<div id="skill-picker" class="plus-menu" style="display:none; width: 384px;">
  <div style="padding: 12px; border-bottom: 1px solid hsl(var(--border));">
    <input 
      id="skill-search" 
      type="text" 
      placeholder="Search skills..." 
      style="width: 100%; padding: 8px 12px; background: hsl(var(--background)); border: 1px solid hsl(var(--border)); border-radius: 6px; font-size: 13px;"
    />
  </div>
  <div id="skill-list" style="max-height: 320px; overflow-y: auto; padding: 4px;">
    <!-- Dynamically populated -->
  </div>
  <div style="border-top: 1px solid hsl(var(--border)); padding: 8px 12px; font-size: 11px; color: hsl(var(--muted-foreground));">
    <span style="font-weight: 600;">↑↓</span> Navigate 
    <span style="font-weight: 600;">Enter</span> Select 
    <span style="font-weight: 600;">Esc</span> Close
  </div>
</div>

<!-- Hidden file input -->
<input id="file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple style="display:none">

<!-- File pills container (above textarea) -->
<div id="file-pills-container" style="display:none; padding: 12px 20px; flex-wrap: wrap; gap: 8px;"></div>

<!-- Skill pill (in toolbar, after mode button) -->
<div id="skill-pill-container" style="display:none; margin-left: 8px;"></div>
```

**JS state additions (in existing `<script>` block):**
```javascript
let attachedFiles = [];      // { name, mimeType, base64, sizeBytes }
let selectedSkill = null;    // skill name string or null
let availableSkills = [];    // loaded from window.electronAPI.skills.list()
let focusedSkillIndex = 0;   // for keyboard nav
```

**JS functions to add:**
```javascript
// ── Plus Menu ──────────────────────────────────────────────────────────────
function openPlusMenu() {
  const menu = document.getElementById('plus-menu');
  const btn = document.getElementById('btn-plus');
  if (!menu || !btn) return;
  
  const rect = btn.getBoundingClientRect();
  menu.style.bottom = `calc(100vh - ${rect.top}px + 8px)`;
  menu.style.left = `${rect.left}px`;
  menu.style.display = 'block';
}

function closePlusMenu() {
  document.getElementById('plus-menu').style.display = 'none';
  document.getElementById('skill-picker').style.display = 'none';
}

// ── File Handling ──────────────────────────────────────────────────────────
async function handleFileInput(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  
  for (let i = 0; i < Math.min(files.length, 5 - attachedFiles.length); i++) {
    const file = files[i];
    
    // Validate
    if (file.size > 10_000_000) {
      alert(`File "${file.name}" exceeds 10 MB limit`);
      continue;
    }
    
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert(`File type not allowed: ${file.type}`);
      continue;
    }
    
    // Convert to base64
    const base64 = await fileToBase64(file);
    attachedFiles.push({
      name: file.name,
      mimeType: file.type,
      base64,
      sizeBytes: file.size
    });
  }
  
  renderFilePills();
  closePlusMenu();
  document.getElementById('file-input').value = '';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderFilePills() {
  const container = document.getElementById('file-pills-container');
  if (!container) return;
  
  if (attachedFiles.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  
  container.style.display = 'flex';
  container.innerHTML = attachedFiles.map((file, idx) => `
    <div class="file-pill">
      ${file.mimeType === 'application/pdf' ? 
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>' :
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'
      }
      <span class="file-pill-name">${file.name}</span>
      <svg class="file-pill-remove" onclick="removeFile(${idx})" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>
  `).join('');
}

function removeFile(idx) {
  attachedFiles.splice(idx, 1);
  renderFilePills();
}

// ── Skill Handling ─────────────────────────────────────────────────────────
async function loadSkills() {
  if (availableSkills.length > 0) return; // Already loaded
  
  try {
    availableSkills = await window.electronAPI.skills.list();
  } catch (err) {
    console.error('[Overlay] Failed to load skills:', err);
  }
}

async function openSkillPicker() {
  await loadSkills();
  
  const picker = document.getElementById('skill-picker');
  const btn = document.getElementById('btn-plus');
  if (!picker || !btn) return;
  
  const rect = btn.getBoundingClientRect();
  picker.style.bottom = `calc(100vh - ${rect.top}px + 8px)`;
  picker.style.left = `${rect.left}px`;
  picker.style.display = 'block';
  
  renderSkillList(availableSkills);
  document.getElementById('skill-search').focus();
  
  closePlusMenu();
}

function renderSkillList(skills) {
  const list = document.getElementById('skill-list');
  if (!list) return;
  
  list.innerHTML = skills.map((skill, idx) => `
    <div class="skill-item ${idx === focusedSkillIndex ? 'focused' : ''}" data-skill="${skill.name}" data-idx="${idx}">
      <svg class="skill-item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
      </svg>
      <div class="skill-item-content">
        <div class="skill-item-label">${skill.label}</div>
        <div class="skill-item-desc">${skill.description}</div>
      </div>
    </div>
  `).join('');
  
  // Add click handlers
  list.querySelectorAll('.skill-item').forEach(item => {
    item.addEventListener('click', () => {
      selectSkill(item.dataset.skill);
    });
  });
}

function selectSkill(skillName) {
  selectedSkill = skillName;
  renderSkillPill();
  document.getElementById('skill-picker').style.display = 'none';
}

function renderSkillPill() {
  const container = document.getElementById('skill-pill-container');
  if (!container) return;
  
  if (!selectedSkill) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  
  container.style.display = 'inline-flex';
  container.innerHTML = `
    <div class="skill-pill">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
      </svg>
      <span>${selectedSkill}</span>
      <svg class="skill-pill-remove" onclick="clearSkill()" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>
  `;
}

function clearSkill() {
  selectedSkill = null;
  renderSkillPill();
}

// ── Event Listeners ────────────────────────────────────────────────────────
document.getElementById('btn-plus').addEventListener('click', openPlusMenu);
document.getElementById('menu-attach-files').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('menu-pick-skill').addEventListener('click', openSkillPicker);
document.getElementById('file-input').addEventListener('change', handleFileInput);

// Skill search filter
document.getElementById('skill-search').addEventListener('input', (e) => {
  const filter = e.target.value.toLowerCase();
  const filtered = availableSkills.filter(s => 
    s.label.toLowerCase().includes(filter) ||
    s.name.toLowerCase().includes(filter) ||
    s.description.toLowerCase().includes(filter)
  );
  focusedSkillIndex = 0;
  renderSkillList(filtered);
});

// Skill picker keyboard nav
document.getElementById('skill-search').addEventListener('keydown', (e) => {
  const list = document.getElementById('skill-list');
  const items = list.querySelectorAll('.skill-item');
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusedSkillIndex = Math.min(focusedSkillIndex + 1, items.length - 1);
    renderSkillList(getCurrentFilteredSkills());
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusedSkillIndex = Math.max(focusedSkillIndex - 1, 0);
    renderSkillList(getCurrentFilteredSkills());
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const focused = items[focusedSkillIndex];
    if (focused) selectSkill(focused.dataset.skill);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    document.getElementById('skill-picker').style.display = 'none';
  }
});

function getCurrentFilteredSkills() {
  const filter = document.getElementById('skill-search').value.toLowerCase();
  return availableSkills.filter(s => 
    s.label.toLowerCase().includes(filter) ||
    s.name.toLowerCase().includes(filter) ||
    s.description.toLowerCase().includes(filter)
  );
}

// Click outside to close
document.addEventListener('click', (e) => {
  const plusMenu = document.getElementById('plus-menu');
  const skillPicker = document.getElementById('skill-picker');
  const plusBtn = document.getElementById('btn-plus');
  
  if (plusMenu.style.display === 'block' && 
      !plusMenu.contains(e.target) && 
      !plusBtn.contains(e.target)) {
    closePlusMenu();
  }
  
  if (skillPicker.style.display === 'block' && 
      !skillPicker.contains(e.target) && 
      !plusBtn.contains(e.target)) {
    skillPicker.style.display = 'none';
  }
});
```

**Modify `sendMessage()` function (existing function, line ~278-281):**
```javascript
function sendMessage() {
  const text = textarea.value.trim();
  if (!text || isOptimizing) return;
  
  // ... existing code ...
  
  // Include attachedFiles and selectedSkill in optimize call
  window.electronAPI.overlay.optimize({
    text,
    isRegenerate: false,
    mode: currentMode,
    attachedFiles,  // NEW
    forcedSkill: selectedSkill  // NEW
  });
  
  // Clear ephemeral state
  textarea.value = '';
  attachedFiles = [];
  selectedSkill = null;
  renderFilePills();
  renderSkillPill();
}
```

---

## 🧪 Testing Checklist

### Functional Tests
- [ ] Install Python deps: `pip install -r python-service/requirements.txt`
- [ ] TypeScript compile: `npx tsc --noEmit` in `app-ui/` and `electron/`
- [ ] Upload PDF → verify pill shown → send → response uses PDF content
- [ ] Upload image (GPT-4o) → verify vision API call
- [ ] Upload 6 files → verify rejection at 5-file limit
- [ ] Upload 11 MB file → verify rejection
- [ ] Select "Technical" skill → verify pill shown → send → verify skill applied
- [ ] Type `/` in textarea → verify skill picker opens
- [ ] Clear skill pill → verify skill not sent
- [ ] Switch chat → verify files/skill cleared
- [ ] Overlay: Plus menu works identically

### Security Tests
- [ ] Rename `.exe` to `.pdf` → verify magic-byte rejection in Python
- [ ] Upload PDF with "IGNORE PREVIOUS INSTRUCTIONS" → verify sanitization
- [ ] Two users upload simultaneously → verify no content mixing (requires multi-user setup)

---

## 📝 Next Steps

1. **Finish ChatView.tsx integration** (30 min)
2. **Finish overlay.html modifications** (45 min)
3. **Test Python deps installation** (10 min)
4. **Run TypeScript compilation** (5 min)
5. **Manual testing** (60 min)
6. **Fix any bugs found** (30 min)

**Total remaining: ~3 hours**

---

## 🚀 Deployment Notes

### Before Production Launch:
1. Add rate limiting (Phase 2 from audit)
2. Add connection pool limits
3. Add monitoring/logging
4. Add cost estimation for vision API
5. Set up error tracking (Sentry)
6. Add RLS policies on Supabase tables
7. Generate skill file checksums for integrity validation

### Environment Variables Required:
```env
OPTIMIZER_MODEL=openrouter/openai/gpt-4o-mini
OPENROUTER_API_KEY=your_key_here
SUMMARIZER_MODEL=claude-haiku-4-5-20251001
```

### Database Migration (if storing attachment metadata):
```sql
ALTER TABLE prompt_optimizations 
ADD COLUMN has_attachments BOOLEAN DEFAULT FALSE,
ADD COLUMN attachment_metadata JSONB DEFAULT '[]'::jsonb;
```
