#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

python_bin="${DREAMGRID_PYTHON:-python3}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm 11.19.0 is required. Enable Corepack, then activate the version in package.json."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13+ is required. Node 22 LTS is recommended."
  exit 1
fi

if ! command -v "$python_bin" >/dev/null 2>&1; then
  echo "Python 3.11+ is required. Set DREAMGRID_PYTHON to its executable."
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' || {
  echo "DreamGrid requires Node.js 22.13 or newer."
  exit 1
}

"$python_bin" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else "DreamGrid requires Python 3.11+")'

pnpm install --frozen-lockfile

if [[ ! -x .venv/bin/python ]]; then
  "$python_bin" -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -c services/api/constraints-dev.txt -e 'services/api[dev]'

echo "DreamGrid is ready. Run: pnpm dev"
