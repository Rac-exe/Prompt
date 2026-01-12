# Fix: Python Virtual Environment Issue

## Problem

When running `npm run python:dev`, you may see:
```
ModuleNotFoundError: No module named 'ollama'
```

This happens because the script was using the system Python instead of the virtual environment Python.

## Solution

The `package.json` has been updated to use the virtual environment Python directly.

### Updated Scripts

**Windows:**
```json
"python:dev": "cd python-service && .\\venv\\Scripts\\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
```

**macOS/Linux:**
```json
"python:dev:mac": "cd python-service && ./venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
```

## How to Run

### Option 1: Use npm script (Recommended)

**Windows:**
```bash
npm run python:dev
```

**macOS/Linux:**
```bash
npm run python:dev:mac
```

### Option 2: Manual activation

**Windows:**
```bash
cd python-service
.\venv\Scripts\activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**macOS/Linux:**
```bash
cd python-service
source venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Verification

To verify packages are installed in venv:

**Windows:**
```bash
cd python-service
.\venv\Scripts\python.exe -m pip list | findstr "ollama fastapi uvicorn"
```

**macOS/Linux:**
```bash
cd python-service
./venv/bin/python -m pip list | grep -E "ollama|fastapi|uvicorn"
```

Should show:
```
fastapi    0.128.0
ollama     0.6.1
uvicorn    0.40.0
```

## Status

✅ Fixed - The npm script now uses the virtual environment Python directly.
