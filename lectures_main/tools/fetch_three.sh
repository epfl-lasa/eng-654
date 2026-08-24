#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-0.180.0}"
BASE="https://cdn.jsdelivr.net/npm/three@${VERSION}"

mkdir -p "$ROOT/vendor/three/build" "$ROOT/vendor/three/examples/jsm/controls"

curl -L "$BASE/build/three.module.js" \
  -o "$ROOT/vendor/three/build/three.module.js"

curl -L "$BASE/examples/jsm/controls/OrbitControls.js" \
  -o "$ROOT/vendor/three/examples/jsm/controls/OrbitControls.js"

echo "Downloaded Three.js $VERSION into vendor/three"
