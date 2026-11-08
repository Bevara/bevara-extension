/* Test bench without the extension: plays the role of src/content/bootstrap.js
 * (the isolated-world half) so that the real page-world runtime, the real
 * format registry and the real accessors can be exercised from a plain page.
 *
 * The accessors come from the same Bevara registry the extension uses; its
 * /accessors/ tree is served with CORS `*`, so the page can fetch the
 * catalogue, the solver and the side modules directly. `?registry=<url>`
 * points the bench at another one.
 *
 *   python3 -m http.server 8765      (from this directory)
 *   http://localhost:8765/test/
 */
(function () {
  "use strict";

  /* The page loads ../src/common/*.js, so the server's root has to be the
   * extension directory - started from test/ instead, those paths collapse to
   * /src/… and 404. Say so, rather than failing on an undefined global. */
  if (!globalThis.BevaraFormats || !globalThis.BevaraRegistry) {
    const msg = "[harness] src/common/*.js did not load. Serve the extension directory, not test/:\n"
      + "    cd " + location.origin.replace(/^https?:\/\//, "") + "  ->  python3 -m http.server from the directory that contains src/ and test/\n"
      + "    then open " + location.origin + "/test/";
    console.error(msg);
    document.addEventListener("DOMContentLoaded", () => {
      const p = document.createElement("pre");
      p.style.cssText = "background:#fde8e8;border:1px solid #b42318;color:#b42318;padding:12px;white-space:pre-wrap";
      p.textContent = msg;
      document.body.prepend(p);
    });
    return;
  }

  const PARAMS = new URLSearchParams(location.search);
  const BASE = location.origin + "/";
  const REGISTRY = (PARAMS.get("registry") || globalThis.BevaraRegistry.DEFAULT_REGISTRY).replace(/\/+$/, "");
  const settings = { enabled: true, useWorker: true, progressive: true, allowEncumbered: PARAMS.has("encumbered"), webcodecEncoder: !PARAMS.has("nowebcodec")  /* mirrors the extension default */, proxyCrossOrigin: true, verbose: true };
  const html = document.documentElement;
  let catalogue = null;
  let bundle = null;                 /* ?bundle loads accessors/bundled.json, as the extension does */
  const has = m => !!(catalogue && catalogue.modules.has(m));
  const runtimeOf = m => (catalogue ? R.runtimeFor(catalogue, m) : m);
  /* published, and allowed by the patent policy - what pipelineFor needs to
   * choose between the wasm encoder and the browser's own through WebCodecs */
  const usable = m => has(m) && (settings.allowEncumbered || !R.isRestricted(catalogue, m));
  const LOCAL_ACCESSORS = BASE + "accessors/";

  window.__BEVARA_REPORTS__ = [];
  const report = e => { window.__BEVARA_REPORTS__.push(e); console.log("[report]", JSON.stringify(e)); };

  html.setAttribute("data-bevara-config", JSON.stringify({ base: BASE, verbose: true }));
  const s = document.createElement("script"); s.src = BASE + "src/page/runtime.js"; s.async = false; document.head.appendChild(s);

  /* --- everything below mirrors bootstrap.js with the chrome.* calls stubbed --- */
  const F = globalThis.BevaraFormats;
  const R = globalThis.BevaraRegistry;
  let runtimeReady = false;
  const pendingJobs = [], jobs = new Map(), seen = new WeakSet();
  let nextId = 1;

  async function sniff(url) {
    const r = await fetch(url, { headers: { Range: "bytes=0-4095" } });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const f = F.fromMagic(bytes.subarray(0, 4096)) || F.fromMime(r.headers.get("Content-Type"));
    return { format: f ? f.id : null };
  }

  function post(msg) { window.postMessage(Object.assign({ __bevara: true }, msg), "*"); }
  window.addEventListener("message", ev => {
    if (ev.source !== window || !ev.data || ev.data.__bevara !== true) return;
    const m = ev.data;
    if (m.type === "ready") { runtimeReady = true; while (pendingJobs.length) post({ type: "job", job: pendingJobs.shift() }); }
    else if (m.type === "status") { const j = jobs.get(m.id); if (j) report({ id: m.id, kind: j.fmt.kind, format: j.fmt.id, url: j.url, status: m.status, detail: m.detail }); }
  });
  const submit = job => runtimeReady ? post({ type: "job", job }) : pendingJobs.push(job);

  const absolute = u => { try { return new URL(u, document.baseURI).href; } catch (e) { return ""; } };
  const isCandidateUrl = u => !!u && !/^(blob|data|javascript|about):/i.test(u);

  const kindOf = el => el instanceof HTMLVideoElement ? "video" : el instanceof HTMLAudioElement ? "audio" : "image";
  async function identify(url, type, kind) {
    return F.fromMime(type) || F.fromExtension(url, kind) || F.byId.get((await sniff(url)).format) || null;
  }

  async function takeover(el, fmt, url) {
    if (el.hasAttribute("data-bevara-id")) return;
    const p = F.pipelineFor(fmt, has, runtimeOf, usable);
    const restricted = settings.allowEncumbered ? [] : R.restrictedIn(catalogue, [p.using].concat(p.with));
    if (p.missing.length || restricted.length || (p.useWebcodec && !settings.webcodecEncoder)) {
      report({ kind: fmt.kind, format: fmt.id, url, status: "unavailable",
        detail: p.missing.length ? "missing: " + p.missing.join(",")
          : restricted.length ? "patents: " + restricted.map(r => r.module + "=" + r.status).join(",")
          : p.notes.join("; ") });
      return;
    }
    const id = String(nextId++);
    el.setAttribute("data-bevara-id", id);
    jobs.set(id, { el, fmt, url });
    report({ id, kind: fmt.kind, format: fmt.id, url, status: "started" });
    const modules = {};
    let allLocal = true;
    for (const m of p.with) {
      const src = R.sourceFor(catalogue, bundle, LOCAL_ACCESSORS, "module", m);
      modules[m] = src.url;
      if (!src.local) allLocal = false;
    }
    const coreWasm = R.sourceFor(catalogue, bundle, LOCAL_ACCESSORS, "module", p.using);
    if (!coreWasm.local) allLocal = false;
    const script = R.solverScript(catalogue, bundle, LOCAL_ACCESSORS, p.using);
    const core = await fetch(script.url).then(r => r.text());
    submit({ id, kind: fmt.kind, format: fmt.id, src: url, originalSrc: url, using: p.using, with: p.with,
      modules, coreWasm: coreWasm.url,
      accessors: allLocal ? LOCAL_ACCESSORS : catalogue.base,
      tagsUrl: R.sourceFor(catalogue, bundle, LOCAL_ACCESSORS, "tag", "universal-tags_1.js").url,
      coreScript: URL.createObjectURL(new Blob([core], { type: "text/javascript" })),
      options: Object.assign({}, settings, { useWebcodec: p.useWebcodec }) });
  }

  function handleImage(el) {
    const url = absolute(el.getAttribute("src") || "");
    if (!isCandidateUrl(url)) return;
    const fmt = F.fromExtension(url, "image");
    if (fmt && fmt.kind === "image" && (!fmt.native || FORCE)) return takeover(el, fmt, url);
    const onError = async () => {
      const cur = absolute(el.currentSrc || el.getAttribute("src") || "");
      if (!isCandidateUrl(cur)) return;
      const f = await identify(cur, null, "image");
      if (f && f.kind === "image") takeover(el, f, cur);
    };
    el.addEventListener("error", onError, { once: true });
    if (el.complete && el.naturalWidth === 0) onError();
  }

  function mediaCandidates(el) {
    const out = [];
    const own = el.getAttribute("src");
    if (own) out.push({ url: absolute(own), type: null, node: el });
    for (const s of el.querySelectorAll(":scope > source")) out.push({ url: absolute(s.getAttribute("src") || ""), type: s.getAttribute("type"), node: s });
    return out.filter(c => isCandidateUrl(c.url));
  }
  /* ?force makes every known format look unsupported, to exercise the
   * pipelines on a browser that plays them natively */
  const FORCE = new URLSearchParams(location.search).has("force");
  function nativelyPlayable(el, fmt, type) { if (FORCE) return false; const p = type || fmt.probe; return !p || el.canPlayType(p) !== ""; }

  function handleMedia(el) {
    const candidates = mediaCandidates(el);
    if (!candidates.length) return;
    let first = null, anyNative = false;
    for (const c of candidates) {
      const fmt = F.fromMime(c.type) || F.fromExtension(c.url, kindOf(el));
      if (!fmt) { anyNative = true; continue; }
      if (nativelyPlayable(el, fmt, c.type)) anyNative = true; else if (!first) first = { fmt, url: c.url };
    }
    if (!anyNative && first) return takeover(el, first.fmt, first.url);
    let fired = false;
    const onError = async () => {
      if (fired) return;
      const code = el.error ? el.error.code : 0;
      if (!(code === 4 || code === 3 || el.networkState === 3)) return;
      fired = true;
      for (const c of mediaCandidates(el)) { const f = await identify(c.url, c.type, kindOf(el)); if (f && f.kind !== "image") return takeover(el, f, c.url); }
    };
    el.addEventListener("error", onError);
    for (const c of candidates) if (c.node !== el) c.node.addEventListener("error", onError);
    if (el.error || el.networkState === 3) setTimeout(onError, 0);
  }

  const isOurs = el => el.hasAttribute("data-bevara-id") || (el.getAttribute("is") || "").indexOf("universal-") === 0;
  function consider(el) {
    if (!(el instanceof Element) || seen.has(el) || isOurs(el)) return;
    seen.add(el);
    if (el instanceof HTMLImageElement) handleImage(el); else if (el instanceof HTMLMediaElement) handleMedia(el);
  }
  function scan(root) {
    if (root instanceof HTMLImageElement || root instanceof HTMLMediaElement) consider(root);
    if (root.querySelectorAll) root.querySelectorAll("img, audio, video").forEach(consider);
  }
  /* Nothing is examined before the catalogue is in: without it every
   * pipeline looks unpublished. The extension has the same ordering, with
   * the catalogue coming from the background worker. */
  (async () => {
    catalogue = await R.fetchIndex(REGISTRY);
    if (PARAMS.has("bundle")) {
      bundle = await fetch(BASE + "accessors/bundled.json").then(r => r.ok ? r.json() : null).catch(() => null);
      if (bundle && bundle.mode === "none") bundle = null;
    }
    console.log("[harness] catalogue from " + REGISTRY + ": " + catalogue.modules.size + " accessors"
      + (bundle ? "; bundle: " + Object.keys(bundle.modules).join(", ") : "; no bundle"));
    scan(html);
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === "childList") m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); });
        else if (!isOurs(m.target)) { seen.delete(m.target); consider(m.target); }
      }
    }).observe(html, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
  })().catch(e => console.error("[harness] registry unreachable:", e.message));
})();
