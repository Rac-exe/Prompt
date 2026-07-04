#!/bin/bash
echo "========================================="
echo "Setup Verification Script"
echo "========================================="
echo ""

# Check Node.js
if command -v node &> /dev/null; then
    echo "✅ Node.js: $(node --version)"
else
    echo "❌ Node.js: NOT INSTALLED"
fi

# Check npm
if command -v npm &> /dev/null; then
    echo "✅ npm: $(npm --version)"
else
    echo "❌ npm: NOT INSTALLED"
fi

# Check Python
if command -v python &> /dev/null; then
    echo "✅ Python: $(python --version)"
else
    echo "❌ Python: NOT INSTALLED"
fi

# Check Ollama
if command -v ollama &> /dev/null; then
    echo "✅ Ollama: $(ollama --version 2>&1 | head -1)"
else
    echo "❌ Ollama: NOT INSTALLED"
fi

echo ""
echo "========================================="
echo "Project Files"
echo "========================================="

# Check key files
if [ -f ".env" ]; then
    echo "✅ .env exists"
    if grep -q "SUPABASE_URL" .env; then
        echo "   ✅ SUPABASE_URL set"
    else
        echo "   ❌ SUPABASE_URL missing"
    fi
    if grep -q "SUPABASE_ANON_KEY" .env; then
        echo "   ✅ SUPABASE_ANON_KEY set"
    else
        echo "   ❌ SUPABASE_ANON_KEY missing"
    fi
else
    echo "❌ .env NOT FOUND"
fi

if [ -f "package.json" ]; then
    echo "✅ package.json exists"
    if grep -q "\"version\": \"2.0.0\"" package.json; then
        echo "   ✅ Version 2.0.0"
    else
        echo "   ❌ Not version 2.0.0"
    fi
else
    echo "❌ package.json NOT FOUND"
fi

if [ -f "electron/preload.ts" ]; then
    echo "✅ preload.ts exists"
else
    echo "❌ preload.ts NOT FOUND"
fi

if [ -f "dist/main/index-new.js" ]; then
    echo "✅ dist/main/index-new.js compiled"
else
    echo "❌ dist/main/index-new.js NOT COMPILED"
    echo "   Run: npm run build"
fi

if [ -d "dist/main/database" ]; then
    echo "✅ Database services compiled"
else
    echo "❌ Database services NOT COMPILED"
fi

if [ -d "dist/main/windows" ]; then
    echo "✅ Window managers compiled"
else
    echo "❌ Window managers NOT COMPILED"
fi

echo ""
echo "========================================="
echo "Next Steps"
echo "========================================="
echo "1. Run migration SQL in Supabase dashboard"
echo "2. Start Python service: npm run python:dev"
echo "3. Start Electron app: npm run electron"
echo ""
