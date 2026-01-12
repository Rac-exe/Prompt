# Complete Implementation Guide - Prompt Optimizer

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Running the Application](#running-the-application)
5. [Usage](#usage)
6. [Development Workflow](#development-workflow)
7. [Troubleshooting](#troubleshooting)
8. [Project Structure](#project-structure)
9. [Key Components](#key-components)
10. [Next Steps](#next-steps)

---

## Prerequisites

### Required Software

1. **Node.js** (v18 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify: `node --version`

2. **Python** (v3.8 or higher)
   - Download from [python.org](https://www.python.org/downloads/)
   - Verify: `python --version`
   - **Important**: Ensure Python is added to PATH

3. **Ollama** (Latest version)
   - **Windows**: Download installer from [ollama.ai/download](https://ollama.ai/download)
   - **macOS**: `brew install ollama` or download from website
   - **Linux**: See [ollama.ai/download](https://ollama.ai/download)
   - Verify: `ollama --version`

4. **Git** (Optional, for version control)
   - Download from [git-scm.com](https://git-scm.com/)

### System Requirements

- **Windows**: Windows 10/11 (64-bit)
- **macOS**: macOS 10.15 or later
- **RAM**: Minimum 8GB (16GB recommended for LLM)
- **Storage**: 5GB+ free space (for models)
- **Permissions**: 
  - Windows: No special permissions needed
  - macOS: Accessibility permission required (see setup)

---

## Installation

### Step 1: Clone/Download Project

If using Git:
```bash
git clone <repository-url>
cd prompt-optimizer
```

Or extract the project folder to your desired location.

### Step 2: Install Node.js Dependencies

```bash
npm install
```

**Expected Output:**
```
added 96 packages
```

**Installed Packages:**
- `electron` (v28.0.0) - Desktop app framework
- `typescript` (v5.3.3) - TypeScript compiler
- `axios` (v1.6.2) - HTTP client
- `node-global-key-listener` (v0.2.0) - Global keyboard hooks

### Step 3: Install Python Dependencies

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

**Installed Python Packages:**
- `fastapi` (v0.128.0) - Web framework
- `uvicorn[standard]` (v0.40.0) - ASGI server
- `ollama` (v0.6.1) - Ollama client library
- `pydantic` (v2.12.5) - Data validation

**Note**: If you encounter Rust compilation errors, the packages should install pre-built wheels automatically.

### Step 4: Setup Ollama

1. **Start Ollama Service:**
   ```bash
   ollama serve
   ```
   Keep this running in a separate terminal.

2. **Download a Model:**
   ```bash
   # Recommended: LLaMA 3.2 (smaller, faster)
   ollama pull llama3.2
   
   # Or try other models:
   ollama pull mistral
   ollama pull codellama
   ```

3. **Verify Model:**
   ```bash
   ollama list
   ```
   Should show your downloaded model.

### Step 5: Build TypeScript

```bash
npm run build
```

**Expected Output:**
```
> prompt-optimizer@1.0.0 build
> tsc
```

This compiles TypeScript files to JavaScript in the `dist/` directory.

---

## Configuration

### Python Service Configuration

Edit `python-service/app/main.py`:

```python
# Change default model (line ~40)
response = ollama.chat(
    model="your-model-name",  # Change this
    ...
)

# Change port (line ~100)
uvicorn.run(app, host="127.0.0.1", port=8000)  # Change port
```

### Electron Configuration

Edit `electron/main/api/python-client.ts`:

```typescript
// Change Python service URL (line ~10)
constructor(baseUrl: string = "http://localhost:8000") {  // Change port
```

### System Prompt Customization

Edit `python-service/app/main.py`:

```python
SYSTEM_PROMPT = """Your custom system prompt here..."""
```

---

## Running the Application

### Development Mode

You need **two terminals** running simultaneously:

**Terminal 1 - Python Service:**

**Windows:**
```bash
npm run python:dev
```

**macOS/Linux:**
```bash
npm run python:dev:mac
```

**Or manually (if scripts don't work):**
```bash
cd python-service
# Windows
.\venv\Scripts\activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# macOS/Linux
source venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Expected Output:**
```
INFO:     Will watch for changes in these directories: ['C:\\Users\\...\\python-service']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

**Terminal 2 - Electron App:**
```bash
npm run dev
```

**Expected Output:**
```
> prompt-optimizer@1.0.0 dev
> npm run build && npm run electron

> prompt-optimizer@1.0.0 build
> tsc

> prompt-optimizer@1.0.0 electron
Initializing Prompt Optimizer...
Python service connected
Keyboard monitoring started
Prompt Optimizer initialized successfully
```

### Production Mode

```bash
npm run build
npm start
```

---

## Usage

### Basic Usage

1. **Start both services** (Python + Electron)

2. **Open any text application:**
   - Notepad
   - VS Code
   - Chrome (text fields)
   - Word
   - Any text editor

3. **Type the trigger:**
   ```
   @prompt your prompt text here
   ```

4. **Wait for optimization** (1-5 seconds):
   - A blue highlight appears under your text
   - Shows "Optimizing..." message

5. **View optimized version:**
   - Hover over the highlight
   - A popup appears showing:
     - Original prompt
     - Optimized prompt
     - Replace button

6. **Replace text:**
   - Click "Replace" button
   - Text is copied to clipboard
   - **Note**: Currently requires manual paste (Ctrl+V / Cmd+V)
   - Future: Automatic replacement with native modules

### Example Prompts

**Basic:**
```
@prompt write a blog post about AI
```

**Technical:**
```
@prompt explain how neural networks work
```

**Creative:**
```
@prompt create a story about a robot learning to paint
```

---

## Development Workflow

### Project Structure

```
prompt-optimizer/
├── electron/                    # Electron application
│   ├── main/                    # Main process (TypeScript)
│   │   ├── index.ts            # Entry point
│   │   ├── app.ts              # App orchestrator
│   │   ├── input/              # Keyboard hooks
│   │   │   ├── keyboard-hook.ts
│   │   │   └── trigger-detector.ts
│   │   ├── context/            # Window tracking
│   │   │   └── window-tracker.ts
│   │   ├── overlay/            # UI overlays
│   │   │   └── overlay-manager.ts
│   │   ├── api/                # Python client
│   │   │   └── python-client.ts
│   │   └── text/               # Text replacement
│   │       └── text-replacer.ts
│   ├── renderer/               # UI files
│   │   ├── highlight.html
│   │   ├── popup.html
│   │   └── error.html
│   └── preload.ts              # IPC bridge
├── python-service/             # Python AI service
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py            # FastAPI server
│   ├── venv/                   # Virtual environment
│   └── requirements.txt
├── dist/                       # Compiled JavaScript (generated)
├── node_modules/              # Node dependencies
├── package.json
├── tsconfig.json
└── README.md
```

### Development Commands

```bash
# Build TypeScript
npm run build

# Run Electron (after build)
npm run electron

# Build + Run (development)
npm run dev

# Run Python service
npm run python:dev

# Install Python dependencies
npm run python:install
```

### Making Changes

1. **Edit TypeScript files** in `electron/main/`
2. **Rebuild**: `npm run build`
3. **Restart Electron**: `npm run electron`

4. **Edit Python files** in `python-service/app/`
5. **Auto-reload**: Service auto-reloads on file changes (if using `--reload`)

### Testing

**Test Python Service:**
```bash
# Health check
curl http://localhost:8000/health

# Test optimization
curl -X POST http://localhost:8000/optimize \
  -H "Content-Type: application/json" \
  -d '{"prompt": "write a blog post"}'
```

**Test Electron:**
- Check console output for errors
- Verify keyboard hook is active
- Test trigger detection

---

## Troubleshooting

### Common Issues

#### 1. "Python service not available"

**Symptoms:**
- Electron shows warning: "Python service not available"
- Overlay doesn't appear

**Solutions:**
- Ensure Python service is running: `npm run python:dev`
- Check port 8000 is not in use: `netstat -an | findstr 8000` (Windows)
- Verify Ollama is running: `ollama list`
- Check Python service logs for errors

#### 2. "Model not found" Error

**Symptoms:**
- Python service returns 500 error
- Error message mentions model

**Solutions:**
- Ensure Ollama is running: `ollama serve`
- Pull the model: `ollama pull llama3.2`
- Verify model exists: `ollama list`
- Check model name in `python-service/app/main.py` matches

#### 3. Keyboard Hook Not Working

**Windows:**
- Try running Electron as administrator
- Check antivirus isn't blocking
- Verify `node-global-key-listener` installed correctly

**macOS:**
- **Grant Accessibility Permission:**
  1. System Preferences → Security & Privacy → Privacy
  2. Select "Accessibility" from left sidebar
  3. Click lock icon, enter password
  4. Add Terminal (or Electron app)
  5. Restart Electron app

#### 4. TypeScript Build Errors

**Symptoms:**
- `npm run build` fails
- Type errors in console

**Solutions:**
- Ensure all dependencies installed: `npm install`
- Check TypeScript version: `npx tsc --version`
- Clear and rebuild: `rm -rf dist && npm run build`

#### 5. Overlay Not Showing

**Symptoms:**
- Trigger detected but no highlight appears

**Solutions:**
- Check Electron console for errors
- Verify window bounds calculation
- Test in different application
- Check overlay window creation in logs

#### 6. Text Replacement Not Working

**Current Limitation:**
- Text replacement currently copies to clipboard
- Requires manual paste (Ctrl+V / Cmd+V)

**Future Solution:**
- Add `robotjs` or native keyboard simulation module
- Implement automatic paste

### Debug Mode

**Enable Verbose Logging:**

Edit `electron/main/app.ts`:
```typescript
// Add at top
process.env.DEBUG = "true";
```

**Check Logs:**
- Electron: Console output in terminal
- Python: Terminal running `npm run python:dev`
- Ollama: Check Ollama service logs

### Performance Issues

**Slow Optimization:**
- Use smaller model (llama3.2 instead of llama3)
- Reduce `num_predict` in Python service
- Check system resources (CPU/RAM)

**High CPU Usage:**
- Reduce window tracking frequency
- Optimize keyboard hook callbacks
- Check for memory leaks

---

## Key Components

### 1. Keyboard Hook (`electron/main/input/keyboard-hook.ts`)

- Monitors global keyboard events
- Detects "@prompt" trigger
- Emits "trigger-detected" event

### 2. Trigger Detector (`electron/main/input/trigger-detector.ts`)

- Captures prompt text after trigger
- Tracks window context
- Manages capture timeout

### 3. Window Tracker (`electron/main/context/window-tracker.ts`)

- Gets active window information
- Calculates window bounds
- Platform-specific (Windows/macOS)

### 4. Overlay Manager (`electron/main/overlay/overlay-manager.ts`)

- Creates transparent overlay windows
- Manages highlight and popup UI
- Handles text replacement

### 5. Python Client (`electron/main/api/python-client.ts`)

- HTTP client for Python service
- Sends optimization requests
- Handles errors and timeouts

### 6. Python Service (`python-service/app/main.py`)

- FastAPI server
- Ollama integration
- Prompt optimization logic
- Caching

---

## Next Steps

### Immediate Improvements

1. **Automatic Text Replacement**
   - Add `robotjs` or native module
   - Implement keyboard simulation
   - Support undo/redo

2. **Better Cursor Detection**
   - App-specific hooks
   - Accessibility APIs
   - OCR-based detection

3. **Settings UI**
   - Model selection
   - Port configuration
   - System prompt editor

### Future Features

- Multi-model support
- Prompt templates
- History of optimizations
- Keyboard shortcuts
- Multi-language support
- Cloud sync (optional)
- Team features

### Production Readiness

- [ ] Code signing (Windows/macOS)
- [ ] Installer creation
- [ ] Auto-updater setup
- [ ] Error reporting
- [ ] Analytics (privacy-focused)
- [ ] Documentation website
- [ ] User guide

---

## Additional Resources

- **Architecture**: See `ARCHITECTURE.md`
- **Code Examples**: See `IMPLEMENTATION_EXAMPLE.md`
- **Quick Start**: See `QUICK_START.md`
- **Setup Help**: See `SETUP.md`

## Support

For issues:
1. Check this guide's Troubleshooting section
2. Review error logs
3. Check GitHub issues (if applicable)
4. Create new issue with:
   - OS version
   - Error messages
   - Steps to reproduce

---

**Last Updated**: Based on current project state with all dependencies installed and TypeScript compilation successful.

**Status**: ✅ Ready for development and testing
