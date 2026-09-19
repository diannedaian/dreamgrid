#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dreamgrid_asset="${1:-}"
case "$dreamgrid_asset" in
  college-bed|campus-chair|dorm-desk) shift ;;
  *) echo 'Usage: bash scripts/build-furniture.sh college-bed|campus-chair|dorm-desk [--no-render]' >&2; exit 1 ;;
esac
dreamgrid_blender="${DREAMGRID_BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
if [[ ! -x "$dreamgrid_blender" ]]; then
  echo 'Set DREAMGRID_BLENDER to your Blender executable.' >&2
  exit 1
fi
node tools/blender/validate-spec.mjs "assets/specs/$dreamgrid_asset.json"
dreamgrid_model_options=()
if [[ "$dreamgrid_asset" == campus-chair ]]; then
  dreamgrid_model_options=(--fuse-material wood)
fi
"$dreamgrid_blender" --background --factory-startup --disable-autoexec \
  --python-exit-code 1 --python tools/blender/build_asset.py -- \
  --spec "assets/specs/$dreamgrid_asset.json" \
  --output "artifacts/$dreamgrid_asset" \
  --glb "apps/web/public/demo-assets/$dreamgrid_asset.glb" ${dreamgrid_model_options[@]+"${dreamgrid_model_options[@]}"} "$@"
