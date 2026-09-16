$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = $nodeCommand.Source
if (-not $nodePath) {
  $nodePath = "C:\Users\jimoc\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
  if (-not (Test-Path -LiteralPath $nodePath)) { throw "Node.js was not found." }
}

Push-Location $projectRoot
try {
  & $nodePath src/collect.js --base=fixtures/richmond-live-2026-09-16.json --output=fixtures/live-current.json
  if ($LASTEXITCODE -ne 0) { throw "Golf tee-time refresh exited with code $LASTEXITCODE." }
  Write-Output "Golf tee-time feed refresh completed at $(Get-Date -Format o)."
} finally {
  Pop-Location
}