/* Page-world runtime.
 *
 * Executes the jobs prepared by the content script: instantiates the solver
 * (main module) with the selected accessors (side modules) and hands the
 * result back to the element. Adapted from the Showcase MutationObserver demo:
 *   - images and audio go through the generic pipeline below (worker when the
 *     page allows blob workers, main thread otherwise) and come back as a PNG
 *     (via canvas) or a WAV blob;
 *   - video is upgraded to <video is="universal-video_1"> so that progressive
 *     playback through Media Source Extensions is available, with the generic
 *     pipeline (whole-file transcode to fragmented MP4/H.264) as fallback.
 */
(function () {
  "use strict";

  if (window.__bevaraRuntime) return;
  window.__bevaraRuntime = true;

  const cfgAttr = document.documentElement.getAttribute("data-bevara-config");
  document.documentElement.removeAttribute("data-bevara-config");
  const config = cfgAttr ? JSON.parse(cfgAttr) : { base: "", verbose: false };
  const log = (...a) => { if (config.verbose) console.log("[bevara/page]", ...a); };

  const injectedScripts = new Map(); /* url -> Promise */
  const PROGRESSIVE_GRACE_MS = 20000;
  let tagsLoaded = null;

  function post(msg) { window.postMessage(Object.assign({ __bevara: true }, msg), "*"); }
  function status(id, s, detail) { post({ type: "status", id, status: s, detail }); }

  function elementFor(id) {
    return document.querySelector('[data-bevara-id="' + id + '"]');
  }

  function loadScript(url) {
    if (injectedScripts.has(url)) return injectedScripts.get(url);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("failed to load " + url));
      (document.head || document.documentElement).appendChild(s);
    });
    injectedScripts.set(url, p);
    return p;
  }

  function clearText(t) { return String(t).replaceAll("[37m", "").replaceAll("[0m", ""); }

  /* A worker message carrying exit_code is not necessarily the end: the
   * loader relays console.error/warn as { exit_code: -1, printErr: "WORKER
   * CONSOLE...." } while the session keeps running. */
  function isConsoleRelay(res) {
    return typeof res.printErr === "string" && res.printErr.indexOf("WORKER CONSOLE.") === 0;
  }

  /* ---------------------------------------------------------------- session */
  /* A session wraps one solver instance, worker or not, behind the same three
   * calls: run(init message) -> final message, call(message) -> reply, close(). */

  function workerSession(scriptUrl) {
    const worker = new Worker(scriptUrl);
    const listeners = [];
    worker.addEventListener("message", m => listeners.slice().forEach(l => l(m.data)));
    return {
      run(message) {
        return new Promise((resolve, reject) => {
          const onMsg = res => {
            if (res.print) log(clearText(res.print));
            if (res.printErr) log(clearText(res.printErr));
            if ("exit_code" in res && !isConsoleRelay(res)) {
              listeners.splice(listeners.indexOf(onMsg), 1);
              if (res.blob) resolve(res);
              else reject(new Error("pipeline ended without output (exit " + res.exit_code + ")" + (res.printErr ? ": " + clearText(res.printErr) : "")));
            }
          };
          listeners.push(onMsg);
          worker.addEventListener("error", e => {
            /* a CSP-refused blob worker surfaces here, not as a throw */
            const err = new Error(e.message || "worker error");
            err.workerFailed = true;
            reject(err);
          }, { once: true });
          worker.postMessage(message);
        });
      },
      call(message) {
        return new Promise(resolve => {
          const once = res => { listeners.splice(listeners.indexOf(once), 1); resolve(res); };
          listeners.push(once);
          worker.postMessage(message);
        });
      },
      close() { worker.terminate(); }
    };
  }

  async function mainThreadSession(core, scriptUrl) {
    if (!window[core]) await loadScript(scriptUrl);
    if (!window[core]) throw new Error("solver " + core + " did not register itself");
    const handler = await window[core]();
    return {
      async run(message) {
        const res = await handler({ data: message });
        if (res && res.print) log(clearText(res.print));
        if (res && res.printErr) log(clearText(res.printErr));
        if (!res || !res.blob) throw new Error("pipeline ended without output" + (res && res.printErr ? ": " + clearText(res.printErr) : ""));
        return res;
      },
      call(message) { return Promise.resolve(handler({ data: message })); },
      close() { try { handler({ data: { event: "destroy" } }); } catch (e) { } }
    };
  }

  function openSession(job, allowWorker) {
    if (allowWorker && job.options.useWorker && job.coreScript) {
      try {
        return Promise.resolve(workerSession(job.coreScript));
      } catch (e) {
        log("worker refused, falling back to main thread:", e.message);
      }
    }
    return mainThreadSession(job.using, job.accessors + job.using + ".js");
  }

  /* ---------------------------------------------------------------- pipeline */
  function initMessage(job, out, extra) {
    return Object.assign({
      event: "init",
      module: {
        dynamicLibraries: job.with.map(m => job.accessors + m + ".wasm"),
        noInitialRun: true,
        noExitRuntime: true
      },
      wasmBinaryFile: job.accessors + job.using + ".wasm",
      src: job.src,
      dst: "out." + out,
      useWebcodec: false,
      print: config.verbose ? "1" : null,
      printErr: config.verbose ? "1" : null,
      noCleanupOnExit: (out === "rgb" || out === "rgba") ? "" : null
    }, extra || {});
  }

  /* Raw pixels from the pipeline -> PNG blob the <img> can display. */
  async function pixelsToPng(session, out, blob) {
    const props = await session.call({ event: "get_properties", properties: ["width", "height"] });
    const width = props && props.width, height = props && props.height;
    if (!width || !height) throw new Error("pipeline reported no dimensions");
    const data = new Uint8ClampedArray(await blob.arrayBuffer());
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    let img;
    if (out === "rgba") {
      img = new ImageData(data, width, height);
    } else {
      img = new ImageData(width, height);
      const dst = img.data, n = 4 * width * height;
      for (let s = 0, d = 0; d < n;) {
        dst[d++] = data[s++]; dst[d++] = data[s++]; dst[d++] = data[s++]; dst[d++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }

  async function runGeneric(job, out, extra, allowWorker = true) {
    const session = await openSession(job, allowWorker);
    try {
      const res = await session.run(initMessage(job, out, extra));
      let blob = res.blob;
      if (out === "rgb" || out === "rgba") blob = await pixelsToPng(session, out, blob);
      return blob;
    } catch (e) {
      if (e && e.workerFailed && allowWorker) {
        /* the page's CSP refused the blob worker: same pipeline, main thread */
        log("worker failed, retrying on the main thread:", e.message);
        return runGeneric(job, out, extra, false);
      }
      throw e;
    } finally {
      session.close();
    }
  }

  /* ------------------------------------------------------------------- image */
  async function handleImage(job) {
    const el = elementFor(job.id);
    if (!el) throw new Error("element vanished");
    const png = await runGeneric(job, "rgb");
    const url = URL.createObjectURL(png);
    /* srcset rather than src, as the demo does: the original address is kept
     * on the element while the browser displays our rendition. */
    el.setAttribute("srcset", url);
    return "png";
  }

  /* ------------------------------------------------------------------- audio */
  async function handleAudio(job) {
    const el = elementFor(job.id);
    if (!el) throw new Error("element vanished");
    const wav = await runGeneric(job, "wav", { mime_type: "audio/wav" });
    const wasPlaying = el.autoplay || !el.paused;
    el.setAttribute("src", URL.createObjectURL(wav));
    el.load();
    if (wasPlaying) el.play().catch(() => { });
    return "wav";
  }

  /* ------------------------------------------------------------------- video */
  /* A customised built-in only upgrades when the parser or createElement
   * builds it, so the plain <video> is swapped for one owned by
   * universal-video_1, carrying the same attributes and children. */
  function upgradeToUniversalVideo(el, job) {
    const upgraded = document.createElement("video", { is: "universal-video_1" });
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === "is" || attr.name === "src") continue;
      upgraded.setAttribute(attr.name, attr.value);
    }
    while (el.firstChild) upgraded.appendChild(el.firstChild);
    upgraded.setAttribute("is", "universal-video_1");
    upgraded.setAttribute("using", job.using);
    upgraded.setAttribute("with", job.with.join(";"));
    upgraded.setAttribute("script-directory", job.accessors);
    upgraded.setAttribute("src", job.src);
    if (job.options.progressive) upgraded.setAttribute("progressive", "");
    if (job.options.useWebcodec) upgraded.setAttribute("use-webcodec", "");
    /* no use-worker here: the tag would build the worker from the extension
     * URL, which is cross-origin for the page */
    el.replaceWith(upgraded);
    return upgraded;
  }

  const TAG_ATTRS = ["is", "using", "with", "script-directory", "progressive", "use-webcodec", "src"];

  /* Swap an upgraded (but stalled) universal-video back for a plain <video>
   * so the whole-file result has a clean element to land on. */
  function downgrade(el) {
    const plain = document.createElement("video");
    for (const attr of Array.from(el.attributes)) {
      if (TAG_ATTRS.indexOf(attr.name) === -1) plain.setAttribute(attr.name, attr.value);
    }
    while (el.firstChild) plain.appendChild(el.firstChild);
    el.replaceWith(plain);
    return plain;
  }

  /* Resolves true as soon as the element has media data, false after ms. */
  function waitForData(el, ms) {
    return new Promise(resolve => {
      const has = () => el.readyState >= HTMLMediaElement.HAVE_METADATA || el.buffered.length > 0;
      if (has()) return resolve(true);
      const timer = setTimeout(() => { el.removeEventListener("loadedmetadata", onMeta); resolve(false); }, ms);
      const onMeta = () => { clearTimeout(timer); resolve(true); };
      el.addEventListener("loadedmetadata", onMeta, { once: true });
    });
  }

  async function videoFallback(job) {
    let el = elementFor(job.id);
    if (!el) throw new Error("element vanished");
    if (el.getAttribute("is")) el = downgrade(el);
    const mp4 = await runGeneric(job, "mp4", { mime_type: "video/mp4", transcode: ["c=avc"] });
    const wasPlaying = el.autoplay || !el.paused;
    el.removeAttribute("progressive");
    el.setAttribute("src", URL.createObjectURL(mp4));
    el.load();
    if (wasPlaying) el.play().catch(() => { });
    return "mp4";
  }

  async function handleVideo(job) {
    const el = elementFor(job.id);
    if (!el) throw new Error("element vanished");

    if (!tagsLoaded) tagsLoaded = loadScript(job.accessors + "universal-tags_1.js");
    try {
      await tagsLoaded;
      if (!customElements.get("universal-video_1")) throw new Error("universal-video_1 not defined");
    } catch (e) {
      log("universal tags unavailable, whole-file fallback:", e.message);
      return videoFallback(job);
    }

    const upgraded = upgradeToUniversalVideo(el, job);
    const p = upgraded.decodingPromise;
    if (!p) return videoFallback(job);
    let src;
    try {
      src = await p;
    } catch (e) {
      log("universal-video failed, whole-file fallback:", e && e.message || e);
      return videoFallback(job);
    }
    if (!src) return videoFallback(job);

    if (job.options.progressive && upgraded.hasAttribute("progressive")) {
      /* In progressive mode the promise settles as soon as the MediaSource
       * is attached, before any segment exists. Segments never come for
       * some sources (observed: video-only files), so a bounded wait for
       * the first data guards the whole-file route. */
      if (!(await waitForData(upgraded, PROGRESSIVE_GRACE_MS))) {
        log("no progressive data after " + PROGRESSIVE_GRACE_MS / 1000 + "s, whole-file fallback");
        return videoFallback(job);
      }
      return "mp4 (progressive)";
    }
    return "mp4";
  }

  /* ---------------------------------------------------------------- dispatch */
  async function run(job) {
    log("job", job.id, job.kind, job.format, job.originalSrc);
    try {
      let detail;
      if (job.kind === "image") detail = await handleImage(job);
      else if (job.kind === "audio") detail = await handleAudio(job);
      else if (job.kind === "video") detail = await handleVideo(job);
      else throw new Error("unknown kind " + job.kind);
      status(job.id, "done", detail);
    } catch (e) {
      console.warn("[bevara] could not decode", job.originalSrc, "-", e && e.message || e);
      status(job.id, "error", e && e.message || String(e));
    }
  }

  window.addEventListener("message", ev => {
    if (ev.source !== window || !ev.data || ev.data.__bevara !== true) return;
    if (ev.data.type === "job" && ev.data.job) run(ev.data.job);
  });

  post({ type: "ready" });
})();
