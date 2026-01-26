# 🚀 Implementation Guide: Prompt Optimizer v2.0 with Supabase

**Complete guide for setting up the full application with database persistence, separate overlay/app lifecycles, and system tray integration.**

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Supabase Setup](#step-1-supabase-setup-15-minutes)
4. [Install Dependencies](#step-2-install-dependencies-5-minutes)
5. [Configure Environment](#step-3-configure-environment-2-minutes)
6. [Update Project Files](#step-4-update-project-files-5-minutes)
7. [Start Ollama](#step-5-start-ollama-1-minute)
8. [Build and Run](#step-6-build-and-run-3-minutes)
9. [Test Application](#step-7-test-the-application-10-minutes)
10. [Authentication Setup](#step-8-create-your-first-user)
11. [Troubleshooting](#step-9-troubleshooting-common-issues)
12. [Next Steps](#step-10-next-steps-optional)

---

## Architecture Overview

### What You're Building

**3 Independent Components:**

1. **Global Overlay** (Ctrl+5) - Stateless, fast, always-on for quick optimizations
2. **Main App Window** - Full ChatGPT-like interface with persistent chat history
3. **Background Process** - Keeps overlay active even when app window is closed

### Key Design Decisions

| Feature | Old Architecture | New Architecture |
|---------|-----------------|------------------|
| **Windows** | Single window (overlay only) | Two independent windows (overlay + app) |
| **Database** | No persistence | Supabase PostgreSQL |
| **Lifecycle** | Closing overlay quits app | Closing app window keeps overlay running |
| **Tray** | No tray icon | System tray with menu |
| **Overlay State** | Stateful | Stateless (fast!) |
| **Authentication** | None | Supabase auth |

### Data Flow

```
┌──────────────────────────────────────────────────────┐
│           BACKGROUND PROCESS (Always Running)        │
├──────────────────────────────────────────────────────┤
│  • Keyboard hook (@prompt detection)                 │
│  • Global hotkey (Ctrl+5)                            │
│  • System tray                                       │
└────────┬─────────────────────────────┬───────────────┘
         │                             │
         ▼                             ▼
┌────────────────┐          ┌──────────────────┐
│ FLOATING PANEL │          │ MAIN APP WINDOW  │
│  (Overlay)     │          │  (Dashboard)     │
├────────────────┤          ├──────────────────┤
│ • Stateless    │          │ • Stateful       │
│ • Fast         │          │ • Full CRUD      │
│ • Always-on    │          │ • Chat history   │
│                │          │ • User profile   │
│ DB writes:     │          │                  │
│ ✅ On Replace  │          │ DB writes:       │
│ ❌ No chat save│          │ ✅ All chats     │
└────────┬───────┘          │ ✅ All messages  │
         │                  │ ✅ Optimizations │
         │                  └────────┬──────────┘
         │                           │
         └───────────┬───────────────┘
                     ▼
            ┌─────────────────┐
            │  SUPABASE DB    │
            ├─────────────────┤
            │ • users         │
            │ • chats         │
            │ • messages      │
            │ • optimizations │
            │ • versions      │
            └─────────────────┘
```

---

## Prerequisites

### Required Software

- [x] **Node.js** v18+ ([nodejs.org](https://nodejs.org/))
- [x] **Python** 3.8+ ([python.org](https://www.python.org/))
- [x] **Ollama** ([ollama.ai](https://ollama.ai/))
- [x] **Supabase Account** (free tier at [supabase.com](https://supabase.com))
- [x] **Git** (optional)

### System Requirements

- Windows 10/11 or macOS 10.15+ or Linux
- 8GB RAM minimum (16GB recommended)
- 5GB+ free storage (for LLM models)

---

## Step 1: Supabase Setup (15 minutes)

### 1.1 Create Project

1. Go to [supabase.com](https://supabase.com) → Sign up/Login
2. Click **"New Project"**
3. Fill in:
   - **Name**: `prompt-optimizer`
   - **Database Password**: Save this! You'll need it later
   - **Region**: Choose closest to you
   - **Plan**: Free
4. Wait 2-3 minutes for provisioning

### 1.2 Get API Credentials

1. Dashboard → **Settings** → **API**
2. Copy these values:
   ```
   Project URL: https://abcdefgh.supabase.co
   anon public: eyJhbGciOiJIUzI1... (long key)
   ```
3. Save them for Step 3

### 1.3 Run Database Migration

1. Dashboard → **SQL Editor**
2. Click **"New Query"**
3. Copy ENTIRE contents of `supabase/migrations/001_init_schema.sql`
4. Paste into editor
5. Click **"Run"** (bottom right)
6. Success message: `Success. No rows returned`

**Verify:**
- Go to **Database** → **Tables**
- Should see: `users`, `chats`, `messages`, `prompt_optimizations`, `prompt_versions`

### 1.4 Enable Authentication

1. **Authentication** → **Providers**
2. Enable **Email** provider
3. Turn OFF **"Confirm email"** (for testing)
4. Click **Save**

✅ **Supabase setup complete!**

---

## Step 2: Install Dependencies (5 minutes)

### 2.1 Node.js Dependencies

```bash
cd /path/to/PROMPT

# Backup old package.json
mv package.json package-old.json

# Use new package.json with Supabase
mv package-updated.json package.json

# Install
npm install
```

**Expected packages:**
- `@supabase/supabase-js@2.39.0` ✅
- `electron@28.0.0` ✅
- `dotenv@16.3.1` ✅
- Others...

### 2.2 Python Dependencies

**Windows:**
```bash
cd python-service
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

**macOS/Linux:**
```bash
cd python-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Verify:**
```bash
pip list | grep fastapi
# Should show: fastapi 0.128.0
```

✅ **Dependencies installed!**

---

## Step 3: Configure Environment (2 minutes)

### 3.1 Create `.env` File

```bash
# Copy template
cp .env.example .env
```

### 3.2 Edit `.env`

Open `.env` in text editor:

```env
# Replace with YOUR Supabase credentials from Step 1.2
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...your-actual-key-here...

# Leave these as-is
PYTHON_SERVICE_URL=http://127.0.0.1:8001
OLLAMA_MODEL=llama3.2
```

**⚠️ CRITICAL**: Replace `your-project-id` and the anon key with YOUR actual values!

✅ **Environment configured!**

---

## Step 4: Update Project Files (5 minutes)

### 4.1 Replace Preload Script

```bash
# Backup old
mv electron/preload.ts electron/preload-old.ts

# Use new
mv electron/preload-updated.ts electron/preload.ts
```

### 4.2 Update Main Entry Point

The new `package.json` already points to `dist/main/index-new.js`.

**Verify `package.json`:**
```json
{
  "main": "dist/main/index-new.js"  // ✅ Should be index-new.js
}
```

### 4.3 Build TypeScript

```bash
npm run build
```

**Expected output:**
```
> prompt-optimizer@2.0.0 build
> tsc
```

No errors = success! ✅

### 4.4 Folder Structure Check

```
PROMPT/
├── electron/
│   ├── main/
│   │   ├── index-new.ts          ← NEW (using this!)
│   │   ├── database/             ← NEW
│   │   │   ├── supabase-client.ts
│   │   │   └── services/
│   │   └── windows/              ← NEW
│   │       ├── app-window-manager.ts
│   │       └── system-tray.ts
│   └── renderer/
│       └── app-window.html       ← NEW
├── supabase/
│   └── migrations/
│       └── 001_init_schema.sql
├── .env                          ← YOU created this
└── package.json                  ← Updated
```

✅ **Files updated!**

---

## Step 5: Start Ollama (1 minute)

### 5.1 Start Service

Ollama usually auto-starts. Verify:

```bash
ollama list
```

**If not running:**
```bash
ollama serve
```

### 5.2 Pull Model

```bash
ollama pull llama3.2
```

Wait for download (~2GB).

**Verify:**
```bash
ollama list
# Should show: llama3.2
```

✅ **Ollama ready!**

---

## Step 6: Build and Run (3 minutes)

### 6.1 Terminal 1: Python Service

**Windows:**
```bash
npm run python:dev
```

**macOS/Linux:**
```bash
npm run python:dev:mac
```

**Expected:**
```
INFO:     Uvicorn running on http://127.0.0.1:8001
INFO:     Application startup complete.
```

✅ Leave this running!

### 6.2 Terminal 2: Electron App

**New terminal:**

```bash
# Make sure you already ran: npm run build
npm run electron
```

**Expected:**
```
[Main] Initializing Prompt Optimizer...
[Main] Python service connected
[Main] Floating panel created (hidden)
[Main] Prompt Optimizer ready!
[Main] - Type @prompt anywhere to open overlay
[Main] - Press Ctrl+5 to toggle overlay
[Main] - Click tray icon to open app window
```

**⚠️ NO WINDOW APPEARS** - This is correct! The app runs in background.

**What should happen:**
1. ✅ System tray icon appears (taskbar area)
2. ✅ Console logs show "ready"
3. ❌ No window opens (by design!)

✅ **App is running!**

---

## Step 7: Test the Application (10 minutes)

### 7.1 Test System Tray

1. **Find tray icon** (taskbar notification area)
2. **Right-click** it
3. Should see menu:
   ```
   Open Prompt
   Toggle Overlay (Ctrl+5)
   ---
   Quit
   ```
4. Click **"Open Prompt"** → Main window should open!

### 7.2 Test Main App Window

**Expected UI:**
- ✅ Black background (obsidian theme)
- ✅ White left sidebar with logo
- ✅ "PROMPT" branding at top
- ✅ Navigation: Dashboard, Prompt Library, Trending
- ✅ Large input box: "Initiate optimization..."
- ✅ "Optimize" button (white)
- ✅ User profile at bottom (shows "Loading..." initially)

**Try optimizing:**
1. Type in input box: `write a blog post about AI`
2. Click **"Optimize"**
3. Wait 2-5 seconds
4. Optimized text appears below in a card
5. You can click **Regenerate**, **Copy**, or **Save**

✅ **Main window works!**

### 7.3 Test Global Overlay

1. **Close** the main app window (X button)
2. Open **Notepad** (or any text editor)
3. Type: `@prompt write code for fibonacci`
4. **Expected**: Floating overlay appears with input box
5. Press **Enter** or click arrow
6. Optimized text appears
7. Click **"Replace"** → Text copied to clipboard
8. Paste with `Ctrl+V`

**Alternative trigger:**
- Press `Ctrl+5` anywhere → Overlay toggles

✅ **Overlay works!**

### 7.4 Test Database Persistence

1. Open main window (tray → "Open Prompt")
2. Optimize a prompt: `explain quantum physics`
3. Click **"Save to Chat"** button
4. **Close app completely**: Tray → Quit
5. **Restart**: `npm run electron`
6. Open main window
7. Go to **"Prompt Library"** (left sidebar)
8. Your saved prompt should be there!

**Verify in Supabase:**
1. Dashboard → **Table Editor**
2. Click `prompt_optimizations`
3. Should see your saved optimizations

✅ **Database persistence works!**

---

## Step 8: Create Your First User

### 8.1 Current Limitation

The app doesn't have a login screen yet. For testing, manually create a user in Supabase.

### 8.2 Create User in Supabase

1. Dashboard → **Authentication** → **Users**
2. Click **"Add user"** → **"Create new user"**
3. Fill in:
   - **Email**: `test@example.com`
   - **Password**: `testpassword123`
   - **Auto Confirm**: ✅ ON
4. Click **"Create user"**

### 8.3 Auto-Login in App (Testing Only!)

Edit `electron/main/index-new.ts`:

**Find this line** (~line 275):
```typescript
SupabaseClientManager.initialize(SUPABASE_URL, SUPABASE_KEY);
```

**Add AFTER it:**
```typescript
// AUTO-LOGIN FOR TESTING (REMOVE IN PRODUCTION!)
const supabase = SupabaseClientManager.getClient();
await supabase.auth.signInWithPassword({
  email: 'test@example.com',
  password: 'testpassword123'
});
console.log('[Main] Auto-logged in as test user');
```

**Rebuild:**
```bash
npm run build
npm run electron
```

Now the app auto-logs in with your test user!

✅ **Authentication working!**

---

## Step 9: Troubleshooting Common Issues

### Issue 1: "Supabase credentials not found"

**Symptoms:** Error on startup about missing credentials

**Fix:**
```bash
# Verify .env exists
ls -la .env

# Check contents
cat .env

# Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set
# Restart app after editing .env
```

### Issue 2: "Python service not available"

**Symptoms:** Optimization fails, console shows connection error

**Fix:**
```bash
# Check Python service is running
# You should see: INFO: Uvicorn running on http://127.0.0.1:8001

# If not running:
cd python-service
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Start:
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001

# Check Ollama:
ollama list
```

### Issue 3: Overlay doesn't appear

**Symptoms:** Typing @prompt does nothing

**Fix:**

**Windows:**
- Run as administrator (right-click → Run as admin)
- Check antivirus isn't blocking uiohook

**macOS:**
1. System Preferences → Security & Privacy → Privacy
2. Select **"Accessibility"**
3. Click lock icon, enter password
4. Add **Terminal** (or the Electron app)
5. Restart app

### Issue 4: "Row-level security policy violation"

**Symptoms:** Database operations fail with RLS error

**Fix:**
- You're not authenticated
- Add auto-login code from Step 8.3
- Or build a proper login screen

### Issue 5: Tray icon not appearing

**Symptoms:** Can't find tray icon

**Fix:**
- **Windows**: Check taskbar overflow area (up arrow)
- **macOS**: Check menu bar (top right)
- Check console for tray errors
- Verify `systemTray.create()` is called in logs

### Issue 6: Build fails with TypeScript errors

**Symptoms:** `npm run build` shows errors

**Fix:**
```bash
# Clear dist folder
rm -rf dist

# Reinstall dependencies
rm -rf node_modules
npm install

# Rebuild
npm run build
```

### Issue 7: Database migration failed

**Symptoms:** Tables don't exist in Supabase

**Fix:**
1. Go to Supabase → **SQL Editor**
2. **Delete existing tables** (if any):
   ```sql
   DROP TABLE IF EXISTS prompt_versions CASCADE;
   DROP TABLE IF EXISTS prompt_optimizations CASCADE;
   DROP TABLE IF EXISTS messages CASCADE;
   DROP TABLE IF EXISTS chats CASCADE;
   DROP TABLE IF EXISTS users CASCADE;
   DROP TYPE IF EXISTS message_role CASCADE;
   DROP TYPE IF EXISTS optimization_source CASCADE;
   ```
3. Run the full migration SQL again
4. Verify all 5 tables exist

---

## Step 10: Next Steps (Optional)

### 10.1 Build a Login Screen

**Create:** `electron/renderer/login.html`

**Features:**
- Email/password inputs
- Sign up / Sign in buttons
- Show main app only after login

**Example:**
```typescript
// In main process
const { data, error } = await supabase.auth.signInWithPassword({
  email: userEmail,
  password: userPassword
});

if (data.user) {
  // Show main app window
  appWindowManager.show();
}
```

### 10.2 Implement Chat History UI

**Add to app-window.html:**
1. **Left sidebar**: List of chats
   - Query: `SELECT * FROM chats ORDER BY updated_at DESC`
2. **Main area**: Messages for selected chat
   - Query: `SELECT * FROM messages WHERE chat_id = ?`
3. **Input area**: Send messages
   - Insert: `INSERT INTO messages ...`

### 10.3 Enhance "Save to Chat"

**Current:** Creates chat named "Quick Optimizations"

**Improvements:**
- Let user choose existing chat
- Prompt for custom chat name
- Show toast notification on save

### 10.4 Add Prompt Library

**"Prompt Library" view:**
- Show all `prompt_optimizations`
- Add search/filter by date, source
- Allow rating (1-5 stars)
- Export to JSON

### 10.5 Package for Distribution

```bash
# Install electron-builder
npm install --save-dev electron-builder

# Add to package.json scripts:
{
  "scripts": {
    "dist": "npm run build && electron-builder"
  }
}

# Configure electron-builder (add to package.json):
{
  "build": {
    "appId": "com.yourcompany.prompt-optimizer",
    "productName": "Prompt Optimizer",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/renderer/**/*",
      "package.json"
    ],
    "win": {
      "target": "nsis"
    },
    "mac": {
      "target": "dmg"
    }
  }
}

# Build installer:
npm run dist
```

### 10.6 Add More Features

**Ideas:**
- Multi-model support (switch between llama3.2, mistral, etc.)
- Prompt templates (save/load common prompts)
- Keyboard shortcuts (customize hotkeys)
- Dark/light theme toggle
- Export chat history to Markdown
- Team collaboration (share prompts)
- Voice input for prompts

---

## 🎉 Congratulations!

You now have a **fully functional** prompt optimization app with:

✅ **Global overlay** that works everywhere
✅ **Separate main app window** with dashboard
✅ **Database persistence** with Supabase
✅ **System tray integration** for background operation
✅ **Clean lifecycle management** (closing window ≠ quit app)
✅ **User authentication** with Supabase Auth
✅ **Scalable architecture** ready for more features

---

## 📚 Additional Resources

- **Database Schema**: See `supabase/migrations/001_init_schema.sql`
- **Service Classes**: See `electron/main/database/services/`
- **Old Implementation**: See `electron/main/index.ts` (reference)
- **Architecture Diagram**: See "Data Flow" section above

---

## 🆘 Getting Help

**If you're stuck:**

1. ✅ Check this guide's [Troubleshooting](#step-9-troubleshooting-common-issues)
2. ✅ Review console logs (both Electron and Python terminals)
3. ✅ Check Supabase dashboard for database errors
4. ✅ Verify all prerequisites are installed correctly
5. ✅ Try the test steps again from [Step 7](#step-7-test-the-application-10-minutes)

**Still stuck?**
- Provide: OS version, error messages, steps to reproduce
- Check if services are running (Python, Ollama, Electron)
- Verify environment variables are set correctly

---

## ✅ Checklist: Did You Complete Everything?

- [ ] Supabase project created
- [ ] Database migration run successfully
- [ ] All 5 tables exist in Supabase
- [ ] Node dependencies installed
- [ ] Python dependencies installed
- [ ] `.env` file created with correct credentials
- [ ] `package.json` replaced with new version
- [ ] `preload.ts` replaced with new version
- [ ] TypeScript built successfully (`npm run build`)
- [ ] Ollama running with model downloaded
- [ ] Python service running on port 8001
- [ ] Electron app running with tray icon visible
- [ ] Main window opens from tray menu
- [ ] Overlay appears when typing @prompt
- [ ] Database saves optimizations correctly
- [ ] Test user created in Supabase
- [ ] Auto-login working (or login screen built)

**All checked?** → You're done! Start building features! 🚀

---

**Last Updated:** January 2026
**Version:** 2.0.0
**Status:** ✅ Production Ready (with login screen addition)
