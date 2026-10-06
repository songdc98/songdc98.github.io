/* First-person walk UI: entering from the map, HUD, mini-map, "standing here" info (who sees you / link to the command post / who hears a shout). */
(function () {
  const ES = window.ES, P = ES.phys, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const L = () => ES.lab, A = () => ES.lab.A, esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const st = { active: false, mini: null, miniS: 0, lastInfo: 0, entity: null, toastT: 0 };

  const HINT = { human: "Drag to look · click the ground to walk · scroll to zoom · mini-map to teleport", dog: "Drag to look · click the ground to walk · scroll to zoom · mini-map to teleport", uav: "Drag to aim the gimbal · scroll to zoom · mini-map to teleport" };

  /* ---- identity list + key legend (both drawn from ES.controls.IDENT, the table the keyboard handler uses) ---- */
  const ID = () => ES.controls.IDENT;
  function buildIdent() {
    const box = $("#fp-idlist"); if (box.children.length) return;
    for (const [id, I] of Object.entries(ID())) {
      const b = document.createElement("button"); b.type = "button"; b.className = "idcard"; b.dataset.id = id; b.setAttribute("role", "radio"); b.style.setProperty("--idc", I.color);
      b.innerHTML = `<span class="ico" aria-hidden="true">${I.icon}</span><b>${esc(I.title)}</b><span class="tag">Current ✓</span><span class="go">Click to switch</span><small>${esc(I.spec)}</small><small>Sensors: ${esc(I.sensors)}</small>`;
      b.addEventListener("click", () => { b.blur(); setIdentity(id); });
      box.appendChild(b);
    }
  }
  function renderKeys(body) {
    const I = ID()[body]; $("#fp-keys-h").innerHTML = `Controls<span>You are now <b style="color:${I.color}">${esc(I.name)}</b>; use these keys</span>`;
    $("#fp-keys").innerHTML = ES.controls.groupsFor(body).map((g) => `<div class="kg"><h5>${esc(g.title)}</h5>${g.items.map((it) => `<div class="kr"><span class="kcs">${it.keys.map((lab, i) => { const code = (it.codes || [])[i]; return `<span class="kc${code ? "" : " mouse"}"${code ? ` data-code="${code}"` : ""}>${esc(lab)}</span>`; }).join("")}</span><span class="kd">${esc(it.desc)}</span></div>`).join("")}</div>`).join("");
    $$("#fp-keys .kc[data-code]").forEach((el) => el.addEventListener("click", () => { const code = el.dataset.code; window.dispatchEvent(new KeyboardEvent("keydown", { code })); setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { code })), 140); }));
  }
  function showIdentity(body) {
    buildIdent(); $$("#fp-idlist .idcard").forEach((c) => c.setAttribute("aria-checked", c.dataset.id === body ? "true" : "false"));
    renderKeys(body); $("#fp-own-who").textContent = `· ${ID()[body].name}`; $("#fp-hint").textContent = HINT[body]; ES.bus.emit("fpbody", body);
  }
  function setIdentity(body) { ES.view3d.walk.setBody(body); showIdentity(body); info({ ...ES.view3d.walk.state, z: ES.view3d.walk.state.z }); toast(`You are now: ${ID()[body].name}`); }
  ES.controls.onPress((code, down) => { $$(`#fp-keys .kc[data-code="${code}"]`).forEach((el) => el.classList.toggle("on", down)); });
  /* the own-device readouts (speed, heading, battery, link, GNSS, IMU, light ...) are drawn by hudpanels.js (ES.hud) from the walk:frame hook */
  const tele = (s) => { if (ES.hud && ES.hud.tele) ES.hud.tele(s); };
  const toast = (msg) => { const t = $("#fp-toast"); t.textContent = msg; t.hidden = false; clearTimeout(st.toastT); st.toastT = setTimeout(() => (t.hidden = true), 1800); };

  /* a square snapshot of the map (base layer only) for the mini-map */
  function snapMini() {
    const a = A(), m = a.map, S = a.scene.size; m.overlays = []; m.fit(); m.draw();
    const k = m.dpr, [x0, y0] = m.w2s(0, S), sw = S * m.view.s * k; const c = document.createElement("canvas"); c.width = c.height = 360; c.getContext("2d").drawImage(m.base, x0 * k, y0 * k, sw, sw, 0, 0, 360, 360); st.mini = c; st.miniS = S;
  }
  function drawMini(s) {
    const a = A(), g = $("#fp-mini").getContext("2d"), S = st.miniS || a.scene.size, f = (x, y) => [(x / S) * 360, (1 - y / S) * 360];
    if (st.mini) g.drawImage(st.mini, 0, 0); else { g.fillStyle = "#222"; g.fillRect(0, 0, 360, 360); }
    for (const e of a.ents) { const [x, y] = f(e.x, e.y), sty = a.map.entityStyle(e); g.fillStyle = sty.color; g.beginPath(); g.arc(x, y, 7, 0, 6.3); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); }
    const [px, py] = f(s.x, s.y), r = 16;                                                       // you: red dot with a view wedge
    g.fillStyle = "rgba(225,29,72,.35)"; g.beginPath(); g.moveTo(px, py); g.arc(px, py, 44, -(s.yaw + 0.65), -(s.yaw - 0.65)); g.closePath(); g.fill();
    g.fillStyle = "#e11d48"; g.beginPath(); g.arc(px, py, 9, 0, 6.3); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke();
  }

  /* what the lab's physics says about standing here */
  function info(s) {
    const a = A(), W = a.W, lab = L(), body = s.body, z = body === "uav" ? s.z : body === "dog" ? 0.4 : 1.0, out = [];
    const cams = lab.viewData().cams.filter((cc) => !(st.entity && cc.e.id === st.entity.id)), me = { kind: "t:person", x: s.x, y: s.y, z };
    const by = cams.filter((cc) => lab.seen(cc, me) > 0.25).map((cc) => cc.e.name);
    out.push(`<div>📍 <span class="mono">${s.x.toFixed(1)}, ${s.y.toFixed(1)} m</span>${body === "uav" ? ` · alt <span class="mono">${s.z.toFixed(0)} m</span>` : ""}</div>`);
    out.push(`<div>👁 ${cams.length ? (by.length ? `<b class="ok">${by.length} camera(s) can see you</b>: ${esc(by.join(", "))}` : `<b class="bad">No camera can see you</b>`) : `<span class="muted">Place camera-carrying agents and this line will show who can see you</span>`}</div>`);
    const cp = a.ents.find((e) => e.kind === "cp");
    if (cp) {
      P.FAST = true; const dev = ES.DEVICES[body === "uav" ? "uav" : body === "dog" ? "dog" : "human"], meNode = { id: -9, name: "You", x: s.x, y: s.y, z: body === "uav" ? s.z : dev.antH, radios: dev.radios, kind: body === "uav" ? "uav" : body === "dog" ? "dog" : "human" };
      const nodes = [lab.node(cp), meNode], links = P.network(W, nodes); P.FAST = false; const l = links[0];
      out.push(`<div>📡 Link to the command post: ${l && l.good > 0 ? `<b class="ok">${ES.fmt(l.good, l.good < 10 ? 1 : 0)} Mbit/s</b> · ${esc(l.tech)} · ${l.los ? "line of sight" : "obstructed"}` : `<b class="bad">no link</b>`}</div>`);
    }
    // a shout from here (92 dB(A) at 1 m): who among the placed agents hears it?
    const src = { x: s.x, y: s.y, z: body === "uav" ? s.z : 1.5, l1m: 92 }, amb = lab.ambient(), heard = [];
    for (const e of a.ents) { if (!ES.DEVICES[e.kind] || (st.entity && e.id === st.entity.id)) continue; const zr = e.kind === "uav" ? e.z : e.kind === "cp" ? 3 : e.kind === "dog" ? 0.3 : 1.6; const lp = P.soundAt(W, src, e.x, e.y, zr, null).Lp; if (lp - P.NOISE_FLOOR(e.kind, amb) >= 0) heard.push(e.name); }
    out.push(`<div>🗣 If you shout: ${heard.length ? `<b class="ok">${esc(heard.join(", "))}</b> can hear you` : `<b class="bad">nobody can hear you</b>`}</div>`);
    $("#fp-info").innerHTML = out.join("");
  }

  async function enter(x, y, opts = {}) {
    const a = A(), lab = L(); if (!a.W) return;
    const e = opts.entity || null, sel = lab.byId(a.sel), kindOf = (q) => (q && (q.kind === "dog" || q.kind === "uav") ? q.kind : "human");
    const body = opts.body || kindOf(e || sel), S = a.scene.size;
    // facing: the entity's heading, otherwise from the previous spot / map centre toward the clicked point
    let yaw = opts.yaw ?? (e ? e.yaw : undefined);
    if (yaw === undefined) { const from = a.walker || { x: S / 2, y: S / 2 }; yaw = Math.hypot(x - from.x, y - from.y) > 3 ? Math.atan2(y - from.y, x - from.x) : Math.atan2(S / 2 - y, S / 2 - x); }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    snapMini();
    $("#map").style.visibility = "hidden"; $("#btn-walk").hidden = true; $("#legend").style.display = "none"; $("#cursor").hidden = true; $(".maptools").hidden = true; $("#fphud").hidden = false; document.documentElement.classList.add("fpmode");
    showIdentity(body); $("#fp-render").disabled = !ES.api; st.entity = e; st.active = true;
    $("#hint").textContent = HINT[body] || HINT.human; $("#fp-view").textContent = "Chase view";
    const ep = await (a.lives && a.lives[a.name] || a.episodes[a.name]).catch(() => null);
    const ok = await ES.view3d.walk.enter(a, { x, y, yaw, body, z: e && e.kind === "uav" ? e.z : 28, pitch: e ? e.pitch : undefined, fov: e && e.hfov, hideId: e ? e.id : null,
      hooks: { onView: (v) => { $("#fp-view").textContent = v === "chase" ? "First person" : "Chase view"; }, onMove: (s) => { a.walker = { x: s.x, y: s.y }; drawMini(s); tele(s); const now = performance.now(); if (now - st.lastInfo > 600) { st.lastInfo = now; info({ ...s, z: ES.view3d.walk.state.z }); } }, toast, requestExit: exit } });
    if (!ok) { exit(); toast("Cannot start 3D (WebGL not supported?)"); return; }
    ES.view3d.walk.setLive(ep, $("#fp-live").checked, 1); $("#v3dcap").textContent = "First-person walk-through"; a.walker = { x, y };
  }
  function exit() {
    if (!st.active) return; st.active = false; ES.view3d.walk.exit(); const a = A();
    $("#map").style.visibility = ""; $("#btn-walk").hidden = false; $("#cursor").hidden = false; $(".maptools").hidden = false; $("#fphud").hidden = true; document.documentElement.classList.remove("fpmode"); st.entity = null;
    a.map.resize(); a.map.draw(); L().recompute(); $("#hint").textContent = "Drag entities to move them; drag the white dot to change the heading. The red \"You\" dot is where you stood last; use the button next to it to go back.";
  }

  /* ---- wiring ---- */
  function wire() {
    $("#btn-walk").addEventListener("click", () => { const a = A(); a.tool = a.tool === "walk" ? null : "walk"; L().syncTool(); });
    $("#fp-exit").addEventListener("click", exit);
    $("#fp-view").addEventListener("click", (e) => { e.target.blur(); const W = ES.view3d.walk; W.setView(W.state.view === "chase" ? "fpv" : "chase"); });
    $("#fp-door").addEventListener("click", (e) => { e.target.blur(); ES.view3d.walk.toggleDoor(); });
    $("#fp-live").addEventListener("change", async (e) => { e.target.blur(); const a = A(), ep = await (a.lives && a.lives[a.name] || a.episodes[a.name]).catch(() => null); ES.view3d.walk.setLive(ep, e.target.checked, 1); });
    $("#fp-drop").addEventListener("click", () => {
      const a = A(), s = ES.view3d.walk.state, kind = s.body === "uav" ? "uav" : s.body === "dog" ? "dog" : "human", e = L().mk(kind, s.x, s.y, { yaw: s.yaw, pitch: s.body === "uav" ? s.pitch : undefined, z: kind === "uav" ? s.z : undefined });
      a.ents.push(e); a.sel = e.id; L().renderEnts(); toast(`Placed: ${e.name} (back in the top view you can run experiments with it)`);
    });
    $("#fp-render").addEventListener("click", async () => {
      const a = A(), s = ES.view3d.walk.state; if (!ES.api) return; const btn = $("#fp-render"); btn.disabled = true; toast("Rendering with Blender… (about 30 s the first time)");
      try {
        const body = { scene: a.name, variant: a.variant, look: a.look === "night" ? "night" : "day_cloud", quality: "preview", hide_owner: st.entity ? st.entity.id : null, camera: { x: s.x, y: s.y, z: s.eyeZ || 1.6, yaw: s.yaw, pitch: s.pitch, hfov: s.fov }, entities: a.ents.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, hfov: e.hfov, sound: e.sound, name: e.name })) };
        const r = await fetch(ES.api + "/api/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.status);
        const url = URL.createObjectURL(await r.blob()); const w = window.open(url, "_blank"); if (!w) { $("#renderout").innerHTML = `<figure><img src="${url}" style="width:100%"><figcaption>Blender render (${r.headers.get("X-Render-Seconds") || "?"} s)</figcaption></figure>`; toast("Rendered; see the right-hand panel"); }
      } catch (e) { toast("Render failed: " + e.message); }
      btn.disabled = false;
    });
    const mini = $("#fp-mini"); mini.addEventListener("pointerdown", (e) => { const r = mini.getBoundingClientRect(), S = A().scene.size; ES.view3d.walk.teleport(((e.clientX - r.left) / r.width) * S, (1 - (e.clientY - r.top) / r.height) * S); });
    $$("#fp-dpad button").forEach((b) => { const k = b.dataset.k; b.addEventListener("pointerdown", (e) => { e.preventDefault(); ES.view3d.walk.setKey(k, true); }); for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => ES.view3d.walk.setKey(k, false)); });
    ES.bus.on("engine", () => { $("#fp-render").disabled = false; });
  }
  ES.walkui = { enter, exit, wire, info, setIdentity };
  ES.bus.on("ready", wire);
})();
