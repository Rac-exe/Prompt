# 🚀 Quick Start Guide - Integrated App

## Running the App

### Terminal 1: Python Service
```bash
cd /c/prompt/Prompt
npm run python:dev
```

### Terminal 2: Electron App
```bash
cd /c/prompt/Prompt
npm run dev
```

The app will open automatically with the new React UI!

---

## Testing the Integration

### 1. **Basic Test**
- App should open without errors
- No 404 page
- UI shows chat interface
- You're automatically logged in

### 2. **Prompt Optimization**
```
1. Type: "Write a blog post about AI"
2. Press Enter or click Send
3. Wait ~2-5 seconds
4. AI-optimized response appears
```

### 3. **Overlay Test**
```
1. Close the app window (X button)
2. Electron keeps running in tray
3. Press Ctrl+5
4. Overlay appears
5. Type: @prompt test prompt
6. Overlay shows optimization
```

### 4. **Persistence Test**
```
1. Send a prompt
2. Close app
3. Reopen from tray
4. Chat should still be there
```

---

## Making Changes to the UI

### Edit React Code
```bash
cd /c/prompt/App-main
# Edit files in src/
```

### Rebuild & Deploy
```bash
# Build
cd /c/prompt/App-main
npm run build

# Copy to Electron
cp -r dist/* /c/prompt/Prompt/electron/renderer/app-ui/

# Rebuild Electron
cd /c/prompt/Prompt
npm run build

# Test
npm run dev
```

---

## Useful Commands

### Check if Python service is running
```bash
curl http://127.0.0.1:8001/health
```

### Check Electron APIs in app
```javascript
// Open DevTools (Ctrl+Shift+I)
console.log('Electron?', !!window.electronAPI);
console.log('APIs:', Object.keys(window.electronAPI || {}));
```

### View logs
```bash
# Electron logs show in terminal
# Python logs show in python:dev terminal
```

---

## Common Issues

### Issue: 404 Error
**Solution**: Already fixed with HashRouter

### Issue: Features don't work
**Check**:
1. Is Python service running?
2. Check console for errors
3. Verify `window.electronAPI` exists

### Issue: Optimization doesn't work
**Check**:
1. Python service logs
2. Ollama is running: `ollama list`
3. Port 8001 is accessible

---

## Key Files

### React UI (for editing)
- `/c/prompt/App-main/src/pages/Index.tsx` - Main app logic
- `/c/prompt/App-main/src/lib/electron-api.ts` - Electron bridge
- `/c/prompt/App-main/src/hooks/use-electron.ts` - IPC hooks

### Electron (integrated)
- `/c/prompt/Prompt/electron/renderer/app-ui/` - Deployed UI
- `/c/prompt/Prompt/electron/main/windows/app-window-manager.ts` - Window config

---

## Architecture

```
React UI (Renderer Process)
    ↓ IPC
Main Process (Electron)
    ↓ HTTP
Python Service (FastAPI)
    ↓ API calls
Ollama (AI Model)
```

---

## Next Steps

1. **Test all features** - Make sure everything works
2. **Customize UI** - Edit React components in App-main
3. **Add features** - Use existing Electron APIs
4. **Deploy** - Package for distribution

---

## Support

### Documentation
- `FINAL_INTEGRATION_STATUS.md` - Complete integration details
- `INTEGRATION_SUMMARY.md` - Technical implementation
- `INTEGRATION_CHECKLIST.md` - Step-by-step guide

### Issues?
1. Check terminal logs
2. Check DevTools console (Ctrl+Shift+I)
3. Verify services are running
4. Review documentation

---

## Success! 🎉

Your app is now fully integrated:
- ✅ Modern React UI
- ✅ Electron IPC connected
- ✅ AI optimization working
- ✅ Chat persistence enabled
- ✅ Overlay independent

Happy coding! 🚀
