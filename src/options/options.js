const DEFAULTS = {
  enabled: true, registry: "https://registry.bevara.ddns.net", disabledHosts: [],
  useWorker: true, progressive: true, allowEncumbered: false, webcodecEncoder: true,
  proxyCrossOrigin: true, verbose: false
};
const BOOLS = ["enabled", "useWorker", "progressive", "allowEncumbered", "webcodecEncoder", "proxyCrossOrigin", "verbose"];
const statusEl = document.getElementById("status");

chrome.storage.sync.get(DEFAULTS).then(s => {
  for (const k of BOOLS) document.getElementById(k).checked = !!s[k];
  document.getElementById("registry").value = s.registry;
  document.getElementById("disabledHosts").value = (s.disabledHosts || []).join("\n");
});

function showStatus(res) {
  if (!res || !res.ok) return (statusEl.textContent = "Catalogue unavailable: " + ((res && res.error) || "no answer"));
  const d = res.data;
  if (!d.catalogue) return (statusEl.textContent = "Catalogue unavailable: " + (d.error || "unknown error"));
  const c = d.catalogue;
  const when = c.fetchedAt ? new Date(c.fetchedAt).toLocaleString() : "unknown";
  statusEl.textContent = c.modules.length + " accessors, " + c.tags.length + " tag scripts"
    + " — read " + when + (d.fresh ? "" : " (stale: " + d.error + ")");
}

function loadStatus(force) {
  statusEl.textContent = force ? "Refreshing…" : "Reading catalogue…";
  chrome.runtime.sendMessage({ op: "index", force: !!force }, showStatus);
}
loadStatus(false);
document.getElementById("refresh").addEventListener("click", () => loadStatus(true));

document.getElementById("save").addEventListener("click", () => {
  const s = {};
  for (const k of BOOLS) s[k] = document.getElementById(k).checked;
  s.registry = document.getElementById("registry").value.trim().replace(/\/+$/, "") || DEFAULTS.registry;
  s.disabledHosts = document.getElementById("disabledHosts").value
    .split("\n").map(x => x.trim().toLowerCase()).filter(Boolean);
  chrome.storage.sync.set(s).then(() => {
    const el = document.getElementById("saved");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1500);
    setTimeout(() => loadStatus(false), 300);
  });
});
