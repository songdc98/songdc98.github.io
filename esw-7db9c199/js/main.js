/* Boot: tabs, theme, engine detection. */
(function () {
  const ES = window.ES, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const inited = {};
  function show(tab) {
    $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + tab));
    if (!inited[tab]) { inited[tab] = true; ({ replay: ES.tabs.replayInit, gallery: ES.tabs.galleryInit, ref: ES.tabs.refInit })[tab]?.(); }
    if (tab === "lab") setTimeout(() => ES.app.map && ES.app.map.resize(), 30);
    try { history.replaceState(null, "", location.pathname + location.search + (tab === "lab" ? "" : "#" + tab)); } catch (e) {}
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  try { const d = $("#intro"); if (localStorage.getItem("esw-intro") === "closed") d.open = false; d.addEventListener("toggle", () => { try { localStorage.setItem("esw-intro", d.open ? "open" : "closed"); } catch (e) {} }); } catch (e) {}
  const th = $("#theme"); th.addEventListener("click", () => { const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; r.dataset.theme = dark ? "light" : "dark"; ES.app.map && (ES.app.map.baseKey = "", ES.app.map.draw()); });
  /* local engine (serve_lab.py): same origin first, then the conventional localhost port */
  async function detect() {
    const here = new URL(".", location.href).href.replace(/\/$/, "");                      // same directory as the page (works under any sub-path)
    for (const base of [...new Set([here, "http://127.0.0.1:8765"])]) {
      try { const r = await fetch(base + "/api/ping", { cache: "no-store" }); if (r.ok) { const j = await r.json(); if (j.service === "es-world-lab") { ES.api = base; $("#engdot").classList.add("on"); $("#engtxt").textContent = "本机引擎已连接 · " + (j.engine || "Python"); ES.bus.emit("engine", j); return; } } } catch (e) {}
    }
  }
  ES.appBoot().then(() => { detect(); const h = location.hash.slice(1); if (h && ["replay", "gallery", "ref"].includes(h)) show(h); }).catch((e) => { console.error(e); document.body.insertAdjacentHTML("afterbegin", `<pre style="padding:16px;color:#a00">启动失败:${e.message}\n请通过 HTTP 访问(不要直接双击 index.html),例如 python3 -m http.server</pre>`); });
})();
