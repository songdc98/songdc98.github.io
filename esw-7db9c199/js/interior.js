/* interior.js -> ES.interior: behaviour of building interiors (interiors agent). Docs: web/docs/interiors.md
   * outdoor light model -> uniforms of the baked interior lighting (sky irradiance through the windows, ground radiance, sun bounce per room)
   * rooms: per-room light switches, global power cut, emissive fixtures that match the state, G key + HUD chips, ES.interior.lightOn(bld, index, light) for the sensors
   * eye adaptation: exposure of the human view from the luminance actually in view (rays against the BIM, baked light + sun)
   * statistics: ES.interior.stats() = daylight factor and mean floor / wall / ceiling luminance per room
   Units: the environment module's "units" (1 unit of irradiance = ES.env.luxPerUnit lux; a white diffuse surface under E units has radiance E / pi units). */
(function () {
  const ES = (window.ES = window.ES || {});
  const I = (ES.interior = ES.interior || {});
  const PI = Math.PI, clamp = (v, a, b) => (v < a ? a : v > b ? b : v), lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const st = { power: true, V: null, lpu: 20000, ev: 15.4, up: [1, 1, 1], down: [0.1, 0.1, 0.1], sunDir: [0, 0, 1], sunE: [0, 0, 0], night: false, ctxKey: null, roomOf: null, here: -1, eye: 1, eyeLog: 0, dirty: true, bounceKey: "", view: { L: 0, n: 0, t: 0 }, tView: 0, adapt: true, lmScale: 1 };
  I.state = st;
  const lm = () => ES.lightmap, ctx = () => (ES.lightmap && ES.lightmap.ctx);

  /* ---------------------------------------------------------------- lamp colour ---------------------------------------------------------------- */
  const lin1 = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  function cctRGB(K) {                          // linear RGB of a blackbody-like lamp at K, normalised to luminance 1 (Tanner Helland fit)
    const t = clamp(K, 1500, 12000) / 100; let r, g, b;
    r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592); g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    const c = [lin1(clamp(r, 0, 255)), lin1(clamp(g, 0, 255)), lin1(clamp(b, 0, 255))], y = lumOf(c); return [c[0] / y, c[1] / y, c[2] / y];
  }
  I.cctRGB = cctRGB;

  /* ---------------------------------------------------------------- outdoor light model (units) ---------------------------------------------------------------- */
  const tmpV = () => (tmpV.t || (tmpV.t = new THREE.Vector3(0, 1, 0))), tmpO = () => (tmpO.t || (tmpO.t = new THREE.Vector3()));
  function readOutdoor(V) {
    const env = ES.env, S = env && env.state, rig = S && S.cur && S.cur.rig, o = st;
    if (rig && S.cur.skyData && rig.probe) {
      o.lpu = S.lpu || 20000; o.night = !!(S.L && S.L.night); o.ev = S.ev || 15.4;
      const e = rig.probe.sh.getIrradianceAt(tmpV(), tmpO()); o.up = [Math.max(0, e.x), Math.max(0, e.y), Math.max(0, e.z)];
      o.down = S.ground ? S.ground.slice() : [0.1, 0.1, 0.1];
      const l = rig.sun[0], d = rig.dir; o.sunDir = [d.x, -d.z, d.y]; const k = Math.max(0, l.intensity) * PI; o.sunE = [l.color.r * k, l.color.g * k, l.color.b * k]; o.src = "env";
    } else if (V && V.sun) {                    // legacy lights of view3d.build()
      o.lpu = 11400; const sun = V.sun, tg = sun.target ? sun.target.position : { x: 0, y: 0, z: 0 }, dx = sun.position.x - tg.x, dy = sun.position.y - tg.y, dz = sun.position.z - tg.z, n = Math.hypot(dx, dy, dz) || 1; o.sunDir = [dx / n, -dz / n, dy / n];
      const k = sun.intensity * PI; o.sunE = [sun.color.r * k, sun.color.g * k, sun.color.b * k]; o.night = V.A && V.A.look === "night";
      let hemi = null; if (V.scene) V.scene.traverse((q) => { if (q.isHemisphereLight && !hemi) hemi = q; });
      if (hemi) { o.up = [hemi.color.r * hemi.intensity * PI, hemi.color.g * hemi.intensity * PI, hemi.color.b * hemi.intensity * PI]; const g = 0.2 * (sun.intensity * Math.max(0, o.sunDir[2]) + hemi.intensity); o.down = [g, g, g]; }
      o.src = "legacy";
    }
  }

  /* ---------------------------------------------------------------- rooms and lights ---------------------------------------------------------------- */
  const roomKey = (bid, storey, id) => bid + "/" + storey + "/" + id;
  function indexRooms() {
    const c = ctx(); if (!c || st.ctxKey === c) return; st.ctxKey = c; st.roomOf = {}; st.bounceKey = "";
    for (const r of c.rooms) { st.roomOf[roomKey(r.bid, r.storey, r.id)] = r; r.on = r.on0; r.col = cctRGB(r.cct); r.emit = r.nLights ? r.flux / r.nLights / (PI * (r.type === "pendant" ? 0.1225 : 0.25)) : 0; }     // radiance of a lit fixture face (cd/m2) = flux / (pi * emitting area)
    st.dirty = true;
  }
  function applyRoom(r) {
    const L = lm(); if (!L || !L.ctx || !L.ctx.roomData) return; const k = r.on && st.power && r.nLights > 0 ? st.lmScale : 0, c = r.col, s = k * r.flux / st.lpu, e = k * r.emit / st.lpu;
    L.setRoom(r.g, 0, c[0] * s, c[1] * s, c[2] * s); L.setRoom(r.g, 2, c[0] * e, c[1] * e, c[2] * e);
  }
  const applyAllRooms = () => { const c = ctx(); if (c) for (const r of c.rooms) applyRoom(r); };
  I.rooms = () => (ctx() ? ctx().rooms : []);
  /* multiply the luminous flux of every fixture (1 = the BIM's lm values; the BIM panels are ~10x dimmer than lighting standards ask for, see docs) */
  I.setLumenScale = (k) => { st.lmScale = Math.max(0, +k || 0); applyAllRooms(); ES.bus.emit("interior:lights", -1); };
  I.setRoom = (g, on) => { const c = ctx(); if (!c || !c.rooms[g]) return; c.rooms[g].on = !!on; applyRoom(c.rooms[g]); ES.bus.emit("interior:lights", g); };
  I.setAll = (on) => { const c = ctx(); if (!c) return; for (const r of c.rooms) r.on = !!on; applyAllRooms(); ES.bus.emit("interior:lights", -1); };
  I.reset = () => { const c = ctx(); if (!c) return; for (const r of c.rooms) r.on = r.on0; st.power = true; applyAllRooms(); ES.bus.emit("interior:lights", -1); };
  I.setPower = (on) => { st.power = !!on; applyAllRooms(); ES.bus.emit("interior:power", st.power); };
  I.hereRoom = () => (st.here >= 0 && ctx() ? ctx().rooms[st.here] : null);
  /* is fixture `li` (index in the building's lights[]) of building `bid` lit right now? (power cut and room switch; used by the sensor models) */
  I.lightOn = (bid, li, Lr) => { indexRooms(); if (!st.roomOf) return Lr ? !!Lr.on : false; const r = st.roomOf[roomKey(bid, Lr.storey, Lr.room)]; return r ? !!(r.on && st.power) : !!Lr.on; };
  I.toggleHere = () => {
    const r = I.hereRoom(); if (!r) return toast("你不在房间里");
    if (!r.nLights) return toast(`${r.name}:这间房没有灯`);
    if (!st.power) return toast("停电中:先点「来电」");
    I.setRoom(r.g, !r.on); toast(`${r.name}:灯 ${r.on ? "开" : "关"}`); updateChips();
  };
  const toast = (m) => { const t = document.getElementById("fp-toast"); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1600); };

  /* ---------------------------------------------------------------- HUD chips + key ---------------------------------------------------------------- */
  function buildChips() {
    const box = document.getElementById("fp-acts") || document.querySelector(".fp-acts"); if (!box || document.getElementById("fp-lt-room")) return;
    const mk = (id, text, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn chip-lt"; b.id = id; b.textContent = text; b.title = title; b.addEventListener("click", () => { b.blur(); fn(); updateChips(); }); box.insertBefore(b, box.querySelector("label")); return b; };
    mk("fp-lt-room", "本房间灯", "G 键:开 / 关你所在房间的灯", () => I.toggleHere());
    mk("fp-lt-all", "全部灯", "全部开灯 / 全部关灯", () => { const c = ctx(); if (!c) return; const anyOn = c.rooms.some((r) => r.on && r.nLights); if (!st.power) I.setPower(true); I.setAll(!anyOn); });
    mk("fp-power", "停电", "全局断电 / 来电(断电后所有房间的灯都灭,各房间的开关状态保留)", () => I.setPower(!st.power));
    updateChips();
  }
  function updateChips() {
    const a = document.getElementById("fp-lt-room"), b = document.getElementById("fp-lt-all"), p = document.getElementById("fp-power"); if (!a) return;
    const r = I.hereRoom(), c = ctx();
    a.textContent = !r ? "本房间灯 —" : !r.nLights ? "本房间灯 无灯" : `本房间灯 ${r.on && st.power ? "开" : "关"}`; a.classList.toggle("on", !!(r && r.on && st.power && r.nLights));
    if (c) { const n = c.rooms.filter((q) => q.on && q.nLights).length, tot = c.rooms.filter((q) => q.nLights).length; b.textContent = `全部灯 ${n}/${tot} 亮`; b.classList.toggle("on", n > 0 && st.power); }
    p.textContent = st.power ? "停电" : "来电"; p.classList.toggle("on", !st.power);
  }
  ES.bus.on("walk:enter", () => { buildChips(); indexRooms(); updateChips(); });
  ES.controls.add({ bodies: "all", group: "灯光", keys: ["G"], codes: ["KeyG"], desc: "开 / 关你所在房间的灯(面板里有 全部灯 / 停电)", fn(code, down) { if (down) { I.toggleHere(); updateChips(); } } });

  /* ---------------------------------------------------------------- sun bounce per room ----------------------------------------------------------------
     First bounce of the sun beams that enter through the windows / open doors (flux through each portal, beam landing surface albedo) spread by the integrating-sphere formula
     E = Phi * rho1 / (A (1 - rho)) over the room (the baked AO shapes it); the sun patch itself is the shadow-mapped direct light. */
  function updateBounce(force) {
    const c = ctx(), L = lm(); if (!c || !c.atlas || !c.scene || !c.roomData) return;
    const sd = st.sunDir, se = st.sunE, key = [sd[0], sd[1], sd[2]].map((v) => v.toFixed(2)).join() + "|" + se.map((v) => v.toFixed(2)).join() + "|" + (c.ready ? 1 : 0);
    if (!force && key === st.bounceKey) return; st.bounceKey = key; const kern = L.kernel(); if (!kern) return; const D = c.scene.D, alb = c.alb, matOf = c.scene.mat, sl = lumOf(se);
    for (const r of c.rooms) {
      let p0 = 0, p1 = 0, p2 = 0;
      if (sl > 1e-5 && sd[2] > 0.01 && r.wins.length) {
        for (const w of r.wins) {
          const cs = sd[0] * w.n[0] + sd[1] * w.n[1]; if (cs <= 0.03) continue;
          let T = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const u = ((i + 0.5) / 3 * 2 - 1) * w.hw, v = ((j + 0.5) / 3 * 2 - 1) * w.hh, x = w.c[0] + w.u[0] * u - w.n[0] * 0.05, y = w.c[1] + w.u[1] * u - w.n[1] * 0.05, z = w.c[2] + v; T += kern.shadow(x, y, z, x + sd[0] * 400, y + sd[1] * 400, z + sd[2] * 400); }
          T /= 9; if (T < 0.005) continue;
          const h = kern.cast(w.c[0] - w.n[0] * 0.08, w.c[1] - w.n[1] * 0.08, w.c[2], -sd[0], -sd[1], -sd[2], 40, 0), m = h.box >= 0 ? matOf[h.box * 6 + h.face] : 0, ar = m ? alb[m * 3] : r.rhoRGB[0], ag = m ? alb[m * 3 + 1] : r.rhoRGB[1], ab = m ? alb[m * 3 + 2] : r.rhoRGB[2];
          const flux = cs * 4 * w.hw * w.hh * T;                                           // m2 of beam cross-section x transmittance (the glass 0.85 is in the shadow ray)
          p0 += flux * se[0] * ar; p1 += flux * se[1] * ag; p2 += flux * se[2] * ab;
        }
      }
      const A = Math.max(1, r.aSurf), q = r.rhoRGB; L.setRoom(r.g, 1, p0 / (A * (1 - q[0])), p1 / (A * (1 - q[1])), p2 / (A * (1 - q[2])));
    }
    L.flush();
  }
  I.updateBounce = updateBounce;

  /* ---------------------------------------------------------------- luminance of a view (units) ---------------------------------------------------------------- */
  const VW = 9, VH = 6, _o = { E: null }, vtmp = { d: [0, 0, 0] };
  /* luminance of the surface hit by a ray (units of radiance), including the sun patch; hit = kernel cast result; null ray results are sky / ground */
  function hitLum(c, kern, hit, ox, oy, oz, dx, dy, dz) {
    const sd = st.sunDir, se = st.sunE, skyL = lumOf(st.up), sunL = lumOf(se);
    if (hit.box < 0) return dz > 0 ? skyL * 3 * (1 + 2 * dz) / (7 * PI) : lumOf(st.down);
    const hx = ox + dx * hit.t, hy = oy + dy * hit.t, hz = oz + dz * hit.t, lm_ = lm(), o = lm_.sample(hit.box, hit.face, hx, hy, hz, _o);
    const D = c.scene.D, b = hit.box * 16, k = hit.face >> 1, sg = hit.face & 1 ? -1 : 1, nx = D[b + 3 + 3 * k] * sg, ny = D[b + 4 + 3 * k] * sg, nz = D[b + 5 + 3 * k] * sg;
    if (o) {
      let E = lumOf(o.E) * 1, rho = lumOf(o.rho), cs = nx * sd[0] + ny * sd[1] + nz * sd[2];
      if (sunL > 1e-5 && cs > 0.02 && kern.shadow(hx + nx * 0.02, hy + ny * 0.02, hz + nz * 0.02, hx + sd[0] * 300, hy + sd[1] * 300, hz + sd[2] * 300) > 0.3) E += sunL * cs;
      return rho * E / PI;
    }
    const m = c.scene.mat[hit.box * 6 + hit.face], rho = m ? lumOf([c.alb[m * 3], c.alb[m * 3 + 1], c.alb[m * 3 + 2]]) : 0.3, cs = Math.max(0, nx * sd[0] + ny * sd[1] + nz * sd[2]);
    return rho * (sunL * cs + skyL * (0.5 + 0.5 * nz)) / PI;
  }
  function viewLum(V) {
    const c = ctx(), L = lm(); if (!c || !c.atlas || !L.kernel) return null; const kern = L.kernel(); if (!kern) return null;
    const cam = V.cam; cam.updateMatrixWorld(); const e = cam.matrixWorld.elements, th = Math.tan((cam.fov * PI / 180) / 2), ta = th * cam.aspect, cp = cam.position, ox = cp.x, oy = -cp.z, oz = cp.y;
    let sw = 0, sl = 0, nIn = 0;
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const u = ((i + 0.5) / VW * 2 - 1) * ta * 0.92, v = ((j + 0.5) / VH * 2 - 1) * th * 0.92, w = Math.exp(-(u * u / (ta * ta) + v * v / (th * th)) * 0.9);
      let x = -e[8] + e[0] * u + e[4] * v, y = -e[9] + e[1] * u + e[5] * v, z = -e[10] + e[2] * u + e[6] * v; const n = Math.hypot(x, y, z); x /= n; y /= n; z /= n;
      const dx = x, dy = -z, dz = y, hit = kern.cast(ox, oy, oz, dx, dy, dz, 600, 0); if (hit.box >= 0 && hit.t < 40) nIn++;
      const Lh = hitLum(c, kern, hit, ox, oy, oz, dx, dy, dz); sw += w; sl += w * Math.log(Math.max(Lh, 1e-6));
    }
    return { L: Math.exp(sl / sw), n: nIn / (VW * VH) };
  }
  I.viewLuminance = () => { const V = st.V; return V ? viewLum(V) : null; };

  /* ---------------------------------------------------------------- per-frame update (called from view3d updateWorld) ---------------------------------------------------------------- */
  I.update = function (dt, V, inside) {
    st.V = V; const L = lm(), c = ctx();
    if (!L || !c || !c.atlas || !L.U.lmT0 || !c.roomData) return null;
    indexRooms(); if (V.roomLights) for (const pl of V.roomLights) pl.visible = false;            // the old unshadowed point lights leaked through walls: the baked room lights replace them
    readOutdoor(V);
    const U = L.U; U.lmSkyUp.value.set(st.up[0], st.up[1], st.up[2]); U.lmSkyDown.value.set(st.down[0], st.down[1], st.down[2]);
    const cp = V.cam.position, rr = V.col.roomAt(cp.x, -cp.z, cp.y - 0.2); let here = -1;
    if (rr && rr.room) { const q = st.roomOf[roomKey(rr.b.id, rr.room.storey, rr.room.id)]; if (q) here = q.g; }
    if (here !== st.here) { st.here = here; updateChips(); }
    if (st.dirty || st.lpuApplied !== st.lpu) { st.lpuApplied = st.lpu; applyAllRooms(); st.dirty = false; }
    updateBounce(false); L.flush();
    if (ES.env && ES.env.state) ES.env.state.aoK = inside ? 0 : 1;           // screen-space AO (env.js) would double the baked AO indoors and its large radius smears dark bands over wall / floor junctions
    return eyeExposure(dt, V, inside);
  };
  ES.bus.on("lightmap:ready", () => { st.dirty = true; st.bounceKey = ""; });

  /* ---------------------------------------------------------------- eye adaptation ----------------------------------------------------------------
     Indoors the exposure follows the log-average luminance in view (centre weighted) towards mid grey of the current look (0.125 * 2^EV100 cd/m2), almost fully (gamma 0.92), 1 .. 200x (a dim room at night is seen as the eye sees it);
     outdoors the look's own EV applies (factor 1). Dark adaptation is slower than light adaptation. */
  function eyeExposure(dt, V, inside) {
    const now = performance.now(); let tgt = 1;
    if (inside && st.adapt) {
      if (now - st.tView > 60) { st.tView = now; const v = viewLum(V); if (v) st.view = v; }
      const mid = 0.125 * Math.pow(2, st.ev) / st.lpu, ratio = mid / Math.max(st.view.L, 1e-6); tgt = clamp(Math.pow(Math.max(1, ratio), 0.92), 1, 200);
    }
    const cur = Math.log(st.eye), want = Math.log(tgt), rate = want > cur ? 1.1 : 3.2; st.eyeLog = cur + (want - cur) * Math.min(1, dt * rate); st.eye = Math.exp(st.eyeLog); return st.eye;
  }

  /* ---------------------------------------------------------------- statistics ---------------------------------------------------------------- */
  /* ES.interior.stats({rooms: [global room indices] | null, step: texel stride, sun: true}) -> [{g, bld, storey, name, fn, area, lights, on, df (%), Ework (lux, sky only at table height, else floor), floor / wall / ceil: {E (lux), L (cd/m2)}, lum (cd/m2 mean)}]
     Illuminance = baked sky (current sky colour) + fixtures (current switches) + sun bounce + direct sun on the sampled texels (shadow rays); luminance = albedo * E / pi. */
  I.stats = function (opt = {}) {
    const c = ctx(), L = lm(); if (!c || !c.atlas) return []; readOutdoor(st.V); const kern = L.kernel(), lpu = st.lpu, sd = st.sunDir, se = st.sunE, sunL = lumOf(se), a = c.atlas, fh = L.fromHalf;
    const want = opt.rooms ? new Set(opt.rooms) : null, out = [], step = opt.step || 1;
    for (const id of c.order) {
      const lay = c.layouts[id]; if (!lay.nt) continue; if (want && !c.rooms.slice(lay.roomBase, lay.roomBase + lay.nRooms).some((r) => want.has(r.g))) continue;
      const jid = L.job(id), J = kern.getJob(jid), acc = c.rooms.slice(lay.roomBase, lay.roomBase + lay.nRooms).map(() => ({ fl: [0, 0, 0], wa: [0, 0, 0], ce: [0, 0, 0], dfA: 0, dfS: 0, dfF: 0, dfFa: 0 }));
      for (let q = 0; q < lay.nf; q++) {
        const r = lay.fRoom[q], R = c.rooms[lay.roomBase + r]; if (want && !want.has(R.g)) continue; const nz = lay.fNz[q], cls = nz > 0.7 ? "fl" : nz < -0.7 ? "ce" : Math.abs(nz) < 0.3 ? "wa" : null; if (!cls) continue;
        const nx = lay.fNx[q], ny = lay.fNy[q], pad = lay.fPad[q], area = lay.fArea[q] / (nx * ny), m = lay.B.boxes[lay.fBox[q]][8 + lay.fFace[q]], rho = [c.alb[m * 3], c.alb[m * 3 + 1], c.alb[m * 3 + 2]], A = acc[r];
        for (let j = 0; j < ny; j += step) for (let i = 0; i < nx; i += step) {
          const t = lay.fBase[q] + j * nx + i, o = ((lay.y0 + lay.fY[q] + pad + j) * a.W + lay.fX[q] + pad + i) * 4, w = area * step * step;
          const up = [fh(a.d0[o]), fh(a.d0[o + 1]), fh(a.d0[o + 2])], art = [fh(a.d1[o]), fh(a.d1[o + 1]), fh(a.d1[o + 2])], dn = fh(a.d0[o + 3]), room = lay.roomBase + r, rd = c.roomData, n = c.rooms.length;
          const E = [0, 1, 2].map((k) => st.up[k] * up[k] + st.down[k] * dn + art[k] * rd[room * 4 + k] + rd[(n + room) * 4 + k] * fh(a.d2[o + 1]));
          if (sunL > 1e-5 && opt.sun !== false) { const px = J.P[t * 3], py = J.P[t * 3 + 1], pz = J.P[t * 3 + 2], nxv = J.fN[q * 3], nyv = J.fN[q * 3 + 1], nzv = J.fN[q * 3 + 2], cs = nxv * sd[0] + nyv * sd[1] + nzv * sd[2]; if (cs > 0.02 && kern.shadow(px + nxv * 0.02, py + nyv * 0.02, pz + nzv * 0.02, px + sd[0] * 300, py + sd[1] * 300, pz + sd[2] * 300) > 0.3) for (let k = 0; k < 3; k++) E[k] += se[k] * cs; }
          const Lum = lumOf([rho[0] * E[0], rho[1] * E[1], rho[2] * E[2]]) / PI, Elux = lumOf(E);
          const cc = A[cls]; cc[0] += w; cc[1] += w * Elux * lpu; cc[2] += w * Lum * lpu;
          if (cls === "fl") { const zrel = J.P[t * 3 + 2] - R.z0; if (zrel < 0.12) { A.dfF += w * lumOf(up); A.dfFa += w; } }
          else if (nz > 0.7) { /* never reached: only floors and ceilings are classed by normal */ }
        }
      }
      // work plane: upward-facing texels (tables, desks, counters) 0.6 .. 1.0 m above the floor
      for (let q = 0; q < lay.nf; q++) {
        if (lay.fNz[q] < 0.9) continue; const r = lay.fRoom[q], R = c.rooms[lay.roomBase + r]; if (want && !want.has(R.g)) continue; const nx = lay.fNx[q], ny = lay.fNy[q], pad = lay.fPad[q], area = lay.fArea[q] / (nx * ny), A = acc[r];
        for (let j = 0; j < ny; j += step) for (let i = 0; i < nx; i += step) { const t = lay.fBase[q] + j * nx + i, zrel = J.P[t * 3 + 2] - R.z0; if (zrel < 0.6 || zrel > 1.0) continue; const o = ((lay.y0 + lay.fY[q] + pad + j) * a.W + lay.fX[q] + pad + i) * 4, w = area * step * step; A.dfS += w * (fh(a.d0[o]) + fh(a.d0[o + 1]) + fh(a.d0[o + 2])) / 3; A.dfA += w; }
      }
      acc.forEach((A, r) => {
        const R = c.rooms[lay.roomBase + r]; if (want && !want.has(R.g)) return; const g = (k) => ({ area: +A[k][0].toFixed(2), E: A[k][0] ? +(A[k][1] / A[k][0]).toFixed(1) : 0, L: A[k][0] ? +(A[k][2] / A[k][0]).toFixed(2) : 0 });
        const df = A.dfA > 0.3 ? A.dfS / A.dfA : A.dfFa > 0 ? A.dfF / A.dfFa : 0, tot = A.fl[0] + A.wa[0] + A.ce[0];
        out.push({ g: R.g, bld: R.bid, storey: R.storey, name: R.name, fn: R.fn, area: R.area, lights: R.nLights, on: !!(R.on && st.power), windows: R.wins.length, glazing: R.wins.reduce((s, p) => s + 4 * p.hw * p.hh, 0) / Math.max(R.area, 1), df: +(df * 100).toFixed(2), dfFloor: A.dfFa > 0 ? +(A.dfF / A.dfFa * 100).toFixed(2) : 0, dfSrc: A.dfA > 0.3 ? "work plane" : "floor", floor: g("fl"), wall: g("wa"), ceil: g("ce"), lum: tot ? +((A.fl[2] + A.wa[2] + A.ce[2]) / tot).toFixed(2) : 0 });
      });
    }
    return out;
  };
})();
