/* robots.js: the Unitree Go2 quadruped and the Skydio X2 class UAV (work package "robots", web/docs/characters-props.md section 2).
   Files: assets/robots/go2.glb + go2.json, x2.glb + x2.json (scripts/export_robot_assets.py). Registers the "dog" and "uav" makers of ES.actors; the baseline rigs of
   models.js stay reachable in ES.robots.base (A/B tests). rig.root origin: dog = ground point under the body centre, UAV = plane of its feet; +x = front, +y up, left = -z.
   Dog: foot-planted trot (stance feet pinned in world coordinates, Raibert touchdown targets, diagonal pairs, turning / strafing / backwards), 3-DOF leg IK that
   compensates body sway / bounce / terrain tilt, head node, lamps, contact shadows. UAV: arm hinges (fold when landed and powered down), rotors whose rate follows
   thrust with blur discs, horizon-stabilised 3-axis gimbal, nav lights + double-flash strobe, tilt + hover micro-motion, feet snapped to the floor when landed. */
(function () {
  const ES = (window.ES = window.ES || {});
  const R = (ES.robots = ES.robots || {});
  if (ES.actors && !R.base) R.base = { dog: ES.actors.makers.dog, uav: ES.actors.makers.uav };
  const TAU = Math.PI * 2, G0 = 9.81;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }, lp = (dt, tau) => 1 - Math.exp(-dt / tau);
  const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  /* ---------------------------------------------------------------- files ---------------------------------------------------------------- */
  const META = {}, METAP = {};
  function meta(name) {
    if (!METAP[name]) METAP[name] = fetch(`${ES.ASSET_DIR || "assets"}/robots/${name}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((m) => { META[name] = m; if (ES.bus) ES.bus.emit("models", `robots/${name}.json`); return m; }).catch((e) => { console.warn("robots meta", name, e); META[name] = null; return null; });
    return META[name];
  }
  function files(name) { const k = "robots/" + name, t = ES.models.READY[k]; if (t === undefined) ES.models.load(k); const m = meta(name); return t && m ? { t, m } : null; }
  const whenFiles = (name) => Promise.all([ES.models.load("robots/" + name), META[name] || (meta(name), METAP[name])]).then(() => files(name));

  /* ------------------------------------------------- shared materials, textures, geometry ------------------------------------------------- */
  let MAT = null, TEX = null, GEO = null;
  const col = (h) => new THREE.Color(h).convertSRGBToLinear();
  function mats() {
    if (MAT) return MAT;
    const std = (h, r, m = 0, env = 0.8) => new THREE.MeshStandardMaterial({ color: col(h), roughness: r, metalness: m, envMapIntensity: env });
    const phy = (h, r, m, cc, ccr, env) => new THREE.MeshPhysicalMaterial({ color: col(h), roughness: r, metalness: m, clearcoat: cc, clearcoatRoughness: ccr, envMapIntensity: env });
    MAT = {   // role names = material names written by scripts/export_robot_assets.py
      shell: phy(0xe4e5e2, 0.42, 0, 0.45, 0.3, 0.8), decal: std(0x151618, 0.6), face: phy(0x0a0b0d, 0.22, 0.1, 1, 0.08, 1.1), lidar: phy(0x05060a, 0.05, 0.25, 1, 0.03, 1.4),
      cage: std(0x2a2c30, 0.48, 0.1), cap: std(0x8f9398, 0.34, 0.7), joint: std(0x2a2c30, 0.5, 0.05), calf: std(0x1b1c1f, 0.42, 0.1), foot: std(0x0e0e0f, 0.9), trim: std(0x2c2e32, 0.6),
      lens: phy(0x030408, 0.04, 0.3, 1, 0.02, 1.6),
      body: std(0x2a2d31, 0.5, 0.2), battery: std(0x3b3f44, 0.55, 0.08), arm_front: std(0xa3a8ad, 0.4, 0.2), arm_rear: std(0x232528, 0.46, 0.25), motor: std(0x131416, 0.32, 0.75),
      glass: phy(0x070a0f, 0.05, 0.2, 1, 0.03, 1.5), lens_ir: std(0x29252f, 0.2, 0.55), rubber: std(0x0e0e0f, 0.9), gimbal: std(0x2d3034, 0.38, 0.45), metal: std(0xb8bcc1, 0.28, 1.0),
      antenna: std(0x1b1c1e, 0.7), prop: std(0x151618, 0.42, 0.05),
    };
    for (const [k, m] of Object.entries(MAT)) m.name = k;
    return MAT;
  }
  function canvasTex(n, paint) { const c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d"); paint(g, n); const t = new THREE.CanvasTexture(c); return t; }
  function tex() {
    if (TEX) return TEX;
    TEX = {
      blob: canvasTex(64, (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); r.addColorStop(0, "rgba(0,0,0,1)"); r.addColorStop(0.35, "rgba(0,0,0,.72)"); r.addColorStop(0.7, "rgba(0,0,0,.22)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, n, n); }),
      halo: canvasTex(64, (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.18, "rgba(255,255,255,.75)"); r.addColorStop(0.45, "rgba(255,255,255,.18)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, n, n); }),
      /* rotor blur disc: the time-averaged coverage of two blades, 2 c(r) / (2 pi r) (dense near the hub, faint at the tips) + a faint tip ring; colour = prop plastic */
      disc: canvasTex(128, (g, n) => {
        const im = g.createImageData(n, n), h = n / 2;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const r = Math.hypot(i + 0.5 - h, j + 0.5 - h) / h, ch = r < 0.1 ? 0 : 0.10 + 0.17 * Math.sin(Math.PI * clamp(r * 1.2, 0, 1)) * (1 - 0.45 * r);   // chord / R
          let a = r < 0.1 || r > 1 ? 0 : clamp((2 * ch) / (TAU * Math.max(r, 0.12)), 0, 0.7) * sstep(0.1, 0.17, r) * (1 - sstep(0.965, 1.0, r)); a += 0.07 * sstep(0.9, 0.95, r) * (1 - sstep(0.96, 0.995, r));
          const k = (j * n + i) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = 40; im.data[k + 3] = Math.round(255 * clamp(a * 1.5, 0, 1));
        }
        g.putImageData(im, 0, 0);
      }),
    };
    TEX.disc.encoding = THREE.sRGBEncoding;
    return TEX;
  }
  function geo() {
    if (GEO) return GEO;
    const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
    return (GEO = { flat });
  }
  const lampMat = (lens, glow) => new THREE.MeshStandardMaterial({ color: col(lens), emissive: col(glow), emissiveIntensity: 0.5, roughness: 0.22, metalness: 0, envMapIntensity: 0.9 });
  const blobMat = () => new THREE.MeshBasicMaterial({ map: tex().blob, color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  const haloMat = (c) => new THREE.SpriteMaterial({ map: tex().halo, color: col(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, toneMapped: false, opacity: 0.9 });
  const flu = (p) => [p[0], p[2], -p[1]];               // FLU (Blender / lab body frame) -> three model frame

  /* scratch objects (rigs update one after the other: module-level scratch, no per-frame allocation) */
  let _v, _mt, _ms, _q1, _q2, _e1;
  const scratch = () => { if (!_v) { _v = new THREE.Vector3(); _mt = new THREE.Matrix4(); _ms = new THREE.Matrix4(); _q1 = new THREE.Quaternion(); _q2 = new THREE.Quaternion(); _e1 = new THREE.Euler(); } };
  /* floor height under (x, y) from the lab's world model (the UAV's feet snap to it when landed), null outside the walk view */
  const floorZ = (x, y) => { const w = ES.view3d && ES.view3d.walk, V = w && w.V, W = V && V.A && V.A.W; return W ? W.groundZ(x, y) : null; };

  /* ================================================================ Unitree Go2 ================================================================ */
  const LEGN = ["FL", "FR", "RL", "RR"], PHOFF = { FL: 0, RR: 0, FR: 0.5, RL: 0.5 };          // trot: diagonal pairs FL+RR / FR+RL
  const DUTY = 0.62, SMAX = 0.34;
  function go2Rig(opts, F) {
    scratch();
    const M = F.m, mt = mats(), seed = (opts.seed || 0) >>> 0, L1 = M.L1, L2 = M.L2, SOLE = M.sole, H0 = M.stand.hip_height;
    const root = new THREE.Group(), terr = new THREE.Group(), sway = new THREE.Group(), g = F.t.clone(true);
    root.name = "go2_rig"; terr.rotation.order = "YZX"; root.add(terr); terr.add(sway); sway.add(g); sway.position.y = H0;
    const lampF = lampMat(0xdde4e8, 0xffffff), lampR = lampMat(0x5a100c, 0xff2412), lampS = lampMat(0x0a1820, 0x6fd6ff);
    g.traverse((o) => {
      if (!o.isMesh) return; const n = o.material && o.material.name;
      o.material = n === "led_front" ? lampF : n === "led_rear" ? lampR : n === "lidar_scan" ? lampS : mt[n] || o.material;
      o.castShadow = !/^(led|lidar_scan|lens|decal|trim|face)/.test(n); o.receiveShadow = true;
    });
    const legs = LEGN.map((k) => {
      const d = M.legs[k];
      return { k, hip: g.getObjectByName(d.hip), thigh: g.getObjectByName(d.thigh), calf: g.getObjectByName(d.calf), foot: g.getObjectByName(d.foot), hp: d.hip_pos, d: d.thigh_off,
        nx: d.hip_pos[0], ny: d.hip_pos[1] + d.thigh_off, off: PHOFF[k], px: 0, py: 0, lx: 0, ly: 0, cx: 0, cy: 0, h: 0, sw: false, u: 0, blob: null, bm: null, steps: 0 };
    });
    const head = g.getObjectByName(M.head.node), scan = g.getObjectByName(M.scan_node), hp0 = M.head.pivot; if (head) head.rotation.order = "YZX";
    // contact shadows on the terrain plane (not tilted by the sway): one per foot + a soft one under the body
    const GE = geo(), blobs = [];
    for (const l of legs) { l.bm = blobMat(); l.blob = new THREE.Mesh(GE.flat, l.bm); l.blob.renderOrder = 1; terr.add(l.blob); blobs.push(l.bm); }
    const bodyBM = blobMat(); bodyBM.opacity = 0.26; const bodyBlob = new THREE.Mesh(GE.flat, bodyBM); bodyBlob.scale.set(0.66, 1, 0.36); bodyBlob.position.set(0.02, 0.002, 0); terr.add(bodyBlob); blobs.push(bodyBM);
    for (const b of [bodyBlob, ...legs.map((l) => l.blob)]) { b.castShadow = false; b.receiveShadow = false; b.userData.noShadow = true; }
    // night halos (constant screen size): eyes + head lamp, rear bar
    const hF = haloMat(0xffffff), hR = haloMat(0xff2a18), halos = [];
    const halo = (parent, p, m, s) => { if (!parent) return; const sp = new THREE.Sprite(m); sp.position.set(...p); sp.scale.set(s, s, 1); sp.visible = false; sp.userData.noShadow = true; parent.add(sp); halos.push(sp); };
    const hl = (p) => flu([p[0] - hp0[0], p[1] - hp0[1], p[2] - hp0[2]]);
    if (M.lamps.eye_L) halo(head, hl(M.lamps.eye_L), hF, 0.012); if (M.lamps.eye_R) halo(head, hl(M.lamps.eye_R), hF, 0.012); halo(head, hl(M.lamps.head_lamp), hF, 0.018);
    const base = g.getObjectByName("go2") || g; halo(base, flu(M.lamps.rear_bar), hR, 0.014);
    const S = { ph: (seed % 997) / 997, on: false, init: false, tp: 0, tr: 0, hy: 0, hpi: 0, brake: 0, t: (seed % 101) * 0.37, x0: 0, y0: 0, f: 1.6 };

    /* 3-DOF leg IK in the base frame (FLU): hip abduction about x, thigh / calf about y (knee backwards); writes the node rotations (three: x = FLU x, z = -FLU y) */
    function ik(l, fx, fy, fz) {
      const px = fx - l.hp[0], py = fy - l.hp[1], pz = fz - l.hp[2], d = l.d;
      const Lyz = Math.sqrt(Math.max(py * py + pz * pz - d * d, 1e-8)), q0 = Math.atan2(pz, py) - Math.atan2(-Lyz, d);
      const r = Math.min(Math.hypot(px, Lyz), L1 + L2 - 1e-4), c2 = clamp((r * r - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1), q2 = -Math.acos(c2);
      const q1 = Math.atan2(-px, Lyz) + Math.atan2(L2 * Math.sin(-q2), L1 + L2 * Math.cos(q2));
      l.hip.rotation.x = q0; l.thigh.rotation.z = -q1; l.calf.rotation.z = -q2;
    }
    function plantAll(x, y, c, s) { for (const l of legs) { l.px = l.cx = x + c * l.nx - s * l.ny; l.py = l.cy = y + s * l.nx + c * l.ny; l.sw = false; l.h = 0; } }
    function update(dt, st) {
      dt = clamp(dt || 0, 0, 0.1); S.t += dt;
      const x = st.x || 0, y = st.y || 0, yaw = st.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
      if (!S.init || Math.hypot(x - S.x0, y - S.y0) > 1.5) { plantAll(x, y, c, s); S.init = true; }          // first frame / teleport: feet under the hips
      S.x0 = x; S.y0 = y;
      // terrain attitude (st.pitch / st.roll: terrain-following estimate) on the terrain node
      const at = lp(dt, 0.12); S.tp += ((st.pitch || 0) - S.tp) * at; S.tr += ((st.roll || 0) - S.tr) * at;
      terr.rotation.set(S.tr, 0, S.tp); terr.updateMatrix(); _mt.copy(terr.matrix).invert();
      const tanP = Math.tan(S.tp), tanR = Math.tan(S.tr) / Math.cos(S.tp);
      // gait clock: base law f(v) = 1.6 + 1.1 min(|v|, 1.6) Hz, raised when a hip moves faster than the 0.34 m stride allows
      const vx = st.vx || 0, vy = st.vy || 0, w = st.yawRate || 0, sp = Math.hypot(vx, vy);
      let vh = 0, off = 0;
      for (const l of legs) {
        const rx = c * l.nx - s * l.ny, ry = s * l.nx + c * l.ny; vh = Math.max(vh, Math.hypot(vx - w * ry, vy + w * rx));
        off = Math.max(off, Math.hypot(l.px - (x + rx), l.py - (y + ry)));
      }
      const moving = sp > 0.06 || Math.abs(w) > 0.12, f = Math.max(1.6 + 1.1 * Math.min(sp, 1.6), (vh * DUTY) / SMAX);
      S.on = moving || off > 0.012 || legs.some((l) => l.sw); S.f = f;
      if (S.on) S.ph = (S.ph + f * dt) % 1;
      const Tsw = (1 - DUTY) / f, Tst = DUTY / f, lift = 0.04 + 0.035 * clamp(sp / 1.5, 0, 1);
      for (const l of legs) {
        const sph = (S.ph + l.off) % 1, swing = S.on && sph >= DUTY;
        if (swing && !l.sw) { l.sw = true; l.lx = l.px; l.ly = l.py; }                                 // lift-off
        if (l.sw) {
          const u = swing ? (sph - DUTY) / (1 - DUTY) : 1, rem = (1 - u) * Tsw, yt = yaw + w * rem, ct = Math.cos(yt), stt = Math.sin(yt);
          const rx = ct * l.nx - stt * l.ny, ry = stt * l.nx + ct * l.ny, nxw = x + vx * rem + rx, nyw = y + vy * rem + ry;
          let dx = ((vx - w * ry) * Tst) / 2, dy = ((vy + w * rx) * Tst) / 2; const dl = Math.hypot(dx, dy); if (dl > SMAX / 2) { dx *= SMAX / 2 / dl; dy *= SMAX / 2 / dl; }
          const tx = nxw + dx, ty = nyw + dy, e = u * u * (3 - 2 * u);                                     // Raibert touchdown target, smooth horizontal path
          l.cx = l.lx + (tx - l.lx) * e; l.cy = l.ly + (ty - l.ly) * e; l.h = lift * Math.sin(Math.PI * Math.min(1, u * 1.06)); l.u = u;
          if (!swing) { l.sw = false; l.px = l.cx = tx; l.py = l.cy = ty; l.h = 0; l.steps++; }         // touchdown: planted in world coordinates
        } else { l.cx = l.px; l.cy = l.py; l.h = 0; }
      }
      // body: bounce / roll / pitch locked to the trot phase, lean into acceleration and turns, breathing when idle
      const k = clamp(sp / 1.0, 0, 1) * (S.on ? 1 : 0), ph = S.ph * TAU, idle = 1 - k;
      const bob = -0.0045 * k * Math.cos(2 * ph) + 0.0016 * idle * Math.sin(S.t * 1.7);
      const pitchS = 0.0175 * k * Math.sin(2 * ph + 1.1) + clamp(0.01 * (st.af || 0), -0.03, 0.03) + 0.0025 * idle * Math.sin(S.t * 1.7 + 0.8);
      const rollS = 0.026 * k * Math.sin(ph) - clamp(0.02 * (st.vf || 0) * w, -0.05, 0.05);
      sway.position.y = H0 + bob; sway.rotation.set(rollS, 0, pitchS); sway.updateMatrix(); _ms.copy(sway.matrix).invert();
      for (const l of legs) {
        // world -> terrain frame: offset in the yaw frame, vertical projection onto the terrain plane, inverse tilt
        const dx = l.cx - x, dy = l.cy - y, lx = c * dx + s * dy, ly = -s * dx + c * dy;
        _v.set(lx, lx * tanP + ly * tanR, -ly).applyMatrix4(_mt); const tu = _v.x, tw = _v.z;
        _v.set(tu, SOLE + l.h, tw).applyMatrix4(_ms); ik(l, _v.x, -_v.z, _v.y);
        const hh = clamp(l.h / 0.07, 0, 1); l.blob.position.set(tu, 0.003, tw); l.blob.scale.set(0.085 + 0.05 * hh, 1, 0.075 + 0.05 * hh); l.bm.opacity = 0.62 * (1 - hh) + 0.08;
      }
      // head: follows where the pilot looks (own body) / looks into turns, steadied against the body pitch sway
      if (head) {
        const hd = st.head, ah = lp(dt, 0.15);
        S.hy += (clamp((hd ? hd[0] * 0.5 : 0) + 0.1 * w, -0.09, 0.09) - S.hy) * ah; S.hpi += (clamp((hd ? hd[1] * 0.25 : 0) - 0.5 * pitchS, -0.07, 0.07) - S.hpi) * ah;
        head.rotation.set(0, S.hy, S.hpi);
      }
      // lamps: head lamp + eyes (white), rear bar (dim red, brighter when decelerating), faint LiDAR scan ring with a rotating arc
      const night = !!st.night; S.brake += (((st.af || 0) < -0.4 ? 1 : 0) - S.brake) * lp(dt, 0.08);
      lampF.emissiveIntensity = night ? 3.2 : 0.75; lampR.emissiveIntensity = (night ? 1.1 : 0.3) + S.brake * (night ? 3.2 : 1.6); lampS.emissiveIntensity = night ? 0.9 : 0.22;
      if (scan) scan.rotation.y = (S.t * 2.2 * TAU) % TAU;
      for (const h of halos) h.visible = night;
      hR.opacity = 0.32 + 0.6 * S.brake;
    }
    const rig = {
      kind: "go2", root, height: 0.4, update, legs, state: S,
      /* stance feet and their world contact points (test hook): [{k, stance, steps, x, y}] from the rendered foot nodes */
      feet(out) {
        out = out || []; root.updateMatrixWorld(true);
        legs.forEach((l, i) => { l.foot.getWorldPosition(_v); out[i] = { k: l.k, stance: !l.sw, steps: l.steps, x: _v.x, y: -_v.z, z: _v.y - SOLE }; });
        return out;
      },
      dispose() { [lampF, lampR, lampS, hF, hR, ...blobs].forEach((m) => m.dispose()); },
    };
    update(0, { x: 0, y: 0, yaw: 0, night: false });           // stand pose for placed (static) instances
    return rig;
  }

  /* ================================================================ Skydio X2 class UAV ================================================================ */
  const W_HOVER = 72;          // rev/s at hover thrust (visual; a 7.7" prop runs ~70-110 rev/s)
  function x2Rig(opts, F) {
    scratch();
    const M = F.m, mt = mats(), seed = (opts.seed || 0) >>> 0, CG = M.cg_height;
    const root = new THREE.Group(), land = new THREE.Group(), att = new THREE.Group(), g = F.t.clone(true);
    root.name = "x2_rig"; root.add(land); land.add(att); att.position.y = CG; att.rotation.order = "YZX"; att.add(g); g.position.y = -CG;
    const L = { red: lampMat(0x6a0e0a, 0xff1a10), green: lampMat(0x0b5a1c, 0x18ff40), white: lampMat(0xdfe5e8, 0xffffff), strobe: lampMat(0xe6ecef, 0xffffff), status: lampMat(0x0e2a48, 0x2a9dff) };
    const propM = mt.prop.clone(); propM.transparent = true;
    const discM = new THREE.MeshStandardMaterial({ map: tex().disc, color: col(0x8a8d92), roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    g.traverse((o) => {
      if (!o.isMesh) return; const n = o.material && o.material.name;
      o.material = n === "led_red" ? L.red : n === "led_green" ? L.green : n === "led_white" ? L.white : n === "led_strobe" ? L.strobe : n === "led_status" ? L.status : n === "prop" ? propM : mt[n] || o.material;
      o.castShadow = /^(body|battery|arm_|motor|gimbal|prop)/.test(n); o.receiveShadow = true;
    });
    const disc = new THREE.CircleGeometry(M.prop_r, 40); disc.rotateX(-Math.PI / 2);
    const arms = Object.entries(M.arms).map(([k, a], i) => {
      const node = g.getObjectByName(a.node), rotor = g.getObjectByName(a.rotor), d = new THREE.Mesh(disc, discM);
      d.position.copy(rotor.position); d.position.y += 0.0015; d.renderOrder = 2; d.visible = false; d.userData.noShadow = true; node.add(d);
      return { k, node, rotor, disc: d, fold: a.fold, spin: a.spin, park: a.arm_dir, ang: a.arm_dir + (i % 2) * 0.3, var: 1 + 0.03 * Math.sin(seed * 1.7 + i * 2.1) };
    });
    const gy = g.getObjectByName(M.gimbal.yaw), gr = g.getObjectByName(M.gimbal.roll), gp = g.getObjectByName(M.gimbal.pitch), GL = M.gimbal.limits;
    // halos for the nav lights (night), contact shadow under the body (near the floor)
    const halos = [], hm = { red: haloMat(0xff2010), green: haloMat(0x20ff50), white: haloMat(0xffffff), strobe: haloMat(0xffffff) };
    const halo = (parent, p, m, s) => { const sp = new THREE.Sprite(m); sp.position.set(...p); sp.scale.set(s, s, 1); sp.visible = false; parent.add(sp); halos.push(sp); return sp; };
    for (const [nm, key] of [["nav_port", "red"], ["nav_starboard", "green"]]) { const lp_ = M.lamps[nm]; if (!lp_) continue; const node = g.getObjectByName(M.arms[lp_.arm].node); halo(node, flu(lp_.pos), hm[key], 0.014); }
    const base = g.getObjectByName("x2") || g; halo(base, flu(M.lamps.tail), hm.white, 0.012); const hS = halo(base, flu(M.lamps.strobe), hm.strobe, 0.03);
    const shM = blobMat(); shM.opacity = 0; const shadow = new THREE.Mesh(geo().flat, shM); shadow.scale.set(0.42, 1, 0.42); shadow.visible = false; shadow.userData.noShadow = true; root.add(shadow);
    const S = { init: false, f: 1, w: W_HOVER, on: true, landT: 0, airT: 0, pit: 0, rol: 0, gy: 0, gp: 0, land: 0, t: (seed % 97) * 0.53, hover: 1, ph: (seed % 89) / 89 };

    function setFold(f) { const e = f * f * (3 - 2 * f); for (const a of arms) a.node.rotation.y = (1 - e) * a.fold; }
    /* gimbal: camera world orientation (yaw gyaw, pitch gpitch up+, roll 0) relative to the body -> yaw / roll / pitch joint angles (three Euler 'YXZ') */
    function aimGimbal(bodyYaw, gyaw, gpitch) {
      if (!gy) return;
      _e1.set(att.rotation.x, bodyYaw, att.rotation.z, "YZX"); _q1.setFromEuler(_e1).invert();
      _e1.set(0, gyaw, gpitch, "YZX"); _q2.setFromEuler(_e1); _q1.multiply(_q2); _e1.setFromQuaternion(_q1, "YXZ");
      gy.rotation.y = clamp(_e1.y, -GL.yaw, GL.yaw); gr.rotation.x = clamp(_e1.x, -GL.roll, GL.roll); gp.rotation.z = clamp(_e1.z, GL.pitch_down, GL.pitch_up);
    }
    function lights(on, night, t) {
      const k = on ? 1 : 0;
      L.red.emissiveIntensity = L.green.emissiveIntensity = k * (night ? 4 : 0.6); L.white.emissiveIntensity = k * (night ? 3 : 0.55);
      const tm = (t + S.ph) % 1, flash = on && (tm < 0.05 || (tm > 0.16 && tm < 0.21));                      // anti-collision strobe: double flash at 1 Hz
      L.strobe.emissiveIntensity = flash ? (night ? 9 : 3.5) : 0; L.status.emissiveIntensity = k * (night ? 1.6 : 0.8);
      for (const h of halos) h.visible = night && on; hS.visible = night && flash;
    }
    function update(dt, st) {
      dt = clamp(dt || 0, 0, 0.1); S.t += dt;
      const landed = !!st.landed, night = !!st.night;
      if (!S.init) { S.init = true; if (landed) { S.f = 0; S.w = 0; S.landT = 10; } }                    // first frame: start folded and quiet when parked
      if (landed) { S.landT += dt; S.airT = 0; } else { S.airT += dt; S.landT = 0; }
      // attitude: suggested tilt (thrust vector leans into the acceleration), level on the ground
      const a = lp(dt, 0.1); S.pit += ((landed ? 0 : st.pitch || 0) - S.pit) * a; S.rol += ((landed ? 0 : st.roll || 0) - S.rol) * a;
      // rotor rate follows thrust: T/T_hover = (g + a_z) / g / cos(tilt), rate ~ sqrt(T); spin-up ~0.6 s, spin-down ~0.8 s; quiet once landed
      const tilt = Math.acos(clamp(Math.cos(S.pit) * Math.cos(S.rol), -1, 1)), thrust = clamp((G0 + (st.az || 0)) / G0 / Math.max(0.5, Math.cos(tilt)), 0.35, 2.2);
      const wT = landed ? 0 : W_HOVER * Math.sqrt(thrust); S.w += clamp(wT - S.w, -dt * 95, dt * 125); if (S.w < 0.05 && wT === 0) S.w = 0;
      // arms: unfold (0.8 s) whenever flying / spinning, fold 2 s after the rotors stopped on the ground
      const unfold = !landed || S.w > 0.5 || S.landT < 2.0; S.f = clamp(S.f + (unfold ? dt : -dt) / 0.8, 0, 1); setFold(S.f);
      S.on = !landed || S.w > 0 || S.f > 0 || S.landT < 3.0;
      // rotors: blades while slow, blur disc when fast; parked along the arm when stopped
      const bladeA = 1 - sstep(7, 17, S.w), discA = sstep(9, 22, S.w);
      propM.opacity = bladeA; discM.opacity = 0.95 * discA;
      for (const r of arms) {
        if (S.w > 1.5) r.ang = (r.ang + r.spin * r.var * S.w * TAU * dt) % TAU;
        else { const k = Math.round((r.ang - r.park) / Math.PI), tgt = r.park + k * Math.PI; r.ang += (tgt - r.ang) * lp(dt, 0.25) + r.spin * S.w * TAU * dt; }
        r.rotor.rotation.y = r.ang; r.rotor.visible = bladeA > 0.01; r.disc.visible = discA > 0.01;
        r.disc.rotation.set(clamp(-0.4 * S.rol - 0.006 * (st.vs || 0), -0.08, 0.08), 0, clamp(-0.4 * S.pit + 0.006 * (st.vf || 0), -0.08, 0.08));
      }
      // hover micro-motion + motor vibration when airborne
      S.hover += ((landed ? 0 : 1) - S.hover) * lp(dt, 0.4); const hv = S.hover, t = S.t;
      const wp = hv * (0.006 * Math.sin(t * 3.96 + 0.3) + 0.003 * Math.sin(t * 10.7 + 1.1) + 0.0012 * Math.sin(t * 144)), wr = hv * (0.006 * Math.sin(t * 4.46 + 2.0) + 0.003 * Math.sin(t * 11.9 + 0.4) + 0.0012 * Math.sin(t * 151));
      att.rotation.set(S.rol + wr, 0, S.pit + wp); att.position.y = CG + hv * 0.006 * Math.sin(t * 2.83 + 0.7);
      // feet on the floor when landed (st.z = the altitude of the feet plane; the floor under the drone may differ by a few cm)
      const fz = floorZ(st.x || 0, st.y || 0), tgtLand = landed && fz !== null ? clamp(fz - (st.z || 0), -0.3, 0.1) : 0;
      S.land += (tgtLand - S.land) * lp(dt, landed ? 0.06 : 0.25); land.position.y = S.land;
      if (fz !== null) { const h = (st.z || 0) + S.land - fz; shadow.visible = h < 2.5; shadow.position.y = fz - (st.z || 0) + 0.004; const k = clamp(h / 2.5, 0, 1); shadow.scale.set(0.44 + 0.5 * k, 1, 0.4 + 0.5 * k); shM.opacity = 0.42 * (1 - k); }
      // gimbal: world-frame target (st.gimbal [yaw, pitch up+]) smoothed like a real gimbal, horizon held against body tilt / vibration
      const gm = st.gimbal, ty = gm ? gm[0] : st.yaw || 0, tp = gm ? gm[1] : -0.12, ag = lp(dt, 0.09);
      S.gy += wrap(ty - S.gy) * ag; S.gp += (tp - S.gp) * ag; aimGimbal(st.yaw || 0, S.gy, S.gp);
      if (dt === 0) { S.gy = ty; S.gp = tp; aimGimbal(st.yaw || 0, ty, tp); }
      lights(S.on, night, t);
    }
    const rig = {
      kind: "x2", root, height: 0.14, update, state: S, arms,
      /* sheet / test poses: "hover" (default), "folded", "unfolded" (landed, rotors stopped) */
      pose(p, yaw = 0, night = false) {
        S.init = true; S.f = p === "folded" ? 0 : 1; S.w = p === "hover" ? W_HOVER : 0; S.landT = p === "hover" ? 0 : 10; S.hover = p === "hover" ? 1 : 0;
        if (p !== "hover") for (const r of arms) r.ang = r.park;
        update(0, { landed: p !== "hover", night, yaw, pitch: 0, roll: 0, az: 0, gimbal: null }); if (p === "unfolded") { S.f = 1; setFold(1); }
        return rig;
      },
      dispose() { [...Object.values(L), propM, discM, shM, ...Object.values(hm)].forEach((m) => m.dispose()); disc.dispose(); },
    };
    rig.pose("hover");                                               // placed (static) instances: hovering with discs, gimbal level
    S.init = false; S.f = 1;
    return rig;
  }

  /* ================================================================ registration ================================================================ */
  if (ES.actors) {
    ES.actors.register("dog", (opts) => { const F = files("go2"); return F ? go2Rig(opts || {}, F) : ES.models.READY["robots/go2"] === null && R.base.dog ? R.base.dog(opts) : null; });
    ES.actors.register("uav", (opts) => { const F = files("x2"); return F ? x2Rig(opts || {}, F) : ES.models.READY["robots/x2"] === null && R.base.uav ? R.base.uav(opts) : null; });
  }
  R.dog = async (opts = {}) => { const F = await whenFiles("go2"); return F ? go2Rig(opts, F) : null; };
  R.uav = async (opts = {}) => { const F = await whenFiles("x2"); return F ? x2Rig(opts, F) : null; };
  R.meta = META;

  /* demo states for contact sheets and tests: run the rig through a synthetic motion (the root stays at the origin; the rig only sees the state struct) */
  R.simulate = (rig, o = {}) => {
    const dt = o.dt || 1 / 60, n = Math.round((o.time || 1) / dt), st = { x: 0, y: 0, z: o.z || 0, yaw: o.yaw || 0, vx: 0, vy: 0, vz: 0, speed: 0, vf: 0, vs: 0, af: o.af || 0, as: 0, az: o.az || 0, yawRate: o.w || 0,
      pitch: o.pitch || 0, roll: o.roll || 0, moving: false, landed: !!o.landed, night: !!o.night, gimbal: o.gimbal || null, head: o.head || null, t: 0, dt };
    for (let i = 0; i < n; i++) {
      const v = typeof o.v === "function" ? o.v(i * dt) : o.v || 0, c = Math.cos(st.yaw), s = Math.sin(st.yaw);
      st.vf = v; st.vs = o.vs || 0; st.vx = c * v - s * st.vs; st.vy = s * v + c * st.vs; st.speed = Math.hypot(st.vx, st.vy); st.moving = st.speed > 0.25;
      st.x += st.vx * dt; st.y += st.vy * dt; st.yaw += (o.w || 0) * dt; st.t += dt;
      if (o.each) o.each(st, i);
      rig.update(dt, st); if (o.after) o.after(st, i);
    }
    return st;
  };
})();
