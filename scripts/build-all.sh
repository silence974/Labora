#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building frontend..."
cd "$REPO_ROOT/frontend"
npm install
npm run build

echo "==> Packaging backend..."
cd "$REPO_ROOT/backend"
uv sync
uv run pyinstaller labora.spec --clean --noconfirm

echo "==> Copying backend binary to desktop resources..."
mkdir -p "$REPO_ROOT/desktop/resources/backend"
cp -r "$REPO_ROOT/backend/dist/labora" "$REPO_ROOT/desktop/resources/backend/"

echo "==> Building Electron app..."
cd "$REPO_ROOT/desktop"
npm install
npm run build

echo "==> Done. Installer is in desktop/dist/"
