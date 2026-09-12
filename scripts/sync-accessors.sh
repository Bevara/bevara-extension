#!/usr/bin/env bash
# Copies into ./accessors the solver main modules, the side modules used by the
# format registry, and the universal tags bundle, from a directory holding the
# Showcase accessors (default: ../Showcase/accessors).
#
#   scripts/sync-accessors.sh [source-dir] [--all]
#
# --all copies every .wasm in the source instead of only the ones the registry
# can ask for.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$HERE/../Showcase/accessors}"
ALL=0
for a in "$@"; do [ "$a" = "--all" ] && ALL=1; done
[ -d "$SRC" ] || { echo "source directory not found: $SRC" >&2; exit 1; }

DST="$HERE/accessors"
mkdir -p "$DST"

wanted=$(node -e '
  require(process.argv[1]);
  const F = globalThis.BevaraFormats;
  const mods = F.allModules();
  const files = [];
  for (const m of mods) { files.push(m + ".wasm"); if (m.startsWith("solver")) files.push(m + ".js"); }
  files.push("universal-tags_1.js");
  console.log(files.join("\n"));
' "$HERE/src/common/formats.js")

missing=0; copied=0
if [ "$ALL" = "1" ]; then
  cp "$SRC"/*.wasm "$SRC"/solver*.js "$SRC"/universal-tags_1.js "$DST"/
  copied=$(ls "$DST" | wc -l | tr -d ' ')
else
  while IFS= read -r f; do
    if [ -f "$SRC/$f" ]; then cp "$SRC/$f" "$DST/$f"; copied=$((copied+1))
    else echo "missing: $f" >&2; missing=$((missing+1)); fi
  done <<< "$wanted"
fi

echo "copied $copied file(s) to $DST ($(du -sh "$DST" | cut -f1))"
[ "$missing" = "0" ] || echo "$missing accessor(s) missing - the matching formats will fail at runtime" >&2
