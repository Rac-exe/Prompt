# How to Start the Application

## ✅ All Dependencies Installed

Both Node.js and Python dependencies are now properly installed:

### Node.js Packages:
- ✅ electron
- ✅ typescript
- ✅ axios
- ✅ ws (WebSocket client)
- ✅ node-global-key-listener

### Python Packages:
- ✅ fastapi
- ✅ uvicorn
- ✅ ollama
- ✅ vosk (speech recognition)
- ✅ pyaudio (audio capture)
- ✅ numpy

## 🚀 Starting the Application

You need to run **TWO terminals**:

### Terminal 1: Python Service (Backend)
```powershell
cd C:\Users\Prabhat\Desktop\PROMPT
npm run python:dev
```

This starts the FastAPI server on `http://127.0.0.1:8000`

**Wait for this message:**
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### Terminal 2: Electron App (Frontend)
```powershell
cd C:\Users\Prabhat\Desktop\PROMPT
npm run dev
```

This builds TypeScript and starts the Electron app.

**Wait for this message:**
```
Prompt Optimizer initialized successfully
Press Ctrl+5 (or Cmd+5 on macOS) to show/hide the floating panel
```

## 🎯 Using the Application

### Method 1: Type @prompt anywhere
1. Open any text editor (Notepad, VS Code, Chrome, etc.)
2. Type: `@prompt Write me a blog post about AI`
3. Wait 2-3 seconds for the text to stabilize
4. A popup will appear with the optimized prompt
5. Click the **Replace** button (✓) to replace your text
6. Or click **Copy** (⎘) to copy to clipboard

### Method 2: Use Floating Panel (Ctrl+5)
1. Press `Ctrl+5` to show the floating panel
2. Type or speak your prompt
3. Click submit or stop voice input
4. The prompt will be optimized automatically

## 🔧 Troubleshooting

### Python Service Won't Start
**Error:** `Module not found`
**Solution:**
```powershell
cd python-service
./venv/Scripts/python.exe -m pip install -r requirements.txt
```

### Electron App Crashes
**Error:** `Cannot find module 'ws'`
**Solution:**
```powershell
npm install ws @types/ws
npm run build
```

### Ollama Not Working
**Error:** `Model not found`
**Solution:**
```powershell
ollama pull llama3.2
ollama list  # Verify model is installed
```

### Voice Input Not Working
**Error:** `Vosk model not found`
**Solution:**
```powershell
npm run python:download-model
```

## 📋 Features Available

✅ **Replace Button** - Automatically replaces `@prompt <text>` with optimized output
✅ **Copy Button** - Copies optimized text to clipboard
✅ **Refresh Button** - Re-runs optimization
✅ **Voice Input** - Speech-to-text via Vosk (Ctrl+5 → Mic icon)
✅ **Global Trigger** - Type `@prompt` anywhere on your system
✅ **Floating Panel** - Quick access via Ctrl+5

## ⚙️ Configuration

### Change LLM Model
Edit `python-service/app/main.py`:
```python
model="llama3.2",  # Change to "mistral" or other Ollama model
```

### Change Port
Edit `electron/main/app.ts`:
```typescript
this.pythonClient = new PythonClient("http://127.0.0.1:8000");  // Change port
```

And `python-service/app/main.py`:
```python
uvicorn.run(app, host="127.0.0.1", port=8000)  # Change port
```

## 🛑 Stopping the Application

1. Close the Electron window or press `Ctrl+C` in Terminal 2
2. Press `Ctrl+C` in Terminal 1 to stop Python service

## 📝 Notes

- **First Run**: May take longer as Vosk model loads
- **Optimization Speed**: Depends on your hardware (1-5 seconds)
- **Privacy**: All processing happens locally, no cloud services
- **Permissions**: Windows may show UAC prompt on first run

## 🎉 You're Ready!

The application is now fully set up and ready to use. Both terminals should be running for the app to work properly.
