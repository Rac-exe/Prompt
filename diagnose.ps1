Write-Host "=== Prompt Optimizer Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

# Check Ollama
Write-Host "1. Checking Ollama..." -ForegroundColor Yellow
try {
    $ollamaList = ollama list 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✓ Ollama is running" -ForegroundColor Green
        $ollamaList | Select-Object -First 3 | ForEach-Object { Write-Host "   $_" }
    } else {
        Write-Host "   ✗ Ollama is not running" -ForegroundColor Red
        Write-Host "   Run: Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ✗ Ollama not found" -ForegroundColor Red
}
Write-Host ""

# Check Python Service
Write-Host "2. Checking Python Service..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri http://localhost:8000/health -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    $health = $response.Content | ConvertFrom-Json
    if ($health.status -eq "ok") {
        Write-Host "   ✓ Python service is running" -ForegroundColor Green
        Write-Host "   ✓ Ollama connected: $($health.ollama_connected)" -ForegroundColor Green
        Write-Host "   ✓ Models available: $($health.models_available)" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ Python service is degraded" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ✗ Python service is NOT running" -ForegroundColor Red
    Write-Host "   Run: npm run python:dev" -ForegroundColor Yellow
}
Write-Host ""

# Check Build
Write-Host "3. Checking Build..." -ForegroundColor Yellow
if (Test-Path "dist\main\index.js") {
    Write-Host "   ✓ Build files exist" -ForegroundColor Green
} else {
    Write-Host "   ✗ Build files missing" -ForegroundColor Red
    Write-Host "   Run: npm run build" -ForegroundColor Yellow
}
Write-Host ""

# Check Port 8000
Write-Host "4. Checking Port 8000..." -ForegroundColor Yellow
$port8000 = netstat -an | findstr "8000"
if ($port8000) {
    Write-Host "   ✓ Port 8000 is in use (Python service)" -ForegroundColor Green
} else {
    Write-Host "   ✗ Port 8000 is not in use" -ForegroundColor Red
}
Write-Host ""

# Check Node Modules
Write-Host "5. Checking Dependencies..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    $electronInstalled = Test-Path "node_modules\electron"
    $keyListenerInstalled = Test-Path "node_modules\node-global-key-listener"
    
    if ($electronInstalled) {
        Write-Host "   ✓ Electron installed" -ForegroundColor Green
    } else {
        Write-Host "   ✗ Electron not installed" -ForegroundColor Red
    }
    
    if ($keyListenerInstalled) {
        Write-Host "   ✓ node-global-key-listener installed" -ForegroundColor Green
    } else {
        Write-Host "   ✗ node-global-key-listener not installed" -ForegroundColor Red
    }
} else {
    Write-Host "   ✗ node_modules not found" -ForegroundColor Red
    Write-Host "   Run: npm install" -ForegroundColor Yellow
}
Write-Host ""

# Check Python Virtual Environment
Write-Host "6. Checking Python Environment..." -ForegroundColor Yellow
if (Test-Path "python-service\venv") {
    Write-Host "   ✓ Python virtual environment exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ Python virtual environment not found" -ForegroundColor Red
    Write-Host "   Run: npm run python:install" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "=== Diagnostic Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start the application:" -ForegroundColor Yellow
Write-Host "  Terminal 1: npm run python:dev" -ForegroundColor White
Write-Host "  Terminal 2: npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "If keyboard hook does not work, try running as Administrator" -ForegroundColor Yellow
