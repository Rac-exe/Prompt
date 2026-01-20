# TESTING_IMPORTANT - Feature Testing Reference

## HOW TO MAINTAIN THIS FILE

### Purpose
This file tracks testing results for the application across different environments and applications. Use this to document where features work, fail, or have issues.

### File Structure
Each testing location has:
1. **Application Name** - The software/environment being tested
2. **Status** - ✅ Working / ⚠️ Partial / ❌ Not Working / 🔄 Not Tested
3. **Features Tested** - List of features tested in this environment
4. **Known Issues** - Specific problems encountered
5. **Last Tested Date** - When this was last verified
6. **Notes** - Additional context or workarounds

### How to Update This File
When testing a feature:
1. Find the application section
2. Update the **Status** emoji
3. Add details to **Features Tested** (what worked/failed)
4. Document any **Known Issues** with reproduction steps
5. Update **Last Tested Date**
6. Add **Notes** for workarounds or context

### Status Legend
- ✅ **Working** - All features work as expected
- ⚠️ **Partial** - Some features work, some don't
- ❌ **Not Working** - Features completely fail
- 🔄 **Not Tested** - No testing done yet
- 🚧 **In Progress** - Currently being tested/fixed

---

## Table of Contents
1. [Text Editors](#text-editors)
   - [Notepad](#notepad)
   - [VS Code](#vs-code)
   - [Cursor](#cursor)
2. [Word Processors](#word-processors)
   - [Microsoft Word](#microsoft-word)
   - [Google Docs](#google-docs)
3. [AI Chatbots](#ai-chatbots)
   - [ChatGPT](#chatgpt)
   - [Google Gemini](#gemini)
   - [Claude](#claude)
4. [Browsers](#browsers)
   - [Browser Search Bar](#browser-search-bar)
5. [Messaging Apps](#messaging-apps)
   - [WhatsApp](#whatsapp)
   - [Discord](#discord)
   - [Telegram](#telegram)
6. [Testing Checklist](#testing-checklist)

---

## Text Editors

### Notepad
**Status:** ✅ Working
**Last Tested:** 2026-01-18

#### Features Tested:
- [x] @prompt detection
- [x] Overlay appearance
- [x] Text replacement via UI Automation
- [x] Cursor positioning after replacement
- [x] Multi-line prompts
- [ ] Special characters in prompts
- [x] Copy button functionality

#### Known Issues:
None - Works perfectly with UI Automation (ValuePattern + TextPattern).

#### Notes:
Notepad is the primary target application and fully supports Windows UI Automation. Text replacement works without any keyboard simulation.

---

### VS Code
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in editor
- [ ] @prompt detection in terminal
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Multi-line prompts in comments
- [ ] Extension conflicts

#### Known Issues:
None documented yet.

#### Notes:
VS Code may have different text controls for editor vs terminal. Test both environments.

---

### Cursor
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Integration with Cursor's AI features
- [ ] Chat panel vs editor

#### Known Issues:
None documented yet.

#### Notes:
Cursor is built on VS Code, so behavior should be similar. Watch for conflicts with Cursor's built-in AI.

---

## Word Processors

### Microsoft Word
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in document
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Formatting preservation after replacement
- [ ] Track Changes compatibility
- [ ] Comments/Review mode compatibility

#### Known Issues:
None documented yet.

#### Notes:
Word uses rich text format. Verify that formatting (bold, italic, fonts) is preserved after replacement.

---

### Google Docs
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in browser
- [ ] Overlay appearance
- [ ] Text replacement (may require keyboard fallback)
- [ ] Formatting preservation
- [ ] Collaboration mode (multiple cursors)

#### Known Issues:
None documented yet.

#### Notes:
Google Docs runs in browser. UI Automation may not work - might need keyboard simulation as fallback.

---

## AI Chatbots

### ChatGPT
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in chat input
- [ ] Overlay appearance in browser
- [ ] Text replacement in textarea
- [ ] Multi-line prompts
- [ ] Special characters (code blocks, markdown)

#### Known Issues:
None documented yet.

#### Notes:
ChatGPT uses a contenteditable div or textarea. Test both the web interface and desktop app (if applicable).

---

### Gemini
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in chat input
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Multi-line prompts

#### Known Issues:
None documented yet.

#### Notes:
Similar to ChatGPT, runs in browser. Test responsiveness of overlay in Google's interface.

---

### Claude
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in chat input
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Multi-line prompts
- [ ] Code blocks within prompts

#### Known Issues:
None documented yet.

#### Notes:
Test both claude.ai web interface and any desktop apps. Verify overlay doesn't conflict with Claude's UI.

---

## Browsers

### Browser Search Bar
**Status:** ⚠️ Partial (Brave Browser)
**Last Tested:** 2026-01-20

#### Features Tested:
- [x] @prompt detection in address/search bar
- [x] Overlay appearance
- [x] Text replacement in URL bar (address bar) - **WORKING**
- [x] Text replacement in search bar - **NOT WORKING (keyboard fallback removed)**
- [x] Copy button functionality - **WORKING**
- [ ] Chrome compatibility
- [ ] Edge compatibility
- [ ] Firefox compatibility

#### Known Issues:
1. **Browser Search Bar**:
   - **Issue**: UI Automation (ValuePattern) doesn't work on browser search bars
   - **Previous Solution**: Keyboard fallback using PowerShell SendKeys
   - **Current Status**: Keyboard fallback REMOVED (unreliable, caused issues)
   - **User Action**: Must use Copy button and paste manually (Ctrl+V)

2. **Copy Button**:
   - **Status**: ✅ Working via IPC-based method (no focus required)

#### Notes:
- **URL/Address Bar**: ✅ Works with UI Automation (ValuePattern)
- **Search Bar**: ❌ Auto-replace disabled - users must use Copy button
- **Why keyboard fallback was removed**:
  - Selected wrong windows
  - Unreliable timing
  - Caused false triggers
  - Users should use Copy button as designed fallback
- Browser controls have varying accessibility support - UI Automation only works for some controls

---

## Messaging Apps

### WhatsApp
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in chat input (Web)
- [ ] @prompt detection in chat input (Desktop app)
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Emoji/mention compatibility

#### Known Issues:
None documented yet.

#### Notes:
Test both WhatsApp Web (browser) and WhatsApp Desktop app. Input fields may behave differently.

---

### Discord
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in message input
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Markdown support (code blocks, bold, etc.)
- [ ] @mention conflicts with @prompt

#### Known Issues:
None documented yet.

#### Notes:
Discord has @mentions. Ensure @prompt doesn't conflict with Discord's @ autocomplete. Test in both channels and DMs.

---

### Telegram
**Status:** 🔄 Not Tested
**Last Tested:** Never

#### Features Tested:
- [ ] @prompt detection in chat input (Web)
- [ ] @prompt detection in chat input (Desktop app)
- [ ] Overlay appearance
- [ ] Text replacement
- [ ] Bot command (@) compatibility

#### Known Issues:
None documented yet.

#### Notes:
Similar to Discord, Telegram uses @ for bot commands. Verify no conflicts. Test both web and desktop versions.

---

## Testing Checklist

### Basic Functionality Test (Do this for EVERY application)
1. **Detection Test**
   - [ ] Type `@prompt` and verify trigger detection
   - [ ] Check console logs for trigger detection
   - [ ] Verify overlay appears at correct position

2. **Simple Replacement Test**
   - [ ] Type: `@prompt write an email`
   - [ ] Wait for optimization (highlight should turn green)
   - [ ] Click "Replace" button
   - [ ] Verify text is replaced correctly
   - [ ] Verify cursor is at end of replaced text

3. **Multi-line Test**
   - [ ] Type multi-line prompt:
     ```
     @prompt write an email
     about the meeting
     keep it short
     ```
   - [ ] Verify detection works with newlines
   - [ ] Verify replacement preserves formatting

4. **Edge Cases**
   - [ ] Type `@prompt` then delete it - overlay should disappear
   - [ ] Type `@prompt hello` then edit middle - should reset optimization
   - [ ] Type two `@prompt` instances - each should have separate overlay
   - [ ] Test with special characters: `@prompt "test" & 'quote' \n etc`

5. **Window Tracking**
   - [ ] Move window while overlay is visible - overlay should follow
   - [ ] Switch to different application - overlay should hide
   - [ ] Switch back - overlay should reappear

### Performance Test
1. **Timing**
   - [ ] Measure stabilization time (should be ~2000ms after stopping typing)
   - [ ] Measure optimization API call time
   - [ ] Verify no lag when typing after @prompt

2. **Resource Usage**
   - [ ] Check CPU usage during idle
   - [ ] Check CPU usage during typing
   - [ ] Check memory usage over time

### Failure Recovery Test
1. **Error Scenarios**
   - [ ] Disconnect internet during optimization - verify error handling
   - [ ] Close target window while overlay visible - verify cleanup
   - [ ] Type extremely long prompt (>10000 chars) - verify handling

---

## Additional Testing Suggestions

Based on the project architecture, here are more applications to consider testing:

### Code Editors & IDEs
- [ ] **Visual Studio** - Full IDE with different text controls
- [ ] **Sublime Text** - Lightweight editor
- [ ] **Atom** - Similar to VS Code
- [ ] **JetBrains IDEs** (PyCharm, WebStorm, etc.) - Different UI framework

### Email Clients
- [ ] **Outlook** - Desktop email client
- [ ] **Gmail** (Web) - Browser-based email
- [ ] **Thunderbird** - Open-source email client

### Note-Taking Apps
- [ ] **Notion** - Web + Desktop app
- [ ] **Obsidian** - Markdown editor
- [ ] **OneNote** - Microsoft note-taking
- [ ] **Evernote** - Cross-platform notes

### Terminals
- [ ] **Windows Terminal** - Modern terminal
- [ ] **PowerShell** - Command-line interface
- [ ] **Command Prompt** - Legacy terminal
- [ ] **Git Bash** - Unix-like terminal on Windows

### Collaboration Tools
- [ ] **Slack** - Team messaging
- [ ] **Microsoft Teams** - Video + chat
- [ ] **Zoom Chat** - Meeting chat

### Browsers (Specific Fields)
- [ ] **Browser Textarea** - Generic text input fields
- [ ] **GitHub comment box** - Markdown support
- [ ] **Reddit post/comment** - Rich text editor
- [ ] **Twitter/X compose** - Character-limited input

---

## Testing Best Practices

### Before Testing
1. Clear application logs: Check console for clean slate
2. Ensure stable internet connection (for API calls)
3. Document system info: Windows version, app versions
4. Close conflicting apps that might interfere

### During Testing
1. Test one feature at a time
2. Document exact steps to reproduce issues
3. Save screenshots of failures
4. Copy error messages from console logs
5. Note timestamp of when issue occurred

### After Testing
1. Update this file with results
2. Create GitHub issues for bugs found
3. Add repro steps to issues
4. Update priority based on severity
5. Retest after fixes are implemented

---

## Issue Severity Classification

Use this to prioritize fixes:

### Critical (P0) - Blocks core functionality
- Application completely doesn't work
- Crashes or freezes
- Data loss or corruption

### High (P1) - Major feature broken
- Text replacement fails
- Overlay doesn't appear
- Wrong text gets replaced

### Medium (P2) - Feature partially broken
- Cursor positioning wrong
- Overlay position slightly off
- Slow performance (>5s delay)

### Low (P3) - Minor issues
- Visual glitches
- Minor UI inconsistencies
- Edge cases that rarely occur

---

Last Updated: 2026-01-20
Version: 1.1 (Updated after keyboard fallback removal)
