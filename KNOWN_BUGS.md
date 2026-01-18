# Known Bugs and Temporary Issues

**Last Updated**: 2026-01-18
**Status**: In Development - Some Features Temporarily Buggy

---

## 🔴 Critical Bugs (Blocking UX)

### 1. Popup Dismissal Not Working
**Status**: ❌ Broken
**Severity**: Critical
**Impact**: Users cannot cancel/close the optimization popup

**Issue**:
- Clicking outside the popup does NOT dismiss it
- Pressing ESC key does NOT dismiss it
- User is forced to click "Replace" button or wait

**Workaround**: None - must use Replace button or restart app

**Technical Details**:
- Popup is `focusable: false` to prevent breaking UI Automation
- ESC key handler in `popup.html` not firing
- Blur events unavailable due to non-focusable window
- Dismiss monitoring implemented but not functional

**Files**:
- `electron/main/overlay/overlay-manager.ts:353-378`
- `electron/renderer/popup.html` (ESC handler)

**Planned Fix**: Research global mouse click detection or alternative dismissal patterns

---

## 🟡 Medium Priority Bugs

### 2. LLM Outputs Too Verbose
**Status**: ⚠️ Partially Working
**Severity**: Medium
**Impact**: Poor user experience, overwhelming output

**Issue**:
- Simple prompts generate excessively long outputs (2000+ characters)
- Example: "write code for todo app" → 2116 characters
- Adds unnecessary preambles like "As an expert software engineer..."
- Should be 300-500 chars max for most prompts

**Workaround**: Manually edit the output after pasting

**Technical Details**:
- SYSTEM_PROMPT recently rewritten but still too permissive
- LLM (llama3.2) not following conciseness instructions
- May need explicit token limits or stronger constraints

**Files**:
- `python-service/app/main.py:227-268` (SYSTEM_PROMPT)

**Planned Fix**: Add explicit length constraints and more concise examples

---

### 3. Occasional Paste Detection Event
**Status**: ⚠️ Under Investigation
**Severity**: Low-Medium
**Impact**: May trigger unwanted optimizations

**Issue**:
- Paste event detected between user actions
- Unclear if this is user paste or system bug
- Example: `[TextStatePoller] Paste detected - adding 42 chars to buffer`

**Workaround**: None needed - appears to be rare

**Technical Details**:
- Happens after successful text replacement
- Could be user manually pasting
- Could be race condition in buffer management
- Needs more detailed logging to diagnose

**Files**:
- `electron/main/input/text-state-poller.ts:228-256` (handlePaste)

**Planned Fix**: Add source tracking for paste events

---

## ✅ Recently Fixed Issues

### Fixed: Paste Detection Loop During Text Replacement
**Status**: ✅ Fixed
**Date**: 2026-01-18

**Issue**:
- Keyboard fallback triggered paste detection
- Created infinite optimization loop
- Replaced text was re-detected as new prompt

**Solution**:
- Implemented `isReplacingText` flag
- Increased timeout from 500ms to 1500ms
- Added immediate buffer clearing after replacement

**Files**:
- `electron/main/input/text-state-poller.ts:93-119`
- `electron/main/overlay/overlay-manager.ts:62-72`

---

### Fixed: UI Automation Breaking After Popup Focus Change
**Status**: ✅ Fixed
**Date**: 2026-01-18

**Issue**:
- Popup was set to `focusable: true` for dismissal
- This broke UI Automation in underlying window
- ValuePattern failed because focus was on popup

**Solution**:
- Reverted popup to `focusable: false`
- Kept UI Automation working perfectly
- ESC dismissal still not working (see Bug #1)

**Files**:
- `electron/main/overlay/overlay-manager.ts:207`

---

### Fixed: Text Concatenation Between Prompts
**Status**: ✅ Fixed
**Date**: 2026-01-18

**Issue**:
- Multiple prompts being concatenated without spacing
- Example: "behaviouwrite" instead of separate prompts
- Buffer not cleared properly between optimizations

**Solution**:
- Immediate buffer clearing after text replacement
- Double clear (once in overlay-manager, once in app.ts)
- Prevents stale text contamination

**Files**:
- `electron/main/overlay/overlay-manager.ts:70-72, 82-84`

---

## 🚧 Temporary Limitations

### Browser/Web Apps Not Supported Yet
**Status**: Planned Feature
**Severity**: N/A
**Impact**: Only works in native apps (Notepad, WordPad, etc.)

**Current Behavior**:
- Works: Notepad, WordPad, File Explorer, native apps
- Doesn't Work: Chrome, Firefox, VS Code, Slack, Discord

**Reason**:
- Browser content is sandboxed from OS
- No UI Automation API access to web textareas
- Would require browser extension

**Future Plan**: See `HYBRID_IMPORTANT.md` for browser extension architecture

---

### Voice Input Transcription Quality
**Status**: Known Issue
**Severity**: Low
**Impact**: Voice transcription may be inaccurate

**Current Behavior**:
- Voice input uses Vosk speech-to-text
- May produce transcription errors
- No error correction or confidence scoring

**Workaround**: Type prompt manually for best results

**Future Plan**: Improve transcription or integrate better STT service

---

## 📝 Testing Status

### Tested Environments
- ✅ Windows 10/11 - Notepad (native Win32 Edit control)
- ✅ UI Automation with ValuePattern + TextPattern
- ✅ Text replacement without keyboard simulation
- ✅ Paste detection prevention during replacement

### Not Yet Tested
- ❌ WordPad
- ❌ File Explorer rename boxes
- ❌ Microsoft Office apps
- ❌ Keyboard fallback method (for apps without UI Automation)
- ❌ Browser extension (not implemented yet)

---

## 🔧 Development Notes

### What's Working Well
1. ✅ UI Automation in native Windows apps (flawless)
2. ✅ Text replacement via ValuePattern (no keyboard needed)
3. ✅ Paste detection prevention (flag mechanism working)
4. ✅ Buffer management (clean state between prompts)
5. ✅ Python service integration (Ollama + llama3.2)
6. ✅ Optimization pipeline (guardrails, validation, etc.)
7. ✅ Floating panel with Ctrl+5 hotkey

### What Needs Work
1. ❌ Popup dismissal mechanism (critical UX blocker)
2. ⚠️ LLM prompt tuning (too verbose)
3. ⚠️ Browser/web app support (needs extension)
4. ⚠️ Voice input quality improvements

---

## 📊 Performance Metrics

### Optimization Times (Notepad Tests)
- Test 1: 4896ms (~5s)
- Test 2: 5375ms (~5.4s)
- Test 3: 2798ms (~2.8s)
- **Average**: ~4.3 seconds

**Note**: Times are reasonable for local LLM (Ollama). Cloud API would be faster but requires internet.

### UI Automation Performance
- Text replacement: < 100ms (near-instant)
- Cursor positioning: < 100ms
- Much faster than keyboard simulation (~350-550ms)

---

## 🎯 Next Release Priorities

1. **Fix popup dismissal** (blocks user acceptance)
2. **Tune LLM for conciseness** (improves UX)
3. **Test keyboard fallback** (validate 1500ms timeout)
4. **Test in more native apps** (WordPad, Office, etc.)
5. **Plan browser extension** (long-term goal)

---

## 🐛 How to Report Bugs

If you encounter issues not listed here:

1. Check `TESTING_NOTES.md` for detailed test results
2. Check console logs for error messages
3. Note the app you're using (Notepad, browser, etc.)
4. Include steps to reproduce

---

## 📚 Related Documentation

- `TESTING_NOTES.md` - Detailed test session analysis
- `HYBRID_IMPORTANT.md` - Browser extension architecture plan
- `LOGGING_IMPORTANT.md` - Logging system documentation
- `ADAPTIVE_PROMPT_SYSTEM.md` - Prompt optimization strategies

---

**Remember**: This is in active development. Some features are temporarily buggy while we improve the core functionality. UI Automation in native apps works great - focus testing there for now!
