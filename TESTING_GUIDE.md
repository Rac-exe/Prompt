# Testing Guide - Prompt Optimizer

## ✅ Service Status

### Python Service: **RUNNING** ✅
- **URL**: http://localhost:8000
- **Health Check**: ✅ Working
- **Optimization Endpoint**: ✅ Working
- **Ollama Connection**: ✅ Connected
- **Models Available**: 1 model detected

### Test Results

**Health Check Response:**
```json
{
  "status": "ok",
  "service": "prompt-optimizer",
  "ollama_connected": true,
  "models_available": 1
}
```

**Optimization Test:**
- **Input**: "write a blog post"
- **Output**: Successfully optimized
- **Latency**: ~75 seconds (first run, subsequent runs will be faster due to caching)
- **Status**: ✅ Working

---

## How to Test the Full Application

### Prerequisites

1. **Python Service Running** ✅ (Already running)
2. **Electron App Running** (Start it now)

### Step 1: Start Electron App

Open a **new terminal** and run:

```bash
npm run electron
```

Or if you prefer to build first:

```bash
npm run dev
```

**Expected Output:**
```
Initializing Prompt Optimizer...
Python service connected
Keyboard monitoring started
Prompt Optimizer initialized successfully
```

### Step 2: Test the Application

#### Test 1: Basic Trigger Detection

1. **Open any text editor:**
   - Notepad
   - VS Code
   - Chrome (any text field)
   - Word
   - Any application with text input

2. **Type the trigger:**
   ```
   @prompt write a blog post about artificial intelligence
   ```

3. **What should happen:**
   - After typing `@prompt ` (with space), the app detects the trigger
   - A blue highlight appears under your text
   - Shows "Optimizing..." message
   - Wait 1-5 seconds (or longer on first run)

4. **Expected result:**
   - Highlight changes to green when ready
   - Shows "Hover to see optimization" message

#### Test 2: View Optimization

1. **Hover your mouse** over the highlighted text

2. **Expected result:**
   - A popup window appears
   - Shows:
     - **Original**: Your original prompt
     - **Optimized**: The AI-optimized version
     - **Replace** button
     - **Dismiss** button

#### Test 3: Replace Text

1. **Click the "Replace" button** in the popup

2. **Expected result:**
   - Text is copied to clipboard
   - Popup closes
   - Highlight disappears

3. **Paste the text:**
   - Press `Ctrl+V` (Windows) or `Cmd+V` (macOS)
   - The optimized text should paste

**Note**: Currently requires manual paste. Automatic replacement will be added in future versions.

#### Test 4: Different Applications

Test in various applications:
- ✅ Notepad
- ✅ VS Code
- ✅ Chrome/Edge (text fields)
- ✅ Microsoft Word
- ✅ Discord/Slack (chat input)
- ✅ Any text editor

#### Test 5: Different Prompts

Try various prompt types:

**Simple:**
```
@prompt explain quantum computing
```

**Technical:**
```
@prompt write a function to sort an array in Python
```

**Creative:**
```
@prompt create a story about a robot learning to paint
```

**Business:**
```
@prompt write an email to schedule a meeting
```

---

## Troubleshooting Tests

### Issue: No highlight appears

**Possible causes:**
1. Keyboard hook not working
   - **Windows**: Try running Electron as administrator
   - **macOS**: Grant Accessibility permissions (System Preferences → Security & Privacy → Privacy → Accessibility)

2. Trigger not detected
   - Make sure you type `@prompt ` (with space after "prompt")
   - Check Electron console for errors

3. Python service not connected
   - Check Electron console for "Python service not available" warning
   - Verify Python service is running: `curl http://localhost:8000/health`

### Issue: Optimization takes too long

**Normal behavior:**
- First optimization: 30-90 seconds (model loading)
- Subsequent optimizations: 1-5 seconds (cached)

**If consistently slow:**
- Check system resources (CPU/RAM)
- Try a smaller model: `ollama pull llama3.2:1b` (1 billion parameters)
- Check Ollama is running: `ollama list`

### Issue: "Model not found" error

**Solution:**
```bash
# Make sure Ollama is running
ollama serve

# Pull the model
ollama pull llama3.2

# Verify
ollama list
```

### Issue: Popup doesn't appear

**Check:**
1. Electron console for errors
2. Window bounds calculation
3. Try in different application
4. Check if overlay window is created (check console logs)

### Issue: Text replacement doesn't work

**Current limitation:**
- Text replacement copies to clipboard
- Requires manual paste (Ctrl+V / Cmd+V)
- This is expected behavior in MVP

**Future:**
- Automatic replacement will be added with native keyboard simulation

---

## Automated Testing Script

Run the automated test script:

```bash
powershell -ExecutionPolicy Bypass -File test-services.ps1
```

This will test:
1. ✅ Python service health
2. ✅ Optimization endpoint
3. ✅ Electron app status

---

## Manual API Testing

### Test Health Endpoint

**PowerShell:**
```powershell
Invoke-WebRequest -Uri http://localhost:8000/health -UseBasicParsing
```

**curl (if available):**
```bash
curl http://localhost:8000/health
```

**Expected:**
```json
{
  "status": "ok",
  "service": "prompt-optimizer",
  "ollama_connected": true,
  "models_available": 1
}
```

### Test Optimization Endpoint

**PowerShell:**
```powershell
$body = @{prompt='write a blog post'} | ConvertTo-Json
Invoke-WebRequest -Uri http://localhost:8000/optimize -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing
```

**Expected:**
```json
{
  "optimized": "Write a comprehensive blog post...",
  "original": "write a blog post",
  "model": "llama3.2",
  "latency_ms": 1234.56
}
```

---

## Performance Benchmarks

### Expected Latencies

- **First optimization**: 30-90 seconds (model loading)
- **Cached optimization**: 1-5 seconds
- **New prompt**: 5-15 seconds (depending on model size)

### System Requirements

- **Minimum RAM**: 8GB (16GB recommended)
- **CPU**: Modern multi-core processor
- **Storage**: 5GB+ for models

---

## Success Criteria

✅ **All tests passing if:**
1. Python service responds to health check
2. Optimization endpoint returns optimized text
3. Electron app starts without errors
4. Trigger detection works (`@prompt `)
5. Highlight appears after trigger
6. Popup shows optimized text on hover
7. Text can be copied to clipboard

---

## Next Steps After Testing

1. **If all tests pass**: You're ready to use the application!
2. **If issues found**: Check troubleshooting section above
3. **For improvements**: See `ARCHITECTURE.md` for future enhancements

---

## Quick Test Checklist

- [ ] Python service running (`npm run python:dev`)
- [ ] Electron app running (`npm run electron`)
- [ ] Health check passes
- [ ] Optimization endpoint works
- [ ] Trigger detection works (`@prompt `)
- [ ] Highlight appears
- [ ] Popup shows on hover
- [ ] Text can be copied

**Status**: ✅ Python Service Verified and Working!

**Next**: Start Electron app and test the full workflow!
