#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$NoInstall
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Arecanut Grading System - startup" -ForegroundColor Cyan
Write-Host "Root: $root"

function Test-Cmd($name) {
  try { $null = Get-Command $name -ErrorAction Stop; return $true } catch { return $false }
}

if (-not (Test-Cmd node)) { Write-Error "node not found"; exit 1 }
if (-not (Test-Cmd npm)) { Write-Error "npm not found"; exit 1 }
if (-not (Test-Cmd python)) { Write-Warning "python not found; local ML inference may fail" }

# Check model
$model = Join-Path $root "ml_service/weights/best.pt"
$meta = Join-Path $root "ml_service/model_metadata.json"
if (-not (Test-Path $model)) {
  Write-Warning "Missing model: $model"
} else {
  if (Test-Path $meta) {
    Write-Host "Model and metadata present" -ForegroundColor Green
  }
}

# Server env
$serverEnv = Join-Path $root "server/.env"
$serverEnvEx = Join-Path $root "server/.env.example"
if (-not (Test-Path $serverEnv) -and (Test-Path $serverEnvEx)) {
  Write-Host "Copying server/.env.example to server/.env" -ForegroundColor Yellow
  Copy-Item $serverEnvEx $serverEnv
}

if ($CheckOnly) {
  Write-Host "CheckOnly - exiting" -ForegroundColor Green
  exit 0
}

if (-not $NoInstall) {
  Write-Host "Installing server deps..." -ForegroundColor Cyan
  Push-Location (Join-Path $root "server")
  npm install --no-audit --no-fund
  Pop-Location

  Write-Host "Installing client deps..." -ForegroundColor Cyan
  Push-Location (Join-Path $root "client")
  npm install --no-audit --no-fund
  Pop-Location
}

Write-Host "Starting services (server:5000, client:5173). Press Ctrl+C to stop." -ForegroundColor Cyan
$serverJob = Start-Job -ScriptBlock { Set-Location $using:root\server; npm run dev }
$clientJob = Start-Job -ScriptBlock { Set-Location $using:root\client; npm run dev }

try {
  while ($true) {
    Start-Sleep -Seconds 2
    if ($serverJob.State -ne 'Running' -and $clientJob.State -ne 'Running') { break }
  }
} finally {
  Stop-Job $serverJob, $clientJob -ErrorAction SilentlyContinue
  Remove-Job $serverJob, $clientJob -ErrorAction SilentlyContinue
}
