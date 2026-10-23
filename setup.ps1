#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Arecanut Grading System - portable setup" -ForegroundColor Cyan
Write-Host "Project root: $root"

function Test-Cmd($name) {
  try { $null = Get-Command $name -ErrorAction Stop; return $true } catch { return $false }
}

if (-not (Test-Cmd node)) { Write-Error "Node.js 20+ is required but 'node' was not found."; exit 1 }
if (-not (Test-Cmd npm)) { Write-Error "npm was not found. Install Node.js 20+ and retry."; exit 1 }

if (-not (Test-Cmd python)) {
  Write-Error "Python 3.10-3.12 is required but 'python' was not found."
  exit 1
}

$serverEnv = Join-Path $root "server/.env"
$serverEnvExample = Join-Path $root "server/.env.example"
if (-not (Test-Path $serverEnv)) {
  if (-not (Test-Path $serverEnvExample)) {
    Write-Error "Missing server/.env.example; cannot create server/.env."
    exit 1
  }
  Copy-Item $serverEnvExample $serverEnv
  Write-Host "Created server/.env from server/.env.example." -ForegroundColor Yellow
  Write-Host "Edit server/.env to set JWT_SECRET and, if needed, MONGO_URI." -ForegroundColor Yellow
}

Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $root "server")
try { npm install --no-audit --no-fund } finally { Pop-Location }

Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
Push-Location (Join-Path $root "client")
try { npm install --no-audit --no-fund } finally { Pop-Location }

Write-Host "Installing Python inference dependencies..." -ForegroundColor Cyan
python -m pip install -r (Join-Path $root "ml_service/requirements.txt")

Write-Host "Verifying the committed model artifact..." -ForegroundColor Cyan
python (Join-Path $root "scripts/verify_model.py")
if ($LASTEXITCODE -ne 0) {
  Write-Error "Model verification failed. Restore ml_service/weights/best.pt before running the app."
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Setup complete. Start the app with:" -ForegroundColor Green
Write-Host "  .\start.ps1" -ForegroundColor Green
Write-Host "Then open http://localhost:5173" -ForegroundColor Green
