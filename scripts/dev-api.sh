#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="${DREAMGRID_PYTHON:-$repo_root/.venv/bin/python}"

if [[ ! -x "$python_bin" ]]; then
  echo "Python environment not found. Run: pnpm bootstrap"
  exit 1
fi

cd "$repo_root/services/api"
exec "$python_bin" -m uvicorn dreamgrid_api.main:app \
  --app-dir src \
  --host 127.0.0.1 \
  --port 8000 \
  --reload --reload-dir src
