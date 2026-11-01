#!/usr/bin/env bash
# Fills ./accessors with a build-time copy of registry files, so that the
# extension can load them from chrome-extension:// URLs instead of over the
# network. Those URLs are exempt from the visited page's Content-Security-
# Policy, which plain https:// registry URLs are not - see README, "Local
# copies and page CSP".
#
#   scripts/sync-accessors.sh               glue only (default): the solvers
#                                           and the universal-tag scripts
#   scripts/sync-accessors.sh --all         every module the format table can
#                                           ask for, for a fully offline build
#   scripts/sync-accessors.sh --none        empty the directory (registry-only)
#   scripts/sync-accessors.sh -r <url>      another registry
#
# accessors/bundled.json records what was copied and at which version; the
# extension compares it with the live catalogue and prefers the registry when
# the two disagree, so a stale bundle degrades to a slower load, never to a
# version mismatch.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="https://registry.bevara.ddns.net"
MODE="glue"

while [ $# -gt 0 ]; do
  case "$1" in
    --all) MODE="all" ;;
    --glue) MODE="glue" ;;
    --none) MODE="none" ;;
    -r|--registry) shift; REGISTRY="${1%/}" ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

DST="$HERE/accessors"
rm -rf "$DST"; mkdir -p "$DST"

if [ "$MODE" = "none" ]; then
  echo '{"mode":"none","modules":{},"tags":{}}' > "$DST/bundled.json"
  echo "accessors/ emptied - everything will come from the registry"
  exit 0
fi

echo "reading $REGISTRY/accessors/index.json"
curl -fsS "$REGISTRY/accessors/index.json" -o "$DST/.index.json"

node - "$HERE" "$DST" "$REGISTRY" "$MODE" <<'NODE'
const fs = require("fs"), path = require("path");
const [here, dst, registry, mode] = process.argv.slice(2);
require(path.join(here, "src/common/formats.js"));
const index = JSON.parse(fs.readFileSync(path.join(dst, ".index.json"), "utf8"));

const byModule = new Map();
for (const f of index.filters || []) byModule.set(f.file.replace(/\.wasm$/, ""), f);
for (const r of index.runtimes || []) byModule.set(r.module, r);

/* The glue is what the page loads as *script*: the solvers' JavaScript and
 * the universal tags. Their wasm travels with them, because a solver whose
 * JavaScript is local but whose wasm is remote gains nothing on a page that
 * blocks the fetch. */
const glue = (index.runtimes || []).map(r => r.module);
const wanted = mode === "all"
  ? Array.from(new Set(globalThis.BevaraFormats.allModules().filter(m => byModule.has(m)).concat(glue)))
  : glue;

const files = [];
for (const m of wanted) {
  const e = byModule.get(m);
  if (!e) { console.error("  not on the registry: " + m); continue; }
  files.push({ module: m, version: e.version, file: e.file });
  if (e.js) files.push({ module: m, version: e.version, file: e.js, js: true });
}
for (const t of index.tags || []) files.push({ tag: t.file, version: t.version, file: t.file });

fs.writeFileSync(path.join(dst, ".files.json"), JSON.stringify(files));
NODE

modules="{}"; tags="{}"
total=0
while IFS=$'\t' read -r file; do
  [ -n "$file" ] || continue
  curl -fsS "$REGISTRY/accessors/$file" -o "$DST/$file"
  total=$((total + 1))
done < <(node -e '
  const f = require(process.argv[1]);
  console.log(f.map(x => x.file).join("\n"));
' "$DST/.files.json")

node -e '
  const fs = require("fs"), path = require("path");
  const dst = process.argv[1], registry = process.argv[2], mode = process.argv[3];
  const files = require(path.join(dst, ".files.json"));
  const out = { mode, registry, generatedAt: new Date().toISOString(), modules: {}, tags: {} };
  for (const f of files) {
    if (f.tag) out.tags[f.tag] = f.version;
    else out.modules[f.module] = f.version;
  }
  fs.writeFileSync(path.join(dst, "bundled.json"), JSON.stringify(out, null, 2) + "\n");
' "$DST" "$REGISTRY" "$MODE"

rm -f "$DST/.index.json" "$DST/.files.json"
echo "copied $total file(s) into $DST ($(du -sh "$DST" | cut -f1)), mode=$MODE"
