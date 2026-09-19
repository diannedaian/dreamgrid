#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_bin="${DREAMGRID_PYTHON:-$repo_root/.venv/bin/python}"

if [[ ! -x "$python_bin" ]]; then
  echo "Python environment not found. Run: pnpm bootstrap"
  exit 1
fi

cd "$repo_root"
exec "$python_bin" -m pytest services/api/tests
