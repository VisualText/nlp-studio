# Package the dehilster.nlp extension from a sibling vscode-nlp checkout into
# stopgap\vsix\vscode.nlp.vsix, where the Dockerfile expects it.
#
# The extension is not published to Open VSX (the marketplace openvscode-server
# talks to), so building the vsix locally is the only way to get it into the image.

param(
    [string]$VscodeNlpDir = ''
)

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$stopgap = Split-Path -Parent $here
if (-not $VscodeNlpDir) {
    $VscodeNlpDir = Join-Path (Split-Path -Parent (Split-Path -Parent $stopgap)) 'vscode-nlp'
}

if (-not (Test-Path $VscodeNlpDir)) {
    throw "build-vsix: vscode-nlp checkout not found at $VscodeNlpDir (pass -VscodeNlpDir to override)"
}

Write-Host "build-vsix: source = $VscodeNlpDir"
Push-Location $VscodeNlpDir
try {
    if (-not (Test-Path (Join-Path $VscodeNlpDir 'node_modules'))) { npm ci }
    npm run vsce-package        # webpack --mode production && vsce package -o ./vscode.nlp.vsix
    if ($LASTEXITCODE -ne 0) { throw "build-vsix: npm run vsce-package failed ($LASTEXITCODE)" }
}
finally {
    Pop-Location
}

$vsixDir = Join-Path $stopgap 'vsix'
New-Item -ItemType Directory -Force -Path $vsixDir | Out-Null
Copy-Item (Join-Path $VscodeNlpDir 'vscode.nlp.vsix') (Join-Path $vsixDir 'vscode.nlp.vsix') -Force
Write-Host "build-vsix: wrote $(Join-Path $vsixDir 'vscode.nlp.vsix')"
