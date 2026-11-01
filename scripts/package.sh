#!/usr/bin/env bash
# Builds the zip to upload on the Chrome Web Store developer dashboard.
#
#   scripts/package.sh            -> dist/bevara-universal-media-<version>.zip
#
# Only what the extension needs at runtime goes in: manifest, icons, src/ and
# whatever scripts/sync-accessors.sh left in accessors/ (nothing, the glue, or
# everything - see README, "Local copies and page CSP"). The test bench,
# scripts, git files and macOS metadata stay out. The zip has the manifest at
# its root, as the store requires.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

version=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
out="dist/bevara-universal-media-$version.zip"
rm -f "$out"

mode=$(python3 -c "import json;print(json.load(open('accessors/bundled.json'))['mode'])" 2>/dev/null || echo none)
echo "accessors bundled: $mode"

zip -r -q -X "$out" manifest.json icons src LICENSE.md accessors \
  -x '*.DS_Store' -x '*/.DS_Store'

echo "$out ($(du -h "$out" | cut -f1))"
unzip -l "$out" | tail -1
