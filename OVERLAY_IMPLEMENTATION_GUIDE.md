# Overlay.html Implementation Guide

## Overview
The overlay window ([`overlay.html`](electron/renderer/overlay.html)) is a self-contained 2,342-line HTML/JS file. All additions must use plain JavaScript and inline CSS to match the existing code style.

---

## Step 1: Add CSS (Inside existing `<style>` block)

Find the closing `</style>` tag (around line ~1200) and add BEFORE it:

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
.file-pills-container {
  display: none;
  padding: 12px 20px;
  flex-wrap: wrap;
  gap: 8px;
}

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
.skill-pill-container {
  display: none;
  margin-left: 8px;
}

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

---

## Step 2: Add HTML Elements

### A. Find the input toolbar (search for `.input-toolbar-left`)

Add BEFORE the mode button:

```html
<!-- Plus / attach button -->
<button id="btn-plus" class="btn-toolbar" title="Add files or pick skill" type="button">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
</button>

<!-- Skill pill container (shown when skill selected) -->
<div id="skill-pill-container" class="skill-pill-container"></div>
```

### B. Add hidden file input (anywhere in `<body>`, before closing `</body>`):

```html
<!-- Hidden file input -->
<input id="file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" multiple style="display:none">
```

### C. Add file pills container (BEFORE the textarea):

```html
<!-- File pills container -->
<div id="file-pills-container" class="file-pills-container"></div>
```

### D. Add Plus Menu popover (anywhere in `<body>`, before closing `</body>`):

```html
<!-- Plus menu popover -->
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

<!-- Skill picker popover -->
<div id="skill-picker" class="plus-menu" style="display:none; width: 384px;">
  <div style="padding: 12px; border-bottom: 1px solid hsl(var(--border));">
    <input 
      id="skill-search" 
      type="text" 
      placeholder="Search skills..." 
      style="width: 100%; padding: 8px 12px; background: hsl(var(--background)); border: 1px solid hsl(var(--border)); border-radius: 6px; font-size: 13px; color: hsl(var(--foreground));"
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
```

---

## Step 3: Add JavaScript State & Functions

Find the existing `<script>` block (around line ~1300) and add these variables at the top:

```javascript
// ── File & Skill State ────────────────────────────────────────────────────
let attachedFiles = [];      // { name, mimeType, base64, sizeBytes }
let selectedSkill = null;    // skill name string or null
let availableSkills = [];    // loaded from window.electronAPI.skills.list()
let focusedSkillIndex = 0;   // for keyboard nav in skill picker
```

Then add these functions (before the existing `sendMessage()` function):

```javascript
// ══════════════════════════════════════════════════════════════════════════
// PLUS MENU & FILE HANDLING
// ══════════════════════════════════════════════════════════════════════════

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
  const plusMenu = document.getElementById('plus-menu');
  const skillPicker = document.getElementById('skill-picker');
  if (plusMenu) plusMenu.style.display = 'none';
  if (skillPicker) skillPicker.style.display = 'none';
}

async function handleFileInput(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  
  for (let i = 0; i < Math.min(files.length, 5 - attachedFiles.length); i++) {
    const file = files[i];
    
    // Validate size
    if (file.size > 10_000_000) {
      alert(`File "${file.name}" exceeds 10 MB limit`);
      continue;
    }
    
    // Validate type
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert(`File type not allowed: ${file.type}`);
      continue;
    }
    
    // Convert to base64
    try {
      const base64 = await fileToBase64(file);
      attachedFiles.push({
        name: file.name,
        mimeType: file.type,
        base64,
        sizeBytes: file.size
      });
    } catch (err) {
      console.error(`[Overlay] Failed to process file ${file.name}:`, err);
      alert(`Failed to process file "${file.name}"`);
    }
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

// ══════════════════════════════════════════════════════════════════════════
// SKILL PICKER
// ══════════════════════════════════════════════════════════════════════════

async function loadSkills() {
  if (availableSkills.length > 0) return; // Already loaded
  
  try {
    availableSkills = await window.electronAPI.skills.list();
    console.log(`[Overlay] Loaded ${availableSkills.length} skills`);
  } catch (err) {
    console.error('[Overlay] Failed to load skills:', err);
    availableSkills = [];
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
  
  focusedSkillIndex = 0;
  renderSkillList(availableSkills);
  
  const searchInput = document.getElementById('skill-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  
  closePlusMenu();
}

function renderSkillList(skills) {
  const list = document.getElementById('skill-list');
  if (!list) return;
  
  if (skills.length === 0) {
    list.innerHTML = '<div style="padding: 16px; text-align: center; font-size: 12px; color: hsl(var(--muted-foreground));">No skills found</div>';
    return;
  }
  
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
    
    item.addEventListener('mouseenter', () => {
      focusedSkillIndex = parseInt(item.dataset.idx);
      renderSkillList(getCurrentFilteredSkills());
    });
  });
}

function selectSkill(skillName) {
  selectedSkill = skillName;
  renderSkillPill();
  document.getElementById('skill-picker').style.display = 'none';
  console.log(`[Overlay] Selected skill: ${skillName}`);
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

function getCurrentFilteredSkills() {
  const searchInput = document.getElementById('skill-search');
  if (!searchInput) return availableSkills;
  
  const filter = searchInput.value.toLowerCase();
  if (!filter) return availableSkills;
  
  return availableSkills.filter(s => 
    s.label.toLowerCase().includes(filter) ||
    s.name.toLowerCase().includes(filter) ||
    s.description.toLowerCase().includes(filter)
  );
}
```

---

## Step 3: Add Event Listeners

Find the existing event listeners section (search for `addEventListener`) and add:

```javascript
// ── Plus Menu Event Listeners ──────────────────────────────────────────────
document.getElementById('btn-plus').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('plus-menu');
  if (menu.style.display === 'block') {
    closePlusMenu();
  } else {
    openPlusMenu();
  }
});

document.getElementById('menu-attach-files').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('menu-pick-skill').addEventListener('click', openSkillPicker);

document.getElementById('file-input').addEventListener('change', handleFileInput);

// Skill search filter
document.getElementById('skill-search').addEventListener('input', (e) => {
  const filtered = getCurrentFilteredSkills();
  focusedSkillIndex = 0;
  renderSkillList(filtered);
});

// Skill picker keyboard navigation
document.getElementById('skill-search').addEventListener('keydown', (e) => {
  const filtered = getCurrentFilteredSkills();
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusedSkillIndex = Math.min(focusedSkillIndex + 1, filtered.length - 1);
    renderSkillList(filtered);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusedSkillIndex = Math.max(focusedSkillIndex - 1, 0);
    renderSkillList(filtered);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filtered[focusedSkillIndex]) {
      selectSkill(filtered[focusedSkillIndex].name);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    document.getElementById('skill-picker').style.display = 'none';
  }
});

// Click outside to close menus
document.addEventListener('click', (e) => {
  const plusMenu = document.getElementById('plus-menu');
  const skillPicker = document.getElementById('skill-picker');
  const plusBtn = document.getElementById('btn-plus');
  
  if (plusMenu && plusMenu.style.display === 'block' && 
      !plusMenu.contains(e.target) && 
      !plusBtn.contains(e.target)) {
    closePlusMenu();
  }
  
  if (skillPicker && skillPicker.style.display === 'block' && 
      !skillPicker.contains(e.target) && 
      !plusBtn.contains(e.target)) {
    skillPicker.style.display = 'none';
  }
});
```

---

## Step 4: Modify sendMessage() Function

Find the existing `sendMessage()` function (search for `function sendMessage()`) and modify it:

```javascript
function sendMessage() {
  const text = textarea.value.trim();
  if (!text || isOptimizing) return;
  
  // ... existing validation code ...
  
  // Include attachedFiles and selectedSkill in optimize call
  window.electronAPI.overlay.optimize({
    text,
    isRegenerate: false,
    mode: currentMode,
    attachedFiles: attachedFiles,      // NEW
    forcedSkill: selectedSkill          // NEW
  });
  
  // Clear input and ephemeral state
  textarea.value = '';
  attachedFiles = [];
  selectedSkill = null;
  renderFilePills();
  renderSkillPill();
  
  // ... rest of existing code ...
}
```

---

## Step 5: Update overlay-ipc-handlers.ts

In [`overlay-ipc-handlers.ts`](electron/main/ipc-handlers/overlay-ipc-handlers.ts), find the optimize handler and update it to forward the new params:

```typescript
// Around line 130-140
ipcMain.on('overlay:optimize', async (event, data: { 
  text: string; 
  isRegenerate?: boolean; 
  mode?: string;
  attachedFiles?: any[];
  forcedSkill?: string | null;
}) => {
  // ... existing code ...
  
  const optimizedText = await pythonClient.optimizeStream(
    data.text,
    data.isRegenerate || false,
    null, // messages context
    (chunk, accumulated) => {
      overlayManager.send('optimization-chunk', { chunk, accumulated });
    },
    data.mode || 'fast',
    customInstructions,
    data.attachedFiles || [],      // NEW
    data.forcedSkill || null        // NEW
  );
  
  // ... rest of handler ...
});
```

---

## Testing the Overlay

1. Open overlay with `@prompt` trigger
2. Click `+` button → verify menu opens
3. Click "Attach Files" → verify native file picker opens
4. Select PDF → verify pill appears above textarea
5. Click pill `×` → verify file removed
6. Click `+` → "Select Skill" → verify skill picker opens
7. Search "tech" → verify filtering works
8. Press ↓ → verify keyboard nav works
9. Press Enter → verify skill pill appears in toolbar
10. Type message → Send → verify files and skill are sent
11. Verify pills clear after send

---

## Production Checklist

Before deploying:
- [ ] Test with 5×10MB PDFs simultaneously
- [ ] Test with corrupted PDF file
- [ ] Test with renamed `.exe` → `.pdf` file
- [ ] Test skill picker with 20+ skills (scroll performance)
- [ ] Test rapid file attach/remove (memory leaks)
- [ ] Test overlay + main app simultaneously (state isolation)
- [ ] Verify no file content persisted to disk or database
- [ ] Add error tracking for file parsing failures
- [ ] Add analytics for feature usage (files attached, skills selected)
