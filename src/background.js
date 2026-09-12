/* Background service worker.
 *
 * Three jobs the page cannot do for itself:
 *   - sniff:  read the first bytes of a media URL to identify its format when
 *             the extension/MIME give nothing (host_permissions bypass CORS)
 *   - fetch:  stream a cross-origin media file the page is not allowed to
 *             read (Port "bevara-fetch"), so the pipeline can consume it as a
 *             same-origin blob
 *   - state:  remember what was taken over on each tab, for the popup badge
 */
importScripts("common/formats.js");

const DEFAULTS = {
  enabled: true,
  disabledHosts: [],
  useWorker: true,
  progressive: true,
  useWebcodec: false,
  proxyCrossOrigin: true,
  verbose: false
};

const tabState = new Map();

function getSettings() {
  return chrome.storage.sync.get(DEFAULTS).then(s => Object.assign({}, DEFAULTS, s));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS).then(s => chrome.storage.sync.set(Object.assign({}, DEFAULTS, s)));
});

async function sniff(url) {
  const res = await fetch(url, { headers: { Range: "bytes=0-4095" }, credentials: "omit" });
  const contentType = res.headers.get("Content-Type") || "";
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf.slice(0, 4096));
  const f = BevaraFormats.fromMagic(bytes) || BevaraFormats.fromMime(contentType);
  return { format: f ? f.id : null, contentType, status: res.status };
}

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

function updateBadge(tabId) {
  const entries = tabState.get(tabId) || [];
  const n = entries.length;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" });
  if (n) chrome.action.setBadgeBackgroundColor({ tabId, color: "#0b3d91" });
}

chrome.tabs.onRemoved.addListener(tabId => tabState.delete(tabId));
/* a top-level navigation starts a new page: forget the previous one */
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && tabState.has(tabId)) { tabState.delete(tabId); updateBadge(tabId); }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  (async () => {
    switch (msg.op) {
      case "settings":
        return getSettings();

      case "sniff":
        return sniff(msg.url);

      case "report": {
        if (tabId === null) return null;
        const list = tabState.get(tabId) || [];
        list.push({ kind: msg.kind, format: msg.format, url: msg.url, status: msg.status, at: Date.now() });
        tabState.set(tabId, list);
        updateBadge(tabId);
        return null;
      }

      case "reset": {
        if (tabId === null) return null;
        tabState.delete(tabId);
        updateBadge(tabId);
        return null;
      }

      case "tabState": {
        const id = msg.tabId;
        return tabState.get(id) || [];
      }

      default:
        throw new Error("unknown op " + msg.op);
    }
  })().then(
    data => sendResponse({ ok: true, data }),
    err => sendResponse({ ok: false, error: String(err && err.message || err) })
  );

  return true; /* async sendResponse */
});
