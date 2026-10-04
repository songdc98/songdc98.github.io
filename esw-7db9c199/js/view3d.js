/* 3-D view (three.js r128 from cdnjs, loaded on demand).
   preview : small camera-pose preview of the selected agent (right panel)
   walk    : first-person walk-through (click the map to stand somewhere; drag to look, WASD to walk, click the ground to go there; human / dog / drone bodies;
             walls, fences, trunks and parked cars block you, so you only get through gates).
   The scene is built from the same exported geometry the physics models use. It is a geometric real-time view, not path tracing: the "Blender render" button gives the real image. */
(function () {
  const ES = window.ES;
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  let loading = null;
  const loadThree = () => window.THREE ? Promise.resolve() : loading || (loading = new Promise((res, rej) => { const s = document.createElement("script"); s.src = THREE_URL; s.onload = res; s.onerror = () => rej(new Error("three.js 加载失败")); document.head.appendChild(s); }));
  const V = { key: "", renderer: null, scene: null, cam: null, agents: null, lamps: [], A: null, hide: null, tex: null, live: null, col: null, bimB: {}, mats: null, env: null, exposure: 1 };
  const WALK = { active: false, x: 0, y: 0, zf: 0, zv: 0, yaw: 0, pitch: 0, body: "human", z: 28, fov: 75, keys: {}, tween: null, bob: 0, raf: 0, last: 0, hud: 0, hooks: {}, speedMul: 1 };
  /* bodies: capsule radius r, height h, step-up height step (stairs, kerbs, thresholds), eye height; Unitree Go2: ~0.7 m long, 0.4 m high, climbs ~0.2 m steps; people: 0.28 m shoulder radius */
  const BODY = { human: { eye: 1.6, r: 0.28, h: 1.7, step: 0.35, v: 1.4, run: 3.8, fov: 75, label: "人(1.7 m)" }, dog: { eye: 0.45, r: 0.27, h: 0.55, step: 0.22, v: 1.0, run: 2.6, fov: 100, label: "机械狗(0.45 m)" }, uav: { eye: 0, r: 0.3, h: 0.3, step: 0, v: 6, run: 16, fov: 84, label: "无人机(飞行)" } };
  const SRGB = (c) => new THREE.Color(c).convertSRGBToLinear();           // hex colours are sRGB; the renderer works in linear light
  const WALL = { house: 0xe0c4a0, cottage: 0xdcc09c, apartment: 0xb5654f, rowhouse: 0xc27a5e, commercial: 0xb4a89a, campus: 0xb4694f, warehouse: 0xc3c9ce, factory: 0xb4bac0, office: 0x9fb2c6, civic: 0xc3b6a4 };
  const ROOF = { house: 0x6d5a4f, cottage: 0x7a5148, apartment: 0x77797c, rowhouse: 0x7d5a4a, commercial: 0x6f7378, campus: 0x7a6a64, warehouse: 0x9a3a32, factory: 0x7c7f83, office: 0x6f7378, civic: 0x7a7168 };
  const mkRng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  /* ====================================== procedural textures ====================================== */
  function ctex(w, h, draw, repeat, seed = 1) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h, mkRng(seed));
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = V.renderer ? Math.min(8, V.renderer.capabilities.getMaxAnisotropy()) : 4; if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
  }
  const speck = (g, w, h, rnd, n, cols, size = 2, alpha = 0.5) => { for (let i = 0; i < n; i++) { g.globalAlpha = alpha * (0.4 + 0.6 * rnd()); g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd())); } g.globalAlpha = 1; };
  function textures() {
    if (V.tex) return V.tex; const T = {};
    T.grass = ctex(512, 512, (g, w, h, r) => { g.fillStyle = "#5d8c44"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 9000, ["#4a7a36", "#75a352", "#86a74f", "#3f6d31", "#6f9a4a"], 3, 0.55); g.lineWidth = 1.2; for (let i = 0; i < 3800; i++) { g.strokeStyle = ["#3f6d31", "#7db35a", "#6a9a45", "#8fb860"][i % 4]; g.globalAlpha = 0.65; const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 8); g.stroke(); } g.globalAlpha = 1; }, [1 / 2.5, 1 / 2.5], 1);
    T.asphalt = ctex(256, 256, (g, w, h, r) => { g.fillStyle = "#4b4e53"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 5200, ["#3b3d41", "#62666b", "#707479", "#2f3135"], 1.6, 0.55); g.strokeStyle = "#2b2d30"; g.lineWidth = 1.2; for (let k = 0; k < 3; k++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let j = 0; j < 8; j++) { x += (r() - 0.4) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); } }, [1 / 4, 1 / 4], 2);
    T.sidewalk = ctex(256, 256, (g, w, h, r) => { g.fillStyle = "#bab7ac"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 2600, ["#a7a49a", "#cbc8bd", "#9c998f"], 2, 0.5); g.strokeStyle = "#8f8c82"; g.lineWidth = 2; for (const x of [0, 128]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (const y of [0, 128]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } }, [1 / 2, 1 / 2], 3);
    T.concrete = ctex(256, 256, (g, w, h, r) => { g.fillStyle = "#aeaba2"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 2400, ["#9d9a91", "#bdbab0"], 2, 0.5); g.strokeStyle = "#85827a"; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); }, [1 / 3, 1 / 3], 4);
    T.gravel = ctex(256, 256, (g, w, h, r) => { g.fillStyle = "#a89a7d"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 5000, ["#8e8168", "#bfb092", "#776b57", "#cabd9f"], 2.4, 0.6); }, [1 / 3, 1 / 3], 5);
    T.shingle = (hex) => ctex(128, 128, (g, w, h, r) => { g.fillStyle = "#" + hex.toString(16).padStart(6, "0"); g.fillRect(0, 0, w, h); speck(g, w, h, r, 1400, ["#000000", "#ffffff"], 2, 0.07); g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 1.5; for (let y = 0; y < h; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (y / 12) % 2 ? 0 : 10; x < w; x += 20) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 12); g.stroke(); } } }, [1 / 1.5, 1 / 1.5], 6);
    T.flatroof = ctex(128, 128, (g, w, h, r) => { g.fillStyle = "#6e7175"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 1800, ["#5b5e62", "#85888c", "#4d5054"], 2, 0.5); }, [1 / 2, 1 / 2], 7);
    T.picket = ctex(128, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#f2efe6"; for (let i = 0; i < 8; i++) { const x = i * 16 + 3; g.beginPath(); g.moveTo(x, h); g.lineTo(x, 8); g.lineTo(x + 5, 1); g.lineTo(x + 10, 8); g.lineTo(x + 10, h); g.closePath(); g.fill(); } g.fillStyle = "#e0dccf"; g.fillRect(0, 14, w, 5); g.fillRect(0, 44, w, 5); }, [1, 1], 9);
    T.privacy = ctex(128, 64, (g, w, h, r) => { g.fillStyle = "#8a6238"; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { g.fillStyle = ["#7a5430", "#966b3f", "#85603a"][i % 3]; g.fillRect(i * 8, 0, 7, h); } speck(g, w, h, r, 400, ["#5e4025"], 2, 0.4); g.fillStyle = "#6a4a2a"; g.fillRect(0, 0, w, 4); }, [1, 1], 10);
    T.chain = ctex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = "rgba(150,158,164,.95)"; g.lineWidth = 1.6; for (let k = -64; k < 128; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke(); } }, [1, 1], 11);
    T.water = ctex(64, 64, (g, w, h, r) => { g.fillStyle = "#4fb4e6"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 120, ["#ffffff", "#2f8fc8"], 6, 0.18); }, [1 / 4, 1 / 4], 12);
    T.facades = {};
    return (V.tex = T);
  }
  /* one storey of facade: 6 m wide x one floor high; style = brick | stucco | metal | office; lit = emissive map for night */
  function facade(style, lit, seed) {
    const key = style + (lit ? "L" : "D") + seed, T = textures(); if (T.facades[key]) return T.facades[key];
    const t = ctex(256, 256, (g, w, h, r) => {
      if (lit) { g.fillStyle = "#000"; g.fillRect(0, 0, w, h); }
      else if (style === "brick") { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.fillStyle = "#e3d6c4"; for (let y = 0; y < h; y += 16) { g.fillRect(0, y, w, 2); for (let x = (y / 16) % 2 ? 0 : 16; x < w; x += 32) g.fillRect(x, y, 2, 16); } speck(g, w, h, r, 900, ["#000"], 3, 0.1); }
      else if (style === "metal") { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 2; for (let x = 0; x < w; x += 14) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } }
      else { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); speck(g, w, h, r, 1500, ["#000"], 3, 0.06); }
      const wins = style === "metal" ? [[96, 40, 64, 40]] : style === "office" ? [[8, 40, 112, 120], [136, 40, 112, 120]] : [[28, 56, 64, 112], [164, 56, 64, 112]];
      for (const [x, y, ww, hh] of wins) {
        if (lit) { if (r() < 0.55) { g.fillStyle = r() < 0.5 ? "#ffd9a0" : "#fff1c8"; g.fillRect(x, y, ww, hh); } continue; }
        const gr = g.createLinearGradient(x, y, x, y + hh); gr.addColorStop(0, "#9fb8cf"); gr.addColorStop(0.6, "#5f7d99"); gr.addColorStop(1, "#46627b"); g.fillStyle = gr; g.fillRect(x, y, ww, hh);
        g.strokeStyle = "#f1efe8"; g.lineWidth = style === "office" ? 3 : 6; g.strokeRect(x, y, ww, hh); if (style !== "office") { g.lineWidth = 3; g.beginPath(); g.moveTo(x + ww / 2, y); g.lineTo(x + ww / 2, y + hh); g.moveTo(x, y + hh / 2); g.lineTo(x + ww, y + hh / 2); g.stroke(); }
        g.fillStyle = "rgba(255,255,255,.22)"; g.beginPath(); g.moveTo(x, y); g.lineTo(x + ww * 0.55, y); g.lineTo(x, y + hh * 0.5); g.closePath(); g.fill();
      }
    }, [1 / 6, 1], seed);
    return (T.facades[key] = t);
  }
  /* sky dome, stars, image-based light: env.js (HDRI looks) */

  function fillTrees() {
    const M = ES.models.READY.treeMeta; if (!M || !V.trees || !V.treeGroup) return;
    for (const T of V.trees) {
      if (T.filled >= 2) continue;
      if (!T.choice) { const K = M.kinds[T.kind] || M.kinds.round; let w = 0, u = T.u * K.choices.reduce((a, c) => a + c.w, 0); T.choice = K.choices.find((c) => { w += c.w; return u <= w; }) || K.choices[0]; }
      const c = T.choice, near = ES.models.treeSync(c.near), far = ES.models.treeSync(c.far), have = (near ? 1 : 0) + (far ? 1 : 0); if (have <= T.filled) continue;
      T.g.clear(); const lod = new THREE.LOD(), sc = c.scale * T.s; if (near) lod.addLevel(near, 0); if (far) lod.addLevel(far, near ? 75 : 0); if (!near && far) { /* only the far mesh so far */ }
      lod.scale.setScalar(sc); T.g.add(lod); T.filled = have;
    }
  }
  ES.bus.on("models", () => { fillTrees(); });
  /* ====================================== scene ====================================== */
  const shape = (ring, holes) => { const sh = new THREE.Shape(ring.map((p) => new THREE.Vector2(p[0], p[1]))); (holes || []).forEach((h) => sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))))); return sh; };
  const flat = (ring, holes, mat, y) => { const g = new THREE.ShapeGeometry(shape(ring, holes)); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = true; return m; };
  const slab = (ring, holes, topMat, sideMat, depth) => { const g = new THREE.ExtrudeGeometry(shape(ring, holes), { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, [topMat, sideMat]); m.receiveShadow = true; return m; };
  const lam = (o) => { const q = Object.assign({}, o); if (q.color !== undefined) q.color = SRGB(q.color); if (q.emissive !== undefined) q.emissive = SRGB(q.emissive); return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.93, metalness: 0, envMapIntensity: 0.55 }, q)); };
  const bas = (o) => new THREE.MeshBasicMaterial(Object.assign({}, o, { color: SRGB(o.color) }));
  function roofGeom(part, h, kind) {
    const [p0, p1, p2] = part, ux = p1[0] - p0[0], uy = p1[1] - p0[1], vx = p2[0] - p1[0], vy = p2[1] - p1[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    const long = lu >= lv, L = Math.max(lu, lv) / 2 + 0.55, Wd = Math.min(lu, lv) / 2 + 0.55, yaw = Math.atan2(long ? uy : vy, long ? ux : vx), cx = part.reduce((a, p) => a + p[0], 0) / part.length, cy = part.reduce((a, p) => a + p[1], 0) / part.length;
    const rh = Math.min(Wd * 0.62, 3.2), R = kind === "hip" ? Math.max(0.2, L - Wd * 0.95) : L;
    const v = [[-L, -Wd, 0], [L, -Wd, 0], [L, Wd, 0], [-L, Wd, 0], [-R, 0, rh], [R, 0, rh]], tri = [[0, 1, 5], [0, 5, 4], [2, 3, 4], [2, 4, 5], [0, 4, 3], [1, 2, 5]], pos = [], uv = [];
    for (const t of tri) for (const i of t) { pos.push(...v[i]); uv.push(v[i][0], v[i][1] + v[i][2] * 0.9); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    g.rotateX(-Math.PI / 2); g.rotateY(yaw); g.translate(cx, h, -cy); return g;
  }
  function build(A) {
    const T = textures(), sc = A.scene, W = A.W, night = A.look === "night", S = sc.size, rng = mkRng(sc.seed + 7), scn = new THREE.Scene();
    const rig = ES.env.attach(scn, A, V), sun = rig.sun[0];       // sky dome, sun (3 shadow cascades), light probe, HDRI image-based light: env.js
    ES.env.buildGround(scn, A, V);                                // photographic ground: lawns, kerbs, sidewalks, roads + markings continued to the horizon, terrain, distant buildings and trees (env.js)
    // buildings: the building model (walls with real openings, floors, stairs, furniture) when available, else the old extruded prism
    V.mats = A.bim ? ES.bim.makeMaterials(A.bim.materials, { env: scn.environment }) : null; V.col = new ES.BimCol(); V.bimB = {}; V.bimSkip = new Set(); V.lightProbe = [];
    sc.buildings.forEach((b, bi) => {
      const dmg = W.damage[b.id], kind = b.kind, collapsed = dmg && dmg.state === "collapsed"; let h = b.h; if (collapsed) h = Math.min(2.4, 0.2 * b.h); else if (dmg && dmg.state === "partial") h = 0.72 * b.h;
      const bimB = A.bim && A.bim.buildings[b.id];
      if (bimB && !collapsed) {
        const keep = dmg && dmg.state === "partial" ? Math.max(1, Math.floor(0.7 * b.floors)) : 99, bb = ES.bim.buildBuilding(bimB, V.mats, { night });
        for (const [st, gs] of Object.entries(bb.byStorey)) if (+st >= keep) gs.forEach((g) => { g.visible = false; });
        if (keep < 99) bb.roof.forEach((g) => { g.visible = false; });
        scn.add(bb.group); V.bimB[b.id] = bb; V.col.addBuilding(bimB, bi, keep); V.bimSkip.add(bi + 1);
        for (const L of bimB.lights) if (L.on && L.storey < keep) V.lightProbe.push({ p: L.pos, cct: L.cct, lm: L.lm, b: b.id });
        return;
      }
      const style = kind === "apartment" || kind === "rowhouse" || kind === "campus" ? "brick" : kind === "warehouse" || kind === "factory" ? "metal" : kind === "office" || kind === "commercial" ? "office" : "stucco";
      const fh = b.floors > 0 ? b.h / b.floors : 3, seed = (bi * 7 + 3) | 0, tex = facade(style, false, seed % 3), etex = night ? facade(style, true, seed % 5) : null;
      const tt = tex.clone(); tt.needsUpdate = true; tt.repeat.set(1 / 6, 1 / fh); let et = null; if (etex) { et = etex.clone(); et.needsUpdate = true; et.repeat.set(1 / 6, 1 / fh); }
      const col = collapsed ? 0x7a5c44 : new THREE.Color(WALL[kind] || 0xcccccc).multiplyScalar(0.9 + 0.2 * rng());
      const rub = collapsed && ES.pbr ? ES.pbr.material("rubble", { tint: [0.55, 0.45, 0.38] }) : null;       // collapsed building: broken masonry (pbr.js)
      const side = rub || lam({ color: col, map: collapsed ? null : tt, emissive: night && !collapsed ? 0xffffff : 0x000000, emissiveMap: collapsed ? null : et });
      const flatRoof = lam({ map: T.flatroof, color: 0xffffff }), pitched = lam({ map: T.shingle(ROOF[kind] || 0x6d5a4f), color: 0xffffff, side: THREE.DoubleSide });
      for (const part of (b.parts && b.parts.length ? b.parts : [b.fp])) {
        const g = new THREE.ExtrudeGeometry(shape(part), { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
        const isPitched = (b.roof === "gable" || b.roof === "hip") && part.length === 4 && !collapsed;
        const mesh = new THREE.Mesh(g, [rub || (isPitched ? lam({ color: col }) : flatRoof), side]); mesh.castShadow = mesh.receiveShadow = true; scn.add(mesh);
        if (isPitched) { const rm = new THREE.Mesh(roofGeom(part, h, b.roof), pitched); rm.castShadow = true; scn.add(rm); }
      }
      if (b.entrance && !collapsed) { const e = b.entrance, nx = e.normal ? e.normal[0] : 0, ny = e.normal ? e.normal[1] : -1, door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.14), lam({ color: 0x5a3a24 })); door.position.set(e.xy[0] + nx * 0.07, 0.14 + 1.05, -(e.xy[1] + ny * 0.07)); door.rotation.y = Math.atan2(nx, -ny); scn.add(door); }
      if ((kind === "house" || kind === "cottage") && !collapsed) { const c = b.fp.reduce((a, p) => [a[0] + p[0] / b.fp.length, a[1] + p[1] / b.fp.length], [0, 0]); const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.7), lam({ color: 0x8a4b3a })); ch.position.set(c[0] + 1.2, h + 1.6, -c[1] + 0.8); ch.castShadow = true; scn.add(ch); }
    });
    for (const sp of W.variantData.spills || []) scn.add(flat(sp.ring, null, lam({ color: 0x6b5240 }), 0.16));
    for (const f of W.variantData.fires || []) { const mm = new THREE.Mesh(new THREE.ConeGeometry(f.r * 0.6, f.r * 1.8, 10), bas({ color: 0xff7a1a, transparent: true, opacity: 0.8 })); mm.position.set(f.xy[0], f.r * 0.9 + 0.14, -f.xy[1]); scn.add(mm); const L = new THREE.PointLight(0xff8a30, 1.4, 60); L.position.copy(mm.position); L.position.y += 3; scn.add(L); }
    // fences, yard / industrial objects, street furniture, lamps: real models from props.js (the primitives below are the fallback while that module is absent)
    V.lamps = []; V.propBlk = []; const propsDone = !!(ES.props && ES.props.build && ES.props.build(scn, A, V));
    // fences
    if (!propsDone && A.occ.fences) for (const o of sc.objects) if (o.type === "fence") {
      const tx = o.style === "privacy" ? T.privacy : o.style === "chain" ? T.chain : T.picket, post = lam({ color: o.style === "chain" ? 0x7c858b : o.style === "privacy" ? 0x6a4a2a : 0xe6e2d6 });
      for (const ln of o.lines) for (let k = 0; k + 1 < ln.length; k++) {
        const a = ln[k], c = ln[k + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.2) continue;
        const t = tx.clone(); t.needsUpdate = true; t.repeat.set(o.style === "chain" ? L / 1 : L / (o.style === "picket" ? 1.2 : 1.0), 1);
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(L, o.h), lam({ map: t, transparent: o.style !== "privacy", alphaTest: 0.4, side: THREE.DoubleSide }));
        pm.rotation.y = Math.atan2(c[1] - a[1], c[0] - a[0]); pm.position.set((a[0] + c[0]) / 2, 0.14 + o.h / 2, -(a[1] + c[1]) / 2); pm.castShadow = o.style === "privacy"; scn.add(pm);
        const u = Math.max(1, Math.round(L / 2.4)); for (let s = 0; s <= u; s++) { const px = a[0] + ((c[0] - a[0]) * s) / u, py = a[1] + ((c[1] - a[1]) * s) / u; const pp = new THREE.Mesh(new THREE.BoxGeometry(0.1, o.h + 0.1, 0.1), post); pp.position.set(px, 0.14 + o.h / 2, -py); scn.add(pp); }
      }
    }
    if (!propsDone) for (const o of sc.objects) {
      if (o.type === "box") { const mm = new THREE.Mesh(new THREE.BoxGeometry(o.size[0], o.size[2], o.size[1]), lam({ color: o.name === "container" ? [0xc0504d, 0x4f81bd, 0x70a757][Math.floor(o.xy[0] + o.xy[1]) % 3] : o.name === "shed" ? 0xb9926e : o.name === "bins" ? 0x3d8f5e : 0xd8a31a })); mm.rotation.y = o.yaw; mm.position.set(o.xy[0], 0.14 + o.size[2] / 2, -o.xy[1]); mm.castShadow = mm.receiveShadow = true; scn.add(mm); if (o.name === "shed") { const rf = new THREE.Mesh(new THREE.BoxGeometry(o.size[0] + 0.3, 0.12, o.size[1] + 0.3), lam({ color: 0x8a3a30 })); rf.rotation.y = o.yaw; rf.position.set(o.xy[0], 0.14 + o.size[2] + 0.06, -o.xy[1]); scn.add(rf); } }
      else if (o.type === "cyl") { const mm = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.h, 24), lam({ color: o.name === "chimney" ? 0xd9d2c9 : 0xb7bdc2 })); mm.position.set(o.xy[0], o.h / 2, -o.xy[1]); mm.castShadow = true; scn.add(mm); }
      else if (o.type === "post") { const mm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, o.h, 6), lam({ color: 0x33414a })); mm.position.set(o.xy[0], 0.14 + o.h / 2, -o.xy[1]); scn.add(mm); if (o.name === "mailbox") { const bx = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.5), lam({ color: 0x2f5aa8 })); bx.position.set(o.xy[0], 0.14 + o.h + 0.1, -o.xy[1]); scn.add(bx); } }
    }
    // trees: real branching trees with alpha-cut leaf cards (exported from the vegetation system), 2 LODs; filled in as the model files arrive
    V.treeGroup = new THREE.Group(); V.trees = [];
    if (A.occ.trees) {
      const hash = (x, y, o) => { const v = Math.sin(x * 12.9898 + y * 78.233 + o * 37.719) * 43758.5453; return v - Math.floor(v); };
      sc.trees.forEach((t, i) => V.trees.push({ x: t[0], y: t[1], kind: t[2], s: t[3], u: hash(t[0], t[1], 1), rot: hash(t[0], t[1], 2) * 6.283, filled: 0, g: new THREE.Group() }));
      V.trees.forEach((T) => { T.g.position.set(T.x, 0.14, -T.y); T.g.rotation.y = T.rot; T.g.userData.dyn = true; V.treeGroup.add(T.g); });
      ES.models.treeMeta().then(() => fillTrees());
    }
    scn.add(V.treeGroup);
    // lamps (+ lights at night)
    const pole = new THREE.CylinderGeometry(0.07, 0.1, 7, 8), poleMat = lam({ color: 0x2a2f33 });
    for (const l of (propsDone ? [] : sc.lamps)) {
      const mm = new THREE.Mesh(pole, poleMat); mm.position.set(l[0], 3.5 + 0.14, -l[1]); mm.castShadow = true; scn.add(mm); const hx = l[0] + Math.cos(l[2]) * 1.6, hy = l[1] + Math.sin(l[2]) * 1.6;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), poleMat); arm.position.set((l[0] + hx) / 2, 7.0, -(l[1] + hy) / 2); arm.rotation.y = Math.atan2(hy - l[1], hx - l[0]); scn.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.3), bas({ color: night ? 0xffe2a8 : 0x666666 })); head.position.set(hx, 6.95, -hy); head.rotation.y = Math.atan2(hy - l[1], hx - l[0]); scn.add(head); V.lamps.push([hx, 6.7, -hy]);
    }
    // parked vehicles: the exported Blender models (clear-coat paint, glass, tyres); boxes of the true size until the model file has loaded
    V.vehGroups = [];
    if (A.occ.vehicles) W.vehicles.forEach((v, i) => {
      const g = new THREE.Group(), L = v.dims[0], Wd = v.dims[1], H = v.dims[2];
      g.rotation.y = ES.rad(v.yaw); g.position.set(v.xy[0], W.groundZ(v.xy[0], v.xy[1]), -v.xy[1]); g.userData.dyn = true;
      const real = ES.models && ES.models.vehicleSync(v.vtype || "sedan", v.color != null ? v.color : i);
      if (real) g.add(real); else { const ph = new THREE.Mesh(new THREE.BoxGeometry(L, H * 0.8, Wd), lam({ color: 0x8a8f94 })); ph.position.y = H * 0.4; ph.userData.ph = true; ph.castShadow = true; g.add(ph); }
      scn.add(g); V.vehGroups.push(g);
    });
    scn.traverse((o) => { if (o.isMesh && !o.userData.dyn) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    V.scene = scn; V.sun = sun; ES.bus.emit("scene:built", V);
  }

  /* ====================================== agent models ====================================== */
  function label(text, color) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g = c.getContext("2d"); g.font = "600 30px 'Source Sans 3', 'PingFang SC', sans-serif"; g.textAlign = "center"; g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,.65)"; g.strokeText(text, 128, 42); g.fillStyle = "#fff"; g.fillText(text, 128, 42);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, sizeAttenuation: false })); sp.scale.set(0.2, 0.05, 1); return sp;
  }
  function agentModel(e, opts = {}) {
    const g = new THREE.Group(), mat = (c) => lam({ color: c }), box = (x, y, z, c, px, py, pz, par) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat(c)); m.position.set(px, py, pz); m.castShadow = true; (par || g).add(m); return m; };
    const col = e.kind.startsWith("t:") ? ES.TARGETS[e.kind.slice(2)].color : e.kind === "sound" ? "#b8860b" : ES.DEVICES[e.kind].color; g.userData.parts = {};
    /* rigs come from the actor registry (models.js; humans.js / robots.js / vehicles.js register the detailed makers); a maker returns null while its files load -> primitives below, rebuilt on the "models" event */
    const rk = e.kind === "human" ? "human" : e.kind === "t:person" ? "person" : e.kind === "t:lying" ? "lying" : e.kind === "t:vehicle" ? "tvehicle" : e.kind, sid = String(e.id), seed = typeof e.id === "number" ? e.id : [...sid].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rig = ES.actors ? ES.actors.make(rk, { id: e.id, name: e.name, role: e.role, live: !!opts.live, self: !!opts.self, seed }) : null;
    if (rig) { g.add(rig.root); g.userData.rig = rig; }
    else if (e.kind === "uav") { box(0.3, 0.1, 0.3, 0x222222, 0, 0, 0); g.userData.parts.rotors = []; for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { box(0.2, 0.02, 0.02, 0x222222, 0.1 * x, 0, 0.1 * z); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12), mat(0xcccccc)); r.position.set(0.22 * x, 0.04, 0.22 * z); g.add(r); g.userData.parts.rotors.push(r); } }
    else if (e.kind === "dog") { box(0.62, 0.2, 0.26, 0xdfdfe4, 0, 0.34, 0); box(0.16, 0.13, 0.16, 0xdfdfe4, 0.38, 0.42, 0); g.userData.parts.legs = []; for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const piv = new THREE.Group(); piv.position.set(0.23 * x, 0.3, 0.11 * z); box(0.06, 0.3, 0.06, 0x333333, 0, -0.15, 0, piv); g.add(piv); g.userData.parts.legs.push(piv); } }
    else if (e.kind === "human" || e.kind === "t:person") { const sh = e.kind === "human" ? 0xf2a31b : 0x4a6fa5; box(0.3, 0.58, 0.18, sh, 0, 1.12, 0); const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(0xe2b79b)); h.position.y = 1.55; g.add(h); g.userData.parts.legs = []; g.userData.parts.arms = [];
      for (const z of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(0, 0.82, 0.09 * z); box(0.12, 0.8, 0.1, 0x2f3a4a, 0, -0.4, 0, piv); g.add(piv); g.userData.parts.legs.push(piv); const arm = new THREE.Group(); arm.position.set(0, 1.35, 0.2 * z); box(0.09, 0.6, 0.08, sh, 0, -0.3, 0, arm); g.add(arm); g.userData.parts.arms.push(arm); } }
    else if (e.kind === "t:lying") { box(0.6, 0.22, 0.3, 0xd62728, 0.15, 0.11, 0); box(0.7, 0.18, 0.2, 0x2f3a4a, -0.5, 0.09, 0); const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xe2b79b)); h.position.set(0.55, 0.12, 0); g.add(h); }
    else if (e.kind === "t:vehicle") { box(4.2, 0.9, 1.8, 0x666666, 0, 0.6, 0); box(2.0, 0.6, 1.6, 0x20262c, -0.2, 1.3, 0); }
    else if (e.kind === "rover") { box(0.6, 0.35, 0.5, 0xe69f00, 0, 0.3, 0); box(0.4, 0.3, 0.4, 0xf3c24f, 0, 0.62, 0); for (const [x, z] of [[1, 1], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, -1]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), mat(0x222222)); w.rotation.x = Math.PI / 2; w.position.set(0.22 * x, 0.1, 0.27 * z); g.add(w); } }
    else if (e.kind === "cp" && ES.models.vehicleSync("box_truck", 5)) { const t = ES.models.vehicleSync("box_truck", 5); g.add(t); box(0.1, 3.0, 0.1, 0x555555, -1.5, 4.9, 0.7); box(0.9, 0.5, 0.06, 0xdddddd, -1.5, 6.4, 0.7); box(1.6, 0.14, 1.2, 0xcfd3d8, 0.4, 3.35, 0); }
    else if (e.kind === "cp") { const D = (V.A && V.A.scene.cp_dims) || [7, 2.5, 3.3]; box(D[0] * 0.7, 2.4, 2.5, 0x2f6fb5, -D[0] * 0.15, 1.75, 0); box(D[0] * 0.27, 2.3, 1.75, 0xdfe4ea, D[0] * 0.365, 1.38, 0); box(D[0] * 0.14, 2.0, 0.9, 0x20262c, D[0] * 0.42, 1.8, 0);
      for (const x of [0.34, -0.32]) for (const z of [1, -1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18), mat(0x151515)); w.rotation.x = Math.PI / 2; w.position.set(D[0] * x, 0.5, z * 1.1); g.add(w); }
      box(0.1, 3.0, 0.1, 0x555555, -D[0] * 0.25, 4.0, 0.6); box(0.8, 0.5, 0.06, 0xdddddd, -D[0] * 0.25, 5.4, 0.6); box(1.6, 0.14, 1.2, 0xcfd3d8, -D[0] * 0.05, 3.05, 0); }
    else if (e.kind === "sound") { const s = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), mat(0xb8860b)); s.rotation.x = Math.PI / 2; g.add(s); }
    if (!opts.noBeacon && !(opts.small && e.kind !== "sound")) { const beacon = new THREE.Mesh(new THREE.SphereGeometry(opts.small ? 0.2 : 0.45, 12, 10), bas({ color: col, transparent: true, opacity: 0.85, toneMapped: false })); beacon.position.y = (e.kind === "cp" ? 7.2 : e.kind === "uav" ? 0.8 : e.kind === "dog" ? 1.0 : e.kind === "rover" ? 1.1 : 2.2); g.add(beacon); }
    if (opts.label && e.name) { const sp = label(e.name, col); sp.position.y = (e.kind === "cp" ? 8.2 : e.kind === "uav" ? 1.5 : e.kind === "dog" ? 1.5 : e.kind === "rover" ? 1.6 : 2.7); g.add(sp); }
    const z = e.kind === "uav" ? e.z : (e.zf != null ? e.zf : (V.A ? surfZ(e.x, e.y) : 0.1)); g.position.set(e.x, z, -e.y); g.rotation.y = e.yaw !== undefined ? e.yaw : 0; g.userData.eid = e.id;
    if (e.kind === "uav" && e.z) { const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -e.z, 0)]), new THREE.LineBasicMaterial({ color: SRGB(col), transparent: true, opacity: 0.4 })); g.add(ln); }
    g.userData.dyn = true; return g;
  }
  /* live agents: the episode's own dog / drone / rover / residents move through the scene */
  function buildLive(ep) {
    const grp = new THREE.Group(); grp.userData.items = [];
    for (const [id, a] of Object.entries(ep.agents)) {
      const kind = a.type === "uav" ? "uav" : a.type === "ugv" ? "dog" : a.type === "ugv_wheel" ? "rover" : a.role === "lie" ? "t:lying" : "human";
      const mk = kind === "human" ? (id === "human_0" ? "human" : "t:person") : kind;
      const model = agentModel({ kind: mk, id, role: a.role, x: a.pos[0][0], y: a.pos[0][1], z: a.pos[0][2], yaw: a.yaw[0] }, { noBeacon: true, label: false, live: true });
      grp.add(model); grp.userData.items.push({ id, a, model, kind, mk, phase: Math.random() * 6 });
    }
    return grp;
  }
  /* a model file finished loading: live agents still standing in as primitives get their real rig (the others keep theirs and their tracker state) */
  function upgradeLive() {
    const grp = V.live; if (!grp || !V.liveEp) return;
    for (const it of grp.userData.items) {
      if (it.model.userData.rig) continue; const a = it.a, n = agentModel({ kind: it.mk, id: it.id, role: a.role, x: a.pos[0][0], y: a.pos[0][1], z: a.pos[0][2], yaw: a.yaw[0] }, { noBeacon: true, label: false, live: true });
      if (!n.userData.rig) continue; grp.remove(it.model); grp.add(n); it.model = n; it.lastT = 0; it.st = null;
    }
  }
  /* the doors the episode holds open (a search team props them): applied while the live agents are on, restored afterwards */
  function liveDoors(ep, on) {
    if (!V.col) return; const keep = V.liveDoorKeep || (V.liveDoorKeep = {});
    if (!on) { for (const [k, o] of Object.entries(keep)) { const d = V.col.doors[k]; if (d) setDoor(d, o); } V.liveDoorKeep = {}; return; }
    for (const [k, o] of Object.entries((ep && ep.door_state) || {})) { const d = V.col.doors[k]; if (!d) continue; if (!(k in keep)) keep[k] = d.open; setDoor(d, o); }
  }
  /* body attitude suggestions handed to the rigs in the state struct (angles in rad; pitch > 0 = nose up, roll > 0 = right side down; three frame: +x forward, +z right) */
  function groundTilt(st, x, y, yaw, zf) {          // a legged body follows the surface under it (slopes, stairs, kerbs): 0.6 m wheelbase, 0.4 m track
    const c = Math.cos(yaw), s = Math.sin(yaw), g = (px, py) => supportZ(px, py, zf, 0.3);
    st.pitch = ES.clamp(Math.atan2(g(x + c * 0.3, y + s * 0.3) - g(x - c * 0.3, y - s * 0.3), 0.6), -0.5, 0.5); st.roll = ES.clamp(Math.atan2(g(x - s * 0.2, y + c * 0.2) - g(x + s * 0.2, y - c * 0.2), 0.4), -0.4, 0.4);
  }
  function uavTilt(st) {                            // thrust vector leans into the acceleration; steady forward flight leans nose-down with speed (drag balance)
    st.pitch = -ES.clamp(Math.atan2(st.af, 9.81) + 0.03 * st.vf, -0.6, 0.6); st.roll = -ES.clamp(Math.atan2(st.as, 9.81) + 0.03 * st.vs, -0.6, 0.6);
  }
  /* parked vehicles keep their pose; the emergency vehicles' light bars flash (they are on duty), driven by the vehicle rigs of vehicles.js */
  function tickParked(dt, now) {
    const L = V.vehGroups; if (!L || !L.length) return; const night = ES.actors ? ES.actors.isNight() : false, st = { t: now / 1000, night, moving: false, speed: 0 };
    for (const g of L) { const m = g.children[0], r = m && m.userData && m.userData.rig; if (r && r.dynamic) r.update(dt, st); }
  }
  function tickLive(now) {
    const live = V.live; if (!live || !V.liveEp) return; const ep = V.liveEp, t = (now / 1000) * V.liveSpeed + (V.liveOffset || 0), night = ES.actors ? ES.actors.isNight() : false;
    for (const it of live.userData.items) {
      const a = it.a, T = (a.n - 1) * ep.dt, tt = T > 0 ? t % T : 0, f = tt / ep.dt, i0 = Math.min(a.n - 2, Math.floor(f)), u = f - i0, p0 = a.pos[i0], p1 = a.pos[i0 + 1] || p0;
      const x = p0[0] + (p1[0] - p0[0]) * u, y = p0[1] + (p1[1] - p0[1]) * u; let dy = a.yaw[Math.min(a.n - 1, i0 + 1)] - a.yaw[i0]; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const yaw = a.yaw[i0] + dy * u;
      const z = it.kind === "uav" ? p0[2] + (p1[2] - p0[2]) * u : (a.gz ? a.gz[i0] + ((a.gz[i0 + 1] !== undefined ? a.gz[i0 + 1] : a.gz[i0]) - a.gz[i0]) * u : V.A.W.groundZ(x, y)), vx = (p1[0] - p0[0]) / ep.dt, vy = (p1[1] - p0[1]) / ep.dt, spd = Math.hypot(vx, vy), moving = spd > 0.25;
      it.model.position.set(x, z, -y); it.model.rotation.y = yaw; const rig = it.model.userData.rig, ph = (now / 1000) * (it.kind === "dog" ? 6 : 7) + it.phase, sw = moving ? Math.sin(ph) * 0.55 : 0, P = rig ? {} : (it.model.userData.parts || {});
      if (rig) {          // detailed rig: one kinematic state per agent per frame (velocity / acceleration / yaw rate by finite differences of the played-back path)
        const dtf = Math.min(0.1, Math.max(0, (now - (it.lastT || now)) / 1000)); it.lastT = now;
        const st = ES.actors.track(it, dtf, x, y, z, yaw, { vmax: it.kind === "uav" ? 30 : 12 }); st.t = now / 1000; st.id = it.id; st.live = true; st.role = a.role || "stand"; st.view = "chase"; st.night = night; st.head = null;
        if (it.kind === "dog") groundTilt(st, x, y, yaw, z); else if (it.kind === "uav") {
          uavTilt(st); const gm = a.gimbal; if (gm) { const g0 = gm[Math.min(a.n - 1, i0)], g1 = gm[Math.min(a.n - 1, i0 + 1)]; st.gimbal = [g0[0] + ES.wrapPi(g1[0] - g0[0]) * u, -(g0[1] + (g1[1] - g0[1]) * u)]; }          // world-frame yaw / pitch, pitch > 0 = up (the data's pitch looks down)
          st.landed = z - V.A.W.groundZ(x, y) < 0.25 && st.speed < 0.3 && Math.abs(st.vz) < 0.3;
        }
        rig.update(dtf, st);
      }
      if (P.wheels) P.wheels.forEach((w) => { w.rotation.z = -(((now / 1000) * spd) / 0.1) % 6.283; });
      if (P.legs) P.legs.forEach((l, k) => { l.rotation.z = (k % 2 ? sw : -sw) * (it.kind === "dog" ? 0.8 : 1); });
      if (P.arms) P.arms.forEach((l, k) => { l.rotation.z = it.a.role === "wave" && k === 0 ? 2.75 + 0.3 * Math.sin((now / 1000) * 7) : (k % 2 ? -sw : sw) * 0.6; });
      if (P.rotors) P.rotors.forEach((r) => { r.rotation.y += 1.6; });
    }
  }

  /* ====================================== rendering helpers ====================================== */
  function size() { const c = document.getElementById("v3d"), r = c.parentElement.getBoundingClientRect(); V.w = Math.max(50, r.width); V.h = Math.max(30, r.height); V.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); V.renderer.setSize(V.w, V.h, false); if (V.cam) { V.cam.aspect = V.w / V.h; V.cam.updateProjectionMatrix(); } }
  const $cap = () => document.getElementById("v3dcap");
  function placeAgents(A, withLabels) {
    if (V.agents) V.scene.remove(V.agents); V.agents = new THREE.Group();
    for (const e of A.ents) { if (e.id === V.hide) continue; V.agents.add(agentModel(e, withLabels ? { small: true, label: true } : {})); }
    V.scene.add(V.agents);
    if (V.lampLights) V.lampLights.forEach((l) => V.scene.remove(l)); V.lampLights = [];
    if (A.look === "night" && !(ES.env && ES.env.handlesLamps)) { const cp = V.cam.position, ls = V.lamps.map((p) => ({ p, d: Math.hypot(p[0] - cp.x, p[2] - cp.z) })).sort((a, b) => a.d - b.d).slice(0, 8); for (const { p } of ls) { const L = new THREE.PointLight(0xffd9a0, 1.2, 55, 1.6); L.position.set(...p); V.scene.add(L); V.lampLights.push(L); } }
  }
  function camFromEntity(A) {
    const e = A.ents.find((q) => q.id === A.sel), d = e && ES.DEVICES[e.kind], S = A.scene.size, aspect = V.w / V.h; let from = "总览(选中一个带相机的智能体可切换为它的视角)";
    if (d && d.cam) {
      const vfov = ES.deg(2 * Math.atan(Math.tan(ES.rad(e.hfov) / 2) / aspect)); V.cam.fov = vfov; V.cam.aspect = aspect; V.cam.updateProjectionMatrix();
      const z = e.kind === "uav" ? e.z : ((e.zf != null ? e.zf : surfZ(e.x, e.y)) + (d.antH || d.z)), cp = Math.cos(e.pitch || 0); V.cam.position.set(e.x, z, -e.y); V.cam.lookAt(e.x + Math.cos(e.yaw) * cp, z + Math.sin(e.pitch || 0), -(e.y + Math.sin(e.yaw) * cp));
      from = `${e.name} 的视角 · 水平 ${Math.round(e.hfov)}° · 俯仰 ${Math.round(ES.deg(e.pitch || 0))}°`; V.hide = e.id;
    } else { V.cam.fov = 55; V.cam.aspect = aspect; V.cam.updateProjectionMatrix(); V.cam.position.set(-0.05 * S, 0.5 * S, 0.8 * S); V.cam.lookAt(S * 0.5, 0, -S * 0.45); V.hide = null; }
    $cap().textContent = from;
  }
  function ensureRenderer() {
    if (!window.THREE) return false;
    if (!V.renderer) {
      try { V.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("v3d"), antialias: true }); } catch (e) { $cap().textContent = "此浏览器无法创建 WebGL 画布"; return false; }
      V.renderer.shadowMap.enabled = true; V.renderer.shadowMap.type = THREE.PCFSoftShadowMap; V.renderer.outputEncoding = THREE.sRGBEncoding; V.renderer.toneMapping = THREE.ACESFilmicToneMapping; V.renderer.toneMappingExposure = 1.0; V.renderer.localClippingEnabled = true; V.cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
      ES.env.init(V.renderer);                                    // HDR pipeline (linear scene radiance, own tone mapping), shader patches: env.js
      new ResizeObserver(() => { if (V.renderer && V.A && V.scene && !WALK.active) { size(); camFromEntity(V.A); renderPreview(V.A); } }).observe(document.getElementById("preview"));
      new ResizeObserver(() => { if (V.renderer && V.scene && WALK.active) { size(); renderWalk(); } }).observe(document.getElementById("walkstage"));
      document.getElementById("preview").addEventListener("click", () => { if (WALK.active) return; V.big = !V.big; document.getElementById("preview").classList.toggle("big", V.big); });
    }
    return true;
  }
  function ensureScene(A) { const key = [A.name, A.variant, A.look, JSON.stringify(A.occ), A.bim ? 1 : 0].join("|"); if (key !== V.key) { build(A); V.key = key; V.live = null; if (V.liveEp) { V.live = buildLive(V.liveEp); V.scene.add(V.live); V.liveDoorKeep = {}; liveDoors(V.liveEp, true); } } }
  function renderPreview(A) { if (!V.renderer || !V.scene || WALK.active) return; placeAgents(A, false); ES.env.render(V.scene, V.cam, V); }

  /* ====================================== walk mode ====================================== */
  /* One kinematic body (people / dog on foot, drone in the air) against two worlds: the building model (boxes: walls with real openings, glass, floors, stairs,
     furniture, door leaves; see bimcol.js) and the outdoor raster (trunks, fences, parked cars, sheds, rubble). A body steps up onto surfaces <= its step height
     (stairs, kerbs, thresholds); wheels / legs do not climb a 0.45 m stoop in one go, so a delivery robot with step 0.05 m cannot enter a house. */
  const bimCell = (W, id) => V.bimSkip && V.bimSkip.has(W.bid[id]);
  const rasterBlocked = (W, x, y, r, body, z) => {
    if (!W.inside(x, y)) return true; const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]], rub = body === "dog" ? 0.5 : 0.2;
    for (const [a, b] of dirs) {
      const id = W.ij(x + a * r, y + b * r); if (id < 0) return true;
      if (bimCell(W, id)) { if (body === "uav") { const bf = V.col.buildingAt(x + a * r, y + b * r, 0); if (bf && z > bf.zTop - 0.25 && z < bf.zTop + bf.roofRise + 0.35) return true; } continue; }   // inside a modelled building the boxes decide
      if (body === "uav") { if (W.hB[id] > z - 0.7) return true; } else if (W.hB[id] > 0.25 || W.hT[id] > 0.05 || W.navBlk[id] || W.rub[id] > rub) return true;
    }
    return false;
  };
  const OBJR = { human: 0.3, t: 0.3, dog: 0.4, rover: 0.45, uav: 0.0 };
  const LIVE_R = { dog: 0.4, rover: 0.45, human: 0.3, "t:person": 0.3, "t:lying": 0.8 };
  /* the episode's own people / dog / robot are solid too: yours is a body, theirs follow their recorded paths and cannot step aside, so you are pushed out of them */
  function liveHit(x, y, r, z, self) {
    if (!V.live) return null;
    for (const it of V.live.userData.items) { if (it.kind === "uav" || it.id === self) continue; const m = it.model.position, rr = (LIVE_R[it.kind] || 0.3) + r, dx = x - m.x, dy = y + m.z; if (dx * dx + dy * dy < rr * rr && Math.abs(m.y - z) < 1.6) return { it, dx, dy, d: Math.hypot(dx, dy), rr }; }
    return null;
  }
  /* street-furniture footprints registered by props.js in V.propBlk: circles {x, y, r} and oriented boxes {x, y, hx, hy, yaw} (the model's true footprint; the body radius is added here) */
  function propHit(x, y, r) {
    const L = V.propBlk; if (!L) return false;
    for (let i = 0; i < L.length; i++) { const p = L[i]; if (p.hx === undefined) { const dx = x - p.x, dy = y - p.y, rr = p.r + r; if (dx * dx + dy * dy < rr * rr) return true; } else { const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0), dx = x - p.x, dy = y - p.y; if (Math.abs(c * dx + s * dy) < p.hx + r && Math.abs(-s * dx + c * dy) < p.hy + r) return true; } }
    return false;
  }
  function entBlocked(x, y, r) {           // placed entities are solid bodies too (the command-post truck, a robot, a person)
    if (liveHit(x, y, r, WALK.zf) || propHit(x, y, r)) return true;
    for (const e of V.A.ents) {
      if (e.id === V.hide || e.kind === "uav" || e.kind === "sound") continue;
      if (e.kind === "cp") { const D = V.A.scene.cp_dims || [7, 2.5, 3.3], c = Math.cos(e.yaw || 0), s = Math.sin(e.yaw || 0), dx = x - e.x, dy = y - e.y, lx = c * dx + s * dy, ly = -s * dx + c * dy; if (Math.abs(lx) < D[0] / 2 + r && Math.abs(ly) < D[1] / 2 + r) return true; continue; }
      const rr = (e.kind === "dog" ? 0.4 : e.kind === "rover" ? 0.45 : e.kind === "t:vehicle" ? 2.3 : e.kind === "t:lying" ? 0.8 : 0.3) + r; if (Math.hypot(e.x - x, e.y - y) < rr) return true;
    }
    return false;
  }
  /* highest standable surface at (x, y) that the body can step onto (feet at zf) */
  function supportZ(x, y, zf, step) {
    const f = V.col.floorAt(x, y, zf, step), g = V.A.W.groundZ(x, y), inB = V.col.buildingAt(x, y, 0);
    if (inB) return f === null ? zf : f;
    return f === null ? g : Math.max(f, g);
  }
  /* height of the surface under (x, y) for a ground entity placed there (lowest storey inside a building) */
  function surfZ(x, y) { if (!V.col) return V.A.W.groundZ(x, y); const bf = V.col && V.col.buildingAt(x, y, 0); if (bf) { const f = V.col.floorAt(x, y, bf.z0 + 0.5, 0.7); return f === null ? bf.z0 : f; } return V.A.W.groundZ(x, y); }
  function bodyOK(x, y, z, body) {         // may the body stand here (feet at z)?
    const B = BODY[body], W = V.A.W;
    if (rasterBlocked(W, x, y, B.r, body, body === "uav" ? z : 0)) return false;
    if (body === "uav") return !V.col.collides(x, y, B.r, z - B.r, z + B.r) && z - B.r > W.groundZ(x, y) + 0.05;
    if (V.col.collides(x, y, B.r, z + B.step, z + B.h)) return false;
    return !entBlocked(x, y, B.r);
  }
  /* advance the body by (dx, dy); slides along obstacles, steps up / down, opens doors it bumps into (people) */
  function moveBody(dx, dy, dz = 0) {
    const B = BODY[WALK.body], W = V.A.W; let nx = WALK.x + dx, ny = WALK.y + dy;
    if (WALK.body === "uav") {
      if (dx || dy) { if (bodyOK(nx, ny, WALK.z, "uav")) { WALK.x = nx; WALK.y = ny; } else if (bodyOK(nx, WALK.y, WALK.z, "uav")) WALK.x = nx; else if (bodyOK(WALK.x, ny, WALK.z, "uav")) WALK.y = ny; else return false; }
      if (dz) { const nz = ES.clamp(WALK.z + dz, 0.4, 150); if (bodyOK(WALK.x, WALK.y, nz, "uav")) WALK.z = nz; }
      return true;
    }
    const before = [WALK.x, WALK.y];
    const zAt = (px, py) => Math.max(WALK.zf, supportZ(px, py, WALK.zf, B.step));          // the feet will stand on the surface under the new spot (a stair tread): collide from that height, not from the old one (else the second riser blocks the first step)
    const r = V.col.resolve(nx, ny, B.r, zAt(nx, ny), B.h, B.step);
    if (r.doorHit && WALK.body === "human" && r.doorHit.open < 0.3 && !r.doorHit.locked) setDoor(r.doorHit, 1);
    const tryAt = (px, py) => { if (rasterBlocked(W, px, py, B.r, WALK.body, 0) || entBlocked(px, py, B.r)) return false; const zs = supportZ(px, py, WALK.zf, B.step); if (zs - WALK.zf > B.step + 1e-3) return false; WALK.x = px; WALK.y = py; WALK.zf = zs; return true; };
    if (!tryAt(r.x, r.y)) { const r2 = V.col.resolve(nx, WALK.y, B.r, zAt(nx, WALK.y), B.h, B.step), r3 = V.col.resolve(WALK.x, ny, B.r, zAt(WALK.x, ny), B.h, B.step); if (!tryAt(r2.x, r2.y)) tryAt(r3.x, r3.y); }
    return Math.hypot(WALK.x - before[0], WALK.y - before[1]) > 0.02 * Math.hypot(dx, dy);
  }
  function nearestFree(x, y, body, zf) {
    if (body === "uav") { for (let d = 0; d < 14; d += 0.5) for (let a = 0; a < 6.28; a += 0.5) { const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; if (bodyOK(px, py, zf, "uav")) return [px, py]; } return [x, y]; }
    const B = BODY[body], z0 = surfZ(x, y);
    for (let d = 0; d < 14; d += 0.4) for (let a = 0; a < 6.28; a += d === 0 ? 7 : 0.45) { const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, zs = surfZ(px, py); if (bodyOK(px, py, zs, body)) return [px, py, zs]; }
    return [x, y, z0];
  }
  /* doors: shared state between the collision model and the rendered leaf */
  function setDoor(d, open) { V.col.setDoor(d, open); const bb = V.bimB[d.bid], info = bb && bb.doors[d.tag]; if (info) { info.open = open; ES.bim.applyDoor(info); } }
  function toggleNearestDoor() {
    const near = V.col.nearestDoor(WALK.x, WALK.y, WALK.zf, 1.9); if (!near) { WALK.hooks.toast && WALK.hooks.toast("附近没有门"); return; }
    const d = near.door, to = d.open < 0.5 ? 1 : 0; WALK.doorAnim = WALK.doorAnim || []; WALK.doorAnim = WALK.doorAnim.filter((a) => a.d !== d); WALK.doorAnim.push({ d, to }); WALK.hooks.toast && WALK.hooks.toast(to ? "开门" : "关门");
  }
  function tickDoors(dt) {
    const L = WALK.doorAnim; if (!L || !L.length) return;
    for (let i = L.length - 1; i >= 0; i--) { const a = L[i], o = a.d.open, n = o + Math.sign(a.to - o) * dt * 1.6; if (Math.abs(a.to - n) < 0.05) { setDoor(a.d, a.to); L.splice(i, 1); } else setDoor(a.d, n); }
  }
  function ensureSelf() {
    const key = WALK.body; if (V.self && V.selfKey === key && V.self.parent === V.scene) return;
    if (V.self && V.self.parent) V.self.parent.remove(V.self); V.selfKey = key; V.selfTrk = null; V.selfT = 0; V.self = agentModel({ kind: key, id: -1, x: 0, y: 0, z: 0, yaw: 0 }, { noBeacon: true, label: false, self: true }); V.self.userData.dyn = true; V.self.rotation.order = "YZX"; V.scene.add(V.self);
  }
  function updateSelf() {
    ensureSelf(); const m = V.self, P = m.userData.parts || {}, show = WALK.view === "chase"; m.visible = show; if (!show) return;
    const z = WALK.body === "uav" ? WALK.z : WALK.zf; m.position.set(WALK.x, z, -WALK.y); m.rotation.y = WALK.yaw;
    const srig = m.userData.rig;
    if (srig) {                                     // detailed rig: same state struct as the live agents (own velocity / acceleration come from the real motion of the body)
      const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - (V.selfT || now)) / 1000)), zv = WALK.body === "uav" ? WALK.z : WALK.zv; V.selfT = now; m.position.y = zv;
      const st = ES.actors.track(V.selfTrk || (V.selfTrk = {}), dt, WALK.x, WALK.y, zv, WALK.yaw, { vmax: WALK.body === "uav" ? 40 : 12 });
      st.t = now / 1000; st.id = "self"; st.live = false; st.role = "self"; st.view = WALK.view; st.night = ES.actors.isNight(); st.head = [0, WALK.pitch]; st.gimbal = null; st.gaitPhase = WALK.body === "human" ? WALK.phase : null;          // the avatar's legs follow the same phase the footstep sounds use
      if (WALK.body === "dog") groundTilt(st, WALK.x, WALK.y, WALK.yaw, WALK.zf); else if (WALK.body === "uav") { const U = WALK.uav || {}; st.pitch = -(U.pitch || 0); st.roll = -(U.roll || 0); st.landed = !!U.landed; st.gimbal = [WALK.yaw, WALK.pitch]; }
      srig.update(dt, st); return;
    }
    if (WALK.body === "dog") {
      const c = Math.cos(WALK.yaw), s = Math.sin(WALK.yaw), zf_ = supportZ(WALK.x + c * 0.3, WALK.y + s * 0.3, WALK.zf, 0.3), zb_ = supportZ(WALK.x - c * 0.3, WALK.y - s * 0.3, WALK.zf, 0.3);
      m.rotation.z = ES.clamp(Math.atan2(zf_ - zb_, 0.6), -0.5, 0.5); m.position.y = WALK.zv; const rig = P.rig; if (rig) { const bob = rig.gait(WALK.speed || 0, WALK.phase || 0); rig.root.position.y = rig.baseY + bob; }
    } else if (WALK.body === "uav") {
      const U = WALK.uav || {}, rig = P.rig; if (rig) { rig.root.rotation.z = -(U.pitch || 0); rig.root.rotation.x = -(U.roll || 0); }
    } else { m.position.y = WALK.zv; const sw = (WALK.speed || 0) > 0.1 ? Math.sin((WALK.phase || 0) * 6.283) * Math.min(0.7, 0.25 + 0.2 * WALK.speed) : 0; (P.legs || []).forEach((l, i) => { l.rotation.z = i % 2 ? sw : -sw; }); (P.arms || []).forEach((l, i) => { l.rotation.z = i % 2 ? -sw : sw; }); }
  }
  function walkCamera() {
    const A = V.A, B = BODY[WALK.body], z = WALK.body === "uav" ? WALK.z : WALK.zv + B.eye + Math.sin(WALK.bob) * (WALK.body === "human" ? 0.03 : 0.012);
    const aspect = V.w / V.h, vfov = ES.deg(2 * Math.atan(Math.tan(ES.rad(WALK.fov) / 2) / aspect)); V.cam.fov = vfov; V.cam.aspect = aspect; V.cam.near = WALK.body === "uav" ? 0.12 : 0.05; V.cam.updateProjectionMatrix();
    if (WALK.view === "chase") {                    // behind and above the body, pulled in when something is in the way
      const back = WALK.body === "uav" ? 3.4 : WALK.body === "dog" ? 1.9 : 2.6, up = WALK.body === "uav" ? 1.0 : WALK.body === "dog" ? 0.85 : 1.1, bz = WALK.body === "uav" ? WALK.z : WALK.zv, cp = Math.cos(WALK.pitch * 0.6), sp = Math.sin(WALK.pitch * 0.6);
      let t = 1, px = WALK.x, py = WALK.y, pz = bz + up; for (; t > 0.08; t -= 0.07) { px = WALK.x - Math.cos(WALK.yaw) * back * cp * t; py = WALK.y - Math.sin(WALK.yaw) * back * cp * t; pz = bz + up + back * t * -sp; if (!V.col.collides(px, py, 0.14, pz - 0.14, pz + 0.14) && pz > A.W.groundZ(px, py) + 0.12) break; }
      V.cam.position.set(px, pz, -py); V.cam.lookAt(WALK.x, bz + (WALK.body === "human" ? 1.2 : WALK.body === "dog" ? 0.3 : 0.1), -WALK.y); WALK.eyeZ = pz; return;
    }
    const cp = Math.cos(WALK.pitch); V.cam.position.set(WALK.x, z, -WALK.y); V.cam.lookAt(WALK.x + Math.cos(WALK.yaw) * cp, z + Math.sin(WALK.pitch), -(WALK.y + Math.sin(WALK.yaw) * cp)); WALK.eyeZ = z;
  }
  let walkAgentsKey = "";
  function placeAgentsWalk() {      // user-placed entities are static in the walk view; rebuilt only when they change
    const A = V.A, key = JSON.stringify(A.ents.map((e) => [e.id, e.kind, e.x, e.y, e.z, e.yaw])) + A.look + V.hide; if (key === walkAgentsKey && V.agents && V.agents.parent) return; walkAgentsKey = key; placeAgents(A, true);
  }
  /* building LOD + exposure + nearby room lights; run once per frame */
  function updateWorld(dt) {
    const cp = V.cam.position, x = cp.x, y = -cp.z, inside = !!V.col.roomAt(x, y, cp.y - 0.2);
    for (const bb of Object.values(V.bimB)) {
      const dx = Math.max(bb.lo[0] - x, 0, x - bb.hi[0]), dy = Math.max(bb.lo[1] - y, 0, y - bb.hi[1]), near = Math.hypot(dx, dy) < 75;
      for (const g of bb.interior) if (g.visible !== (near && g.userData.vis !== false)) g.visible = near && g.userData.vis !== false;
    }
    // eye adaptation: a person indoors sees a room as bright as the street (exposure up), looking out a window the street is overexposed
    const night = V.A.look === "night", ex = ES.interior && ES.interior.update ? ES.interior.update(dt, V, inside) : null;           // interior.js: baked room light, switches, adaptation from the luminance in view
    if (ex !== null) { V.exposure = ex; V.renderer.toneMappingExposure = V.exposure; }
    else { const tgt = (night ? 1.5 : 1.0) * (inside ? (night ? 1.2 : 1.25) : 1.0); V.exposure += (tgt - V.exposure) * Math.min(1, dt * 1.8); V.renderer.toneMappingExposure = V.exposure; }
    // point lights for the nearest lit fixtures (day and night): spill light through windows and onto the floor (replaced by the baked room lights when interior.js is active)
    if (V.roomLights && ex === null) { const ls = V.lightProbe.map((l) => ({ l, d: Math.hypot(l.p[0] - x, l.p[1] + cp.z) + Math.abs(l.p[2] - cp.y) * 0.5 })).sort((a, b) => a.d - b.d); V.roomLights.forEach((pl, i) => { const q = ls[i]; if (q && q.d < 40) { pl.visible = true; pl.position.set(q.l.p[0], q.l.p[2] - 0.15, -q.l.p[1]); pl.color.copy(q.l.cct < 3500 ? new THREE.Color(1.0, 0.82, 0.58) : new THREE.Color(0.9, 0.95, 1.0)); pl.intensity = night ? 3.5 : 0.45; } else pl.visible = false; }); }
  }
  function ensureRoomLights() { if (V.roomLights && V.roomLights[0] && V.roomLights[0].parent === V.scene) return; V.roomLights = []; for (let i = 0; i < 6; i++) { const pl = new THREE.PointLight(0xffd9a0, 0, 14, 1.8); pl.visible = false; V.scene.add(pl); V.roomLights.push(pl); } }
  function renderWalk() {
    if (!V.renderer || !V.scene) return; walkCamera(); updateSelf(); placeAgentsWalk(); ensureRoomLights(); updateWorld(0.016); ES.env.render(V.scene, V.cam, V);
  }
  /* ---- vehicle dynamics of the controlled body ---- */
  const DYN = { human: { acc: 2.6, dec: 4.2, turn: 2.6, strafe: 0.7, rate: 9 }, dog: { acc: 1.7, dec: 2.6, turn: 1.9, strafe: 0.55, rate: 8 } };
  const BATT_WH = 62, P_HOVER = 108;                          // Skydio X2 class: ~35 min of hover from a ~62 Wh pack
  function stepFoot(dt, now, k) {
    const B = BODY[WALK.body], D = DYN[WALK.body], dyn = WALK.dyn || (WALK.dyn = { vf: 0, vs: 0, w: 0 });
    const mv = (k.w || k.up ? 1 : 0) - (k.s || k.down ? 1 : 0), st = (k.d ? 1 : 0) - (k.a ? 1 : 0), turn = (k.q || k.left ? 1 : 0) - (k.e || k.right ? 1 : 0);
    const slope = Math.abs(WALK.zf - (WALK.zPrev ?? WALK.zf)) / Math.max(dt, 1e-3); WALK.zPrev = WALK.zf; const vmax = (k.shift ? B.run : B.v) * WALK.speedMul * (slope > 0.25 ? 0.55 : 1);
    let tf = mv * vmax, ts = st * vmax * D.strafe, tw = turn * D.turn;
    if (WALK.goal && !mv && !st) {                // walking to a clicked spot
      const g = WALK.goal, dx = g.x - WALK.x, dy = g.y - WALK.y, d = Math.hypot(dx, dy);
      if (d < 0.25) WALK.goal = null; else { const want = Math.atan2(dy, dx); let da = want - WALK.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); tw = ES.clamp(da * 3, -D.turn, D.turn); tf = Math.max(0, Math.cos(da)) * Math.min(vmax * 1.6, d * 1.5); ts = 0; }
    } else if (mv || st) WALK.goal = null;
    const fx = (cur, tgt, a, dcc) => cur + ES.clamp(tgt - cur, -dcc * dt, a * dt);
    dyn.vf = fx(dyn.vf, tf, D.acc, D.dec); dyn.vs = fx(dyn.vs, ts, D.acc, D.dec); dyn.w = dyn.w + ES.clamp(tw - dyn.w, -D.turn * 6 * dt, D.turn * 6 * dt); WALK.yaw += dyn.w * dt;
    const c = Math.cos(WALK.yaw), s = Math.sin(WALK.yaw), vx = c * dyn.vf + s * dyn.vs, vy = s * dyn.vf - c * dyn.vs;
    if (Math.abs(dyn.vf) > 0.02 || Math.abs(dyn.vs) > 0.02) {
      const moved = moveBody(vx * dt, vy * dt, 0);
      if (!moved) { dyn.vf *= 0.4; dyn.vs *= 0.4; if (WALK.goal) { WALK.goal.stuck = (WALK.goal.stuck || 0) + dt; if (WALK.goal.stuck > 0.7) { WALK.goal = null; WALK.hooks.toast && WALK.hooks.toast("过不去:被墙、家具、台阶或关着的门挡住"); } } else if (WALK.hooks.toast && now - (WALK.toastAt || -1e9) > 1800) { WALK.toastAt = now; WALK.hooks.toast("被挡住了(墙、家具、台阶过高、车或树干)"); } } else if (WALK.goal) WALK.goal.stuck = 0;
    }
    const sp = Math.hypot(dyn.vf, dyn.vs); WALK.speed = sp; WALK.bob += dt * (sp > 0.05 ? 3.2 + 2.2 * sp : 0); WALK.phase = (WALK.phase || 0) + dt * (WALK.body === "human" && ES.humans && ES.humans.cycleRate ? ES.humans.cycleRate(sp) : 1.6 + 1.1 * Math.min(sp, 1.6));          // full gait cycles: people = v / stride (stride 1.26 m at 1.4 m/s, heel strike of the left foot at integer phase), the dog's trot keeps its own rate
    const dzv = WALK.zf - WALK.zv; WALK.zv += dzv * Math.min(1, dt * (dzv > 0 ? 12 : 9)); if (Math.abs(dzv) > 3) WALK.zv = WALK.zf;
  }
  /* quadrotor: commanded velocity -> bounded acceleration (first-order lag), body tilt = atan(a / g), gimbal-stabilised camera, battery with hover + climb + drag power, ground contact */
  function stepUav(dt, now, k) {
    const U = WALK.uav || (WALK.uav = { vx: 0, vy: 0, vz: 0, roll: 0, pitch: 0, w: 0, batt: BATT_WH, landed: false, crash: 0 }), B = BODY.uav, W = V.A.W;
    const fw = (k.w || k.up ? 1 : 0) - (k.s || k.down ? 1 : 0), st = (k.d ? 1 : 0) - (k.a ? 1 : 0), up = (k.space ? 1 : 0) - (k.c ? 1 : 0), turn = (k.q || k.left ? 1 : 0) - (k.e || k.right ? 1 : 0);
    const vmax = (k.shift ? 16 : 7) * WALK.speedMul, empty = U.batt <= 0, low = U.batt < 0.06 * BATT_WH;
    let cf = fw * vmax, cs = st * vmax, cz = up * (k.shift ? 5 : 3.5); { const m = Math.hypot(cf, cs); if (m > vmax) { cf *= vmax / m; cs *= vmax / m; } }
    if (low && !empty) { cz = Math.min(cz, -1.2); if (!U.warned) { U.warned = true; WALK.hooks.toast && WALK.hooks.toast("电量低:自动降落"); } }
    if (empty) { cz = -9; cf = cs = 0; }
    const gnd = W.groundZ(WALK.x, WALK.y) + 0.12;
    U.w += ES.clamp(turn * 1.8 - U.w, -9 * dt, 9 * dt); WALK.yaw += U.w * dt;
    const c = Math.cos(WALK.yaw), s = Math.sin(WALK.yaw), tvx = c * cf + s * cs, tvy = s * cf - c * cs, tau = 0.45, amax = 6.5, azmax = 4.5;
    let ax = (tvx - U.vx) / tau, ay = (tvy - U.vy) / tau, az = (cz - U.vz) / tau; const ah = Math.hypot(ax, ay); if (ah > amax) { ax *= amax / ah; ay *= amax / ah; } az = ES.clamp(az, -azmax, azmax * 0.9);
    U.vx += ax * dt; U.vy += ay * dt; U.vz += az * dt;
    // body attitude follows the acceleration in the body frame (forward accel -> nose down)
    const aF = c * ax + s * ay, aL = -s * ax + c * ay; U.pitch += (ES.clamp(Math.atan2(aF, 9.81), -0.6, 0.6) - U.pitch) * Math.min(1, dt * 10); U.roll += (ES.clamp(Math.atan2(aL, 9.81), -0.6, 0.6) - U.roll) * Math.min(1, dt * 10);
    const dx = U.vx * dt, dy = U.vy * dt, dz = U.vz * dt, ox = WALK.x, oy = WALK.y, oz = WALK.z;
    moveBody(dx, dy, dz);
    const hitXY = Math.hypot(WALK.x - ox, WALK.y - oy) < 0.7 * Math.hypot(dx, dy) - 1e-6, hitZ = Math.abs(WALK.z - oz) < 0.7 * Math.abs(dz) - 1e-6;
    if (hitXY || hitZ) { const spd = Math.hypot(U.vx, U.vy, U.vz); if (spd > 3.5 && now - U.crash > 1500) { U.crash = now; WALK.hooks.toast && WALK.hooks.toast(`撞击 ${spd.toFixed(1)} m/s(碰到了墙、窗、天花板或树)`); } if (hitXY) { U.vx *= -0.15; U.vy *= -0.15; } if (hitZ) U.vz = 0; }
    if (WALK.z < gnd) { WALK.z = gnd; if (U.vz < 0) U.vz = 0; U.landed = !up || empty; } else U.landed = false;
    if (U.landed && !up) { U.vx *= 0.8; U.vy *= 0.8; }
    const vh = Math.hypot(U.vx, U.vy), P = U.landed ? 3 : P_HOVER + 3.2 * vh * vh + 95 * Math.max(U.vz, 0) + 12 * Math.abs(U.w); U.batt = Math.max(0, U.batt - P * dt / 3600);
    WALK.speed = vh; WALK.vz = U.vz; WALK.batt = U.batt / BATT_WH;
  }
  function advance(dt, now) {
    const k = WALK.keys; tickDoors(dt);
    if (WALK.body === "uav") stepUav(dt, now, k); else { stepFoot(dt, now, k); pushedByLive(); }
  }
  function pushedByLive() {                 // a moving live agent that walks into you pushes you aside (it cannot avoid you); never into a wall
    const B = BODY[WALK.body], h = liveHit(WALK.x, WALK.y, B.r, WALK.zf); if (!h) return;
    const d = h.d || 1e-3, push = (h.rr - d) + 0.01, nx = WALK.x + (h.dx / d) * push, ny = WALK.y + (h.dy / d) * push;
    if (bodyOK(nx, ny, WALK.zf, WALK.body)) { WALK.x = nx; WALK.y = ny; } else if (WALK.hooks.toast && performance.now() - (WALK.pushToast || 0) > 2500) { WALK.pushToast = performance.now(); WALK.hooks.toast("被走过来的人/机器挤住了"); }
  }
  function tick(now) {
    if (!WALK.active) return; WALK.raf = requestAnimationFrame(tick); const dt = Math.min(0.1, (now - (WALK.last || now)) / 1000); WALK.last = now;
    advance(dt, now); tickLive(now); tickParked(dt, now); renderWalk(); ES.bus.emit("walk:frame", dt, now, WALK, V);          // sensors / audio / HUD modules hook in here (after the main view is drawn)
    if (now - WALK.hud > 200) { WALK.hud = now; if (WALK.hooks.onMove) WALK.hooks.onMove({ x: WALK.x, y: WALK.y, z: WALK.eyeZ, zf: WALK.zf, yaw: WALK.yaw, body: WALK.body, speed: WALK.speed || 0, vz: WALK.vz || 0, batt: WALK.batt ?? 1, pitch: WALK.pitch, alt: WALK.body === "uav" ? WALK.z - V.A.W.groundZ(WALK.x, WALK.y) : 0, view: WALK.view }); }
  }
  /* pointer: drag = look (grab-the-world, like street view), click on a floor / the ground = walk there, wheel = zoom */
  let drag = null;
  function onDown(e) { if (!WALK.active) return; e.currentTarget.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0, yaw: WALK.yaw, pitch: WALK.pitch }; }
  function onMove(e) { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy)); if (drag.moved > 4) { const k = 0.0042 * (WALK.fov / 75); WALK.yaw = drag.yaw + dx * k; WALK.pitch = ES.clamp(drag.pitch + dy * k, -1.45, 1.45); } }
  function onUp(e) { if (!drag) return; const d = drag; drag = null; if (d.moved <= 4) clickGo(e); }
  function clickGo(e) {
    const A = V.A, r = e.currentTarget.getBoundingClientRect(), nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), rc = new THREE.Raycaster(); rc.setFromCamera(nd, V.cam);
    if (WALK.body === "uav") { WALK.hooks.toast && WALK.hooks.toast("无人机用 WASD 飞行,空格/C 升降"); return; }
    // first floor-like surface hit (building meshes), else the outdoor ground plane
    let hit = null; const meshes = []; for (const bb of Object.values(V.bimB)) bb.group.traverse((o) => { if (o.isMesh && o.visible && o.parent.visible && !(o.material && o.material.userData && o.material.userData.glass)) meshes.push(o); });
    const hits = rc.intersectObjects(meshes, false); for (const h of hits) { if (h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.7) { hit = h.point; break; } if (h.distance < 60) break; }
    let px, py, pz;
    if (hit) { px = hit.x; py = -hit.z; pz = hit.y; }
    else { const gy = A.W.groundZ(WALK.x, WALK.y) + 0.02; if (rc.ray.direction.y > -0.02) { WALK.hooks.toast && WALK.hooks.toast("点地面或地板才能走过去"); return; } const t = (gy - rc.ray.origin.y) / rc.ray.direction.y; px = rc.ray.origin.x + rc.ray.direction.x * t; py = -(rc.ray.origin.z + rc.ray.direction.z * t); pz = gy; }
    const B = BODY[WALK.body]; if (!A.W.inside(px, py)) { WALK.hooks.toast && WALK.hooks.toast("那里站不了"); return; }
    const zs = supportZ(px, py, pz, 0.15); if (!bodyOK(px, py, zs, WALK.body)) { WALK.hooks.toast && WALK.hooks.toast("那里站不了(家具、墙、围栏或障碍)"); return; }
    WALK.goal = { x: px, y: py, stuck: 0 };
  }
  function onWheel(e) { if (!WALK.active) return; e.preventDefault(); WALK.fov = ES.clamp(WALK.fov * Math.exp(e.deltaY * 0.001), 35, 110); }
  const KEYMAP = ES.controls.MOVE;                                          // key code -> movement name; the HUD legend is drawn from the same table (controls.js)
  function onKey(e, down) { if (!WALK.active || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return; if (e.repeat && down) { if (KEYMAP[e.code]) e.preventDefault(); return; } const took = ES.controls.onKey(e.code, down, WALK.body); if (took) { e.preventDefault(); return; } if (down && e.code === "KeyF") { e.preventDefault(); toggleNearestDoor(); return; } if (down && e.code === "KeyV") { e.preventDefault(); walk.setView(WALK.view === "chase" ? "fpv" : "chase"); return; } const k = KEYMAP[e.code]; if (!k) { if (down && e.code === "Escape" && WALK.hooks.requestExit) WALK.hooks.requestExit(); return; } e.preventDefault(); WALK.keys[k] = down; }
  window.addEventListener("keydown", (e) => onKey(e, true)); window.addEventListener("keyup", (e) => onKey(e, false)); window.addEventListener("blur", () => { WALK.keys = {}; });

  const walk = {
    get active() { return WALK.active; }, state: WALK, BODY,
    async enter(A, opt) {
      await loadThree(); V.A = A; if (!ensureRenderer()) return false; await loadBim(A); ensureScene(A); const body = opt.body || "human", B = BODY[body]; WALK.body = body; WALK.fov = opt.fov || B.fov; WALK.pitch = opt.pitch ?? (body === "uav" ? -0.35 : 0); WALK.yaw = opt.yaw || 0; WALK.z = opt.z || 28; WALK.goal = null; WALK.keys = {}; WALK.hooks = opt.hooks || {}; WALK.doorAnim = [];
      const [x, y, zs] = nearestFree(opt.x, opt.y, body, WALK.z); WALK.x = x; WALK.y = y; WALK.zf = opt.zf != null && body !== "uav" ? opt.zf : zs ?? 0; WALK.zv = WALK.zf;
      const stage = document.getElementById("walkstage"), cv = document.getElementById("v3d"); stage.hidden = false; stage.appendChild(cv);
      cv.onpointerdown = onDown; cv.onpointermove = onMove; cv.onpointerup = onUp; cv.onwheel = onWheel; cv.style.touchAction = "none"; cv.style.cursor = "grab";
      WALK.active = true; WALK.last = 0; V.hide = opt.hideId ?? null; walkAgentsKey = ""; V.exposure = 1; WALK.view = "fpv"; WALK.dyn = null; WALK.uav = null; WALK.speed = 0; WALK.phase = 0; WALK.zPrev = WALK.zf; if (V.self && V.self.parent) V.self.parent.remove(V.self); V.self = null; size(); cancelAnimationFrame(WALK.raf); WALK.raf = requestAnimationFrame(tick); if (WALK.hooks.onMove) WALK.hooks.onMove({ x: WALK.x, y: WALK.y, z: B.eye, zf: WALK.zf, yaw: WALK.yaw, body: WALK.body }); ES.bus.emit("walk:enter", WALK, V); return true;
    },
    setBody(name) { const B = BODY[name]; if (!B) return; WALK.body = name; WALK.fov = B.fov; WALK.goal = null; WALK.dyn = null; WALK.uav = null; if (name === "uav") { WALK.pitch = -0.35; WALK.z = Math.max(WALK.z, WALK.zf + 2.0, 6); } else WALK.pitch = 0; const [x, y, zs] = nearestFree(WALK.x, WALK.y, name, name === "uav" ? WALK.z : WALK.zf); WALK.x = x; WALK.y = y; if (name !== "uav") { WALK.zf = zs ?? WALK.zf; WALK.zv = WALK.zf; } },
    teleport(x, y) { const [px, py, zs] = nearestFree(x, y, WALK.body, WALK.body === "uav" ? WALK.z : surfZ(x, y)); WALK.goal = null; WALK.x = px; WALK.y = py; if (WALK.body !== "uav") { WALK.zf = zs ?? WALK.zf; WALK.zv = WALK.zf; } },
    setKey(k, v) { WALK.keys[k] = v; },
    toggleDoor() { toggleNearestDoor(); },
    setView(v) { WALK.view = v; if (V.self) V.self.visible = v === "chase"; WALK.hooks.toast && WALK.hooks.toast(v === "chase" ? "跟随视角(V 切换)" : "第一人称(V 切换)"); if (WALK.hooks.onView) WALK.hooks.onView(v); },
    advance(dt) { advance(dt, performance.now()); renderWalk(); },      // one simulation step (also used by tests: the browser pauses animation frames in hidden tabs)
    exit() {
      if (!WALK.active) return; WALK.active = false; ES.bus.emit("walk:exit", WALK, V); cancelAnimationFrame(WALK.raf); const cv = document.getElementById("v3d"); cv.onpointerdown = cv.onpointermove = cv.onpointerup = cv.onwheel = null; cv.style.cursor = ""; cv.style.touchAction = ""; V.exposure = 1; if (V.renderer) V.renderer.toneMappingExposure = 1;
      document.getElementById("preview").insertBefore(cv, document.getElementById("v3dcap")); document.getElementById("walkstage").hidden = true; if (V.agents) { V.scene.remove(V.agents); V.agents = null; } size(); if (V.A) ES.view3d.update(V.A);
    },
    setLive(ep, on, speed) { if (V.live && V.scene) V.scene.remove(V.live); liveDoors(null, false); V.live = null; V.liveEp = on ? ep : null; V.liveSpeed = speed || 1; if (on && ep && V.scene) { V.live = buildLive(ep); V.scene.add(V.live); liveDoors(ep, true); } },
    surfZ, V,
  };
  async function loadBim(A) { if (A.bimFor !== A.name) { A.bimFor = A.name; A.bim = null; } if (A.bim === null || A.bim === undefined) { A.bim = (await ES.bimLoad(A.name)) || false; } return A.bim; }
  ES.bus.on("models", () => {
    if (!V.scene || !V.A) return;
    (V.vehGroups || []).forEach((g, i) => { const ph = g.children[0]; if (ph && ph.userData.ph) { const v = V.A.W.vehicles[i], real = ES.models.vehicleSync(v.vtype || "sedan", v.color != null ? v.color : i); if (real) { g.remove(ph); g.add(real); } } });
    walkAgentsKey = ""; upgradeLive();
    if (V.self && !V.self.userData.rig && ES.actors && ES.actors.has(V.selfKey === "human" ? "human" : V.selfKey)) { if (V.self.parent) V.self.parent.remove(V.self); V.self = null; }          // your own body: swap the primitive for the real rig once its files are in
    if (V.renderer && !WALK.active) renderPreview(V.A);
  });
  ES.view3d = {
    walk,
    update(A) {
      V.A = A; if (!A.scene || !A.W) return;
      if (!window.THREE) { $cap().textContent = "加载 3D 引擎…"; loadThree().then(() => ES.view3d.update(A)).catch(() => { $cap().textContent = "3D 预览不可用(无法加载 three.js)"; }); return; }
      if (!ensureRenderer()) return; size();
      if (A.bimFor !== A.name || A.bim === undefined || A.bim === null) { loadBim(A).then(() => { V.key = ""; ES.view3d.update(A); }); return; }
      ensureScene(A);
      if (WALK.active) return;
      camFromEntity(A); renderPreview(A);
    },
    /* the scene or look changed while walking: rebuild the scene around the same spot */
    refresh(A) { V.A = A; if (V.renderer && WALK.active) { V.key = ""; ensureScene(A); walkAgentsKey = ""; } },
  };
})();
