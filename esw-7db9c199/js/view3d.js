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
  const V = { key: "", renderer: null, scene: null, cam: null, agents: null, lamps: [], A: null, hide: null, tex: null, live: null };
  const WALK = { active: false, x: 0, y: 0, yaw: 0, pitch: 0, body: "human", z: 28, fov: 75, keys: {}, tween: null, bob: 0, raf: 0, last: 0, hud: 0, hooks: {}, speedMul: 1 };
  const BODY = { human: { eye: 1.6, r: 0.3, v: 1.4, run: 3.8, fov: 75, label: "人(1.6 m)" }, dog: { eye: 0.45, r: 0.25, v: 1.0, run: 2.6, fov: 100, label: "机械狗(0.45 m)" }, uav: { eye: 0, r: 0.6, v: 6, run: 16, fov: 84, label: "无人机(飞行)" } };
  const WALL = { house: 0xe0c4a0, cottage: 0xdcc09c, apartment: 0xb5654f, rowhouse: 0xc27a5e, commercial: 0xb4a89a, campus: 0xb4694f, warehouse: 0xc3c9ce, factory: 0xb4bac0, office: 0x9fb2c6, civic: 0xc3b6a4 };
  const ROOF = { house: 0x6d5a4f, cottage: 0x7a5148, apartment: 0x77797c, rowhouse: 0x7d5a4a, commercial: 0x6f7378, campus: 0x7a6a64, warehouse: 0x9a3a32, factory: 0x7c7f83, office: 0x6f7378, civic: 0x7a7168 };
  const mkRng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  /* ====================================== procedural textures ====================================== */
  function ctex(w, h, draw, repeat, seed = 1) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h, mkRng(seed));
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = V.renderer ? Math.min(8, V.renderer.capabilities.getMaxAnisotropy()) : 4; if (repeat) t.repeat.set(repeat[0], repeat[1]); return t;
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
  function skyDome(night) {
    const top = night ? 0x050a1c : 0x3f86cf, hor = night ? 0x1b2547 : 0xcfe2f4, sunDir = new THREE.Vector3(-0.45, 0.62, 0.55);
    const m = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 14), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(hor) }, sunDir: { value: sunDir }, sunCol: { value: new THREE.Color(night ? 0x000000 : 0xfff0cf) } },
      vertexShader: "varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "varying vec3 vP; uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; void main(){ vec3 d=normalize(vP); float h=clamp(d.y,0.0,1.0); vec3 c=mix(hor,top,pow(h,0.5)); float s=max(dot(d,normalize(sunDir)),0.0); c+=sunCol*(pow(s,900.0)*3.0+pow(s,10.0)*0.22); gl_FragColor=vec4(c,1.0); }" }));
    m.renderOrder = -10; m.userData.dyn = true; return { mesh: m, horizon: hor };
  }
  function stars() { const n = 900, p = new Float32Array(n * 3), r = mkRng(5); for (let i = 0; i < n; i++) { const th = r() * 6.283, ph = Math.acos(0.05 + 0.95 * r()), R = 1700; p[i * 3] = R * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = R * Math.cos(ph); p[i * 3 + 2] = R * Math.sin(ph) * Math.sin(th); } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); const pt = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })); pt.userData.dyn = true; return pt; }

  /* ====================================== scene ====================================== */
  const shape = (ring, holes) => { const sh = new THREE.Shape(ring.map((p) => new THREE.Vector2(p[0], p[1]))); (holes || []).forEach((h) => sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))))); return sh; };
  const flat = (ring, holes, mat, y) => { const g = new THREE.ShapeGeometry(shape(ring, holes)); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = true; return m; };
  const slab = (ring, holes, topMat, sideMat, depth) => { const g = new THREE.ExtrudeGeometry(shape(ring, holes), { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, [topMat, sideMat]); m.receiveShadow = true; return m; };
  const lam = (o) => new THREE.MeshLambertMaterial(o);
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
    const sky = skyDome(night); scn.background = new THREE.Color(sky.horizon); scn.fog = new THREE.Fog(sky.horizon, 120, night ? 520 : 900);
    V.sky = sky.mesh; scn.add(sky.mesh); V.stars = null; if (night) { V.stars = stars(); scn.add(V.stars); }
    scn.add(new THREE.HemisphereLight(night ? 0x35467a : 0xdfeaff, night ? 0x10140f : 0x6a7a52, night ? 0.6 : 0.85));
    const sun = new THREE.DirectionalLight(night ? 0x6f86c4 : 0xfff1d8, night ? 0.4 : 1.0); sun.position.set(S * 0.5 - 90, 130, -S * 0.5 + 110); sun.target.position.set(S / 2, 0, -S / 2);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); const sc2 = sun.shadow.camera; sc2.left = -S * 0.8; sc2.right = S * 0.8; sc2.top = S * 0.8; sc2.bottom = -S * 0.8; sc2.near = 10; sc2.far = 500; sun.shadow.bias = -0.0005; scn.add(sun, sun.target);
    // ground: wide grass plane, lawn blocks (raised 0.14), parks, sidewalks with kerbs, roads, markings
    const gt = T.grass.clone(); gt.needsUpdate = true; gt.repeat.set(4000 / 2.5, 4000 / 2.5); const gp = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), lam({ map: gt, color: night ? 0x2a3b2a : 0xffffff })); gp.rotation.x = -Math.PI / 2; gp.position.y = -0.01; gp.receiveShadow = true; scn.add(gp);
    const m = (map, col) => lam({ map, color: col || 0xffffff }), grassM = m(T.grass), sideC = m(T.sidewalk, 0xd6d3c8), conc = m(T.concrete), grav = m(T.gravel);
    for (const b of sc.blocks) scn.add(slab(b.ring, null, b.ground === "paved" ? conc : b.ground === "gravel" ? grav : grassM, sideC, 0.14));
    for (const p of sc.parks) scn.add(flat(p, null, grassM, 0.15)); for (const p of sc.plazas) scn.add(flat(p, null, conc, 0.15));
    for (const p of sc.ponds) scn.add(flat(p, null, lam({ color: 0x4f8fc0, transparent: true, opacity: 0.85 }), 0.1));
    for (const p of sc.sidewalk_poly) scn.add(slab(p.ring, p.holes, m(T.sidewalk), sideC, 0.16)); for (const p of sc.path_poly) scn.add(slab(p.ring, p.holes, m(T.sidewalk), sideC, 0.164));
    for (const p of sc.road_poly) scn.add(flat(p.ring, p.holes, m(T.asphalt), 0.012));
    const stripe = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
    for (const c of sc.centrelines) if (c.dashed) for (let k = 0; k + 1 < c.line.length; k++) { const a = c.line[k], b = c.line[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 1; t < L - 3; t += 6) { const mm = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.15), stripe); mm.rotation.x = -Math.PI / 2; mm.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]); mm.position.set(a[0] + ((b[0] - a[0]) * (t + 1.5)) / L, 0.02, -(a[1] + ((b[1] - a[1]) * (t + 1.5)) / L)); scn.add(mm); } }
    for (const z of sc.crosswalks) { const n = Math.floor(z.w / 0.9); for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * 0.9, mm = new THREE.Mesh(new THREE.PlaneGeometry(z.len, 0.45), stripe); mm.rotation.x = -Math.PI / 2; mm.rotation.z = Math.atan2(z.d[1], z.d[0]); mm.position.set(z.c[0] - z.d[1] * off, 0.02, -(z.c[1] + z.d[0] * off)); scn.add(mm); } }
    for (const o of sc.objects) {
      if (o.type === "pave") scn.add(flat(o.ring, null, o.surface === "concrete" ? conc : m(T.asphalt), 0.152));
      else if (o.type === "pool") scn.add(flat(o.ring, null, lam({ map: T.water, color: 0xffffff }), 0.15));
      else if (o.type === "walkway") { const mm = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1]), o.w), sideC); mm.rotation.x = -Math.PI / 2; mm.rotation.z = Math.atan2(o.to[1] - o.from[1], o.to[0] - o.from[0]); mm.position.set((o.from[0] + o.to[0]) / 2, 0.153, -(o.from[1] + o.to[1]) / 2); mm.receiveShadow = true; scn.add(mm); }
    }
    // buildings
    sc.buildings.forEach((b, bi) => {
      const dmg = W.damage[b.id], kind = b.kind, collapsed = dmg && dmg.state === "collapsed"; let h = b.h; if (collapsed) h = Math.min(2.4, 0.2 * b.h); else if (dmg && dmg.state === "partial") h = 0.72 * b.h;
      const style = kind === "apartment" || kind === "rowhouse" || kind === "campus" ? "brick" : kind === "warehouse" || kind === "factory" ? "metal" : kind === "office" || kind === "commercial" ? "office" : "stucco";
      const fh = b.floors > 0 ? b.h / b.floors : 3, seed = (bi * 7 + 3) | 0, tex = facade(style, false, seed % 3), etex = night ? facade(style, true, seed % 5) : null;
      const tt = tex.clone(); tt.needsUpdate = true; tt.repeat.set(1 / 6, 1 / fh); let et = null; if (etex) { et = etex.clone(); et.needsUpdate = true; et.repeat.set(1 / 6, 1 / fh); }
      const col = collapsed ? 0x7a5c44 : new THREE.Color(WALL[kind] || 0xcccccc).multiplyScalar(0.9 + 0.2 * rng());
      const side = lam({ color: col, map: collapsed ? null : tt, emissive: night && !collapsed ? 0xffffff : 0x000000, emissiveMap: collapsed ? null : et });
      const flatRoof = lam({ map: T.flatroof, color: 0xffffff }), pitched = lam({ map: T.shingle(ROOF[kind] || 0x6d5a4f), color: 0xffffff, side: THREE.DoubleSide });
      for (const part of (b.parts && b.parts.length ? b.parts : [b.fp])) {
        const g = new THREE.ExtrudeGeometry(shape(part), { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
        const isPitched = (b.roof === "gable" || b.roof === "hip") && part.length === 4 && !collapsed;
        const mesh = new THREE.Mesh(g, [isPitched ? lam({ color: col }) : flatRoof, side]); mesh.castShadow = mesh.receiveShadow = true; scn.add(mesh);
        if (isPitched) { const rm = new THREE.Mesh(roofGeom(part, h, b.roof), pitched); rm.castShadow = true; scn.add(rm); }
      }
      if (b.entrance && !collapsed) { const e = b.entrance, nx = e.normal ? e.normal[0] : 0, ny = e.normal ? e.normal[1] : -1, door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.14), lam({ color: 0x5a3a24 })); door.position.set(e.xy[0] + nx * 0.07, 0.14 + 1.05, -(e.xy[1] + ny * 0.07)); door.rotation.y = Math.atan2(nx, -ny); scn.add(door); }
      if ((kind === "house" || kind === "cottage") && !collapsed) { const c = b.fp.reduce((a, p) => [a[0] + p[0] / b.fp.length, a[1] + p[1] / b.fp.length], [0, 0]); const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.7), lam({ color: 0x8a4b3a })); ch.position.set(c[0] + 1.2, h + 1.6, -c[1] + 0.8); ch.castShadow = true; scn.add(ch); }
    });
    for (const sp of W.variantData.spills || []) scn.add(flat(sp.ring, null, lam({ color: 0x6b5240 }), 0.16));
    for (const f of W.variantData.fires || []) { const mm = new THREE.Mesh(new THREE.ConeGeometry(f.r * 0.6, f.r * 1.8, 10), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.8 })); mm.position.set(f.xy[0], f.r * 0.9 + 0.14, -f.xy[1]); scn.add(mm); const L = new THREE.PointLight(0xff8a30, 1.4, 60); L.position.copy(mm.position); L.position.y += 3; scn.add(L); }
    // fences
    if (A.occ.fences) for (const o of sc.objects) if (o.type === "fence") {
      const tx = o.style === "privacy" ? T.privacy : o.style === "chain" ? T.chain : T.picket, post = lam({ color: o.style === "chain" ? 0x7c858b : o.style === "privacy" ? 0x6a4a2a : 0xe6e2d6 });
      for (const ln of o.lines) for (let k = 0; k + 1 < ln.length; k++) {
        const a = ln[k], c = ln[k + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.2) continue;
        const t = tx.clone(); t.needsUpdate = true; t.repeat.set(o.style === "chain" ? L / 1 : L / (o.style === "picket" ? 1.2 : 1.0), 1);
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(L, o.h), lam({ map: t, transparent: o.style !== "privacy", alphaTest: 0.4, side: THREE.DoubleSide }));
        pm.rotation.y = Math.atan2(c[1] - a[1], c[0] - a[0]); pm.position.set((a[0] + c[0]) / 2, 0.14 + o.h / 2, -(a[1] + c[1]) / 2); pm.castShadow = o.style === "privacy"; scn.add(pm);
        const u = Math.max(1, Math.round(L / 2.4)); for (let s = 0; s <= u; s++) { const px = a[0] + ((c[0] - a[0]) * s) / u, py = a[1] + ((c[1] - a[1]) * s) / u; const pp = new THREE.Mesh(new THREE.BoxGeometry(0.1, o.h + 0.1, 0.1), post); pp.position.set(px, 0.14 + o.h / 2, -py); scn.add(pp); }
      }
    }
    for (const o of sc.objects) {
      if (o.type === "box") { const mm = new THREE.Mesh(new THREE.BoxGeometry(o.size[0], o.size[2], o.size[1]), lam({ color: o.name === "container" ? [0xc0504d, 0x4f81bd, 0x70a757][Math.floor(o.xy[0] + o.xy[1]) % 3] : o.name === "shed" ? 0xb9926e : o.name === "bins" ? 0x3d8f5e : 0xd8a31a })); mm.rotation.y = o.yaw; mm.position.set(o.xy[0], 0.14 + o.size[2] / 2, -o.xy[1]); mm.castShadow = mm.receiveShadow = true; scn.add(mm); if (o.name === "shed") { const rf = new THREE.Mesh(new THREE.BoxGeometry(o.size[0] + 0.3, 0.12, o.size[1] + 0.3), lam({ color: 0x8a3a30 })); rf.rotation.y = o.yaw; rf.position.set(o.xy[0], 0.14 + o.size[2] + 0.06, -o.xy[1]); scn.add(rf); } }
      else if (o.type === "cyl") { const mm = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.h, 24), lam({ color: o.name === "chimney" ? 0xd9d2c9 : 0xb7bdc2 })); mm.position.set(o.xy[0], o.h / 2, -o.xy[1]); mm.castShadow = true; scn.add(mm); }
      else if (o.type === "post") { const mm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, o.h, 6), lam({ color: 0x33414a })); mm.position.set(o.xy[0], 0.14 + o.h / 2, -o.xy[1]); scn.add(mm); if (o.name === "mailbox") { const bx = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.5), lam({ color: 0x2f5aa8 })); bx.position.set(o.xy[0], 0.14 + o.h + 0.1, -o.xy[1]); scn.add(bx); } }
    }
    // trees: three jittered crown blobs + trunk
    if (A.occ.trees) {
      const jit = (seed) => { const g = new THREE.IcosahedronGeometry(1, 2), pos = g.attributes.position, h = (x, y, z, o) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + o * 3.1 + seed) * 43758.5453; return v - Math.floor(v); };   // position hash: duplicated vertices move together (no tears)
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = 0.84 + 0.26 * h(Math.round(x * 20) / 20, Math.round(y * 20) / 20, Math.round(z * 20) / 20, 1); pos.setXYZ(i, x * k, y * k * 0.92, z * k); }
        const nm = g.attributes.normal; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), l = Math.hypot(x, y, z) || 1; nm.setXYZ(i, x / l, y / l, z / l); } return g; };   // radial normals: smooth blobs
      const crowns = [jit(11), jit(23), jit(37), jit(41)], cone = new THREE.ConeGeometry(1, 1, 9), trunk = new THREE.CylinderGeometry(0.16, 0.28, 1, 7), trunkM = lam({ color: 0x5b3a1e });
      sc.trees.forEach((t, i) => {
        const k = ES.TREE[t[2]] || ES.TREE.round, s = t[3], hh = k.h * s, lo = k.lo * s, r = k.r * s, shade = 0.72 + 0.5 * rng(), col = new THREE.Color(t[2] === "conifer" ? 0x2c6a3b : 0x3d8a46).multiplyScalar(shade), mat = lam({ color: col });
        const tr = new THREE.Mesh(trunk, trunkM); tr.scale.set(s, lo + 1.0, s); tr.position.set(t[0], 0.14 + (lo + 1.0) / 2, -t[1]); tr.castShadow = true; scn.add(tr);
        if (t[2] === "conifer") { for (let c = 0; c < 3; c++) { const cr = new THREE.Mesh(cone, mat); const rr = r * (1 - c * 0.25), hc = (hh - lo) * 0.5; cr.scale.set(rr, hc, rr); cr.position.set(t[0], 0.14 + lo + c * (hh - lo) * 0.28 + hc / 2, -t[1]); cr.castShadow = true; scn.add(cr); } }
        else { [[0, 0, 0, 1], [0.5, 0.15, 0.3, 0.7], [-0.45, -0.1, -0.35, 0.72]].forEach(([ox, oy, oz, sz], c) => { const cr = new THREE.Mesh(crowns[(i + c) % 4], mat); cr.scale.set(r * sz, ((hh - lo) / 2) * sz, r * sz); cr.position.set(t[0] + ox * r, 0.14 + lo + (hh - lo) / 2 + oy * (hh - lo) * 0.3, -t[1] - oz * r); cr.rotation.y = i * 1.7 + c; cr.castShadow = true; scn.add(cr); }); }
      });
    }
    // lamps (+ lights at night)
    V.lamps = []; const pole = new THREE.CylinderGeometry(0.07, 0.1, 7, 8), poleMat = lam({ color: 0x2a2f33 });
    for (const l of sc.lamps) {
      const mm = new THREE.Mesh(pole, poleMat); mm.position.set(l[0], 3.5 + 0.14, -l[1]); mm.castShadow = true; scn.add(mm); const hx = l[0] + Math.cos(l[2]) * 1.6, hy = l[1] + Math.sin(l[2]) * 1.6;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), poleMat); arm.position.set((l[0] + hx) / 2, 7.0, -(l[1] + hy) / 2); arm.rotation.y = Math.atan2(hy - l[1], hx - l[0]); scn.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: night ? 0xffe2a8 : 0x666666 })); head.position.set(hx, 6.95, -hy); head.rotation.y = Math.atan2(hy - l[1], hx - l[0]); scn.add(head); V.lamps.push([hx, 6.7, -hy]);
    }
    // parked vehicles
    if (A.occ.vehicles) W.vehicles.forEach((v, i) => {
      const col = [0x4d6f9a, 0xb23a3a, 0xd9d9d9, 0x2f3b45, 0x8a8f94, 0xe0c24a][i % 6]; const g = new THREE.Group(), L = v.dims[0], Wd = v.dims[1], H = v.dims[2];
      const body = new THREE.Mesh(new THREE.BoxGeometry(L, H * 0.5, Wd), lam({ color: col })); body.position.y = H * 0.38; const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.52, H * 0.4, Wd * 0.88), new THREE.MeshLambertMaterial({ color: 0x1f262c, emissive: 0x0b1118 })); cab.position.set(-L * 0.05, H * 0.76, 0); g.add(body, cab);
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.2, H * 0.2, 0.22, 14), lam({ color: 0x111111 })); w.rotation.x = Math.PI / 2; w.position.set(x * L * 0.32, H * 0.2, z * Wd * 0.46); g.add(w); }
      g.rotation.y = ES.rad(v.yaw); g.position.set(v.xy[0], W.groundZ(v.xy[0], v.xy[1]), -v.xy[1]); g.traverse((o) => { o.castShadow = true; }); scn.add(g);
    });
    scn.traverse((o) => { if (o.isMesh && !o.userData.dyn) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    V.scene = scn; V.sun = sun;
  }

  /* ====================================== agent models ====================================== */
  function label(text, color) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g = c.getContext("2d"); g.font = "600 30px 'Source Sans 3', 'PingFang SC', sans-serif"; g.textAlign = "center"; g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,.65)"; g.strokeText(text, 128, 42); g.fillStyle = "#fff"; g.fillText(text, 128, 42);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })); sp.scale.set(2.4, 0.6, 1); return sp;
  }
  function agentModel(e, opts = {}) {
    const g = new THREE.Group(), mat = (c) => lam({ color: c }), box = (x, y, z, c, px, py, pz, par) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat(c)); m.position.set(px, py, pz); m.castShadow = true; (par || g).add(m); return m; };
    const col = e.kind.startsWith("t:") ? ES.TARGETS[e.kind.slice(2)].color : e.kind === "sound" ? "#b8860b" : ES.DEVICES[e.kind].color; g.userData.parts = {};
    if (e.kind === "uav") { box(0.3, 0.1, 0.3, 0x222222, 0, 0, 0); g.userData.parts.rotors = []; for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { box(0.2, 0.02, 0.02, 0x222222, 0.1 * x, 0, 0.1 * z); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12), mat(0xcccccc)); r.position.set(0.22 * x, 0.04, 0.22 * z); g.add(r); g.userData.parts.rotors.push(r); } }
    else if (e.kind === "dog") { box(0.62, 0.2, 0.26, 0xdfdfe4, 0, 0.34, 0); box(0.16, 0.13, 0.16, 0xdfdfe4, 0.38, 0.42, 0); g.userData.parts.legs = []; for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const piv = new THREE.Group(); piv.position.set(0.23 * x, 0.3, 0.11 * z); box(0.06, 0.3, 0.06, 0x333333, 0, -0.15, 0, piv); g.add(piv); g.userData.parts.legs.push(piv); } }
    else if (e.kind === "human" || e.kind === "t:person") { const sh = e.kind === "human" ? 0xf2a31b : 0x4a6fa5; box(0.3, 0.58, 0.18, sh, 0, 1.12, 0); const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(0xe2b79b)); h.position.y = 1.55; g.add(h); g.userData.parts.legs = []; g.userData.parts.arms = [];
      for (const z of [-1, 1]) { const piv = new THREE.Group(); piv.position.set(0, 0.82, 0.09 * z); box(0.12, 0.8, 0.1, 0x2f3a4a, 0, -0.4, 0, piv); g.add(piv); g.userData.parts.legs.push(piv); const arm = new THREE.Group(); arm.position.set(0, 1.35, 0.2 * z); box(0.09, 0.6, 0.08, sh, 0, -0.3, 0, arm); g.add(arm); g.userData.parts.arms.push(arm); } }
    else if (e.kind === "t:lying") { box(0.6, 0.22, 0.3, 0xd62728, 0.15, 0.11, 0); box(0.7, 0.18, 0.2, 0x2f3a4a, -0.5, 0.09, 0); const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xe2b79b)); h.position.set(0.55, 0.12, 0); g.add(h); }
    else if (e.kind === "t:vehicle") { box(4.2, 0.9, 1.8, 0x666666, 0, 0.6, 0); box(2.0, 0.6, 1.6, 0x20262c, -0.2, 1.3, 0); }
    else if (e.kind === "rover") { box(0.6, 0.35, 0.5, 0xe69f00, 0, 0.3, 0); box(0.4, 0.3, 0.4, 0xf3c24f, 0, 0.62, 0); for (const [x, z] of [[1, 1], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, -1]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), mat(0x222222)); w.rotation.x = Math.PI / 2; w.position.set(0.22 * x, 0.1, 0.27 * z); g.add(w); } }
    else if (e.kind === "cp") { box(6, 2.4, 2.4, 0x0072b2, 0, 1.4, 0); box(0.2, 6, 0.2, 0x444444, 0, 3, 0); box(0.9, 0.5, 0.1, 0xdddddd, 0, 6, 0); }
    else if (e.kind === "sound") { const s = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), mat(0xb8860b)); s.rotation.x = Math.PI / 2; g.add(s); }
    if (!opts.noBeacon) { const beacon = new THREE.Mesh(new THREE.SphereGeometry(opts.small ? 0.2 : 0.45, 12, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 })); beacon.position.y = (e.kind === "cp" ? 7.2 : e.kind === "uav" ? 0.8 : e.kind === "dog" ? 1.0 : e.kind === "rover" ? 1.1 : 2.2); g.add(beacon); }
    if (opts.label && e.name) { const sp = label(e.name, col); sp.position.y = (e.kind === "cp" ? 8.2 : e.kind === "uav" ? 1.5 : e.kind === "dog" ? 1.5 : e.kind === "rover" ? 1.6 : 2.7); g.add(sp); }
    const z = e.kind === "uav" ? e.z : (V.A ? V.A.W.groundZ(e.x, e.y) : 0.1); g.position.set(e.x, z, -e.y); g.rotation.y = e.yaw !== undefined ? e.yaw : 0; g.userData.eid = e.id;
    if (e.kind === "uav" && e.z) { const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -e.z, 0)]), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.4 })); g.add(ln); }
    g.userData.dyn = true; return g;
  }
  /* live agents: the episode's own dog / drone / rover / residents move through the scene */
  function buildLive(ep) {
    const grp = new THREE.Group(); grp.userData.items = [];
    for (const [id, a] of Object.entries(ep.agents)) {
      const kind = a.type === "uav" ? "uav" : a.type === "ugv" ? "dog" : a.type === "ugv_wheel" ? "rover" : a.role === "lie" ? "t:lying" : "human";
      const mk = kind === "human" ? (id === "human_0" ? "human" : "t:person") : kind;
      const model = agentModel({ kind: mk, id, x: a.pos[0][0], y: a.pos[0][1], z: a.pos[0][2], yaw: a.yaw[0] }, { noBeacon: true, label: false });
      grp.add(model); grp.userData.items.push({ id, a, model, kind, phase: Math.random() * 6 });
    }
    return grp;
  }
  function tickLive(now) {
    const live = V.live; if (!live || !V.liveEp) return; const ep = V.liveEp, t = (now / 1000) * V.liveSpeed;
    for (const it of live.userData.items) {
      const a = it.a, T = (a.n - 1) * ep.dt, tt = T > 0 ? t % T : 0, f = tt / ep.dt, i0 = Math.min(a.n - 2, Math.floor(f)), u = f - i0, p0 = a.pos[i0], p1 = a.pos[i0 + 1] || p0;
      const x = p0[0] + (p1[0] - p0[0]) * u, y = p0[1] + (p1[1] - p0[1]) * u; let dy = a.yaw[Math.min(a.n - 1, i0 + 1)] - a.yaw[i0]; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const yaw = a.yaw[i0] + dy * u;
      const z = it.kind === "uav" ? p0[2] + (p1[2] - p0[2]) * u : V.A.W.groundZ(x, y); const moving = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / ep.dt > 0.25;
      it.model.position.set(x, z, -y); it.model.rotation.y = yaw; const ph = (now / 1000) * (it.kind === "dog" ? 6 : 7) + it.phase, sw = moving ? Math.sin(ph) * 0.55 : 0, P = it.model.userData.parts || {};
      if (P.legs) P.legs.forEach((l, k) => { l.rotation.z = (k % 2 ? sw : -sw) * (it.kind === "dog" ? 0.8 : 1); });
      if (P.arms) P.arms.forEach((l, k) => { l.rotation.z = (k % 2 ? -sw : sw) * 0.6; });
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
    if (A.look === "night") { const cp = V.cam.position, ls = V.lamps.map((p) => ({ p, d: Math.hypot(p[0] - cp.x, p[2] - cp.z) })).sort((a, b) => a.d - b.d).slice(0, 8); for (const { p } of ls) { const L = new THREE.PointLight(0xffd9a0, 1.2, 55, 1.6); L.position.set(...p); V.scene.add(L); V.lampLights.push(L); } }
  }
  function camFromEntity(A) {
    const e = A.ents.find((q) => q.id === A.sel), d = e && ES.DEVICES[e.kind], S = A.scene.size, aspect = V.w / V.h; let from = "总览(选中一个带相机的智能体可切换为它的视角)";
    if (d && d.cam) {
      const vfov = ES.deg(2 * Math.atan(Math.tan(ES.rad(e.hfov) / 2) / aspect)); V.cam.fov = vfov; V.cam.aspect = aspect; V.cam.updateProjectionMatrix();
      const z = e.kind === "uav" ? e.z : (A.W.groundZ(e.x, e.y) + (d.antH || d.z)), cp = Math.cos(e.pitch || 0); V.cam.position.set(e.x, z, -e.y); V.cam.lookAt(e.x + Math.cos(e.yaw) * cp, z + Math.sin(e.pitch || 0), -(e.y + Math.sin(e.yaw) * cp));
      from = `${e.name} 的视角 · 水平 ${Math.round(e.hfov)}° · 俯仰 ${Math.round(ES.deg(e.pitch || 0))}°`; V.hide = e.id;
    } else { V.cam.fov = 55; V.cam.aspect = aspect; V.cam.updateProjectionMatrix(); V.cam.position.set(-0.05 * S, 0.5 * S, 0.8 * S); V.cam.lookAt(S * 0.5, 0, -S * 0.45); V.hide = null; }
    $cap().textContent = from;
  }
  function ensureRenderer() {
    if (!window.THREE) return false;
    if (!V.renderer) {
      try { V.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("v3d"), antialias: true }); } catch (e) { $cap().textContent = "此浏览器无法创建 WebGL 画布"; return false; }
      V.renderer.shadowMap.enabled = true; V.renderer.shadowMap.type = THREE.PCFSoftShadowMap; V.cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000);
      new ResizeObserver(() => { if (V.renderer && V.A && !WALK.active) { size(); camFromEntity(V.A); renderPreview(V.A); } }).observe(document.getElementById("preview"));
      new ResizeObserver(() => { if (V.renderer && WALK.active) { size(); renderWalk(); } }).observe(document.getElementById("walkstage"));
      document.getElementById("preview").addEventListener("click", () => { if (WALK.active) return; V.big = !V.big; document.getElementById("preview").classList.toggle("big", V.big); });
    }
    return true;
  }
  function ensureScene(A) { const key = [A.name, A.variant, A.look, JSON.stringify(A.occ)].join("|"); if (key !== V.key) { build(A); V.key = key; V.live = null; if (V.liveEp) { V.live = buildLive(V.liveEp); V.scene.add(V.live); } } }
  function renderPreview(A) { if (!V.renderer || WALK.active) return; placeAgents(A, false); V.sky.position.copy(V.cam.position); if (V.stars) V.stars.position.copy(V.cam.position); V.renderer.render(V.scene, V.cam); }

  /* ====================================== walk mode ====================================== */
  const walkBlocked = (W, x, y, r, body, z) => {
    if (!W.inside(x, y)) return true; const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]], rub = body === "dog" ? 0.5 : 0.2;
    for (const [a, b] of dirs) { const id = W.ij(x + a * r, y + b * r); if (id < 0) return true; if (body === "uav") { if (W.hB[id] > z - 0.7) return true; } else if (W.hB[id] > 0.25 || W.hT[id] > 0.05 || W.navBlk[id] || W.rub[id] > rub) return true; }
    return false;
  };
  const clearLine = (W, x0, y0, x1, y1, r, body, z) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.3); for (let k = 1; k <= n; k++) { if (walkBlocked(W, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r, body, z)) return false; } return true; };
  function nearestFree(W, x, y, r, body, z) { if (!walkBlocked(W, x, y, r, body, z)) return [x, y]; for (let d = 0.5; d < 12; d += 0.5) for (let a = 0; a < 6.28; a += 0.4) { const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; if (!walkBlocked(W, px, py, r, body, z)) return [px, py]; } return [x, y]; }
  function walkCamera() {
    const A = V.A, B = BODY[WALK.body], g = A.W.groundZ(WALK.x, WALK.y), z = WALK.body === "uav" ? WALK.z : g + B.eye + Math.sin(WALK.bob) * (WALK.body === "human" ? 0.035 : 0.012);
    const aspect = V.w / V.h, vfov = ES.deg(2 * Math.atan(Math.tan(ES.rad(WALK.fov) / 2) / aspect)); V.cam.fov = vfov; V.cam.aspect = aspect; V.cam.updateProjectionMatrix();
    const cp = Math.cos(WALK.pitch); V.cam.position.set(WALK.x, z, -WALK.y); V.cam.lookAt(WALK.x + Math.cos(WALK.yaw) * cp, z + Math.sin(WALK.pitch), -(WALK.y + Math.sin(WALK.yaw) * cp)); WALK.eyeZ = z;
  }
  let walkAgentsKey = "";
  function placeAgentsWalk() {      // user-placed entities are static in the walk view; rebuilt only when they change
    const A = V.A, key = JSON.stringify(A.ents.map((e) => [e.id, e.kind, e.x, e.y, e.z, e.yaw])) + A.look + V.hide; if (key === walkAgentsKey && V.agents && V.agents.parent) return; walkAgentsKey = key; placeAgents(A, true);
  }
  function renderWalk() {
    if (!V.renderer || !V.scene) return; walkCamera(); placeAgentsWalk(); V.sky.position.copy(V.cam.position); if (V.stars) V.stars.position.copy(V.cam.position); V.renderer.render(V.scene, V.cam);
  }
  function advance(dt, now) {
    const A = V.A, W = A.W, B = BODY[WALK.body], k = WALK.keys;
    if (WALK.tween) {
      const tw = WALK.tween; tw.t += dt / tw.dur; const u = Math.min(1, tw.t), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; WALK.x = tw.x0 + (tw.x1 - tw.x0) * e; WALK.y = tw.y0 + (tw.y1 - tw.y0) * e; WALK.bob += dt * 9; if (u >= 1) WALK.tween = null;
    } else {
      const sp = (k.shift ? B.run : B.v) * WALK.speedMul, mv = (k.w || k.up ? 1 : 0) - (k.s || k.down ? 1 : 0), st = (k.d ? 1 : 0) - (k.a ? 1 : 0), turn = (k.q || k.left ? 1 : 0) - (k.e || k.right ? 1 : 0);
      WALK.yaw += turn * 1.7 * dt;
      if (mv || st) {
        const fx = Math.cos(WALK.yaw), fy = Math.sin(WALK.yaw), rx = Math.sin(WALK.yaw), ry = -Math.cos(WALK.yaw); let vx = fx * mv + rx * st, vy = fy * mv + ry * st; const n = Math.hypot(vx, vy) || 1; vx = (vx / n) * sp * dt; vy = (vy / n) * sp * dt;
        const nx = WALK.x + vx, ny = WALK.y + vy, ox = WALK.x, oy = WALK.y;
        if (!walkBlocked(W, nx, ny, B.r, WALK.body, WALK.z)) { WALK.x = nx; WALK.y = ny; } else if (!walkBlocked(W, nx, WALK.y, B.r, WALK.body, WALK.z)) WALK.x = nx; else if (!walkBlocked(W, WALK.x, ny, B.r, WALK.body, WALK.z)) WALK.y = ny;
        if (Math.hypot(WALK.x - ox, WALK.y - oy) < 0.3 * Math.hypot(vx, vy) && WALK.hooks.toast && now - (WALK.toastAt || -1e9) > 1500) { WALK.toastAt = now; WALK.hooks.toast("被挡住了(墙、围栏、车或树干)"); }
        WALK.bob += dt * (k.shift ? 11 : 7);
      }
      if (WALK.body === "uav") { const up = (k.space || k.r ? 1 : 0) - (k.c || k.f ? 1 : 0); if (up) { const nz = ES.clamp(WALK.z + up * sp * 0.5 * dt, 2, 150); if (!walkBlocked(W, WALK.x, WALK.y, B.r, "uav", nz)) WALK.z = nz; } }
    }
  }
  function tick(now) {
    if (!WALK.active) return; WALK.raf = requestAnimationFrame(tick); const dt = Math.min(0.1, (now - (WALK.last || now)) / 1000); WALK.last = now;
    advance(dt, now); tickLive(now); renderWalk();
    if (now - WALK.hud > 250) { WALK.hud = now; if (WALK.hooks.onMove) WALK.hooks.onMove({ x: WALK.x, y: WALK.y, z: WALK.eyeZ, yaw: WALK.yaw, body: WALK.body }); }
  }
  /* pointer: drag = look (grab-the-world, like street view), click on the ground = go there, wheel = zoom */
  let drag = null;
  function onDown(e) { if (!WALK.active) return; e.currentTarget.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0, yaw: WALK.yaw, pitch: WALK.pitch }; }
  function onMove(e) { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy)); if (drag.moved > 4) { const k = 0.0042 * (WALK.fov / 75); WALK.yaw = drag.yaw + dx * k; WALK.pitch = ES.clamp(drag.pitch + dy * k, -1.45, 1.45); } }
  function onUp(e) { if (!drag) return; const d = drag; drag = null; if (d.moved <= 4) clickGo(e); }
  function clickGo(e) {
    const A = V.A, r = e.currentTarget.getBoundingClientRect(), nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), rc = new THREE.Raycaster(); rc.setFromCamera(nd, V.cam);
    const gy = A.W.groundZ(WALK.x, WALK.y) + 0.02; if (rc.ray.direction.y > -0.02) { WALK.hooks.toast && WALK.hooks.toast("点地面才能走过去"); return; }
    const t = (gy - rc.ray.origin.y) / rc.ray.direction.y, px = rc.ray.origin.x + rc.ray.direction.x * t, py = -(rc.ray.origin.z + rc.ray.direction.z * t), B = BODY[WALK.body];
    if (WALK.body === "uav") { WALK.hooks.toast && WALK.hooks.toast("无人机用 WASD 飞行,空格/C 升降"); return; }
    if (!A.W.inside(px, py) || walkBlocked(A.W, px, py, B.r, WALK.body, WALK.z)) { WALK.hooks.toast && WALK.hooks.toast("那里站不了(建筑、围栏或障碍)"); return; }
    if (!clearLine(A.W, WALK.x, WALK.y, px, py, B.r, WALK.body, WALK.z)) { WALK.hooks.toast && WALK.hooks.toast("过不去:中间被墙或围栏挡住,试试绕过门洞"); return; }
    const dist = Math.hypot(px - WALK.x, py - WALK.y); WALK.tween = { x0: WALK.x, y0: WALK.y, x1: px, y1: py, t: 0, dur: ES.clamp(dist / (B.v * 2.4), 0.35, 1.8) };
  }
  function onWheel(e) { if (!WALK.active) return; e.preventDefault(); WALK.fov = ES.clamp(WALK.fov * Math.exp(e.deltaY * 0.001), 35, 110); }
  const KEYMAP = { KeyW: "w", ArrowUp: "up", KeyS: "s", ArrowDown: "down", KeyA: "a", KeyD: "d", KeyQ: "q", ArrowLeft: "left", KeyE: "e", ArrowRight: "right", Space: "space", KeyR: "r", KeyC: "c", KeyF: "f", ShiftLeft: "shift", ShiftRight: "shift" };
  function onKey(e, down) { if (!WALK.active || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return; const k = KEYMAP[e.code]; if (!k) { if (down && e.code === "Escape" && WALK.hooks.requestExit) WALK.hooks.requestExit(); return; } e.preventDefault(); WALK.keys[k] = down; }
  window.addEventListener("keydown", (e) => onKey(e, true)); window.addEventListener("keyup", (e) => onKey(e, false)); window.addEventListener("blur", () => { WALK.keys = {}; });

  const walk = {
    get active() { return WALK.active; }, state: WALK, BODY,
    async enter(A, opt) {
      await loadThree(); V.A = A; if (!ensureRenderer()) return false; ensureScene(A); const body = opt.body || "human", B = BODY[body]; WALK.body = body; WALK.fov = opt.fov || B.fov; WALK.pitch = opt.pitch ?? (body === "uav" ? -0.35 : 0); WALK.yaw = opt.yaw || 0; WALK.z = opt.z || 28; WALK.tween = null; WALK.keys = {};
      const [x, y] = nearestFree(A.W, opt.x, opt.y, B.r, body, WALK.z); WALK.x = x; WALK.y = y; WALK.hooks = opt.hooks || {};
      const stage = document.getElementById("walkstage"), cv = document.getElementById("v3d"); stage.hidden = false; stage.appendChild(cv);
      cv.onpointerdown = onDown; cv.onpointermove = onMove; cv.onpointerup = onUp; cv.onwheel = onWheel; cv.style.touchAction = "none"; cv.style.cursor = "grab";
      WALK.active = true; WALK.last = 0; V.hide = opt.hideId ?? null; walkAgentsKey = ""; size(); cancelAnimationFrame(WALK.raf); WALK.raf = requestAnimationFrame(tick); if (WALK.hooks.onMove) WALK.hooks.onMove({ x: WALK.x, y: WALK.y, z: B.eye, yaw: WALK.yaw, body: WALK.body }); return true;
    },
    setBody(name) { const B = BODY[name]; if (!B) return; WALK.body = name; WALK.fov = B.fov; if (name === "uav") { WALK.pitch = -0.35; WALK.z = Math.max(WALK.z, 20); } else WALK.pitch = 0; const [x, y] = nearestFree(V.A.W, WALK.x, WALK.y, B.r, name, WALK.z); WALK.x = x; WALK.y = y; },
    teleport(x, y) { const B = BODY[WALK.body], [px, py] = nearestFree(V.A.W, x, y, B.r, WALK.body, WALK.z); WALK.tween = null; WALK.x = px; WALK.y = py; },
    setKey(k, v) { WALK.keys[k] = v; },
    advance(dt) { advance(dt, performance.now()); renderWalk(); },      // one simulation step (also used by tests: the browser pauses animation frames in hidden tabs)
    exit() {
      if (!WALK.active) return; WALK.active = false; cancelAnimationFrame(WALK.raf); const cv = document.getElementById("v3d"); cv.onpointerdown = cv.onpointermove = cv.onpointerup = cv.onwheel = null; cv.style.cursor = ""; cv.style.touchAction = "";
      document.getElementById("preview").insertBefore(cv, document.getElementById("v3dcap")); document.getElementById("walkstage").hidden = true; if (V.agents) { V.scene.remove(V.agents); V.agents = null; } size(); if (V.A) ES.view3d.update(V.A);
    },
    setLive(ep, on, speed) { if (V.live && V.scene) V.scene.remove(V.live); V.live = null; V.liveEp = on ? ep : null; V.liveSpeed = speed || 1; if (on && ep && V.scene) { V.live = buildLive(ep); V.scene.add(V.live); } },
  };
  ES.view3d = {
    walk,
    update(A) {
      V.A = A; if (!A.scene || !A.W) return;
      if (!window.THREE) { $cap().textContent = "加载 3D 引擎…"; loadThree().then(() => ES.view3d.update(A)).catch(() => { $cap().textContent = "3D 预览不可用(无法加载 three.js)"; }); return; }
      if (!ensureRenderer()) return; size(); ensureScene(A);
      if (WALK.active) return;
      camFromEntity(A); renderPreview(A);
    },
    /* the scene or look changed while walking: rebuild the scene around the same spot */
    refresh(A) { V.A = A; if (V.renderer && WALK.active) { V.key = ""; ensureScene(A); walkAgentsKey = ""; } },
  };
})();
