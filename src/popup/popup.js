const listEl = document.getElementById("list");
const hostEl = document.getElementById("host");
const toggle = document.getElementById("siteToggle");

document.getElementById("options").addEventListener("click", e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function render(entries) {
  if (!entries.length) return;
  /* latest status per url */
  const byUrl = new Map();
  for (const e of entries) byUrl.set(e.url, Object.assign({}, byUrl.get(e.url) || {}, e));
  const ul = document.createElement("ul");
  for (const e of byUrl.values()) {
    const li = document.createElement("li");
    const kind = document.createElement("span"); kind.className = "kind"; kind.textContent = e.kind + " · " + e.format;
    const url = document.createElement("span"); url.className = "url"; url.title = e.url; url.textContent = e.url;
    const st = document.createElement("span"); st.className = "st " + e.status; st.textContent = e.status;
    li.append(kind, url, st);
    ul.appendChild(li);
  }
  listEl.replaceChildren(ul);
}

chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  if (!tab) return;
  let host = "";
  try { host = new URL(tab.url).hostname; } catch (e) { }
  hostEl.textContent = host || "this page";

  const s = await chrome.storage.sync.get({ disabledHosts: [] });
  toggle.checked = host ? !s.disabledHosts.includes(host) : true;
  toggle.disabled = !host;
  toggle.addEventListener("change", async () => {
    const cur = (await chrome.storage.sync.get({ disabledHosts: [] })).disabledHosts;
    const next = toggle.checked ? cur.filter(h => h !== host) : cur.concat(cur.includes(host) ? [] : [host]);
    await chrome.storage.sync.set({ disabledHosts: next });
    chrome.tabs.reload(tab.id);
  });

  chrome.runtime.sendMessage({ op: "tabState", tabId: tab.id }, res => {
    if (res && res.ok) render(res.data);
  });
});
