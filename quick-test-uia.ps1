# Quick test to see what's wrong with UI Automation
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement

    if ($null -eq $focused) {
        Write-Host "ERROR: No focused element"
        exit 1
    }

    Write-Host "Focused: $($focused.Current.Name)"
    Write-Host "Type: $($focused.Current.ControlType.ProgrammaticName)"

    $valuePattern = $focused.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value = $valuePattern.Current.Value

    Write-Host "Current text: $value"
    Write-Host "SUCCESS"

} catch {
    Write-Host "ERROR: $_"
    Write-Host $_.Exception.Message
    Write-Host $_.ScriptStackTrace
    exit 1
}
