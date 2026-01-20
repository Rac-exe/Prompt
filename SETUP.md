# Setup Instructions

## Quick Setup

### 1. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies
npm run python:install
```

### 2. Setup Ollama

Make sure Ollama is installed and running:

```bash
# Check if Ollama is installed
ollama --version

# If not installed, download from https://ollama.ai

# Pull a model (e.g., llama3.2)
ollama pull llama3.2

# Verify model is available
ollama list
```

### 3. Start the Application

**Terminal 1 - Start Python Service:**
```bash
npm run python:dev
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

**Terminal 2 - Start Electron App:**
```bash
npm run dev
```

### 4. Grant Permissions (macOS only)

On macOS, you'll need to grant Accessibility permissions:

1. Open System Preferences → Security & Privacy → Privacy
2. Select "Accessibility" from the left sidebar
3. Click the lock icon and enter your password
4. Add the Prompt Optimizer app (or Terminal if running from terminal)
5. Restart the app

### 5. Test the Application

1. Open any text editor (Notepad, VS Code, etc.)
2. Type: `@prompt write a blog post about AI`
3. Wait 1-5 seconds for optimization
4. You should see a highlight appear
5. Hover over the highlight to see the optimized version
6. Click "Replace" to copy to clipboard (then paste manually)

## Troubleshooting

### "Python service not available"

- Ensure Python service is running: `npm run python:dev`
- Check if port 8000 is in use: `netstat -an | findstr 8000` (Windows) or `lsof -i :8000` (macOS)
- Verify Ollama is running: `ollama list`

### "Model not found" error

- Ensure Ollama is running: `ollama serve`
- Pull the model: `ollama pull llama3.2`
- Check available models: `ollama list`

### Keyboard hook not working

**Windows:**
- Try running as administrator
- Check if antivirus is blocking the app

**macOS:**
- Grant Accessibility permissions (see step 4 above)
- Restart the app after granting permissions

### Overlay not showing

- Check Electron console for errors
- Verify window bounds are being calculated correctly
- Try in a different application

### Text replacement not working

**Note:** Full automatic text replacement requires native keyboard simulation modules. The current implementation copies to clipboard - you'll need to paste manually (Ctrl+V / Cmd+V).

To implement full replacement, you would need to:
- Add `robotjs` or similar library
- Or create a native addon using Windows `SendInput` API or macOS `CGEvent` API

## Development

### Building

```bash
npm run build
```

### Running Tests

(Add test commands here when tests are implemented)

### Project Structure

```
prompt-optimizer/
├── electron/              # Electron application
│   ├── main/             # Main process (TypeScript)
│   │   ├── input/        # Keyboard hooks and trigger detection
│   │   ├── context/      # Window tracking
│   │   ├── overlay/     # UI overlay management
│   │   ├── api/         # Python client
│   │   └── text/        # Text replacement
│   ├── renderer/         # UI files (HTML)
│   └── preload.ts        # Preload script
├── python-service/       # Python AI service
│   └── app/
│       └── main.py       # FastAPI server
└── package.json
```

## Next Steps

1. Implement native keyboard simulation for automatic text replacement
2. Improve cursor position detection
3. Add settings UI
4. Add undo/redo support
5. Support multiple models
@prompt write a blog post about AI
