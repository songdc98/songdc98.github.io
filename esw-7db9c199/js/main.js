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
  /* local engine (serve_lab.py). Opened from this machine: probe automatically. Opened from a public site: only when the visitor clicks the status
     (probing localhost from a public page makes some browsers ask for "local network" permission, which would look odd to ordinary visitors). */
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  async function detect(manual) {
    const here = new URL(".", location.href).href.replace(/\/$/, "");
    for (const base of [...new Set([...(isLocal || manual ? [here] : []), ...(manual ? ["http://127.0.0.1:8765"] : [])])]) {
      try { const r = await fetch(base + "/api/ping", { cache: "no-store" }); if (r.ok) { const j = await r.json(); if (j.service === "es-world-lab") { ES.api = base; $("#engdot").classList.add("on"); $("#engtxt").textContent = "本机引擎已连接 · " + (j.engine || "Python"); ES.bus.emit("engine", j); return true; } } } catch (e) {}
    }
    if (manual) $("#engtxt").textContent = "没有连上本机引擎(见参考页)";
    return false;
  }
  $("#engine").style.cursor = "pointer";
  $("#engine").title = isLocal ? "本机引擎状态" : "点击尝试连接本机引擎(需要在这台电脑上运行 scripts/serve_lab.py;浏览器可能询问是否允许访问本地网络,请选允许)";
  $("#engine").addEventListener("click", () => { if (!ES.api) detect(true); });
  ES.appBoot().then(() => { if (isLocal) detect(false); const h = location.hash.slice(1); if (h && ["replay", "gallery", "ref"].includes(h)) show(h); }).catch((e) => { console.error(e); document.body.insertAdjacentHTML("afterbegin", `<pre style="padding:16px;color:#a00">启动失败:${e.message}\n请通过 HTTP 访问(不要直接双击 index.html),例如 python3 -m http.server</pre>`); });
})();
