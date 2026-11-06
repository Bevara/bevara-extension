/* Content script (isolated world).
 *
 * This is the MutationObserver half of the extension - the part of the
 * Showcase MutationObserver demo that watches the DOM, decides whether the
 * browser can handle a media element on its own, and if not, hands it to a
 * WebAssembly pipeline. It lives in the isolated world so that it can use the
 * extension APIs (settings, sniffing and CORS-free fetches via the background
 * worker, web-accessible accessors), which page scripts cannot reach.
 *
 * The accessors are not bundled: the solver main modules, the side modules
 * and the universal-tag scripts all come from a Bevara filter registry
 * (registry.bevara.ddns.net by default), whose /accessors/ tree is served
 * with `Access-Control-Allow-Origin: *` so that the page and its workers may
 * load them directly. The background worker keeps the catalogue; this script
 * checks against it that a format's whole pipeline is published before
 * touching an element.
 *
 * The pipeline itself runs in the page's main world (src/page/runtime.js):
 * that is where Workers, MediaSource and the customised built-in
 * <video is="universal-video_1"> have to live. The two halves talk through
 * window.postMessage with fully resolved "jobs": by the time a job crosses the
 * boundary every decision has been made here, so a page forging a job gains
 * nothing it could not already do with the public accessor files.
 *
 * Decision rule per element (see README for the rationale):
 *   - format known and never native anywhere  -> take over immediately
 *   - format possibly native                  -> let the browser try first,
 *                                                take over on `error`
 *   - audio/video                             -> canPlayType() decides up front,
 *                                                `error` remains as a fallback
 */
(function () {
  "use strict";

  const F = globalThis.BevaraFormats;
  const R = globalThis.BevaraRegistry;
  const BASE = chrome.runtime.getURL("");

  const LOCAL_ACCESSORS = BASE + "accessors/";

  let settings = null;
  let catalogue = null;              /* registry catalogue, see common/registry.js */
  let bundle = null;                 /* accessors/bundled.json, may be null */
  const has = m => !!(catalogue && catalogue.modules.has(m));
  const runtimeOf = m => (catalogue ? R.runtimeFor(catalogue, m) : m);
  /* published, and allowed by the patent policy - what pipelineFor needs to
   * choose between the wasm encoder and the browser's own through WebCodecs */
  const usable = m => has(m) && (settings.allowEncumbered || !R.isRestricted(catalogue, m));
  const sourceFor = (kind, key) => R.sourceFor(catalogue, bundle, LOCAL_ACCESSORS, kind, key);
  let runtimeReady = false;
  const pendingJobs = [];
  const jobs = new Map();          /* id -> { el, fmt, url } */
  const seen = new WeakSet();
  const ownUrls = new Set();       /* blob: URLs we created, ignored when re-observed */
  const coreScriptUrls = new Map();/* core name -> blob: URL of its JS wrapper */
  let nextId = 1;

  const log = (...a) => { if (settings && settings.verbose) console.log("[bevara]", ...a); };

  /* --------------------------------------------------------- background RPC */
  function rpc(op, args) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(Object.assign({ op }, args || {}), res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error("no response"));
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      });
    });
  }

  /* Stream a resource through the background worker (host permissions, no
   * CORS) and expose it to the page as a same-origin blob: URL. */
  function proxyFetch(url) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "bevara-fetch" });
      const parts = [];
      let type = "application/octet-stream";
      port.onMessage.addListener(m => {
        switch (m.type) {
          case "head": type = m.contentType; break;
          case "chunk": {
            const bin = atob(m.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            parts.push(bytes);
            break;
          }
          case "done": {
            port.disconnect();
            const blobUrl = URL.createObjectURL(new Blob(parts, { type }));
            ownUrls.add(blobUrl);
            resolve(blobUrl);
            break;
          }
          case "error": port.disconnect(); reject(new Error(m.error)); break;
        }
      });
      port.onDisconnect.addListener(() => reject(new Error("fetch port closed")));
      port.postMessage({ op: "fetch", url });
    });
  }

  /* ------------------------------------------------------- page-world bridge */
  function postToPage(msg) {
    window.postMessage(Object.assign({ __bevara: true }, msg), "*");
  }

  window.addEventListener("message", ev => {
    if (ev.source !== window || !ev.data || ev.data.__bevara !== true) return;
    const m = ev.data;
    if (m.type === "ready") {
      runtimeReady = true;
      while (pendingJobs.length) postToPage({ type: "job", job: pendingJobs.shift() });
    } else if (m.type === "status") {
      const j = jobs.get(m.id);
      if (!j) return;
      log("job", m.id, m.status, m.detail || "");
      rpc("report", { kind: j.fmt.kind, format: j.fmt.id, url: j.url, status: m.status }).catch(() => { });
      if (m.status === "done" || m.status === "error") jobs.delete(m.id);
    }
  });

  function submit(job) {
    if (runtimeReady) postToPage({ type: "job", job });
    else pendingJobs.push(job);
  }

  function injectScript(path) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = BASE + path;
      s.async = false;
      s.onload = () => { s.remove(); resolve(); };
      s.onerror = () => reject(new Error("failed to load " + path));
      (document.head || document.documentElement).appendChild(s);
    });
  }

  /* Workers must be same-origin with the page, so the solver's JS wrapper is
   * fetched from the registry and re-hosted as a page-origin blob: URL. The
   * .wasm files keep their registry URLs, which the worker fetches itself. */
  async function coreScriptUrl(core) {
    if (coreScriptUrls.has(core)) return coreScriptUrls.get(core);
    const script = R.solverScript(catalogue, bundle, LOCAL_ACCESSORS, core);
    if (!script) throw new Error("no source for " + core + ".js");
    const src = script.url;
    const p = fetch(src, { credentials: "omit" })
      .then(r => { if (!r.ok) throw new Error("registry answered " + r.status + " for " + core + ".js"); return r.text(); })
      .then(text => {
        const u = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
        ownUrls.add(u);
        return u;
      });
    coreScriptUrls.set(core, p);
    return p;
  }

  /* --------------------------------------------------------- source helpers */
  function absolute(url) {
    try { return new URL(url, document.baseURI).href; } catch (e) { return ""; }
  }

  function isCandidateUrl(url) {
    if (!url || ownUrls.has(url)) return false;
    if (/^(blob|data|javascript|about|chrome|moz-extension|chrome-extension):/i.test(url)) return false;
    /* never try to decode the registry's own files */
    return !(catalogue && url.indexOf(catalogue.base) === 0);
  }

  function isSameOrigin(url) {
    try { return new URL(url).origin === location.origin; } catch (e) { return false; }
  }

  /* Can the page (and therefore a page-origin worker) read this URL? Costs
   * one byte. Servers that ignore Range get their body cancelled. */
  async function corsReadable(url) {
    try {
      const ctl = new AbortController();
      const res = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: ctl.signal, credentials: "same-origin" });
      ctl.abort();
      return res.ok || res.status === 206 || res.status === 416;
    } catch (e) {
      return false;
    }
  }

  async function resolveSource(url) {
    if (isSameOrigin(url) || await corsReadable(url)) return url;
    if (!settings.proxyCrossOrigin) throw new Error("cross-origin source without CORS and proxy disabled: " + url);
    log("proxying", url);
    return proxyFetch(url);
  }

  const kindOf = el => el instanceof HTMLVideoElement ? "video" : el instanceof HTMLAudioElement ? "audio" : "image";

  async function identify(url, declaredType, kind) {
    let fmt = F.fromMime(declaredType) || F.fromExtension(url, kind);
    if (fmt) return fmt;
    try {
      const r = await rpc("sniff", { url });
      if (r.format) return F.byId.get(r.format);
    } catch (e) {
      log("sniff failed", url, e.message);
    }
    return null;
  }

  /* --------------------------------------------------------------- takeover */
  /* Is the whole pipeline for this format published, and may it be used? */
  function unavailableReason(fmt) {
    if (!catalogue) return "registry catalogue unavailable";
    const p = F.pipelineFor(fmt, has, runtimeOf, usable);
    if (p.missing.length) return "not published on the registry: " + p.missing.join(", ");

    /* A decoder whose format needs a patent licence, or whose status the
     * registry still records as open, is not used on the user's behalf
     * without them saying so. */
    if (!settings.allowEncumbered) {
      const restricted = R.restrictedIn(catalogue, [p.using].concat(p.with));
      if (restricted.length) {
        return "patent status " + restricted.map(r => r.module + ": " + r.status).join(", ")
          + " (enable \"Use patent-encumbered accessors\" in the options to allow it)";
      }
    }

    if (p.useWebcodec && !settings.webcodecEncoder) {
      return p.notes.join("; ") + " (enable \"WebCodecs encoder\" in the options to try anyway)";
    }
    return null;
  }

  async function takeover(el, fmt, url) {
    if (el.hasAttribute("data-bevara-id")) return;

    const why = unavailableReason(fmt);
    if (why) {
      log("leaving", fmt.kind, fmt.id, url, "-", why);
      rpc("report", { kind: fmt.kind, format: fmt.id, url, status: "unavailable", detail: why }).catch(() => { });
      return;
    }

    const id = String(nextId++);
    el.setAttribute("data-bevara-id", id);
    jobs.set(id, { el, fmt, url });
    log("taking over", fmt.kind, fmt.id, url);
    const planned = F.pipelineFor(fmt, has, runtimeOf, usable);
    const patents = R.patentStatus(catalogue, [planned.using].concat(planned.with));
    rpc("report", { kind: fmt.kind, format: fmt.id, url, status: "started", patents }).catch(() => { });

    try {
      const pipeline = F.pipelineFor(fmt, has, runtimeOf, usable);

      /* Each module separately: a bundled one comes from the extension (whose
       * URLs the page's CSP does not police), the rest from the registry. */
      const modules = {};
      let allLocal = true;
      for (const m of pipeline.with) {
        const src = sourceFor("module", m);
        modules[m] = src.url;
        if (!src.local) allLocal = false;
        if (src.skew) log(m, "bundled copy is stale, using the registry");
      }
      const coreWasm = sourceFor("module", pipeline.using);
      if (!coreWasm.local) allLocal = false;
      const tags = sourceFor("tag", "universal-tags_1.js");

      const job = {
        id,
        kind: fmt.kind,
        format: fmt.id,
        src: await resolveSource(url),
        originalSrc: url,
        using: pipeline.using,
        with: pipeline.with,
        modules,
        coreWasm: coreWasm.url,
        /* the universal-video tag resolves its own modules from one
         * directory, so it gets the local one only when everything is there */
        accessors: allLocal ? LOCAL_ACCESSORS : catalogue.base,
        tagsUrl: tags ? tags.url : null,
        coreScript: settings.useWorker ? await coreScriptUrl(pipeline.using) : null,
        options: {
          useWorker: settings.useWorker,
          progressive: settings.progressive,
          useWebcodec: pipeline.useWebcodec,
          verbose: settings.verbose
        }
      };
      submit(job);
    } catch (e) {
      log("takeover aborted", e.message);
      jobs.delete(id);
      el.removeAttribute("data-bevara-id");
      rpc("report", { kind: fmt.kind, format: fmt.id, url, status: "error" }).catch(() => { });
    }
  }

  /* ------------------------------------------------------------------ images */
  function handleImage(el) {
    const url = absolute(el.getAttribute("src") || "");
    if (!isCandidateUrl(url)) return;
    const fmt = F.fromExtension(url, "image");

    if (fmt && fmt.kind === "image" && !fmt.native) {
      takeover(el, fmt, url);
      return;
    }

    /* The browser gets the first try; `error` means it could not decode. */
    const onError = async () => {
      const current = absolute(el.currentSrc || el.getAttribute("src") || "");
      if (!isCandidateUrl(current)) return;
      const f = await identify(current, null, "image");
      if (f && f.kind === "image") takeover(el, f, current);
      else log("no accessor for image", current);
    };
    el.addEventListener("error", onError, { once: true });
    if (el.complete && el.naturalWidth === 0) onError();
  }

  /* -------------------------------------------------------------- audio/video */
  function mediaCandidates(el) {
    const out = [];
    const own = el.getAttribute("src");
    if (own) out.push({ url: absolute(own), type: null, node: el });
    for (const s of el.querySelectorAll(":scope > source")) {
      out.push({ url: absolute(s.getAttribute("src") || ""), type: s.getAttribute("type"), node: s });
    }
    return out.filter(c => isCandidateUrl(c.url));
  }

  function nativelyPlayable(el, fmt, declaredType) {
    const probe = declaredType || fmt.probe;
    if (!probe) return true;
    try { return el.canPlayType(probe) !== ""; } catch (e) { return true; }
  }

  function handleMedia(el) {
    const candidates = mediaCandidates(el);
    if (!candidates.length) {
      /* Sources may be appended later (or set through the src property):
       * the attribute observer below re-enters here when they show up. */
      return;
    }

    let firstServable = null;
    let anyNative = false;
    for (const c of candidates) {
      const fmt = F.fromMime(c.type) || F.fromExtension(c.url, kindOf(el));
      if (!fmt) { anyNative = true; continue; } /* unknown: assume the browser knows better */
      if (nativelyPlayable(el, fmt, c.type)) anyNative = true;
      else if (!firstServable) firstServable = { fmt, url: c.url };
    }

    if (!anyNative && firstServable) {
      takeover(el, firstServable.fmt, firstServable.url);
      return;
    }

    /* Something looked playable: wait for the browser's verdict. A media
     * element with <source> children reports failure on the last <source>,
     * not on itself, hence the listeners on both. */
    let fired = false;
    const onError = async () => {
      if (fired) return;
      const err = el.error;
      const code = err ? err.code : 0;
      const noSource = el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
      if (!(code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE || noSource)) return;
      fired = true;
      for (const c of mediaCandidates(el)) {
        const f = await identify(c.url, c.type, kindOf(el));
        if (f && (f.kind === "audio" || f.kind === "video")) { takeover(el, f, c.url); return; }
      }
      log("no accessor for media", candidates.map(c => c.url));
    };
    el.addEventListener("error", onError);
    for (const c of candidates) if (c.node !== el) c.node.addEventListener("error", onError);
    /* it may already have failed before we attached */
    if (el.error || el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) setTimeout(onError, 0);
  }

  /* ---------------------------------------------------------------- observer */
  function isOurs(el) {
    const is = el.getAttribute("is");
    return el.hasAttribute("data-bevara-id") || (is && is.indexOf("universal-") === 0);
  }

  function consider(el) {
    if (!(el instanceof Element) || seen.has(el) || isOurs(el)) return;
    seen.add(el);
    if (el instanceof HTMLImageElement) handleImage(el);
    else if (el instanceof HTMLMediaElement) handleMedia(el);
  }

  function scan(root) {
    if (root instanceof HTMLImageElement || root instanceof HTMLMediaElement) consider(root);
    if (root.querySelectorAll) root.querySelectorAll("img, audio, video").forEach(consider);
  }

  function observe() {
    scan(document.documentElement);
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === "childList") {
          m.addedNodes.forEach(n => {
            if (n.nodeType !== Node.ELEMENT_NODE) return;
            /* a <source> added under an existing media element */
            if (n instanceof HTMLSourceElement && n.parentElement instanceof HTMLMediaElement) {
              seen.delete(n.parentElement);
              consider(n.parentElement);
            } else {
              scan(n);
            }
          });
        } else if (m.type === "attributes") {
          const el = m.target;
          if (isOurs(el)) continue;
          seen.delete(el);
          consider(el);
        }
      }
    }).observe(document.documentElement, {
      subtree: true, childList: true,
      attributes: true, attributeFilter: ["src"]
    });
  }

  /* ------------------------------------------------------------------- start */
  async function start() {
    try {
      settings = await rpc("settings");
    } catch (e) {
      return; /* background unreachable (extension reloading) */
    }
    if (!settings.enabled) return;
    if ((settings.disabledHosts || []).some(h => h && (location.hostname === h || location.hostname.endsWith("." + h)))) return;

    try {
      const res = await rpc("index");
      catalogue = R.fromStorage(res.catalogue);
      bundle = res.bundle && res.bundle.mode !== "none" ? res.bundle : null;
      if (!catalogue) {
        console.warn("[bevara] no accessor catalogue from " + settings.registry + " - " + (res.error || "unknown error"));
        return;
      }
      if (!res.fresh) log("using a stale catalogue:", res.error);
      log("catalogue:", catalogue.modules.size, "accessors;",
        bundle ? Object.keys(bundle.modules).length + " module(s) bundled locally (" + bundle.mode + ")" : "nothing bundled");
    } catch (e) {
      console.warn("[bevara] could not reach the registry:", e.message);
      return;
    }

    document.documentElement.setAttribute("data-bevara-config", JSON.stringify({
      base: BASE,
      verbose: !!settings.verbose
    }));
    injectScript("src/page/runtime.js").catch(e => console.warn("[bevara]", e.message));

    if (document.documentElement) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });
  }

  start();
})();
