#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dreamgrid_blender="${DREAMGRID_BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [[ ! -x "$dreamgrid_blender" ]]; then
  echo 'Set DREAMGRID_BLENDER to your Blender executable.' >&2
  exit 1
fi
node tools/blender/validate-spec.mjs assets/specs/college-bed.json
"$dreamgrid_blender" --background --factory-startup --disable-autoexec \
  --python-exit-code 1 --python tools/blender/build_asset.py -- \
  --spec assets/specs/college-bed.json \
  --output artifacts/college-bed \
  --glb apps/web/public/demo-assets/college-bed.glb "$@"
