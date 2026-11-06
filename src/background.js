/* Background service worker.
 *
 * Owns everything the page cannot do for itself:
 *   - bundle:   read accessors/bundled.json, the build-time copy of registry
 *               files the extension serves from its own (CSP-exempt) URLs
 *   - registry: fetch and cache /accessors/index.json, so every tab knows
 *               which accessors exist, at what version, with which licence
 *               and patent status, without asking the registry again
 *   - sniff:    read the first bytes of a media URL to identify its format
 *               when the extension and MIME type give nothing
 *   - fetch:    stream a cross-origin media file the page is not allowed to
 *               read (Port "bevara-fetch"), so the pipeline can consume it
 *               as a same-origin blob
 *   - state:    remember what was taken over on each tab, for the popup badge
 */
importScripts("common/formats.js", "common/registry.js");

const R = globalThis.BevaraRegistry;

const DEFAULTS = {
  enabled: true,
  registry: R.DEFAULT_REGISTRY,
  disabledHosts: [],
  useWorker: true,
  progressive: true,
  allowEncumbered: false,
  webcodecEncoder: true,
  proxyCrossOrigin: true,
  verbose: false
};

/* The catalogue changes when someone publishes; an hour is short enough to
 * pick that up and long enough that browsing costs no request. */
const INDEX_TTL_MS = 60 * 60 * 1000;

const tabState = new Map();
let indexPromise = null;
let bundlePromise = null;

/* What scripts/sync-accessors.sh copied into accessors/, if anything. */
function loadBundle() {
  if (!bundlePromise) {
    bundlePromise = fetch(chrome.runtime.getURL("accessors/bundled.json"))
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return bundlePromise;
}

function getSettings() {
  return chrome.storage.sync.get(DEFAULTS).then(s => Object.assign({}, DEFAULTS, s));
}

/* ------------------------------------------------------------- registry */

async function readCachedIndex(registry) {
  const { catalogue } = await chrome.storage.local.get({ catalogue: null });
  if (!catalogue || catalogue.registry !== String(registry).replace(/\/+$/, "")) return null;
  if (Date.now() - (catalogue.fetchedAt || 0) > INDEX_TTL_MS) return { stale: true, raw: catalogue };
  return { stale: false, raw: catalogue };
}

async function loadIndex({ force } = {}) {
  if (indexPromise && !force) return indexPromise;

  indexPromise = (async () => {
    const { registry } = await getSettings();
    const cached = await readCachedIndex(registry);
    if (cached && !cached.stale && !force) {
      return { catalogue: cached.raw, fresh: true, error: null };
    }
    try {
      const cat = await R.fetchIndex(registry);
      const stored = Object.assign(R.toStorage(cat), { fetchedAt: Date.now() });
      await chrome.storage.local.set({ catalogue: stored });
      return { catalogue: stored, fresh: true, error: null };
    } catch (e) {
      /* An unreachable registry must not take the extension down: a stale
       * catalogue still names the right modules, and their URLs are served
       * from the browser's HTTP cache when it has them. */
      if (cached) return { catalogue: cached.raw, fresh: false, error: String(e.message || e) };
      return { catalogue: null, fresh: false, error: String(e.message || e) };
    }
  })();

  const res = await indexPromise;
  if (!res.catalogue) indexPromise = null; /* retry on the next page */
  return res;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS)
    .then(s => chrome.storage.sync.set(Object.assign({}, DEFAULTS, s)))
    .then(() => loadIndex({ force: true }));
});
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => loadIndex());

/* A new registry address invalidates the catalogue built from the old one. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.registry) {
    indexPromise = null;
    chrome.storage.local.remove("catalogue").then(() => loadIndex({ force: true }));
  }
});

/* ---------------------------------------------------------------- sniff */

async function sniff(url) {
  const res = await fetch(url, { headers: { Range: "bytes=0-4095" }, credentials: "omit" });
  const contentType = res.headers.get("Content-Type") || "";
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf.slice(0, 4096));
  const f = BevaraFormats.fromMagic(bytes) || BevaraFormats.fromMime(contentType);
  return { format: f ? f.id : null, contentType, status: res.status };
}

/* ------------------------------------------------------------ media proxy */

/* Runtime messages are JSON-serialised, so a media file is streamed back to
 * the content script over a Port as base64 chunks rather than as one giant
 * array. ~3 MB of bytes per chunk keeps each message far below Chrome's
 * per-message ceiling while still being a handful of messages for a video. */
const CHUNK = 3 * 1024 * 1024;

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function streamMedia(url, port) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  port.postMessage({ type: "head", contentType: res.headers.get("Content-Type") || "application/octet-stream", size: Number(res.headers.get("Content-Length")) || 0 });
  const reader = res.body.getReader();
  let pending = [], pendingLen = 0;
  const flush = () => {
    if (!pendingLen) return;
    const merged = new Uint8Array(pendingLen);
    let o = 0;
    for (const p of pending) { merged.set(p, o); o += p.length; }
    port.postMessage({ type: "chunk", data: toBase64(merged) });
    pending = []; pendingLen = 0;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending.push(value); pendingLen += value.length;
    if (pendingLen >= CHUNK) flush();
  }
  flush();
  port.postMessage({ type: "done" });
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "bevara-fetch") return;
  port.onMessage.addListener(msg => {
    if (msg.op !== "fetch") return;
    streamMedia(msg.url, port).catch(err => {
      try { port.postMessage({ type: "error", error: String(err && err.message || err) }); } catch (e) { }
    });
  });
});

/* ------------------------------------------------------------ tab state */

function updateBadge(tabId) {
  const entries = tabState.get(tabId) || [];
  const n = entries.filter(e => e.status !== "unavailable").length;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" });
  if (n) chrome.action.setBadgeBackgroundColor({ tabId, color: "#0b3d91" });
}

chrome.tabs.onRemoved.addListener(tabId => tabState.delete(tabId));
/* a top-level navigation starts a new page: forget the previous one */
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && tabState.has(tabId)) { tabState.delete(tabId); updateBadge(tabId); }
});

/* ------------------------------------------------------------- messages */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  (async () => {
    switch (msg.op) {
      case "settings":
        return getSettings();

      case "index": {
        const res = await loadIndex({ force: !!msg.force });
        return Object.assign({}, res, { bundle: await loadBundle() });
      }

      case "sniff":
        return sniff(msg.url);

      case "report": {
        if (tabId === null) return null;
        const list = tabState.get(tabId) || [];
        list.push({
          kind: msg.kind, format: msg.format, url: msg.url, status: msg.status,
          detail: msg.detail || null, patents: msg.patents || null, at: Date.now()
        });
        tabState.set(tabId, list);
        updateBadge(tabId);
        return null;
      }

      case "tabState":
        return tabState.get(msg.tabId) || [];

      default:
        throw new Error("unknown op " + msg.op);
    }
  })().then(
    data => sendResponse({ ok: true, data }),
    err => sendResponse({ ok: false, error: String(err && err.message || err) })
  );

  return true; /* async sendResponse */
});
