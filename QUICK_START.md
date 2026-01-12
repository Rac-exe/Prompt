# Quick Start Guide

## Prerequisites

1. **Node.js** (v18+)
2. **Python** (v3.8+)
3. **Ollama** installed and running locally
4. **LLM Model** downloaded in Ollama (e.g., `ollama pull llama3.2`)

## Project Setup

### 1. Initialize Project

```bash
# Create project directory
mkdir prompt-optimizer
cd prompt-optimizer

# Initialize root package.json
npm init -y
```

### 2. Install Electron Dependencies

```bash
npm install --save-dev electron electron-builder typescript @types/node
npm install node-global-key-listener axios
```

### 3. Setup TypeScript

```bash
npm install --save-dev typescript @types/node
npx tsc --init
```

Update `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["electron/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 4. Setup Python Service

```bash
# Create Python service directory
mkdir python-service
cd python-service

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (macOS/Linux)
source venv/bin/activate

# Install dependencies
pip install fastapi uvicorn ollama pydantic
```

### 5. Project Structure

```
prompt-optimizer/
├── electron/
│   ├── main/
│   │   ├── index.ts
│   │   ├── app.ts
│   │   ├── input/
│   │   ├── context/
│   │   ├── overlay/
│   │   └── api/
│   ├── renderer/
│   │   ├── highlight.html
│   │   └── popup.html
│   └── preload.ts
├── python-service/
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py
│   └── requirements.txt
├── package.json
├── tsconfig.json
└── README.md
```

### 6. Basic package.json Scripts

```json
{
  "name": "prompt-optimizer",
  "version": "1.0.0",
  "main": "dist/electron/main/index.js",
  "scripts": {
    "build": "tsc",
    "electron": "electron .",
    "dev": "npm run build && npm run electron",
    "python:dev": "cd python-service && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
  }
}
```

### 7. Test Ollama Connection

```bash
# Start Ollama (if not running)
ollama serve

# Test in another terminal
ollama run llama3.2 "test prompt"
```

### 8. Run Development Environment

**Terminal 1 - Python Service**:
```bash
cd python-service
source venv/bin/activate  # or venv\Scripts\activate on Windows
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 - Electron App**:
```bash
npm run build
npm run electron
```

## Testing

1. Start both services (Python + Electron)
2. Open any text editor (Notepad, VS Code, etc.)
3. Type: `@prompt write a blog post about AI`
4. Wait for optimization (1-5 seconds)
5. Hover over the highlighted text
6. Click "Replace" to use optimized version

## Troubleshooting

### Keyboard Hook Not Working

**Windows**: May need to run as administrator (or use WH_KEYBOARD_LL which doesn't require admin)

**macOS**: Grant Accessibility permissions:
- System Preferences → Security & Privacy → Privacy → Accessibility
- Add your app

### Python Service Not Responding

- Check Ollama is running: `ollama list`
- Test endpoint: `curl http://localhost:8000/health`
- Check Python service logs

### Overlay Not Showing

- Check window bounds calculation
- Verify Electron window is created
- Check console for errors

## Next Steps

1. Implement proper cursor position detection
2. Add error handling and retry logic
3. Implement text replacement (keyboard simulation)
4. Add settings UI
5. Package for distribution
