#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"

echo "Arecanut Grading System - portable setup"
echo "Project root: $root"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required but 'node' was not found." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js 20+ and retry." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3.10-3.12 is required but 'python3' was not found." >&2
  exit 1
fi

if [ ! -f server/.env ]; then
  if [ ! -f server/.env.example ]; then
    echo "Missing server/.env.example; cannot create server/.env." >&2
    exit 1
  fi
  cp server/.env.example server/.env
  echo "Created server/.env from server/.env.example."
  echo "Edit server/.env to set JWT_SECRET and, if needed, MONGO_URI."
fi

echo "Installing backend dependencies..."
(cd server && npm install --no-audit --no-fund)

echo "Installing frontend dependencies..."
(cd client && npm install --no-audit --no-fund)

echo "Installing Python inference dependencies..."
python3 -m pip install -r ml_service/requirements.txt

echo "Verifying the committed model artifact..."
python3 scripts/verify_model.py

echo ""
echo "Setup complete. Start the API and frontend in separate terminals:"
echo "  cd server && npm run dev"
echo "  cd client && npm run dev"
echo "Then open http://localhost:5173"
