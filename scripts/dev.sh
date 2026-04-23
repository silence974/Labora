#!/usr/bin/env bash
# 开发模式一键启动（需要三个终端，或使用 tmux）
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting Labora in development mode..."
echo ""
echo "  Backend  : http://127.0.0.1:8765"
echo "  Frontend : http://localhost:5173"
echo ""

# 检查是否安装了 concurrently
if command -v npx &>/dev/null; then
  npx concurrently \
    --names "backend,frontend" \
    --prefix-colors "cyan,magenta" \
    "cd $REPO_ROOT/backend && uv run python main.py --reload" \
    "cd $REPO_ROOT/frontend && npm run dev"
else
  echo "Run these commands in separate terminals:"
  echo "  cd backend && uv run python main.py --reload"
  echo "  cd frontend && npm run dev"
  echo "  cd desktop && npm run dev   (optional)"
fi
