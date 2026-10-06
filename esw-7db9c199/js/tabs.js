/* Replay, gallery and reference tabs. */
(function () {
  const ES = window.ES, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const fmt = ES.fmt;
  const SC = ["suburb", "courtyard", "mainstreet", "campus", "industrial"];
  const NAMES = { suburb: "Suburban houses", courtyard: "Apartment courtyard", mainstreet: "Main street", campus: "Campus", industrial: "Industrial area" };
  const AGN = { dog_0: "Quadruped robot", uav_0: "UAV", rover_0: "Delivery robot", human_0: "Responder", human_1: "Pedestrian 1", human_2: "Resident (standing)", human_3: "Person calling for help (waving)", human_4: "Person on the ground", cp: "Command post" };
  const videoOf = (s) => (s === "suburb" ? "media/episode.mp4" : `media/ep_${s}.mp4`);
  const exists = async (u) => { try { const r = await fetch(u, { method: "HEAD" }); return r.ok; } catch (e) { return false; } };

  /* ====================== replay ====================== */
  const RP = { scene: "suburb", t: 22, playing: false, speed: 1, last: 0, ep: null, W: null, sc: null, video: null, hasVideo: false };
  async function replayInit() {
    const root = $("#replay-root");
    root.innerHTML = `<div class="row"><h3>Episode replay</h3><div class="seg" id="rp-scenes" style="max-width:640px">${SC.map((s) => `<button data-s="${s}" aria-pressed="${s === RP.scene}">${NAMES[s]}</button>`).join("")}</div></div>
      <div class="split"><div><div class="replaymap"><canvas id="rp-map"></canvas></div>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="rp-play">▶ Play</button><input type="range" id="rp-t" min="0" max="100" step="0.2" value="22" style="flex:1;min-width:140px"><span class="mono" id="rp-time">22.0 s</span>
          <select id="rp-speed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option></select></div>
        <div class="note" id="rp-note" style="margin-top:6px"></div></div>
      <div class="sec"><figure id="rp-fig"><video id="rp-video" controls muted playsinline preload="auto"></video><figcaption id="rp-vcap"></figcaption></figure>
        <div class="card" id="rp-info"></div><div id="rp-audio"></div></div></div>`;
    $$("#rp-scenes button").forEach((b) => b.addEventListener("click", () => replayScene(b.dataset.s)));
    $("#rp-play").addEventListener("click", () => { RP.playing = !RP.playing; RP.last = performance.now(); $("#rp-play").textContent = RP.playing ? "❚❚ Pause" : "▶ Play"; const v = $("#rp-video"); if (RP.hasVideo) { if (RP.playing && inWin(RP.t)) { seekVideo(true); v.play().catch(() => {}); } else v.pause(); } });
    $("#rp-t").addEventListener("input", (e) => { RP.t = +e.target.value; seekVideo(true); rpDraw(); });
    $("#rp-speed").addEventListener("change", (e) => { RP.speed = +e.target.value; const v = $("#rp-video"); v.playbackRate = RP.speed; });
    RP.map = new ES.MapView($("#rp-map"), { entities: () => [], selected: () => null, tool: () => null, select() {}, place() {}, changed() {}, cursor() {}, remove() {} });
    requestAnimationFrame(rpTick); await replayScene(RP.scene);
  }
  const win = () => (RP.ep ? RP.ep.window : [22, 34]); const inWin = (t) => t >= win()[0] && t <= win()[1];
  async function replayScene(s) {
    RP.scene = s; $$("#rp-scenes button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === s));
    const [sc, ep] = await Promise.all([ES.loadJSON(`${ES.DATA_DIR}/scene_${s}.json`), ES.loadJSON(`${ES.DATA_DIR}/episode_${s}.json`)]); RP.sc = sc; RP.ep = ep; RP.W = new ES.World(sc, "day"); RP.map.setScene(sc, RP.W);
    const T = Math.max(...Object.values(ep.agents).map((a) => (a.n - 1) * ep.dt)); const sl = $("#rp-t"); sl.max = Math.min(T, 300); RP.t = ep.window[0]; sl.value = RP.t;
    const v = $("#rp-video"); RP.hasVideo = await exists(videoOf(s)); v.style.display = RP.hasVideo ? "block" : "none"; if (RP.hasVideo) { ES.gate.setSrc(v, videoOf(s)); v.playbackRate = RP.speed; }
    $("#rp-vcap").textContent = RP.hasVideo ? `Six cameras (overview, dog chase, UAV chase, UAV gimbal, dog onboard, helmet), ${ep.window[0]}–${ep.window[1]} s, 5 fps.` : "The rendered video of this scene is still being generated; the map replay on the left comes from the same episode trajectories.";
    $("#rp-note").textContent = `Trajectories come from the dynamics models (sampled every 0.2 s). Communication records cover ${ep.window[0] - 2}–${ep.window[1] + 4} s; the video covers ${ep.window[0]}–${ep.window[1]} s.`;
    rpInfo(); rpAudio(); seekVideo(true); rpDraw();
  }
  function seekVideo(force) {
    const v = $("#rp-video"); if (!RP.hasVideo || !v) return;
    if (inWin(RP.t)) { const want = RP.t - win()[0]; if (v.readyState < 1) { v.addEventListener("loadedmetadata", () => { v.currentTime = RP.t - win()[0]; }, { once: true }); v.load(); } else if (force || Math.abs(v.currentTime - want) > 0.4) v.currentTime = want; } else v.pause();
  }
  function rpTick(now) {
    requestAnimationFrame(rpTick); if (!$("#tab-replay").classList.contains("active") || !RP.ep) { RP.last = now; return; }
    if (RP.playing) { const dt = (now - RP.last) / 1000 * RP.speed; RP.last = now; const v = $("#rp-video");
      if (RP.hasVideo && inWin(RP.t) && !v.paused && v.readyState > 1) RP.t = win()[0] + v.currentTime; else RP.t += dt;
      if (RP.hasVideo && RP.playing && inWin(RP.t) && v.paused) v.play().catch(() => {}); if (RP.hasVideo && !inWin(RP.t) && !v.paused) v.pause();
      if (RP.t > +$("#rp-t").max) RP.t = win()[0]; if (RP.t < win()[0] && RP.hasVideo) { /* free-run before the window */ }
      $("#rp-t").value = RP.t; rpDraw(); }
    RP.last = now;
  }
  const idxAt = (a, ep, t) => Math.max(0, Math.min(a.n - 1, Math.round((t - a.t0) / ep.dt)));
  function rpDraw() {
    if (!RP.ep) return; const ep = RP.ep, t = RP.t; $("#rp-time").textContent = fmt(t, 1) + " s" + (inWin(t) ? " · video" : "");
    const ov = [], ents = []; let k = 0;
    for (const [id, a] of Object.entries(ep.agents)) {
      const i = idxAt(a, ep, t), p = a.pos[i], kind = a.type === "uav" ? "uav" : a.type === "ugv" ? "dog" : a.type === "ugv_wheel" ? "rover" : "human";
      const trail = []; for (let j = Math.max(0, i - 100); j <= i; j += 5) trail.push([a.pos[j][0], a.pos[j][1]]);
      ov.push({ type: "line", pts: trail, color: ES.DEVICES[kind].color, width: 1.5, dash: [] });
      ents.push({ id: k++, kind, x: p[0], y: p[1], z: p[2], yaw: a.yaw[i], name: AGN[id] || id });
      if (kind === "uav" && a.gimbal) { const g = a.gimbal[i]; ov.push({ type: "poly", pts: ES.phys.footprint({ x: p[0], y: p[1], z: p[2], yaw: g[0], pitch: -g[1], hfov: 84, aspect: 16 / 9, range: 150 }), stroke: ES.DEVICES.uav.color, fill: "rgba(204,121,167,.15)", width: 1.2, dash: [] }); }
    }
    const cp = ep.cp; ents.push({ id: k++, kind: "cp", x: cp[0], y: cp[1], z: 6, yaw: 0, name: "Command post" });
    const links = ep.phys && ep.phys.links; if (links) { const keys = Object.keys(links).map(Number).sort((a, b) => a - b), kk = keys.filter((x) => x <= t).pop(); if (kk !== undefined && t <= keys[keys.length - 1] + 2) {
      const pos = (id) => { if (id === "cp") return [cp[0], cp[1]]; const a = ep.agents[id]; if (!a) return null; const q = a.pos[idxAt(a, ep, kk)]; return [q[0], q[1]]; };
      for (const [s, d, rate, ok] of links[String(kk.toFixed ? kk.toFixed(1) : kk)] || links[kk] || []) { const a = pos(s), b = pos(d); if (a && b && ok) ov.unshift({ type: "line", pts: [a, b], color: "rgba(35,164,85,.55)", width: 1.4, dash: [] }); else if (a && b) ov.unshift({ type: "line", pts: [a, b], color: "rgba(213,94,0,.4)", width: 1, dash: [3, 5] }); } } }
    RP.map.h.entities = () => ents; RP.map.overlays = ov; RP.map.draw();
  }
  function rpInfo() {
    const ph = (RP.ep.phys || {}), d = ph.delivery, a = ph.audit || ph.agent_audit; const el = $("#rp-info");
    el.innerHTML = `<h3>${NAMES[RP.scene]} · physical record of this episode</h3><dl class="kv">${d ? `<dt>Messages delivered</dt><dd>${d.delivered} / ${d.n} delivered</dd><dt>Median latency</dt><dd>${d.median_delay_ms} ms</dd>${Object.entries(d.by_kind).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.n} messages · median ${v.median_ms} ms</dd>`).join("")}` : ""}${a ? `<dt>Clipping audit (ground agents)</dt><dd>${Object.values(a).every((v) => !Object.values(v).some(Boolean)) ? '<span class="ok">0 in all categories</span>' : '<span class="warn">clipping found</span>'}</dd>` : ""}</dl>`;
  }
  function rpAudio() {
    const el = $("#rp-audio"), au = RP.ep.phys && RP.ep.phys.audio; if (!au || RP.scene !== "suburb") { el.innerHTML = au ? `<div class="note">Audio was exported with the dataset (data/datasets/scene_${RP.scene}/audio); the web page only embeds the listening samples of the suburb scene.</div>` : ""; return; }
    const nm = { dog_0: "Quadruped robot · 4-mic array (mixed to mono)", uav_0: "UAV · 1 mic", human_0: "Responder · binaural" };
    el.innerHTML = `<h4>What each agent hears (same moment, different ears)</h4>` + Object.entries(au).map(([k, v]) => `<div class="audio"><div class="row" style="justify-content:space-between"><b>${nm[k] || k}</b><span class="mono">${fmt(v.spl_db, 1)} dB</span></div><div class="muted" style="font-size:.84rem">${v.audible.length ? "Audible: " + v.audible.map((x) => esc(x)).join(", ") : "Hears only its own noise"}</div><audio controls preload="none" data-src="media/${k}.wav"></audio></div>`).join("") + `<div class="note">Each clip is normalised separately and does not show the real loudness; see the numbers for sound pressure levels.</div>`;
  }

  /* ====================== gallery ====================== */
  const G = { scene: "suburb", look: "day_cloud", variant: "day" };
  function galleryInit() {
    const root = $("#gallery-root");
    root.innerHTML = `<h3>Gallery and image quality</h3>
      <div class="row"><div class="seg" id="g-scenes" style="max-width:640px">${SC.map((s) => `<button data-s="${s}" aria-pressed="${s === G.scene}">${NAMES[s]}</button>`).join("")}</div>
      <div class="seg" id="g-look" style="max-width:360px"><button data-l="day_cloud" aria-pressed="true">Day</button><button data-l="night" aria-pressed="false">Night</button><button data-l="quake" aria-pressed="false">After the quake</button></div></div>
      <div class="grid2" id="g-imgs"></div>
      <div id="g-looks"></div>
      <h3>Image quality: before and after</h3><figure><img data-src="img/before_after.jpg" alt="Old vs. current render" loading="lazy"><figcaption>Same kind of camera, different episodes. Left: old pipeline, 640×360, 32 samples; right: current pipeline, 1280×720, 128 samples + guided denoising. Cloud sky, transmissive glass with interiors, 4K textures, tree level of detail and grass seams were all fixed in this round.</figcaption></figure>
      <h3>All modalities of one frame</h3><figure><img data-src="img/sensors.jpg" alt="RGB, depth, semantic, instance" loading="lazy"><figcaption>One onboard camera per row; the columns are RGB, depth (metres), semantic (road / sidewalk / grass / building / vegetation / vehicle / person / furniture …) and instance. Depth is rendered in a separate pass, without atmospheric haze.</figcaption></figure>`;
    $$("#g-scenes button").forEach((b) => b.addEventListener("click", () => { G.scene = b.dataset.s; galleryDraw(); })); $$("#g-look button").forEach((b) => b.addEventListener("click", () => { G.look = b.dataset.l; galleryDraw(); }));
    galleryDraw();
  }
  function galleryDraw() {
    $$("#g-scenes button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === G.scene)); $$("#g-look button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.l === G.look));
    const quake = G.look === "quake", v = quake ? "quake" : "day", look = quake ? "day_cloud" : G.look, views = [["aerial", "Aerial oblique"], ["street", "Street view"], ["topdown", "Top-down"]]; if (G.scene === "suburb") views.push(["yard", "Yard"]);
    $("#g-imgs").innerHTML = quake && !["suburb", "mainstreet"].includes(G.scene) ? '<p class="note">No post-quake renders for this scene yet (suburb and main street have them).</p>' : views.map(([k, n]) => `<figure><img data-src="img/${G.scene}_${v}_${look}_${k}.jpg" alt="${NAMES[G.scene]} ${n}" loading="lazy" onerror="this.closest('figure').style.display='none'"><figcaption>${NAMES[G.scene]} · ${n}${quake ? " · after the quake" : look === "night" ? " · night" : ""}</figcaption></figure>`).join("");
    $("#g-looks").innerHTML = G.scene === "suburb" && !quake ? `<h3>The same street under five lighting conditions</h3><div class="grid3">${[["day_cloud", "Partly cloudy day"], ["overcast", "Overcast"], ["sunset", "Sunset"], ["dawn", "Early morning"], ["night", "Night"]].map(([l, n]) => `<figure><img data-src="img/suburb_day_${l}_street.jpg" alt="${n}" loading="lazy"><figcaption>${n}</figcaption></figure>`).join("")}</div>` : "";
  }

  /* ====================== reference ====================== */
  function refInit() {
    const D = ES.DEVICES, rows = Object.entries(D).map(([k, d]) => `<tr><td><b>${d.label}</b></td><td>${d.sensors}</td><td class="mono">${d.tops} TOPS · ${d.tier}(${d.modes} modes)</td><td>${d.radios.map((r) => ES.RADIOS[r].label).join("<br>")}</td></tr>`).join("");
    $("#ref-root").innerHTML = `<h3>Reference</h3>
      <div class="note">All interactive computation on this page runs in your browser, using a compact version of the full Python physics engine. For accuracy comparisons see "How far can these numbers be trusted?" at the bottom right of the lab.</div>
      <h3>How to operate the first-person walk-through</h3><div class="tw"><table class="big"><tr><th>Action</th><th>Effect</th></tr>
        <tr><td>Click "🚶 First-person walk-through" on the map, then click a spot (or double-click the map)</td><td>Stand there, facing the direction you clicked</td></tr>
        <tr><td>Drag the mouse / finger</td><td>Look around (like street view: "grab the world")</td></tr>
        <tr><td>W A S D (or ↑ ↓ with A D) · Shift</td><td>Forward / back / strafe · run</td></tr>
        <tr><td>Q E (or ← →)</td><td>Turn on the spot</td></tr>
        <tr><td>F</td><td>Open / close the nearest door or window</td></tr>
        <tr><td>Click the ground</td><td>Walk there (you are told if a wall or fence is in the way; go round through a gate)</td></tr>
        <tr><td>Scroll wheel</td><td>Zoom the view</td></tr>
        <tr><td>Space / C (UAV identity)</td><td>Climb / descend</td></tr>
        <tr><td>I</td><td>Inspect mode: physics card of the object under the crosshair</td></tr>
        <tr><td>Click the mini-map</td><td>Teleport; Esc returns to the top view</td></tr></table></div>
      <h3>Devices and nested-model tiers</h3><div class="tw"><table class="big"><tr><th>Device</th><th>Sensors</th><th>Compute / tier</th><th>Radios</th></tr>${rows}</table></div>
      <p class="muted" style="font-size:.85rem">Compute figures are approximations from public sources; an nested-model tier means the nested model keeps only its first 2, 8 or 32 modes.</p>
      <h3>Physics modules and validation</h3><div class="tw"><table class="big"><tr><th>Module</th><th>What it does</th><th>Validation</th></tr>
        <tr><td>Acoustics</td><td>Geometric spreading, ISO 9613-1 air absorption, roof and corner diffraction, wall transmission, Doppler, per-path propagation; 53 source types</td><td class="mono">26 checks against analytic solutions · 271 tests, all pass</td></tr>
        <tr><td>Radio + GNSS</td><td>15 radio standards, Friis / two-ray, knife-edge and Deygout, shortest path around corners, wall penetration (P.2040), shadowing and small-scale fading, multi-hop and retransmission; GNSS constellation geometry</td><td class="mono">82 checks · 21 tests, all pass</td></tr>
        <tr><td>Dynamics</td><td>Quadrotor, quadruped, human, wheeled; grid A* and 3D voxel planning</td><td class="mono">26 tests; Go2 cross-checked with MuJoCo: feasible, needs tuning</td></tr>
        <tr><td>Vision</td><td>Cycles path tracing, RGB / depth / semantic / instance, 4K textures, leaf-card trees</td><td>Depth against the analytic geometry: predicted 4.6 m, measured 4.66 m</td></tr>
        <tr><td>Hazards</td><td>Fire spread (Rothermel), dam break (Ritter), smoke plume (Gaussian)</td><td class="mono">37 checks · 31 tests, all pass</td></tr>
        <tr><td>Traffic</td><td>IDM, traffic signals, pedestrians</td><td class="mono warn">2 of 16 checks outside tolerance (recorded honestly)</td></tr></table></div>
      <h3>Run the full engine on your computer</h3><pre class="code">cd sim_env
tools/venv/bin/python scripts/serve_lab.py          # open http://127.0.0.1:8765 in the browser</pre>
      <p class="muted" style="font-size:.88rem">Once the local service is running, the top right of this page shows "Local engine connected" and the lab gets two extra buttons: "Recompute with the full engine" (Python acoustics / radio / geometry) and "Render this view with Blender" (a path-traced real image).</p>
      <h3>Known limitations</h3><ul class="muted" style="font-size:.9rem"><li>The web version uses simplified models: sound has no ground interference or wind; radio has no shadowing or small-scale fading; tree crowns are treated as semi-transparent discs.</li><li>Interiors can be entered, but furniture is built from boxes, indoor light is baked and approximate, and dynamic bodies indoors are still lit by outdoor sky light; semantic masks are slightly fat on trees; terrain and distant trees extend only to ±1.7 km.</li><li>The post-quake stills render only building damage and rubble; fire, smoke and survivors exist on the map and in the experiments but are not yet in the renders.</li><li>The traffic module has 2 checks outside tolerance; the Skydio X2 endurance model is too short (13 min vs. 35 min).</li></ul>`;
  }
  ES.fidelityHTML = (f) => `<table class="big" style="min-width:0;font-size:.8rem"><tr><th>Item</th><th>Samples</th><th>Difference</th></tr>${(f.cases || []).map((c) => `<tr><td>${esc(c.name)}</td><td class="mono">${c.n}</td><td class="mono">${esc(c.result)}</td></tr>`).join("")}</table><div class="note">${esc(f.note || "")}</div>`;

  ES.tabs = { replayInit, galleryInit, refInit, RP };
})();
