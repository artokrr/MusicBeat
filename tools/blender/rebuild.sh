#!/bin/sh
# Rebuild, render the exported files, verify via Chrome CDP, and stop own server.
set -eu
cd "$(dirname "$0")/../.."
mkdir -p tools/out
sh tools/blender/prepare_three.sh
blender --background --python tools/blender/build_all.py > tools/out/build.log 2>&1
blender --background --python tools/blender/render_check.py > tools/out/render.log 2>&1
if lsof -nP -iTCP:3120 -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'Port 3120 is occupied; the existing server was left untouched.' >&2
  exit 1
fi
(cd client && exec ../node_modules/.bin/vite --port 3120 --strictPort) > tools/out/vite.log 2>&1 &
model_vite_pid=$!
trap 'kill "$model_vite_pid" 2>/dev/null || true; wait "$model_vite_pid" 2>/dev/null || true' EXIT INT TERM
# Poll server readiness, not an arbitrary long wait.
model_attempt=0
until curl --fail --silent http://localhost:3120/model-test.html >/dev/null; do
  model_attempt=$((model_attempt+1))
  if [ "$model_attempt" -ge 50 ]; then echo 'Model Vite server failed to start' >&2;exit 1;fi
  sleep 0.2
done
node tools/blender/verify_three.mjs --port 9421 > tools/out/three-check.log 2>&1
python3 tools/blender/package_checks.py
