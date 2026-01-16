# Test Windows UI Automation
# This script tests if UI Automation can access the focused text element

Write-Host "=== Testing Windows UI Automation ===" -ForegroundColor Cyan
Write-Host ""

try {
    # Load UI Automation assemblies
    Write-Host "Loading UI Automation assemblies..." -ForegroundColor Yellow
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Write-Host "✅ Assemblies loaded successfully" -ForegroundColor Green
    Write-Host ""

    # Get the focused element
    Write-Host "Getting focused element..." -ForegroundColor Yellow
    $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement

    if ($null -eq $focusedElement) {
        Write-Host "❌ No focused element found" -ForegroundColor Red
        Write-Host "Please click in a text field (like Notepad) and run this script again" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "✅ Focused element found!" -ForegroundColor Green
    Write-Host ""

    # Display element info
    Write-Host "Element Information:" -ForegroundColor Cyan
    Write-Host "  Name: $($focusedElement.Current.Name)"
    Write-Host "  Control Type: $($focusedElement.Current.ControlType.ProgrammaticName)"
    Write-Host "  Class Name: $($focusedElement.Current.ClassName)"
    Write-Host "  Automation ID: $($focusedElement.Current.AutomationId)"
    Write-Host ""

    # Try to get ValuePattern
    Write-Host "Checking for ValuePattern support..." -ForegroundColor Yellow
    try {
        $valuePattern = $focusedElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)

        if ($null -ne $valuePattern) {
            Write-Host "✅ ValuePattern supported!" -ForegroundColor Green
            Write-Host ""

            # Get current value
            $currentValue = $valuePattern.Current.Value
            Write-Host "Current Text Value:" -ForegroundColor Cyan
            if ($currentValue) {
                Write-Host "  Length: $($currentValue.Length) characters"
                Write-Host "  Preview: $($currentValue.Substring(0, [Math]::Min(100, $currentValue.Length)))"
                Write-Host ""

                # Check if read-only
                $isReadOnly = $valuePattern.Current.IsReadOnly
                Write-Host "  Read-only: $isReadOnly"
                Write-Host ""

                if (-not $isReadOnly) {
                    Write-Host "✅ TEXT CAN BE REPLACED VIA UI AUTOMATION!" -ForegroundColor Green
                    Write-Host "This control supports direct text replacement (like MS Word)" -ForegroundColor Green
                } else {
                    Write-Host "⚠️ Text is read-only, cannot be modified" -ForegroundColor Yellow
                }
            } else {
                Write-Host "  (empty)"
            }
        }
    } catch {
        Write-Host "❌ ValuePattern not supported" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "This control does not support direct text replacement." -ForegroundColor Yellow
        Write-Host "Will need to use keyboard fallback for this application." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "=== Test Complete ===" -ForegroundColor Cyan

} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}
