/* Simplified 3-D preview (three.js r128 from cdnjs, loaded on demand): the scene as extruded buildings with roofs and windows, trees, fences, vehicles,
   street lamps and the placed agents, seen from the selected agent's camera pose. It is a geometric preview (no path tracing); the Blender render button gives the real image. */
(function () {
  const ES = window.ES;
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  let loading = null;
  const loadThree = () => window.THREE ? Promise.resolve() : loading || (loading = new Promise((res, rej) => { const s = document.createElement("script"); s.src = THREE_URL; s.onload = res; s.onerror = () => rej(new Error("three.js 加载失败")); document.head.appendChild(s); }));
  const V = { key: "", renderer: null, scene: null, cam: null, agents: null, lamps: [], raf: 0, A: null, big: false };
  const WALL = { house: 0xd8b99a, cottage: 0xd8b99a, apartment: 0xc98a7a, rowhouse: 0xd6a086, commercial: 0xa9b6c8, campus: 0xc9a18f, warehouse: 0xb8bcc0, factory: 0xa4a8ac, office: 0x9fb2c6, civic: 0xc3b6a4 };
  const ROOF = { house: 0x6d5a4f, cottage: 0x7a5148, apartment: 0x777777, rowhouse: 0x7d5a4a, commercial: 0x777b80, campus: 0x7a6a64, warehouse: 0x8b2f2a, factory: 0x7c7f83, office: 0x6f7378, civic: 0x7a7168 };
  const w3 = (x, y, z) => [x, z, -y];                                       // ENU -> three (Y up)

  function facadeTex(lit, rng) {
    const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
    g.fillStyle = lit ? "#2a2a2e" : "#ffffff"; g.fillRect(0, 0, 128, 128);
    for (let j = 0; j < 1; j++) for (let i = 0; i < 2; i++) {
      const on = lit && rng() < 0.45; g.fillStyle = lit ? (on ? "#ffd9a0" : "#000000") : "#6f8aa3"; g.fillRect(14 + i * 60, 30, 40, 56);
      if (!lit) { g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(14 + i * 60, 30, 40, 14); g.strokeStyle = "#e9e9e9"; g.lineWidth = 3; g.strokeRect(14 + i * 60, 30, 40, 56); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  const mkRng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const shape = (ring, holes) => { const sh = new THREE.Shape(ring.map((p) => new THREE.Vector2(p[0], p[1]))); (holes || []).forEach((h) => sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))))); return sh; };
  function flat(ring, holes, color, y, mats) {
    const g = new THREE.ShapeGeometry(shape(ring, holes)); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color })); m.position.y = y; m.receiveShadow = true; return m;
  }
  function roofGeom(part, h, kind) {
    // oriented rectangle from the first three corners
    const [p0, p1, p2] = part, ux = p1[0] - p0[0], uy = p1[1] - p0[1], vx = p2[0] - p1[0], vy = p2[1] - p1[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    const long = lu >= lv, L = Math.max(lu, lv) / 2 + 0.55, Wd = Math.min(lu, lv) / 2 + 0.55, yaw = Math.atan2(long ? uy : vy, long ? ux : vx), cx = part.reduce((a, p) => a + p[0], 0) / part.length, cy = part.reduce((a, p) => a + p[1], 0) / part.length;
    const rh = Math.min(Wd * 0.62, 3.2), R = kind === "hip" ? Math.max(0.2, L - Wd * 0.95) : L;
    const v = [[-L, -Wd, 0], [L, -Wd, 0], [L, Wd, 0], [-L, Wd, 0], [-R, 0, rh], [R, 0, rh]];
    const tri = [[0, 1, 5], [0, 5, 4], [2, 3, 4], [2, 4, 5], [0, 4, 3], [1, 2, 5]], pos = [];
    for (const t of tri) for (const i of t) pos.push(...v[i]);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    g.rotateX(-Math.PI / 2);                                  // local (x, y, z) -> (x, z, -y): rectangle plane becomes horizontal, ridge up
    g.rotateY(yaw); g.translate(cx, h, -cy); return g;
  }
  function build(A) {
    const sc = A.scene, W = A.W, night = A.look === "night", S = sc.size, rng = mkRng(sc.seed + 7), scn = new THREE.Scene();
    const sky = night ? 0x0b1220 : 0xa9cdee; scn.background = new THREE.Color(sky); scn.fog = new THREE.Fog(sky, 220, night ? 520 : 900);
    scn.add(new THREE.HemisphereLight(night ? 0x2a3a66 : 0xdfeaff, night ? 0x10140f : 0x5d6d4a, night ? 0.55 : 0.75));
    const sun = new THREE.DirectionalLight(night ? 0x6a7fb5 : 0xfff2dd, night ? 0.35 : 0.95); sun.position.set(S * 0.1 - 70, 120, S * 0.2 + 60); sun.target.position.set(S / 2, 0, -S / 2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc2 = sun.shadow.camera; sc2.left = -S * 0.85; sc2.right = S * 0.85; sc2.top = S * 0.85; sc2.bottom = -S * 0.85; sc2.near = 10; sc2.far = 500; sun.shadow.bias = -0.0006;
    scn.add(sun, sun.target);
    // ground
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: night ? 0x1c2a1d : 0x6f9a4f })); gm.rotation.x = -Math.PI / 2; gm.position.y = -0.02; gm.receiveShadow = true; scn.add(gm);
    for (const b of sc.blocks) if (b.ground === "paved") scn.add(flat(b.ring, null, 0x9b9b95, 0.0)); else if (b.ground === "gravel") scn.add(flat(b.ring, null, 0xa89a7c, 0.0));
    for (const p of sc.parks) scn.add(flat(p, null, 0x5f9a4a, 0.01)); for (const p of sc.plazas) scn.add(flat(p, null, 0x9a968b, 0.02));
    for (const p of sc.ponds) { const m = flat(p, null, 0x4f8fc0, 0.03); m.material.transparent = true; m.material.opacity = 0.85; scn.add(m); }
    for (const p of sc.sidewalk_poly) scn.add(flat(p.ring, p.holes, 0xb9b6ac, 0.05)); for (const p of sc.road_poly) scn.add(flat(p.ring, p.holes, 0x4a4d52, 0.07)); for (const p of sc.path_poly) scn.add(flat(p.ring, p.holes, 0xb9b6ac, 0.06));
    const stripe = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
    for (const c of sc.centrelines) if (c.dashed) for (let k = 0; k + 1 < c.line.length; k++) { const a = c.line[k], b = c.line[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 1; t < L - 3; t += 6) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.15), stripe); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]); m.position.set(a[0] + ((b[0] - a[0]) * (t + 1.5)) / L, 0.08, -(a[1] + ((b[1] - a[1]) * (t + 1.5)) / L)); scn.add(m); } }
    for (const z of sc.crosswalks) { const n = Math.floor(z.w / 0.9); for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * 0.9, m = new THREE.Mesh(new THREE.PlaneGeometry(z.len, 0.45), stripe); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(z.d[1], z.d[0]); m.position.set(z.c[0] - z.d[1] * off, 0.08, -(z.c[1] + z.d[0] * off)); scn.add(m); } }
    for (const o of sc.objects) { if (o.type === "pave") scn.add(flat(o.ring, null, o.surface === "concrete" ? 0xb4b2a8 : 0x6c7075, 0.06)); else if (o.type === "pool") scn.add(flat(o.ring, null, 0x55bdf0, 0.07)); else if (o.type === "walkway") { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1]), o.w), new THREE.MeshLambertMaterial({ color: 0xcfcbbd })); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(o.to[1] - o.from[1], o.to[0] - o.from[0]); m.position.set((o.from[0] + o.to[0]) / 2, 0.08, -(o.from[1] + o.to[1]) / 2); scn.add(m); } }
    // buildings
    for (const b of sc.buildings) {
      const dmg = W.damage[b.id], kind = b.kind, wallCol = dmg && dmg.state === "collapsed" ? 0x7a5c44 : WALL[kind] || 0xcccccc; let h = b.h; if (dmg && dmg.state === "collapsed") h = Math.min(2.4, 0.2 * b.h); else if (dmg && dmg.state === "partial") h = 0.72 * b.h;
      const lit = night, tex = facadeTex(false, rng), etex = night ? facadeTex(true, rng) : null; const fh = b.floors > 0 ? b.h / b.floors : 3;
      tex.repeat.set(1 / 6, 1 / fh); if (etex) etex.repeat.set(1 / 6, 1 / fh);
      const side = new THREE.MeshLambertMaterial({ color: wallCol, map: dmg && dmg.state === "collapsed" ? null : tex, emissive: night ? 0xffffff : 0x000000, emissiveMap: etex });
      const cap = new THREE.MeshLambertMaterial({ color: ROOF[kind] || 0x777777 });
      for (const part of (b.parts && b.parts.length ? b.parts : [b.fp])) {
        const g = new THREE.ExtrudeGeometry(shape(part), { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, 0, 0);
        const m = new THREE.Mesh(g, [cap, side]); m.castShadow = m.receiveShadow = true; scn.add(m);
        if ((b.roof === "gable" || b.roof === "hip") && part.length === 4 && !(dmg && dmg.state === "collapsed")) { const rm = new THREE.Mesh(roofGeom(part, h, b.roof), new THREE.MeshLambertMaterial({ color: ROOF[kind] || 0x6d5a4f, side: THREE.DoubleSide })); rm.castShadow = true; scn.add(rm); }
      }
    }
    for (const sp of W.variantData.spills || []) { const m = flat(sp.ring, null, 0x6b5240, 0.15); scn.add(m); }
    for (const f of W.variantData.fires || []) { const m = new THREE.Mesh(new THREE.ConeGeometry(f.r * 0.6, f.r * 1.8, 10), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.8 })); m.position.set(f.xy[0], f.r * 0.9, -f.xy[1]); scn.add(m); const L = new THREE.PointLight(0xff8a30, 1.2, 60); L.position.copy(m.position); L.position.y += 3; scn.add(L); }
    // fences / objects
    if (A.occ.fences) for (const o of sc.objects) if (o.type === "fence") { const col = o.style === "privacy" ? 0x7b5a35 : o.style === "chain" ? 0x8a9196 : 0xf1eee4; const mat = new THREE.MeshLambertMaterial({ color: col, transparent: o.style === "chain", opacity: o.style === "chain" ? 0.55 : 1 });
      for (const ln of o.lines) for (let k = 0; k + 1 < ln.length; k++) { const a = ln[k], c = ln[k + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.2) continue; const m = new THREE.Mesh(new THREE.BoxGeometry(L, o.h, 0.08), mat); m.rotation.y = Math.atan2(c[1] - a[1], c[0] - a[0]); m.position.set((a[0] + c[0]) / 2, o.h / 2, -(a[1] + c[1]) / 2); m.castShadow = true; scn.add(m); } }
    for (const o of sc.objects) {
      if (o.type === "box") { const m = new THREE.Mesh(new THREE.BoxGeometry(o.size[0], o.size[2], o.size[1]), new THREE.MeshLambertMaterial({ color: o.name === "container" ? [0xc0504d, 0x4f81bd, 0x70a757][Math.floor(o.xy[0] + o.xy[1]) % 3] : o.name === "shed" ? 0xb08a6a : o.name === "bins" ? 0x3d8f5e : 0xd8a31a })); m.rotation.y = o.yaw; m.position.set(o.xy[0], o.size[2] / 2, -o.xy[1]); m.castShadow = true; scn.add(m); }
      else if (o.type === "cyl") { const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.h, 20), new THREE.MeshLambertMaterial({ color: o.name === "chimney" ? 0xd9d2c9 : 0xb7bdc2 })); m.position.set(o.xy[0], o.h / 2, -o.xy[1]); m.castShadow = true; scn.add(m); }
      else if (o.type === "post") { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, o.h, 6), new THREE.MeshLambertMaterial({ color: 0x33414a })); m.position.set(o.xy[0], o.h / 2, -o.xy[1]); scn.add(m); }
    }
    // trees
    if (A.occ.trees) { const crown = new THREE.IcosahedronGeometry(1, 1), cone = new THREE.ConeGeometry(1, 1, 8), trunk = new THREE.CylinderGeometry(0.18, 0.3, 1, 6);
      sc.trees.forEach((t, i) => { const k = ES.TREE[t[2]] || ES.TREE.round, s = t[3], hh = k.h * s, lo = k.lo * s, r = k.r * s, shade = 0.75 + 0.5 * rng();
        const tr = new THREE.Mesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5b3a1e })); tr.scale.set(s, lo + 0.5, s); tr.position.set(t[0], (lo + 0.5) / 2, -t[1]); tr.castShadow = true; scn.add(tr);
        const col = new THREE.Color(t[2] === "conifer" ? 0x2f6b3d : 0x3f8a45).multiplyScalar(shade);
        const cr = new THREE.Mesh(t[2] === "conifer" ? cone : crown, new THREE.MeshLambertMaterial({ color: col })); if (t[2] === "conifer") { cr.scale.set(r, hh - lo + 0.8, r); cr.position.set(t[0], lo - 0.4 + (hh - lo + 0.8) / 2, -t[1]); } else { cr.scale.set(r, (hh - lo) / 2, r); cr.position.set(t[0], lo + (hh - lo) / 2, -t[1]); }
        cr.castShadow = true; scn.add(cr); }); }
    // lamps (+ lights at night)
    V.lamps = []; const pole = new THREE.CylinderGeometry(0.07, 0.1, 7, 6), poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2f33 });
    for (const l of sc.lamps) { const m = new THREE.Mesh(pole, poleMat); m.position.set(l[0], 3.5, -l[1]); scn.add(m); const hx = l[0] + Math.cos(l[2]) * 1.6, hy = l[1] + Math.sin(l[2]) * 1.6;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: night ? 0xffe2a8 : 0x555555 })); head.position.set(hx, 6.9, -hy); scn.add(head); V.lamps.push([hx, 6.7, -hy]); }
    // vehicles
    if (A.occ.vehicles) W.vehicles.forEach((v, i) => { const col = [0x4d6f9a, 0xb23a3a, 0xd9d9d9, 0x2f3b45, 0x8a8f94, 0xe0c24a][i % 6]; const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(v.dims[0], v.dims[2] * 0.55, v.dims[1]), new THREE.MeshLambertMaterial({ color: col })); body.position.y = v.dims[2] * 0.4; const cab = new THREE.Mesh(new THREE.BoxGeometry(v.dims[0] * 0.5, v.dims[2] * 0.4, v.dims[1] * 0.85), new THREE.MeshLambertMaterial({ color: 0x20262c })); cab.position.set(-v.dims[0] * 0.05, v.dims[2] * 0.78, 0); g.add(body, cab); g.rotation.y = ES.rad(v.yaw); g.position.set(v.xy[0], 0.05, -v.xy[1]); g.traverse((o) => (o.castShadow = true)); scn.add(g); });
    V.scene = scn; V.sun = sun;
  }
  function agentModel(e) {
    const g = new THREE.Group(), mat = (c) => new THREE.MeshLambertMaterial({ color: c }), box = (x, y, z, c, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat(c)); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
    const col = e.kind.startsWith("t:") ? ES.TARGETS[e.kind.slice(2)].color : e.kind === "sound" ? "#b8860b" : ES.DEVICES[e.kind].color;
    if (e.kind === "uav") { box(0.3, 0.1, 0.3, 0x222222, 0, 0, 0); for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { box(0.2, 0.02, 0.02, 0x222222, 0.1 * x, 0, 0.1 * z); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12), mat(0xcccccc)); r.position.set(0.22 * x, 0.04, 0.22 * z); g.add(r); } }
    else if (e.kind === "dog") { box(0.62, 0.22, 0.28, 0xdfdfe4, 0, 0.32, 0); box(0.16, 0.14, 0.18, 0xdfdfe4, 0.38, 0.4, 0); for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(0.06, 0.28, 0.06, 0x333333, 0.23 * x, 0.14, 0.12 * z); }
    else if (e.kind === "human" || e.kind === "t:person") { box(0.26, 0.6, 0.18, e.kind === "human" ? 0xf2a31b : 0x4a6fa5, 0, 1.05, 0); box(0.22, 0.75, 0.1, 0x2f3a4a, 0, 0.4, 0); const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xe2b79b)); h.position.y = 1.5; g.add(h); }
    else if (e.kind === "t:lying") { box(0.6, 0.22, 0.3, 0xd62728, 0.15, 0.11, 0); box(0.7, 0.18, 0.2, 0x2f3a4a, -0.5, 0.09, 0); const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xe2b79b)); h.position.set(0.55, 0.12, 0); g.add(h); }
    else if (e.kind === "t:vehicle") { box(4.2, 0.9, 1.8, 0x666666, 0, 0.6, 0); box(2.0, 0.6, 1.6, 0x20262c, -0.2, 1.3, 0); }
    else if (e.kind === "rover") { box(0.6, 0.35, 0.5, 0xe69f00, 0, 0.3, 0); box(0.4, 0.3, 0.4, 0xf3c24f, 0, 0.62, 0); for (const [x, z] of [[1, 1], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, -1]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), mat(0x222222)); w.rotation.x = Math.PI / 2; w.position.set(0.22 * x, 0.1, 0.27 * z); g.add(w); } }
    else if (e.kind === "cp") { box(6, 2.4, 2.4, 0x0072b2, 0, 1.4, 0); box(0.2, 6, 0.2, 0x444444, 0, 3, 0); box(0.9, 0.5, 0.1, 0xdddddd, 0, 6, 0); }
    else if (e.kind === "sound") { const s = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), mat(0xb8860b)); s.rotation.x = Math.PI / 2; g.add(s); }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 })); beacon.position.y = (e.kind === "cp" ? 7.2 : e.kind === "uav" ? 0.8 : 2.4); g.add(beacon);
    const z = e.kind === "uav" ? e.z : 0.05; g.position.set(e.x, z, -e.y); g.rotation.y = e.yaw !== undefined ? e.yaw : 0; g.userData.eid = e.id;
    if (e.kind === "uav") { const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -e.z, 0)]), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.4 })); g.add(ln); }
    return g;
  }
  function frame(A) {
    const e = A.ents.find((q) => q.id === A.sel), d = e && ES.DEVICES[e.kind], S = A.scene.size;
    const aspect = V.w / V.h; let from = "总览(选中一个带相机的智能体可切换为它的视角)";
    if (d && d.cam) {
      const vfov = ES.deg(2 * Math.atan(Math.tan(ES.rad(e.hfov) / 2) / aspect)); V.cam.fov = vfov; V.cam.aspect = aspect; V.cam.updateProjectionMatrix();
      const z = e.kind === "uav" ? e.z : d.antH || d.z, cp = Math.cos(e.pitch || 0); V.cam.position.set(e.x, z, -e.y); V.cam.lookAt(e.x + Math.cos(e.yaw) * cp, z + Math.sin(e.pitch || 0), -(e.y + Math.sin(e.yaw) * cp));
      from = `${e.name} 的视角 · 水平 ${Math.round(e.hfov)}° · 俯仰 ${Math.round(ES.deg(e.pitch || 0))}°`; V.hide = e.id;
    } else { V.cam.fov = 55; V.cam.aspect = aspect; V.cam.updateProjectionMatrix(); V.cam.position.set(-0.05 * S, 0.5 * S, 0.8 * S); V.cam.lookAt(S * 0.5, 0, -S * 0.45); V.hide = null; }
    $cap().textContent = from;
  }
  const $cap = () => document.getElementById("v3dcap");
  function render(A) {
    if (!V.renderer) return; if (V.agents) V.scene.remove(V.agents); V.agents = new THREE.Group();
    for (const e of A.ents) { if (e.id === V.hide) continue; V.agents.add(agentModel(e)); }
    V.scene.add(V.agents);
    // night: point lights at the lamps nearest to the camera
    if (V.lampLights) V.lampLights.forEach((l) => V.scene.remove(l)); V.lampLights = [];
    if (A.look === "night") { const cp = V.cam.position, ls = V.lamps.map((p) => ({ p, d: Math.hypot(p[0] - cp.x, p[2] - cp.z) })).sort((a, b) => a.d - b.d).slice(0, 10); for (const { p } of ls) { const L = new THREE.PointLight(0xffd9a0, 1.1, 55, 1.6); L.position.set(...p); V.scene.add(L); V.lampLights.push(L); } }
    V.renderer.shadowMap.enabled = true; V.renderer.render(V.scene, V.cam);
  }
  function size() { const c = document.getElementById("v3d"), r = c.parentElement.getBoundingClientRect(); V.w = Math.max(50, r.width); V.h = Math.max(30, r.height); V.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); V.renderer.setSize(V.w, V.h, false); }
  ES.view3d = {
    update(A) {
      V.A = A; if (!A.scene || !A.W) return;
      if (!window.THREE) { $cap().textContent = "加载 3D 引擎…"; loadThree().then(() => ES.view3d.update(A)).catch((e) => { $cap().textContent = "3D 预览不可用(无法加载 three.js)"; }); return; }
      if (!V.renderer) { try { V.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("v3d"), antialias: true }); } catch (e) { $cap().textContent = "此浏览器无法创建 WebGL 画布"; return; } V.renderer.shadowMap.type = THREE.PCFSoftShadowMap; V.cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.2, 3000); new ResizeObserver(() => { if (V.renderer && V.A) { size(); frame(V.A); render(V.A); } }).observe(document.getElementById("preview")); document.getElementById("preview").addEventListener("click", () => { V.big = !V.big; document.getElementById("preview").classList.toggle("big", V.big); }); }
      size(); const key = [A.name, A.variant, A.look, JSON.stringify(A.occ)].join("|");
      if (key !== V.key) { build(A); V.key = key; }
      frame(A); render(A);
    },
  };
})();
