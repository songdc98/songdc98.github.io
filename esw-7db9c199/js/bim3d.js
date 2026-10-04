/* BIM renderer: builds the three.js scene of a building from the exported oriented boxes (walls with real window / door openings, glass, floors,
   stairs, furniture, roof polygons) with PBR materials and procedural textures in metric UV. Doors are separate groups that swing about their hinge.
   Coordinates: BIM is ENU (x east, y north, z up); three.js is (x, y up, -z): p3 = (x, z, -y). */
(function () {
  const ES = window.ES = window.ES || {};
  const FL = { PHYS: 1, VIS: 2, NAV: 4, GLASS: 8, MOVABLE: 16, WALK: 32, DETAIL: 64 };
  const mkRng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const hex = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];

  /* ---------------------------------------- procedural textures (1 texture tile = `size` metres) ---------------------------------------- */
  const TEXCACHE = {};
  function canvasTex(px, draw, size, seed) {
    const c = document.createElement("canvas"); c.width = c.height = px; const g = c.getContext("2d"); draw(g, px, mkRng(seed || 1));
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.encoding = THREE.sRGBEncoding; t.userData = { size }; return t;
  }
  const mottle = (g, px, r, n, a, rmin = 0.05, rmax = 0.22) => { for (let i = 0; i < n; i++) { const x = r() * px, y = r() * px, rad = px * (rmin + (rmax - rmin) * r()), dark = r() < 0.5, gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`); gr.addColorStop(1, "rgba(128,128,128,0)"); g.fillStyle = gr; g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad); } };
  const noise = (g, px, r, n, alpha, light) => { for (let i = 0; i < n; i++) { g.globalAlpha = alpha * (0.3 + 0.7 * r()); g.fillStyle = r() < 0.5 ? `rgb(${light},${light},${light})` : "#000"; const s = 1 + r() * 2.4; g.fillRect(r() * px, r() * px, s, s); } g.globalAlpha = 1; };
  const PATTERNS = {   // name -> [tile size m, draw(g, px, rnd)]  ; patterns are drawn in greyscale-friendly white so that the material colour tints them
    brick: [1.2, (g, px, r) => { g.fillStyle = "#cfc9c0"; g.fillRect(0, 0, px, px); const ch = px / 16, bw = px * 0.215 / 1.2 + px * 0.01 / 1.2; for (let j = 0; j < 16; j++) { const off = (j % 2) * bw / 2; for (let i = -1; i < px / bw + 1; i++) { const sh = 0.78 + 0.22 * r(); g.fillStyle = `rgb(${255 * sh | 0},${(250 * sh) | 0},${(244 * sh) | 0})`; g.fillRect(i * bw + off + 1.2, j * ch + 1.2, bw - 2.4, ch - 2.4); } } noise(g, px, r, 2600, 0.12, 40); }],
    plaster: [2.0, (g, px, r) => { g.fillStyle = "#f4f4f4"; g.fillRect(0, 0, px, px); mottle(g, px, r, 60, 0.07); noise(g, px, r, 5000, 0.035, 0); }],
    siding: [1.44, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); const n = 8, h = px / n; for (let j = 0; j < n; j++) { const gr = g.createLinearGradient(0, j * h, 0, (j + 1) * h); gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.82, "#f0f0f0"); gr.addColorStop(1, "#9a9a9a"); g.fillStyle = gr; g.fillRect(0, j * h, px, h - 1); } noise(g, px, r, 3000, 0.05, 0); }],
    concrete: [2.0, (g, px, r) => { g.fillStyle = "#eaeaea"; g.fillRect(0, 0, px, px); mottle(g, px, r, 90, 0.09, 0.03, 0.16); noise(g, px, r, 7000, 0.05, 0); g.strokeStyle = "rgba(0,0,0,.22)"; g.lineWidth = 2; g.strokeRect(1, 1, px - 2, px - 2); }],
    metal_rib: [1.2, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); for (let x = 0; x < px; x += px / 8) { const gr = g.createLinearGradient(x, 0, x + px / 8, 0); gr.addColorStop(0, "#9a9a9a"); gr.addColorStop(0.3, "#ffffff"); gr.addColorStop(0.7, "#e8e8e8"); gr.addColorStop(1, "#8a8a8a"); g.fillStyle = gr; g.fillRect(x, 0, px / 8, px); } }],
    wood_floor: [1.2, (g, px, r) => { const n = 10, w = px / n; g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); for (let i = 0; i < n; i++) { let y = -r() * px * 0.5; while (y < px) { const L = px * (0.45 + 0.4 * r()), sh = 0.8 + 0.2 * r(); g.fillStyle = `rgb(${255 * sh | 0},${(250 * sh) | 0},${(244 * sh) | 0})`; g.fillRect(i * w + 0.8, y + 0.8, w - 1.6, L - 1.6); for (let k = 0; k < 6; k++) { g.strokeStyle = "rgba(60,30,10,.12)"; g.lineWidth = 1; g.beginPath(); const yy = y + r() * L; g.moveTo(i * w + 2, yy); g.lineTo(i * w + w - 2, yy + (r() - 0.5) * 6); g.stroke(); } y += L; } } }],
    wood: [1.0, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(70,40,15,${0.06 + 0.12 * r()})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const x = r() * px; g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 30, px * 0.3, x + (r() - 0.5) * 30, px * 0.7, x + (r() - 0.5) * 20, px); g.stroke(); } }],
    carpet: [1.0, (g, px, r) => { g.fillStyle = "#f2f2f2"; g.fillRect(0, 0, px, px); mottle(g, px, r, 50, 0.05); noise(g, px, r, 26000, 0.05, 0); }],
    tile: [1.2, (g, px, r) => { g.fillStyle = "#9a9a96"; g.fillRect(0, 0, px, px); const n = 4, s = px / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const sh = 0.9 + 0.1 * r(); g.fillStyle = `rgb(${255 * sh | 0},${(255 * sh) | 0},${(252 * sh) | 0})`; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); } }],
    shingle: [1.5, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); const rows = 12, h = px / rows; for (let j = 0; j < rows; j++) { for (let i = 0; i < 10; i++) { const x = i * px / 10 + (j % 2) * px / 20, sh = 0.7 + 0.3 * r(); g.fillStyle = `rgb(${255 * sh | 0},${(255 * sh) | 0},${(255 * sh) | 0})`; g.fillRect(x + 1, j * h + 1, px / 10 - 2, h - 1.5); } g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, (j + 1) * h - 2, px, 2); } noise(g, px, r, 6000, 0.12, 0); }],
    tile_roof: [1.2, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); const n = 8, w = px / n; for (let j = 0; j < 10; j++) for (let i = 0; i < n + 1; i++) { const x = i * w + (j % 2) * w / 2 - w / 2, y = j * px / 10, sh = 0.78 + 0.22 * r(); const gr = g.createLinearGradient(x, y, x + w, y); gr.addColorStop(0, `rgba(0,0,0,${0.25})`); gr.addColorStop(0.5, `rgba(255,255,255,0.0)`); gr.addColorStop(1, `rgba(0,0,0,.3)`); g.fillStyle = `rgb(${255 * sh | 0},${(255 * sh) | 0},${(255 * sh) | 0})`; g.fillRect(x, y, w, px / 10); g.fillStyle = gr; g.fillRect(x, y, w, px / 10); } }],
    membrane: [2.0, (g, px, r) => { g.fillStyle = "#f0f0f0"; g.fillRect(0, 0, px, px); mottle(g, px, r, 70, 0.08); noise(g, px, r, 6000, 0.05, 0); }],
    fabric: [0.6, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); g.strokeStyle = "rgba(0,0,0,.09)"; g.lineWidth = 1; for (let i = 0; i < px; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, px); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(px, i); g.stroke(); } }],
    blinds: [0.5, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); for (let j = 0; j < 12; j++) { g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(0, (j + 1) * px / 12 - 3, px, 3); } }],
    grating: [0.5, (g, px) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 3; for (let i = 0; i <= px; i += px / 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, px); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(px, i); g.stroke(); } }],
    cardboard: [0.6, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); noise(g, px, r, 4000, 0.1, 0); g.fillStyle = "rgba(255,255,255,.4)"; g.fillRect(0, px * 0.45, px, px * 0.1); }],
    stone: [1.0, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); noise(g, px, r, 9000, 0.2, 0); noise(g, px, r, 4000, 0.18, 255); }],
    steel: [1.0, (g, px, r) => { g.fillStyle = "#fff"; g.fillRect(0, 0, px, px); noise(g, px, r, 3000, 0.07, 0); }],
  };
  function texFor(name) {
    if (!name || !PATTERNS[name]) return null;
    if (TEXCACHE[name] === undefined) { const [size, draw] = PATTERNS[name]; TEXCACHE[name] = canvasTex(512, draw, size, name.length * 131); }
    return TEXCACHE[name];
  }

  /* ---------------------------------------- materials ---------------------------------------- */
  function makeMaterials(table, opts = {}) {
    const out = [], env = opts.env || null;
    for (let i = 0; i < table.length; i++) {
      const m = table[i], col = hex(m.rgb), isGlass = m.trans >= 0.1 && /glass/.test(m.name), isMetal = /metal|steel|rail|frame_dark|appliance|rack|machine|lockers|grating/.test(m.name);
      let mat = null;
      if (ES.pbr && ES.pbr.fromBim && !opts.noPbr && m.name !== "none" && m.name !== "light") {         // photographic maps / real glass (pbr.js); null = this material keeps the procedural one below
        try { mat = isGlass ? ES.pbr.glassFor(m) : ES.pbr.fromBim(m, opts); } catch (e) { console.warn("pbr", m.name, e); mat = null; }
        if (mat) { out.push(mat); continue; }
      }
      if (m.name === "none") { mat = new THREE.MeshStandardMaterial({ color: 0xff00ff }); }
      else if (m.name === "light") { mat = new THREE.MeshBasicMaterial({ color: 0xfff6dc }); }
      else if (isGlass) { mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.04, metalness: 0.0, transparent: true, opacity: m.name === "glass_frosted" ? 0.8 : Math.max(0.16, 1 - m.trans) * 0.5, envMap: env, envMapIntensity: 1.5, depthWrite: false, side: THREE.DoubleSide }); mat.userData.glass = true; }
      else if (m.trans > 0 && /curtain|blinds/.test(m.name)) { mat = new THREE.MeshStandardMaterial({ color: col, roughness: m.rough, side: THREE.DoubleSide }); }
      else { mat = new THREE.MeshStandardMaterial({ color: col, roughness: m.rough, metalness: isMetal ? 0.7 : 0.0, envMap: env, envMapIntensity: 0.45 }); }
      const t = texFor(m.tex); if (t && !isGlass && m.name !== "light") { mat.map = t; if (["brick", "siding", "shingle", "tile_roof", "metal_rib", "stone"].includes(m.tex)) { mat.bumpMap = t; mat.bumpScale = m.tex === "brick" ? 0.9 : 0.35; } }
      mat.userData.tile = t ? t.userData.size : 1; out.push(mat);
    }
    if (ES.lightmap && ES.lightmap.patchMaterials) ES.lightmap.patchMaterials(out);          // interior lighting term (lightmap.js): interior faces are lit by the baked room light, not by the outdoor sky
    return out;
  }

  /* ---------------------------------------- geometry ---------------------------------------- */
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function rotOf(yaw, roll) { const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll); return [[cy, -sy * cr, sy * sr], [sy, cy * cr, -cy * sr], [0, sr, cr]]; }
  const mv = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
  class Acc { constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; this.lu = []; this.li = []; } }
  /* append one planar quad (4 ENU points, outward normal n) to an accumulator; UV in metres; lm = {uv: 4 atlas corners | null, info: room code} from the lightmap hook */
  function quad(acc, P, n, tile, lm) {
    const base = acc.p.length / 3, flipNeeded = (() => { const a = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], b = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]]; return (a[1] * b[2] - a[2] * b[1]) * n[0] + (a[2] * b[0] - a[0] * b[2]) * n[1] + (a[0] * b[1] - a[1] * b[0]) * n[2] < 0; })();
    const Q = flipNeeded ? [P[0], P[3], P[2], P[1]] : P;
    const up = Math.abs(n[2]) > 0.7, tx = -n[1], ty = n[0], tl = Math.hypot(tx, ty) || 1;
    for (const q of Q) { acc.p.push(q[0], q[2], -q[1]); acc.n.push(n[0], n[2], -n[1]); acc.uv.push((up ? q[0] : (q[0] * tx + q[1] * ty) / tl) / tile, (up ? q[1] : q[2]) / tile); }
    { const ord = flipNeeded ? [0, 3, 2, 1] : [0, 1, 2, 3]; for (const k of ord) { if (lm && lm.uv) acc.lu.push(lm.uv[k * 2], lm.uv[k * 2 + 1]); else acc.lu.push(0, 0); acc.li.push(lm ? lm.info : 0); } }       // lightmap: atlas corner of each emitted vertex (same order as Q)
    acc.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  function boxFaces(b, accFor, mats, onlyMats, hk, bi) {
    const [cx, cy, cz, sx, sy, sz, yaw, roll] = b, R = rotOf(yaw, roll), h = [sx / 2, sy / 2, sz / 2];
    for (let f = 0; f < 6; f++) {
      const m0 = b[8 + f]; if (!m0 || (onlyMats && !onlyMats(m0))) continue; const lm = hk ? hk.face(bi, f, m0) : null, m = lm ? lm.m : m0;
      const n = mv(R, FACES[f]), ax = f >> 1, a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, sg = FACES[f][ax], P = [];
      for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const l = [0, 0, 0]; l[ax] = sg * h[ax]; l[a1] = s1 * h[a1]; l[a2] = s2 * h[a2]; const w = mv(R, l); P.push([cx + w[0], cy + w[1], cz + w[2]]); }
      quad(accFor(m), P, n, mats[m].userData.tile || 1, lm);
    }
  }
  function toGeometry(a) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(a.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(a.n, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2)); g.setIndex(a.i);
    if (ES.bim.hook && ES.lightmap && ES.lightmap.on) { const nv = a.p.length / 3; while (a.li.length < nv) { a.li.push(0); a.lu.push(0, 0); } g.setAttribute("lmUv", new THREE.Float32BufferAttribute(a.lu, 2)); g.setAttribute("lmInfo", new THREE.Float32BufferAttribute(a.li, 1)); }      // always present on BIM meshes (a missing attribute would read stale generic values)
    g.computeBoundingSphere(); return g;
  }

  /* ---------------------------------------- building ---------------------------------------- */
  /* returns { group, doors: {id: {group, open, angle...}}, parts: {static: [meshes], roof: [...], upper: {storey: [meshes]}}, ... } */
  function buildBuilding(B, mats, opts = {}) {
    const root = new THREE.Group(), res = { id: B.id, group: root, doors: {}, byStorey: {}, interior: [], roof: [], lights: [], B, lo: B.bounds[0], hi: B.bounds[1] };
    const staticAcc = {};   // key "storey|class" -> {matId: Acc}
    const EXT_EL = new Set([1, 6, 7, 8, 12, 13, 18, 22]);        // exterior wall, glass, frame, door, step, trim, curtain/blinds, ramp: visible from outside
    const classOf = (b) => { const el = b[14], fl = b[15]; return (el === 5 || el === 20 || el === 21) ? "roof" : (fl & FL.GLASS) ? "glass" : EXT_EL.has(el) ? "ext" : "int"; };
    const bucket = (k, cls) => { const key = k + "|" + cls; return staticAcc[key] || (staticAcc[key] = {}); };
    const movers = {}, hk = ES.bim.hook && ES.lightmap && ES.lightmap.on ? ES.bim.hook.begin(B, mats, opts.bim) : null;       // lightmap layout of this building (atlas rectangles, room codes)
    B.boxes.forEach((b, i) => {
      const fl = b[15]; if (!(fl & FL.VIS)) return;
      const mov = B.mov[i];
      if (mov) { (movers[B.tags[i]] = movers[B.tags[i]] || []).push([b, mov, i]); return; }
      const st = b[16], cls = classOf(b), bk = bucket(st, cls);
      boxFaces(b, (m) => bk[m] || (bk[m] = new Acc()), mats, null, hk, i);
    });
    // roof polygons (planar convex): triangle fan, double-sided material
    (B.polys || []).forEach((p) => {
      const key = p.storey + "|roof", bk = staticAcc[key] || (staticAcc[key] = {}), acc = bk[p.mat] || (bk[p.mat] = new Acc()), V = p.v, base = acc.p.length / 3;
      const a = [V[1][0] - V[0][0], V[1][1] - V[0][1], V[1][2] - V[0][2]], c = [V[2][0] - V[0][0], V[2][1] - V[0][1], V[2][2] - V[0][2]];
      let n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]]; const nl = Math.hypot(...n) || 1; n = n.map((v) => v / nl); if (n[2] < 0 && Math.abs(n[2]) > 0.2) n = n.map((v) => -v);
      const tile = mats[p.mat].userData.tile || 1, tl = Math.hypot(-n[1], n[0]) || 1;
      for (const q of V) { acc.p.push(q[0], q[2], -q[1]); acc.n.push(n[0], n[2], -n[1]); const uvx = Math.abs(n[2]) > 0.5 ? q[0] : (q[0] * -n[1] + q[1] * n[0]) / tl; acc.uv.push(uvx / tile, (Math.abs(n[2]) > 0.5 ? q[1] : q[2]) / tile); }
      for (let k = 1; k + 1 < V.length; k++) acc.i.push(base, base + k, base + k + 1);
    });
    for (const [key, byMat] of Object.entries(staticAcc)) {
      const [st, cls] = key.split("|"); const grp = new THREE.Group(); grp.userData = { storey: +st, cls };
      for (const [m, acc] of Object.entries(byMat)) {
        const mesh = new THREE.Mesh(toGeometry(acc), mats[m]); mesh.castShadow = cls !== "glass"; mesh.receiveShadow = true; if (cls === "glass") mesh.renderOrder = 2; grp.add(mesh);
      }
      root.add(grp); (res.byStorey[st] = res.byStorey[st] || []).push(grp); if (cls === "roof") res.roof.push(grp); if (cls === "int") res.interior.push(grp);
    }
    // doors: one group per door id pivoting about the hinge; geometry stored relative to the pivot
    for (const [tag, list] of Object.entries(movers)) {
      const mv0 = list[0][1]; const g = new THREE.Group(); const info = { group: g, kind: mv0.kind, open: mv0.open || 0, angle: mv0.angle || 0, lift: mv0.lift || 0, target: mv0.open || 0 };
      if (mv0.kind === "swing") g.position.set(mv0.pivot[0], 0, -mv0.pivot[1]);
      for (const [b, mov, bi] of list) {
        const acc = {}; boxFaces(b, (m) => acc[m] || (acc[m] = new Acc()), mats, null, hk, bi);
        for (const [m, a] of Object.entries(acc)) { const mesh = new THREE.Mesh(toGeometry(a), mats[m]); mesh.castShadow = true; mesh.receiveShadow = true; if (mats[m].userData.glass) mesh.renderOrder = 2; if (mov.kind === "swing") mesh.position.set(-mv0.pivot[0], 0, mv0.pivot[1]); g.add(mesh); }
      }
      res.doors[tag] = info; root.add(g); applyDoor(info);
    }
    return res;
  }
  function applyDoor(d) {
    if (d.kind === "swing") d.group.rotation.y = d.angle * d.open;     // ENU CCW angle about +z == three rotation about +y
    else if (d.kind === "slide_up") d.group.position.y = d.lift * d.open;
  }
  ES.bimCache = {}; ES.bimLoad = (name) => ES.bimCache[name] || (ES.bimCache[name] = ES.loadJSON(`${ES.DATA_DIR}/bim_${name}.json`).catch(() => null));
  ES.bim = { FL, makeMaterials, buildBuilding, applyDoor, texFor, hex };
})();
