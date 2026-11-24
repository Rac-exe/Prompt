# Builds the two local Python services into standalone folders with PyInstaller
# so the Windows installer works without Python or a source checkout.
#
# Output: build/services/prmpt-optimizer/prmpt-optimizer.exe
#         build/services/prmpt-code-intel/prmpt-code-intel.exe
# electron-builder ships build/services as resources/services (see package.json).
#
# Prerequisite: the service venvs exist (npm run python:install, npm run code-intel:install).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-services.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'build\services'
$work = Join-Path $root 'build\pyi-work'

function Build-Service($dir, $venv, $name, [string[]]$extra) {
    $py = Join-Path $root "$dir\$venv\Scripts\python.exe"
    if (-not (Test-Path $py)) { throw "Missing $py. Run the service's npm install script first." }
    & $py -m pip install --quiet --disable-pip-version-check 'pyinstaller==6.16.0'
    Push-Location (Join-Path $root $dir)
    try {
        $args = @(
            '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console',
            '--name', $name,
            '--distpath', $dist, '--workpath', (Join-Path $work $name), '--specpath', (Join-Path $work $name),
            '--paths', '.',
            '--collect-submodules', 'uvicorn',
            '--collect-submodules', 'app',
            '--collect-all', 'litellm',
            # pkg_resources' runtime hook fails with current setuptools
            # (missing vendored 'backports'); neither service needs it.
            '--exclude-module', 'pkg_resources'
        ) + $extra + @('run_service.py')
        & $py @args
        if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed for $name" }
    } finally {
        Pop-Location
    }
}

Build-Service 'python-service' 'venv' 'prmpt-optimizer' @(
    '--collect-submodules', 'pipeline_v2',
    '--collect-all', 'tiktoken', '--hidden-import', 'tiktoken_ext.openai_public',
    '--collect-all', 'pymupdf'
)

Build-Service 'code-intelligence-service' '.venv' 'prmpt-code-intel' @(
    '--collect-all', 'onnxruntime',
    '--collect-all', 'tokenizers',
    '--collect-all', 'igraph',
    '--collect-all', 'leidenalg'
)

Get-ChildItem $dist | ForEach-Object {
    $mb = [math]::Round(((Get-ChildItem $_.FullName -Recurse | Measure-Object Length -Sum).Sum / 1MB), 1)
    Write-Host "$($_.Name): $mb MB"
}
