# Test Script for Prompt Optimizer Services
Write-Host "=== Testing Prompt Optimizer Services ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Python Service Health Check
Write-Host "1. Testing Python Service Health..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✅ Python Service is RUNNING" -ForegroundColor Green
        Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ❌ Python Service is NOT running" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Please start it with: npm run python:dev" -ForegroundColor Yellow
}
Write-Host ""

# Test 2: Python Service Optimization Endpoint
Write-Host "2. Testing Optimization Endpoint..." -ForegroundColor Yellow
try {
    $body = @{
        prompt = "write a blog post about AI"
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "http://localhost:8000/optimize" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -UseBasicParsing `
        -TimeoutSec 30
    
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✅ Optimization endpoint is WORKING" -ForegroundColor Green
        $result = $response.Content | ConvertFrom-Json
        Write-Host "   Original: $($result.original)" -ForegroundColor Gray
        Write-Host "   Optimized: $($result.optimized.Substring(0, [Math]::Min(100, $result.optimized.Length)))..." -ForegroundColor Gray
        Write-Host "   Latency: $($result.latency_ms)ms" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ❌ Optimization endpoint FAILED" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Message -like "*ollama*" -or $_.Exception.Message -like "*model*") {
        Write-Host "   Hint: Make sure Ollama is running and model is installed:" -ForegroundColor Yellow
        Write-Host "         ollama serve" -ForegroundColor Yellow
        Write-Host "         ollama pull llama3.2" -ForegroundColor Yellow
    }
}
Write-Host ""

# Test 3: Check if Electron process is running
Write-Host "3. Checking Electron App..." -ForegroundColor Yellow
$electronProcess = Get-Process -Name "electron" -ErrorAction SilentlyContinue
if ($electronProcess) {
    Write-Host "   ✅ Electron App is RUNNING (PID: $($electronProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Electron App is NOT running" -ForegroundColor Yellow
    Write-Host "   Start it with: npm run electron" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "=== Test Summary ===" -ForegroundColor Cyan
Write-Host "Python Service: http://localhost:8000" -ForegroundColor Gray
Write-Host "Electron App: Check if window opened" -ForegroundColor Gray
Write-Host ""
Write-Host "To test the full application:" -ForegroundColor Cyan
Write-Host "1. Make sure both services are running" -ForegroundColor White
Write-Host "2. Open any text editor (Notepad, VS Code, etc.)" -ForegroundColor White
Write-Host "3. Type: @prompt write a blog post about AI" -ForegroundColor White
Write-Host "4. Wait for optimization (1-5 seconds)" -ForegroundColor White
Write-Host "5. Hover over the highlighted text to see optimized version" -ForegroundColor White
Write-Host ""
