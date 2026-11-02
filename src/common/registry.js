/* Client for a Bevara filter registry (https://registry.bevara.ddns.net).
 *
 * The extension ships no accessor of its own: the solver main modules, the
 * side modules and the universal-tag scripts are all served by the registry,
 * which also says which ones exist, at what version, under which licence and
 * patent status. `/accessors/index.json` is that catalogue; everything under
 * `/accessors/` is sent with `Access-Control-Allow-Origin: *`, so a page - and
 * a worker spawned from it - may load the modules directly.
 *
 * Loaded as a classic script in the background worker and in the content
 * script, so it attaches to globalThis rather than using ES module exports.
 */
(function (root) {
  "use strict";

  const DEFAULT_REGISTRY = "https://registry.bevara.ddns.net";

  function accessorsBase(registry) {
    return String(registry).replace(/\/+$/, "") + "/accessors/";
  }

  /* index.json -> { base, generated, modules, tags, patents } where `modules`
   * maps a module name ("libjxl_1", "mm_solver_1.0.1") to what is known about it.
   * Both filters and runtimes land in the same map: callers ask "is this
   * module available", not "is it a filter or a runtime". */
  function normalise(registry, index) {
    const base = accessorsBase(registry);
    const modules = new Map();

    const add = (entry, kind, module) => {
      modules.set(module, {
        module,
        kind,                                /* "filter" | "runtime" */
        name: entry.name,
        version: entry.version,
        /* The flat URL (latest for this ABI) rather than the versioned one:
         * it is what `script-directory` + a bare module name resolves to in
         * the universal tags, so both routes hit the same cache entry. */
        url: base + entry.file,
        file: entry.file,
        size: entry.size || 0,
        integrity: entry.integrity || null,
        patents: entry.patents || null,
        license: entry.license || null,
        support: entry.support || [],
        formats: entry.formats || [],
        js: entry.js ? base + entry.js : null
      });
    };

    for (const f of index.filters || []) {
      add(f, "filter", String(f.file).replace(/\.wasm$/, ""));
    }
    for (const r of index.runtimes || []) {
      add(r, "runtime", r.module || String(r.file).replace(/\.wasm$/, ""));
    }

    const tags = new Map();
    for (const t of index.tags || []) {
      tags.set(t.file, { file: t.file, url: base + t.file, version: t.version, integrity: t.integrity || null });
    }

    return {
      registry: String(registry).replace(/\/+$/, ""),
      base,
      generated: index.generated || null,
      checkpoint: index.checkpoint || null,
      modules,
      tags
    };
  }

  async function fetchIndex(registry) {
    const url = accessorsBase(registry) + "index.json";
    const res = await fetch(url, { credentials: "omit", cache: "no-cache" });
    if (!res.ok) throw new Error("registry " + registry + " answered " + res.status + " for index.json");
    return normalise(registry, await res.json());
  }

  /* The maps do not survive chrome.storage, so the catalogue is stored as
   * plain arrays and rebuilt on the way out. */
  function toStorage(cat) {
    return {
      registry: cat.registry, base: cat.base, generated: cat.generated, checkpoint: cat.checkpoint,
      modules: Array.from(cat.modules.values()),
      tags: Array.from(cat.tags.values())
    };
  }

  function fromStorage(raw) {
    if (!raw || !raw.modules) return null;
    return {
      registry: raw.registry, base: raw.base, generated: raw.generated, checkpoint: raw.checkpoint,
      modules: new Map(raw.modules.map(m => [m.module, m])),
      tags: new Map(raw.tags.map(t => [t.file, t]))
    };
  }

  /* The solver to load for one the format table names. A solver's name
   * carries its version (mm_solver_1.0.2) and the index lists the latest
   * release only, so a name the table pins (mm_solver_1.0.1) stands for the
   * same solver as the registry publishes it now. */
  const familyOf = name => String(name).replace(/_\d+(?:\.\d+\.\d+)?$/, "");
  function runtimeFor(cat, name) {
    if (cat.modules.has(name)) return name;
    for (const m of cat.modules.values()) {
      if (m.kind === "runtime" && familyOf(m.module) === familyOf(name)) return m.module;
    }
    return name;
  }

  /* Names the registry does not publish - the caller refuses the format and
   * says why, rather than letting the pipeline 404 halfway through. */
  function missingFrom(cat, names) {
    return names.filter(n => !cat.modules.has(n));
  }

  /* Where to load a file from.
   *
   * A chrome-extension:// URL is exempt from the visited page's
   * Content-Security-Policy; the registry's https:// URL is not. So anything
   * the build copied into accessors/ (scripts/sync-accessors.sh) is served
   * from the extension, and the registry is the fallback. The bundled copy is
   * only used when its version matches the catalogue: a stale bundle then
   * costs a download rather than silently pairing mismatched modules.
   *
   * `bundle` is accessors/bundled.json, `localBase` the extension's
   * accessors/ URL; either missing means "registry only".
   */
  function sourceFor(cat, bundle, localBase, kind, key) {
    const table = kind === "tag" ? (bundle && bundle.tags) : (bundle && bundle.modules);
    const local = table && table[key];
    const known = kind === "tag"
      ? (cat.tags.get(key) || {}).version
      : (cat.modules.get(key) || {}).version;

    if (local && (!known || local === known)) {
      return { url: localBase + (kind === "tag" ? key : key + ".wasm"), local: true, version: local };
    }
    if (kind === "tag") {
      const t = cat.tags.get(key);
      return t ? { url: t.url, local: false, version: t.version, skew: !!local } : null;
    }
    const m = cat.modules.get(key);
    return m ? { url: m.url, local: false, version: m.version, skew: !!local } : null;
  }

  /* The solver's JavaScript, which has to become a page-origin blob to be a
   * worker script, and can also be injected as a <script> on the main thread. */
  function solverScript(cat, bundle, localBase, module) {
    const local = bundle && bundle.modules && bundle.modules[module];
    const known = (cat.modules.get(module) || {}).version;
    if (local && (!known || local === known)) return { url: localBase + module + ".js", local: true };
    const m = cat.modules.get(module);
    return m ? { url: m.js || (cat.base + module + ".js"), local: false } : null;
  }

  /* Patent status, as declared by the publisher and served by the registry.
   *
   * Only "royalty-free" and "expired" are used without being asked: the other
   * two say either that a licence is needed to practise the format
   * ("licence-required") or that the question is open ("under-review"), and
   * an undeclared status says nothing at all. The extension leaves all three
   * alone unless the user turns them on. */
  const PATENT_RANK = { "licence-required": 3, "under-review": 2, "expired": 1, "royalty-free": 0 };
  const UNRESTRICTED = ["royalty-free", "expired"];

  function statusOf(cat, module) {
    const m = cat.modules.get(module);
    return (m && m.patents && m.patents.status) || "undeclared";
  }

  function isRestricted(cat, module) {
    return UNRESTRICTED.indexOf(statusOf(cat, module)) === -1;
  }

  /* [{ module, status }] for every module of a pipeline the user has not
   * agreed to use - empty when the whole pipeline is unrestricted. */
  function restrictedIn(cat, names) {
    return names.filter(n => cat.modules.has(n) && isRestricted(cat, n))
      .map(n => ({ module: n, status: statusOf(cat, n) }));
  }

  function patentStatus(cat, names) {
    let worst = null;
    for (const n of names) {
      const m = cat.modules.get(n);
      const s = m && m.patents && m.patents.status;
      if (!s) continue;
      if (!worst || (PATENT_RANK[s] || 0) > (PATENT_RANK[worst] || 0)) worst = s;
    }
    return worst;
  }

  root.BevaraRegistry = {
    DEFAULT_REGISTRY, accessorsBase, normalise, fetchIndex, toStorage, fromStorage,
    missingFrom, runtimeFor, patentStatus, sourceFor, solverScript,
    UNRESTRICTED, statusOf, isRestricted, restrictedIn
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
