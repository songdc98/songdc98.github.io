/* Real models exported from the Blender asset set (scripts/export_glb_assets.py): vehicles (sedan ... bus), Unitree Go2 (articulated, gait from two-link IK),
   Skydio X2, delivery rover. GLB nodes are in the lab's frame (x forward, y up, z = -left), so ENU yaw maps to rotation.y directly. */
(function () {
  const ES = (window.ES = window.ES || {});
  ES.ASSET_DIR = ES.ASSET_DIR || "assets";
  const LOADER_URL = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js";
  let loaderP = null;
  const loadLoader = () => (window.THREE && THREE.GLTFLoader ? Promise.resolve() : loaderP || (loaderP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = LOADER_URL; s.onload = res; s.onerror = () => rej(new Error("GLTFLoader 加载失败")); document.head.appendChild(s); })));
  const CACHE = {}, READY = {}, GLTF = {};
  /* every GLB goes through one queue with at most 4 requests in flight (a burst of 40 files, e.g. the tree LODs, overflows the listen queue of simple static servers);
     `name` may contain a sub-folder ("props/bench"); GLTF[name] keeps the whole parsed glTF (animations, cameras) next to READY[name] = gltf.scene */
  const QUEUE = [], MAXQ = 4; let inflight = 0;
  const pump = () => { while (inflight < MAXQ && QUEUE.length) { const job = QUEUE.shift(); inflight++; job().finally(() => { inflight--; pump(); }); } };
  const enqueue = (fn) => new Promise((res, rej) => { QUEUE.push(() => fn().then(res, rej)); pump(); });
  const fetchGLB = (name) => enqueue(() => loadLoader().then(() => new Promise((res, rej) => new THREE.GLTFLoader().load(`${ES.ASSET_DIR}/${name}.glb`, res, undefined, rej))));
  const RETIRED = { go2: 1, x2: 1 };                                      // the old single-file robot models were replaced by assets/robots/*.glb (robots.js): never request them
  const load = (name) => CACHE[name] || (CACHE[name] = (RETIRED[name] ? Promise.reject(new Error("retired model " + name)) : fetchGLB(name)).then((g) => { READY[name] = g.scene; GLTF[name] = g; if (ES.bus && ES.bus.emit) ES.bus.emit("models", name); return g.scene; }).catch((e) => { if (!RETIRED[name]) console.warn("model", name, e); READY[name] = null; return null; }));
  /* actor registry: a maker returns a rig {root: THREE.Object3D (origin = ground point under the body, +x forward, +y up), update(dt, st), setNight?(bool), dispose?()} or null while its files are still loading.
     st = per-frame kinematic state computed by view3d (tickLive / updateSelf): {t, dt, x, y, z, yaw, vx, vy, vz, speed, vf, vs, af, as, yawRate, pitch, roll, moving, role, view, night, gimbal, head}. */
  const ACTORS = {}, actors = { makers: ACTORS, register(kind, fn) { ACTORS[kind] = fn; }, has: (kind) => !!ACTORS[kind], make(kind, opts) { const f = ACTORS[kind]; if (!f || actors.disabled) return null; try { return f(opts || {}) || null; } catch (e) { console.warn("actor", kind, e); return null; } } };
  ES.actors = actors;
  /* night test shared by all rigs: the environment module's flag when it exists (function or boolean), else the lab's look */
  actors.isNight = () => { const e = ES.env; if (e && e.isNight !== undefined) return typeof e.isNight === "function" ? !!e.isNight() : !!e.isNight; if (e && e.look !== undefined) return /night/.test(String(typeof e.look === "function" ? e.look() : e.look)); return !!(ES.app && ES.app.look === "night"); };
  /* kinematic tracker: successive world poses of one actor -> the state struct the rigs consume (finite differences, first-order low-pass; a jump = teleport / loop wrap restarts it).
     T = any object kept per actor; returns T.st = {x, y, z, yaw, vx, vy, vz, speed, vf, vs, af, as, az, yawRate, moving, ...}; the caller fills pitch / roll / role / view / night / gimbal / head. */
  actors.track = (T, dt, x, y, z, yaw, opt = {}) => {
    let st = T.st; if (!st) st = T.st = { x, y, z, yaw, vx: 0, vy: 0, vz: 0, speed: 0, vf: 0, vs: 0, af: 0, as: 0, az: 0, yawRate: 0, pitch: 0, roll: 0, moving: false, landed: false, role: "stand", view: "fpv", night: false, gimbal: null, head: null, live: false, t: 0, dt: 0, id: null, first: true };
    if (dt > 1e-4 && !st.first) {
      const ix = (x - st.x) / dt, iy = (y - st.y) / dt, iz = (z - st.z) / dt, vmax = opt.vmax || 14;
      if (Math.hypot(ix, iy) > vmax || Math.abs(iz) > vmax) { st.vx = st.vy = st.vz = st.vf = st.vs = st.af = st.as = st.az = st.yawRate = 0; }
      else {
        const a = 1 - Math.exp(-dt / 0.12), b = 1 - Math.exp(-dt / 0.2), c = Math.cos(yaw), s = Math.sin(yaw), pvf = st.vf, pvs = st.vs, pvz = st.vz;
        st.vx += (ix - st.vx) * a; st.vy += (iy - st.vy) * a; st.vz += (iz - st.vz) * a;
        st.vf = st.vx * c + st.vy * s; st.vs = -st.vx * s + st.vy * c;
        st.af += ((st.vf - pvf) / dt - st.af) * b; st.as += ((st.vs - pvs) / dt - st.as) * b; st.az += ((st.vz - pvz) / dt - st.az) * b;
        st.yawRate += (ES.wrapPi(yaw - st.yaw) / dt - st.yawRate) * a;
      }
    }
    st.first = false; st.x = x; st.y = y; st.z = z; st.yaw = yaw; st.dt = dt; st.speed = Math.hypot(st.vx, st.vy); st.moving = st.speed > 0.25; return st;
  };
  const srgb = (c) => new THREE.Color(c).convertSRGBToLinear();
  const PAINT = [0xe9e9e6, 0x1b1c1e, 0xaeb2b8, 0x5b5f64, 0x9d1c20, 0x203f78, 0x2c5a3b, 0xc9b99c];            // fleet shares: white / black / silver / grey dominate

  const MATS = {};
  function vehMats() {
    if (MATS.v) return MATS.v;
    const mv = (MATS.v = {
      glass: new THREE.MeshStandardMaterial({ color: srgb(0x0b1118), roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.62, envMapIntensity: 1.7 }),
      rubber: new THREE.MeshStandardMaterial({ color: srgb(0x101010), roughness: 0.92 }), under: new THREE.MeshStandardMaterial({ color: srgb(0x0c0c0d), roughness: 0.95 }),
      rim: new THREE.MeshStandardMaterial({ color: srgb(0xb9bcc2), roughness: 0.28, metalness: 0.95 }), chrome: new THREE.MeshStandardMaterial({ color: srgb(0xd0d2d6), roughness: 0.15, metalness: 1.0 }),
      brake: new THREE.MeshStandardMaterial({ color: srgb(0x3a2a20), roughness: 0.6, metalness: 0.5 }), trim: new THREE.MeshStandardMaterial({ color: srgb(0x111214), roughness: 0.6 }),
      interior: new THREE.MeshStandardMaterial({ color: srgb(0x15161a), roughness: 0.9 }), gap: new THREE.MeshBasicMaterial({ color: 0x000000 }), mirror: new THREE.MeshStandardMaterial({ color: srgb(0x111214), roughness: 0.3 }),
      plate: new THREE.MeshStandardMaterial({ color: srgb(0xd8d8d0), roughness: 0.5 }), grille: new THREE.MeshStandardMaterial({ color: srgb(0x131417), roughness: 0.4, metalness: 0.4 }),
      head: new THREE.MeshStandardMaterial({ color: srgb(0xdfe3e6), roughness: 0.1, metalness: 0.2 }), tail: new THREE.MeshStandardMaterial({ color: srgb(0x7a0d0d), roughness: 0.2 }),
    });
    for (const k in mv) mv[k].name = k;                         // role names stay readable on the shared materials (vehicles.js finds the lamps by them)
    return mv;
  }
  /* parked vehicle: clone of the template with a clear-coat paint in colour `color` (index into the fleet palette) */
  function vehicleFrom(tpl, color = 0, vtype = "") {
    const g = tpl.clone(true), M = vehMats(), paint = new THREE.MeshPhysicalMaterial({ color: srgb(PAINT[color % PAINT.length]), metalness: 0.5, roughness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.0 });
    g.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; const n = o.material && o.material.name; if (n === "paint" || n === "paint2") o.material = paint; else if (M[n]) o.material = M[n]; else if (o.material) { o.material = o.material.clone(); o.material.envMapIntensity = 0.7; } });
    g.userData.wheels = []; g.traverse((o) => { if (/:?wheel\d[LRC]$/.test(o.name)) g.userData.wheels.push(o); });
    if (ES.vehicles && ES.vehicles.attach) ES.vehicles.attach(g, vtype);          // lamp rig (head / tail / brake / indicators / light bars), vehicles.js
    return g;
  }
  const vehicle = async (vtype, color = 0) => { const t = await load("veh_" + vtype); return t ? vehicleFrom(t, color, vtype) : null; };
  const vehicleSync = (vtype, color = 0) => { const t = READY["veh_" + vtype]; if (t === undefined) load("veh_" + vtype); return t ? vehicleFrom(t, color, vtype) : null; };
  /* Unitree Go2: base + 12 joints; stance / swing foot paths solved with two-link IK (thigh and calf 0.213 m) */
  function dogFrom(tpl, meta) {
    const root = tpl.clone(true), J = {};
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material = o.material.clone(); o.material.envMapIntensity = 0.8; o.material.roughness = Math.max(o.material.roughness, 0.35); } } });
    for (const [k, j] of Object.entries(meta.joints)) { const n = root.getObjectByName(j.node); if (n) J[k] = { n, axis: new THREE.Vector3(...j.axis).normalize(), rest: new THREE.Quaternion(j.rest[1], j.rest[2], j.rest[3], j.rest[0]) }; }
    const set = (k, a) => { const j = J[k]; if (j) j.n.quaternion.copy(j.rest).multiply(new THREE.Quaternion().setFromAxisAngle(j.axis, a)); };
    const L1 = 0.213, L2 = 0.213, st = meta.stand;
    const ik = (x, d) => { const r = Math.min(Math.hypot(x, d), L1 + L2 - 1e-3), c = (r * r - L1 * L1 - L2 * L2) / (2 * L1 * L2), q2 = -Math.acos(Math.max(-1, Math.min(1, c))), q1 = Math.atan2(x, d) + Math.atan2(L2 * Math.sin(-q2), L1 + L2 * Math.cos(q2)); return [q1, q2]; };
    const wrap = new THREE.Group(); wrap.add(root);
    const out = { root: wrap, joints: J, stand() { for (const l of ["FL", "FR", "RL", "RR"]) { set(l + "_hip_joint", 0); set(l + "_thigh_joint", st.thigh); set(l + "_calf_joint", st.calf); } }, height: 0.28, t: 0 };
    /* trot gait: v [m/s] forward speed; w [rad/s] turn rate; returns the body bob */
    out.freq = (v) => 1.6 + 1.1 * Math.min(Math.abs(v), 1.6);
    out.gait = (v, phase) => {
      const speed = Math.abs(v), f = out.freq(speed), duty = 0.62, S = Math.min(0.34, speed * duty / f), h0 = 0.265, lift = 0.07 * Math.min(1, speed / 0.5 + 0.1);
      for (const [l, ph] of [["FL", 0], ["RR", 0], ["FR", 0.5], ["RL", 0.5]]) {
        const s = (((phase + ph) % 1) + 1) % 1; let x, z;
        if (speed < 0.03) { x = 0; z = h0; } else if (s < duty) { x = (S / 2) * (1 - (2 * s) / duty) * Math.sign(v); z = h0; } else { const u = (s - duty) / (1 - duty); x = (-S / 2 + S * u) * Math.sign(v); z = h0 - lift * Math.sin(Math.PI * u); }
        const [q1, q2] = ik(x, z); set(l + "_hip_joint", 0); set(l + "_thigh_joint", q1); set(l + "_calf_joint", q2);
      }
      return speed < 0.03 ? 0 : 0.008 * Math.sin(2 * Math.PI * phase * 2);
    };
    out.stand();
    const bb = new THREE.Box3().setFromObject(wrap); wrap.position.y = -bb.min.y; out.height = bb.max.y - bb.min.y; out.baseY = wrap.position.y;
    return out;
  }
  const metaP = () => CACHE.go2meta || (CACHE.go2meta = Promise.resolve((READY.go2meta = null)));          // legacy Go2 joint table is gone with the old model
  const dog = async () => { const [t, m] = await Promise.all([load("go2"), metaP()]); return t && m ? dogFrom(t, m) : null; };
  const dogSync = () => { if (READY.go2 === undefined) load("go2"); if (READY.go2meta === undefined) metaP(); return READY.go2 && READY.go2meta ? dogFrom(READY.go2, READY.go2meta) : null; };
  function uavFrom(tpl) { const root = tpl.clone(true); root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.envMapIntensity = 0.8; } }); const g = new THREE.Group(); g.add(root); return { root: g }; }
  const uav = async () => { const t = await load("x2"); return t ? uavFrom(t) : null; };
  const uavSync = () => { if (READY.x2 === undefined) load("x2"); return READY.x2 ? uavFrom(READY.x2) : null; };
  function roverFrom(tpl) {
    const root = tpl.clone(true), wheels = []; root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.envMapIntensity = 0.7; } if (/:wheel\d$/.test(o.name)) wheels.push(o); });
    const g = new THREE.Group(); g.add(root); root.position.y = 0.12; return { root: g, wheels };
  }
  const rover = async () => { const t = await load("rover"); return t ? roverFrom(t) : null; };
  const roverSync = () => { if (READY.rover === undefined) load("rover"); return READY.rover ? roverFrom(READY.rover) : null; };
  /* trees (scripts/export_tree_assets.py): species meshes with bark + alpha-cut leaf cards; two LODs; templates keep one shared material set */
  const treeMeta = () => CACHE.treeMeta || (CACHE.treeMeta = fetch(`${ES.ASSET_DIR}/trees.json`).then((r) => r.json()).then((m) => { READY.treeMeta = m; if (ES.bus && ES.bus.emit) ES.bus.emit("models", "trees.json"); return m; }).catch(() => (READY.treeMeta = null)));
  function prepTree(tpl) {
    if (tpl.userData.prepped) return tpl; tpl.userData.prepped = true;
    tpl.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; const m = o.material; if (!m) return; m.envMapIntensity = 0.6;
      if (m.name === "leaf") { m.alphaTest = 0.45; m.transparent = false; m.side = THREE.DoubleSide; m.roughness = 0.82; m.metalness = 0; } else if (m.name === "bark") { m.roughness = 0.95; m.metalness = 0; } });
    return tpl;
  }
  const treeSync = (file) => { const key = file.replace(/\.glb$/, ""), t = READY[key]; if (t === undefined) load(key); return t ? prepTree(t).clone(true) : null; };
  /* baseline rigs (robots.js / vehicles.js register the detailed makers over these): the same motion the lab always had, behind the rig interface */
  actors.register("dog", () => { const r = dogSync(); if (!r) return null; let ph = Math.random(); r.root.rotation.order = "YZX"; return { root: r.root, update(dt, st) { ph = (ph + dt * r.freq(st.speed)) % 1; r.root.position.y = r.baseY + r.gait(st.moving ? st.speed : 0, ph); r.root.rotation.z = st.pitch || 0; r.root.rotation.x = st.roll || 0; } }; });
  actors.register("uav", () => { const r = uavSync(); if (!r) return null; r.root.rotation.order = "YZX"; return { root: r.root, update(dt, st) { r.root.rotation.z = st.pitch || 0; r.root.rotation.x = st.roll || 0; } }; });
  actors.register("rover", () => { const r = roverSync(); if (!r) return null; let d = 0; return { root: r.root, update(dt, st) { d += st.vf * dt; r.wheels.forEach((w) => { w.rotation.z = -(d / 0.1) % 6.283; }); } }; });
  ES.models = { load, vehicle, dog, uav, rover, vehicleSync, dogSync, uavSync, roverSync, PAINT, READY, GLTF, srgb, treeMeta, treeSync };
})();
