const DEFAULTS = {
  enabled: true, disabledHosts: [], useWorker: true, progressive: true,
  useWebcodec: false, proxyCrossOrigin: true, verbose: false
};
const BOOLS = ["enabled", "useWorker", "progressive", "useWebcodec", "proxyCrossOrigin", "verbose"];

chrome.storage.sync.get(DEFAULTS).then(s => {
  for (const k of BOOLS) document.getElementById(k).checked = !!s[k];
  document.getElementById("disabledHosts").value = (s.disabledHosts || []).join("\n");
});

document.getElementById("save").addEventListener("click", () => {
  const s = {};
  for (const k of BOOLS) s[k] = document.getElementById(k).checked;
  s.disabledHosts = document.getElementById("disabledHosts").value
    .split("\n").map(x => x.trim().toLowerCase()).filter(Boolean);
  chrome.storage.sync.set(s).then(() => {
    const el = document.getElementById("saved");
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1500);
  });
});
