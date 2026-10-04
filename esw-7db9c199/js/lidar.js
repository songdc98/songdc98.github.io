/* lidar.js -> ES.lidar: LiDAR scanners (ES.ray ray casting) + a clean point-cloud plot. Same return physics as scripts/esworld/sensors/lidar.py Lidar.scan (finite range,
   incidence- and range-dependent return probability sqrt(clip(eff * R^2 / (0.04 t^2))), Gaussian range noise, material reflectivity) plus what the browser adds on top: glass
   (mirror lobe at near-normal incidence, otherwise the beam passes and may hit what is behind), curtains / blinds (partly transparent), foliage (Beer-Lambert volume: sparse
   stochastic returns), dynamic bodies. Scanners cast a ROLLING SLICE per frame like a spinning head; the sweep accumulates in a ring of (column, ring) slots.
   Docs: web/docs/sensors-core.md.  Frames: sensor = body frame FLU (x forward, y left, z up); world = lab ENU. */
(function () {
  "use strict";
  const ES = (window.ES = window.ES || {});
  const LD = (ES.lidar = ES.lidar || {});
  const RC = ES.ray, DEG = Math.PI / 180, TAU = 2 * Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  /* sensors/lidar.py MODELS (lidar_models.json overrides) */
  const MODELS = {
    unitree_l1: { h_fov: 360, v_min: -7, v_max: 52, n_h: 360, n_v: 48, rate_hz: 10, max_range: 30, min_range: 0.05, sigma: 0.02 },
    livox_mid360: { h_fov: 360, v_min: -7, v_max: 52, n_h: 480, n_v: 64, rate_hz: 10, max_range: 70, min_range: 0.1, sigma: 0.02 },
    velodyne_vlp16: { h_fov: 360, v_min: -15, v_max: 15, n_h: 1800, n_v: 16, rate_hz: 10, max_range: 100, min_range: 0.5, sigma: 0.03 },
  };
  const MOUNT = { unitree_l1: [0.28, 0, 0.12], livox_mid360: [0, 0, -0.06], velodyne_vlp16: [0, 0, 0.45] };       // agents_cfg.DEVICES lidar mounts (body frame, m)
  const BODY_Z = { dog: 0.30, rover: 0.19, uav: 0, human: 0.9 };                                                   // body-origin height above the floor (episode data: dog 0.30, rover 0.19, person 0.9)
  LD.MODELS = MODELS; LD.MOUNT = MOUNT; LD.BODY_Z = BODY_Z; LD.specWidth = 0.07; LD.budgetMs = 3.0;
  LD.loaded = false;
  LD.load = () => LD._p || (LD._p = fetch((ES.DATA_DIR || "data") + "/lidar_models.json", { cache: "no-cache" }).then((r) => r.json()).then((j) => {
    for (const [k, v] of Object.entries(j.models || {})) MODELS[k] = Object.assign(MODELS[k] || {}, v);
    for (const [k, v] of Object.entries((j.devices) || {})) { const mdl = v.model; if (mdl && v.mount) MOUNT[mdl] = v.mount; }
    if (j.spec_width) LD.specWidth = j.spec_width;
    if (j.refl_named) { for (const [k, v] of Object.entries(j.refl_named)) RC.REFL[k] = v; for (const m of RC.MATS || []) { const r = j.refl_named[m.name]; if (r) { m.refl = r[0]; m.spec = r[1]; m.nir = r[2]; } } }
    LD.loaded = true; return j;
  }).catch(() => null));
  LD.load();

  /* ---------------- poses ----------------
     Convention: a scanner's getPose() returns the pose of the SENSOR (origin = the sensor's optical centre in world ENU, yaw / pitch / roll of the sensor frame: pitch + = nose up, roll + = right side down).
     The walkPose / livePose / entityPose helpers return BODY poses (body origin: dog 0.30 m, rover 0.19 m above the floor, UAV centre); sensorPose(model, body) applies the mount of the model. */
  LD.sensorPose = (model, b, mount) => { const m = mount || MOUNT[model] || [0, 0, 0], R9 = RC.rotFromPose(b.yaw, b.pitch || 0, b.roll || 0); return { x: b.x + R9[0] * m[0] + R9[1] * m[1] + R9[2] * m[2], y: b.y + R9[3] * m[0] + R9[4] * m[1] + R9[5] * m[2], z: b.z + R9[6] * m[0] + R9[7] * m[1] + R9[8] * m[2], yaw: b.yaw, pitch: b.pitch || 0, roll: b.roll || 0 }; };
  /* highest standable surface at (x, y) the body can step onto (feet at zRef): same rule as view3d.js supportZ (kept here so scanners of other devices need no view3d internals) */
  function supportZ(V, x, y, zRef, step) {
    const f = V.col.floorAt(x, y, zRef, step), g = V.A.W.groundZ(x, y), inB = V.col.buildingAt(x, y, 0);
    if (inB) return f === null ? zRef : f; return f === null ? g : Math.max(f, g);
  }
  /* body pose of the walker: {x, y, z (body origin), yaw, pitch (nose up +), roll (right side down +)}; the dog pitches with the stairs / ramp under it (view3d updateSelf), the UAV with its acceleration */
  LD.walkPose = (WALK, V) => {
    WALK = WALK || ES.view3d.walk.state; V = V || ES.view3d.walk.V;
    if (WALK.body === "uav") { const U = WALK.uav || {}; return { x: WALK.x, y: WALK.y, z: WALK.z, yaw: WALK.yaw, pitch: -(U.pitch || 0), roll: -(U.roll || 0) }; }
    const zv = WALK.zv != null ? WALK.zv : WALK.zf; let pitch = 0;
    if (WALK.body === "dog" && V && V.col) { const c = Math.cos(WALK.yaw), s = Math.sin(WALK.yaw); pitch = clamp(Math.atan2(supportZ(V, WALK.x + c * 0.3, WALK.y + s * 0.3, WALK.zf, 0.3) - supportZ(V, WALK.x - c * 0.3, WALK.y - s * 0.3, WALK.zf, 0.3), 0.6), -0.5, 0.5); }
    return { x: WALK.x, y: WALK.y, z: zv + (BODY_Z[WALK.body] != null ? BODY_Z[WALK.body] : 0.9), yaw: WALK.yaw, pitch, roll: 0 };
  };
  /* body pose of a live-episode agent (item of V.live.userData.items) */
  LD.livePose = (it, V) => {
    V = V || ES.view3d.walk.V; const m = it.model, k = it.kind === "dog" ? "dog" : it.kind === "uav" ? "uav" : it.kind === "rover" ? "rover" : "human"; let pitch = 0, roll = 0;
    if (k === "uav") { const root = m.userData.parts && m.userData.parts.rig && m.userData.parts.rig.root; if (root) { pitch = root.rotation.z; roll = root.rotation.x; } return { x: m.position.x, y: -m.position.z, z: m.position.y, yaw: m.rotation.y, pitch, roll }; }
    const x = m.position.x, y = -m.position.z, zf = m.position.y;
    if (k === "dog" && V && V.col) { const c = Math.cos(m.rotation.y), s = Math.sin(m.rotation.y); pitch = clamp(Math.atan2(supportZ(V, x + c * 0.3, y + s * 0.3, zf, 0.3) - supportZ(V, x - c * 0.3, y - s * 0.3, zf, 0.3), 0.6), -0.5, 0.5); }
    return { x, y, z: zf + BODY_Z[k], yaw: m.rotation.y, pitch, roll };
  };
  /* pose of a placed entity (ES.app.ents item) */
  LD.entityPose = (e, V) => { V = V || ES.view3d.walk.V; const k = e.kind === "uav" ? "uav" : e.kind === "dog" ? "dog" : e.kind === "rover" ? "rover" : "human"; const zf = k === "uav" ? e.z : e.zf != null ? e.zf : ES.view3d.walk.surfZ(e.x, e.y); return { x: e.x, y: e.y, z: k === "uav" ? zf : zf + BODY_Z[k], yaw: e.yaw || 0, pitch: 0, roll: 0 }; };

  /* ---------------- scanner ---------------- */
  /* createScanner({model, getPose (-> SENSOR pose), rate, raysPerFrame (cap per step), ignore | uid (body uid of the carrier: not scanned), rpy (sensor tilt relative to getPose, rad), seed, cfg}) -> scanner
       sc.step(dt, budgetMs) casts the columns the head swept during dt (time-budgeted: what is not finished stays in the backlog, like a slower sensor)
       sc.scanFull() casts one complete sweep now;  sc.last = {t, n, xyz, world, range, intensity, cls, ring, stats}  (accumulated sweep of the last 1/rate s)
       sc.reset(); sc.stats(); sc.cfg */
  LD.createScanner = function (o) {
    const model = o.model || "unitree_l1", cfg = Object.assign({}, MODELS[model] || MODELS.unitree_l1, o.cfg || {}), rate = o.rate || cfg.rate_hz, mount = o.mount || MOUNT[model] || [0, 0, 0], rpy = o.rpy || (model === "livox_mid360" ? [Math.PI, 0, 0] : null);   // the Mid-360 sees -7..+52 deg: on the drone it hangs upside down so that its field of view looks at the ground and the buildings, not at the sky
    const nH = cfg.n_h, nV = cfg.n_v, cap = nH * nV, hfov = cfg.h_fov * DEG, R = cfg.max_range, minR = cfg.min_range, sigma = cfg.sigma, R2 = (R * R) / 0.04, W2 = LD.specWidth * LD.specWidth;
    const cosA = new Float64Array(nH), sinA = new Float64Array(nH), ceR = new Float64Array(nV), seR = new Float64Array(nV);
    for (let c = 0; c < nH; c++) { const a = (hfov * c) / nH; cosA[c] = Math.cos(a); sinA[c] = Math.sin(a); }
    for (let r = 0; r < nV; r++) { const e = (cfg.v_min + ((cfg.v_max - cfg.v_min) * r) / (nV - 1)) * DEG; ceR[r] = Math.cos(e); seR[r] = Math.sin(e); }
    const bx = new Float32Array(cap), by = new Float32Array(cap), bz = new Float32Array(cap), wx = new Float32Array(cap), wy = new Float32Array(cap), wz = new Float32Array(cap), br = new Float32Array(cap);
    const bi = new Uint8Array(cap), bc = new Uint8Array(cap), bring = new Uint8Array(cap), bf = new Uint8Array(cap);      // bf: 1 valid, 2 passed through glass, 4 glass surface return, 8 foliage
    const colT = new Float32Array(nH);
    const out = { xyz: new Float32Array(cap * 3), world: new Float32Array(cap * 3), range: new Float32Array(cap), intensity: new Uint8Array(cap), cls: new Uint8Array(cap), ring: new Uint8Array(cap), col: new Uint16Array(cap), flags: new Uint8Array(cap) };
    // PRNG + Gaussian
    let seed = (o.seed != null ? o.seed : 12345) >>> 0, spare = null; const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => { if (spare !== null) { const v = spare; spare = null; return v; } let u = 0, v = 0; while (u < 1e-12) u = rnd(); v = rnd(); const m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(TAU * v); return m * Math.cos(TAU * v); };
    const sc = { model, cfg, rate, mount, ignore: o.ignore || o.uid || null, raysPerFrame: o.raysPerFrame || Math.ceil((nH * nV * rate * 1.5) / 60), t: 0, col: 0, colAcc: 0, backlog: 0, revs: 0, sweeps: 0, lastPose: null, cast: 0, lastStepMs: 0, avgStepMs: 0, glassPass: 0, glassHit: 0, dirty: true, auto: !!o.auto, getPose: o.getPose, id: o.id || model };
    let _last = null;

    function castColumns(ncols, pose, budgetMs) {
      let R9 = RC.rotFromPose(pose.yaw, pose.pitch || 0, pose.roll || 0); if (rpy) { const Rm = RC.rotFromPose(rpy[2] || 0, rpy[1] || 0, rpy[0] || 0), A = R9; R9 = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R9[3 * i + j] = A[3 * i] * Rm[j] + A[3 * i + 1] * Rm[3 + j] + A[3 * i + 2] * Rm[6 + j]; }
      const OX = pose.x, OY = pose.y, OZ = pose.z;
      const r00 = R9[0], r01 = R9[1], r02 = R9[2], r10 = R9[3], r11 = R9[4], r12 = R9[5], r20 = R9[6], r21 = R9[7], r22 = R9[8];
      RC._ensure(); RC._setOpt({ foliage: true, treat: true, detail: true, ignore: sc.ignore }); const MATS = RC.MATS, rv = RC._rv, ray = RC._ray, t0 = performance.now(); let done = 0;
      for (let k = 0; k < ncols; k++) {
        if (budgetMs !== Infinity && (k & 7) === 7 && performance.now() - t0 > budgetMs) break;
        const c = sc.col; sc.col = c + 1 === nH ? 0 : c + 1; const ca = cosA[c], sa = sinA[c]; colT[c] = sc.t;
        for (let r = 0; r < nV; r++) {
          const ce = ceR[r], se = seR[r], sx = ce * ca, sy = ce * sa, sz = se, dx = r00 * sx + r01 * sy + r02 * sz, dy = r10 * sx + r11 * sy + r12 * sz, dz = r20 * sx + r21 * sy + r22 * sz;
          let ox = OX, oy = OY, oz = OZ, path = 0, thr = 1, flags = 0, got = false, tt = 0, inten = 0, cls = 0;
          for (let pass = 0; pass < 4; pass++) {
            if (!ray(ox, oy, oz, dx, dy, dz, R - path)) break;
            const t = path + rv.t, m = MATS[rv.mat]; let cosi = rv.soft ? 0.6 : -(rv.nx * dx + rv.ny * dy + rv.nz * dz); cosi = cosi < 0 ? 0 : cosi > 1 ? 1 : cosi;
            let eff = m.refl * cosi; if (m.spec > 0) { const th = Math.acos(cosi); eff += m.spec * Math.exp(-(th * th) / W2); } eff *= thr;
            if (t >= minR) { const snr = (eff / (t < 0.1 ? 0.01 : t * t)) * R2; if (snr > 0 && (snr >= 1 || rnd() < Math.sqrt(snr))) { got = true; tt = t; inten = eff > 1 ? 255 : eff * 255; cls = rv.cls; if (rv.glass) flags |= 4; if (rv.soft) flags |= 8; if (rv.walk && rv.nz > 0.8) flags |= 16; break; } }
            if (m.nir > 0 && rnd() < m.nir) { thr *= m.nir; const adv = rv.t + 1e-3; ox += dx * adv; oy += dy * adv; oz += dz * adv; path += adv; flags |= 2; continue; }
            break;
          }
          const s = c * nV + r;
          if (got) { const rm = tt + sigma * gauss(); bx[s] = sx * rm; by[s] = sy * rm; bz[s] = sz * rm; wx[s] = OX + dx * rm; wy[s] = OY + dy * rm; wz[s] = OZ + dz * rm; br[s] = rm; bi[s] = inten; bc[s] = cls; bring[s] = r; bf[s] = 1 | flags; if (flags & 2) sc.glassPass++; if (flags & 4) sc.glassHit++; }
          else bf[s] = 0;
        }
        done++;
      }
      sc.cast += done * nV; sc.dirty = true; return done;
    }
    sc.step = function (dt, budgetMs) {
      const pose = (sc.getPose && sc.getPose()) || null; if (!pose) return 0; const t0 = performance.now(); sc.lastPose = pose; sc.t += dt;
      sc.colAcc += rate * dt * nH * (hfov / TAU); const add = Math.floor(sc.colAcc); sc.colAcc -= add; sc.backlog = Math.min(sc.backlog + add, nH);
      const maxCols = Math.max(1, Math.floor(sc.raysPerFrame / nV)), want = Math.min(sc.backlog, maxCols);
      const done = want > 0 ? castColumns(want, pose, budgetMs == null ? LD.budgetMs : budgetMs) : 0; sc.backlog -= done; if (done) sc.revs += done / nH;
      sc.lastStepMs = performance.now() - t0; sc.avgStepMs += (sc.lastStepMs - sc.avgStepMs) * 0.1; return done * nV;
    };
    /* one complete revolution right now at the given pose (tests, snapshots) */
    sc.scanFull = function (pose) { pose = pose || (sc.getPose && sc.getPose()); if (!pose) return null; sc.lastPose = pose; sc.col = 0; sc.t += 1 / rate; castColumns(nH, pose, Infinity); sc.sweeps++; return sc.last; };
    sc.reset = function () { bf.fill(0); sc.col = 0; sc.colAcc = 0; sc.backlog = 0; sc.dirty = true; sc.cast = 0; sc.glassPass = 0; sc.glassHit = 0; };
    function compact() {
      if (!sc.dirty && _last) return _last; let n = 0, rmax = 0, near = 1e9, nearI = -1, ground = 0, gl = 0, gp = 0, fol = 0; const byCls = new Uint32Array(16), xyz = out.xyz, wld = out.world;
      for (let s = 0; s < cap; s++) {
        const f = bf[s]; if (!(f & 1)) continue; const k = n++; xyz[3 * k] = bx[s]; xyz[3 * k + 1] = by[s]; xyz[3 * k + 2] = bz[s]; wld[3 * k] = wx[s]; wld[3 * k + 1] = wy[s]; wld[3 * k + 2] = wz[s];
        out.range[k] = br[s]; out.intensity[k] = bi[s]; out.cls[k] = bc[s]; out.ring[k] = bring[s]; out.col[k] = (s / nV) | 0; out.flags[k] = f; const c = bc[s]; byCls[c]++; if (f & 16) ground++;
        if (br[s] > rmax) rmax = br[s]; if (br[s] < near) { near = br[s]; nearI = s; } if (f & 4) gl++; if (f & 2) gp++; if (f & 8) fol++;
      }
      let nearest = null; if (nearI >= 0) { const x = bx[nearI], y = by[nearI], z = bz[nearI]; nearest = { r: near, az: Math.atan2(y, x) / DEG, el: Math.asin(clamp(z / (Math.hypot(x, y, z) || 1), -1, 1)) / DEG }; }
      const head = ((sc.col % nH) / nH) * (hfov / DEG), pz = sc.lastPose;
      _last = { t: sc.t, stamp: performance.now(), rev: Math.floor(sc.revs), n, xyz: xyz.subarray(0, 3 * n), world: wld.subarray(0, 3 * n), range: out.range.subarray(0, n), intensity: out.intensity.subarray(0, n), cls: out.cls.subarray(0, n), ring: out.ring.subarray(0, n), col: out.col.subarray(0, n), flags: out.flags.subarray(0, n),
        model, maxRange: R, rangeMax: R, rate, pose: pz, yaw: pz ? pz.yaw : 0, origin: pz ? [pz.x, pz.y, pz.z] : null, head,
        stats: { n, points: n, rmax, nearest, nearestM: nearest ? nearest.r : null, groundFrac: n ? ground / n : 0, glassReturns: gl, throughGlass: gp, foliage: fol, byClass: byCls, raysPerSweep: cap, returnFrac: n / cap, ptsPerSec: n * rate, backlogCols: sc.backlog, stepMs: sc.avgStepMs } };
      sc.dirty = false; return _last;
    }
    Object.defineProperty(sc, "last", { get: compact });
    sc.stats = () => compact().stats;
    sc.origin = () => (sc.lastPose ? [sc.lastPose.x, sc.lastPose.y, sc.lastPose.z] : null);
    sc.colAges = () => colT;
    LD.scanners.add(sc); sc.dispose = () => LD.scanners.delete(sc);
    return sc;
  };
  LD.scanners = new Set();

  /* ---------------- own-device scanner + frame driver ---------------- */
  const BODY_MODEL = { dog: "unitree_l1", uav: "livox_mid360" };
  LD.ownModel = (body) => BODY_MODEL[body] || null;
  /* the walker's scanner (null for bodies without a LiDAR); re-created when the identity changes */
  LD.own = function () {
    const W = ES.view3d.walk.state, mdl = BODY_MODEL[W.body]; if (!mdl) { if (LD._own) { LD._own.dispose(); LD._own = null; } return null; }
    if (!LD._own || LD._own.model !== mdl) { if (LD._own) LD._own.dispose(); LD._own = LD.createScanner({ model: mdl, id: "own", ignore: "walk", auto: false, getPose: () => LD.sensorPose(mdl, LD.walkPose()) }); }
    return LD._own;
  };
  /* auto mode: step the own scanner (and every scanner created with auto:true) from the main loop, within LD.budgetMs per frame */
  LD.auto = { own: false };
  ES.bus.on("walk:frame", (dt) => {
    if (!LD.auto.own && ![...LD.scanners].some((s) => s.auto)) return; const t0 = performance.now(); const list = [];
    if (LD.auto.own) { const s = LD.own(); if (s) list.push(s); } for (const s of LD.scanners) if (s.auto && !list.includes(s)) list.push(s);
    for (let i = 0; i < list.length; i++) { const left = LD.budgetMs - (performance.now() - t0); if (left <= 0.15 && i > 0) break; list[i].step(dt, Math.max(0.3, left / (list.length - i))); }
    LD.frameMs = performance.now() - t0;
  });
  ES.bus.on("walk:exit", () => { for (const s of LD.scanners) s.reset(); });
  ES.bus.on("fpbody", () => { if (LD._own) { LD._own.reset(); } });

  /* ============================== plotting (pure drawing) ============================== */
  const BG = 0xff14110d;           // ABGR of #0d1114
  const TURBO = (() => {
    const K = { r4: [0.13572138, 4.6153926, -42.66032258, 132.13108234], g4: [0.09140261, 2.19418839, 4.84296658, -14.18503333], b4: [0.1066733, 12.64194608, -60.58204836, 110.36276771], r2: [-152.94239396, 59.28637943], g2: [4.27729857, 2.82956604], b2: [-89.90310912, 27.34824973] };
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 255, x2 = x * x, x3 = x2 * x, x4 = x2 * x2, x5 = x4 * x; const c = (a4, a2) => clamp(a4[0] + a4[1] * x + a4[2] * x2 + a4[3] * x3 + a2[0] * x4 + a2[1] * x5, 0, 1);
      lut[i] = (255 << 24) | ((c(K.b4, K.b2) * 255) << 16) | ((c(K.g4, K.g2) * 255) << 8) | (c(K.r4, K.r2) * 255); }
    return lut;
  })();
  const abgr = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
  const CLS_LUT = (() => { const l = new Uint32Array(32).fill(abgr(220, 220, 220)); const col = RC.CLASSES.color; for (const k in col) { let [r, g, b] = col[k]; const lum = 0.3 * r + 0.59 * g + 0.11 * b; if (lum < 90) { const f = (90 - lum) / 90; r += (230 - r) * f; g += (230 - g) * f; b += (230 - b) * f; } l[k] = abgr(r | 0, g | 0, b | 0); } return l; })();
  const INT_LUT = (() => { const l = new Uint32Array(256); for (let i = 0; i < 256; i++) { const t = i / 255; l[i] = abgr((70 + 185 * t) | 0, (110 + 145 * t) | 0, (150 + 105 * t) | 0); } return l; })();
  const NICE = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200];
  const niceStep = (range, nTarget) => { const raw = range / nTarget; for (const s of NICE) if (s >= raw) return s; return NICE[NICE.length - 1]; };
  const bufs = new WeakMap();
  /* auto range [m] for a sweep: just beyond the 95th percentile of the returns, rounded to a ring step (stable between frames) */
  LD.autoRange = (sweep, hold) => {
    if (!sweep || !sweep.n) return 10; const r = sweep.range, n = sweep.n, step = Math.max(1, Math.floor(n / 600)), a = []; for (let i = 0; i < n; i += step) a.push(r[i]); a.sort((p, q) => p - q);
    const p95 = a[Math.floor(a.length * 0.95)] || 5, want = Math.min(sweep.maxRange || 100, Math.max(6, p95 * 1.1)), st = niceStep(want, 4); let rng = Math.ceil(want / st) * st; if (hold && hold > rng && hold < rng * 2) rng = hold; return rng;
  };
  /* draw(canvas, sweep, {mode: 'top' | 'side' | 'persp', colorBy: 'height' | 'intensity' | 'class' | 'range', range: metres | 'auto', rings: true, heading: true, zMin, zMax, t, pointSize})
     top: bird's-eye in the sensor frame (forward = up); side: vertical section through the sensor (forward = right, |y| < slab); persp: slowly orbiting 3-D view with a depth buffer. */
  LD.draw = function (canvas, sweep, opt) {
    const o = Object.assign({ mode: "top", colorBy: "height", range: "auto", rings: true, heading: true, pointSize: 2, zMin: 0, zMax: 12 }, opt || {}), w = canvas.width, h = canvas.height, ctx = canvas.getContext("2d");
    let B = bufs.get(canvas); if (!B || B.w !== w || B.h !== h) { const img = ctx.createImageData(w, h); B = { w, h, img, u32: new Uint32Array(img.data.buffer), depth: new Float32Array(w * h) }; bufs.set(canvas, B); }
    const u32 = B.u32, depth = B.depth; u32.fill(BG); let range = o.range === "auto" ? LD.autoRange(sweep, o._hold) : o.range; o._range = range;
    const n = sweep ? sweep.n : 0, xyz = sweep && sweep.xyz, wld = sweep && sweep.world, rg = sweep && sweep.range, inten = sweep && sweep.intensity, cls = sweep && sweep.cls, zMin = o.zMin, zSpan = Math.max(1e-6, o.zMax - zMin), ps = o.pointSize;
    const cut = o.cut !== undefined ? o.cut : sweep && sweep.model !== "livox_mid360" ? 1.3 : null;       // top view of a ground sensor: floor-plan style cut plane (m above the sensor); null = everything
    const colorOf = (i) => { switch (o.colorBy) { case "intensity": return INT_LUT[inten[i]]; case "class": return CLS_LUT[cls[i] & 31]; case "range": return TURBO[(255 * (1 - Math.min(1, rg[i] / range))) | 0]; default: return TURBO[(255 * clamp((wld[3 * i + 2] - zMin) / zSpan, 0, 1)) | 0]; } };
    const plot = (px, py, col, d) => { const x0 = px | 0, y0 = py | 0; for (let dy = 0; dy < ps; dy++) { const yy = y0 + dy; if (yy < 0 || yy >= h) continue; for (let dx = 0; dx < ps; dx++) { const xx = x0 + dx; if (xx < 0 || xx >= w) continue; const k = yy * w + xx; if (d === undefined) u32[k] = col; else if (depth[k] > d) { depth[k] = d; u32[k] = col; } } } };
    const mode = o.mode, cx = w / 2, cy = mode === "side" ? h * 0.5 : h / 2 + 4, kTop = (Math.min(w, h) / 2 - 16) / range, kSide = (Math.min(w, h * 1) / 2 - 14) / range;
    let proj = null;       // persp: camera basis
    if (mode === "persp") {
      const th = o.t != null ? o.t : performance.now() / 1000 * 0.22, ph = 0.5, D = range * 2.1, fdx = Math.cos(ph) * Math.cos(th), fdy = Math.cos(ph) * Math.sin(th), fdz = -Math.sin(ph); let rx = fdy, ry = -fdx, rz = 0; const rl = Math.hypot(rx, ry); rx /= rl; ry /= rl;
      const ux = ry * fdz - rz * fdy, uy = rz * fdx - rx * fdz, uz = rx * fdy - ry * fdx, F = h * 0.95 / (2 * Math.tan(0.45));
      proj = (x, y, z) => { const d = x * fdx + y * fdy + z * fdz + D; if (d < 0.3) return null; return [cx + ((x * rx + y * ry + z * rz) / d) * F, cy - ((x * ux + y * uy + z * uz) / d) * F, d]; };
      depth.fill(1e9);
    }
    for (let i = 0; i < n; i++) {
      const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
      if (mode === "top") { if (Math.abs(x) > range || Math.abs(y) > range || (cut !== null && z > cut)) continue; plot(cx - y * kTop - ps / 2, cy - x * kTop - ps / 2, colorOf(i)); }
      else if (mode === "side") { if (Math.abs(y) > (o.slab || range * 0.12 + 1)) continue; plot(cx + x * kSide - ps / 2, cy - z * kSide - ps / 2, colorOf(i)); }
      else { const p = proj(x, y, z); if (p) plot(p[0] - ps / 2, p[1] - ps / 2, colorOf(i), p[2]); }
    }
    ctx.putImageData(B.img, 0, 0);
    // ---- overlays: range rings with metre labels, heading wedge, north tick
    const step = niceStep(range, 4), ringList = []; for (let r = step; r <= range + 1e-6; r += step) ringList.push(r);
    ctx.save(); ctx.lineWidth = 1; ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace"; ctx.textBaseline = "middle";
    const label = (txt, x, y) => { ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,12,14,.9)"; ctx.strokeText(txt, x, y); ctx.lineWidth = 1; ctx.fillText(txt, x, y); };
    if (o.rings) for (const r of ringList) {
      ctx.strokeStyle = "rgba(160,190,200,0.28)"; ctx.fillStyle = "rgba(200,222,230,0.85)";
      if (mode === "top") { ctx.beginPath(); ctx.arc(cx, cy, r * kTop, 0, TAU); ctx.stroke(); const a = -0.62, lx = cx + Math.cos(a) * r * kTop, ly = cy + Math.sin(a) * r * kTop; ctx.textAlign = "left"; label(r + " m", lx + 3, ly); }
      else if (mode === "side") { ctx.beginPath(); ctx.arc(cx, cy, r * kSide, 0, TAU); ctx.stroke(); ctx.textAlign = "left"; label(r + " m", cx + r * kSide * 0.72 + 3, cy - r * kSide * 0.72 - 3); }
      else { ctx.beginPath(); let first = true; for (let k = 0; k <= 72; k++) { const a = (k / 72) * TAU, p = proj(r * Math.cos(a), r * Math.sin(a), 0); if (!p) continue; if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); } ctx.stroke(); const p = proj(r, 0, 0); if (p) { ctx.textAlign = "left"; label(r + " m", p[0] + 3, p[1]); } }
    }
    if (o.heading) {
      ctx.fillStyle = "#ffd166"; ctx.strokeStyle = "#ffd166";
      if (mode === "top") { ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx - 5.5, cy + 5); ctx.lineTo(cx, cy + 2); ctx.lineTo(cx + 5.5, cy + 5); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - range * kTop); ctx.stroke(); ctx.globalAlpha = 1;
        if (sweep && sweep.pose) { const a = Math.PI / 2 - sweep.pose.yaw, rr = range * kTop + 0; /* north: world +y in the sensor frame */ const nx = Math.sin(sweep.pose.yaw), ny = Math.cos(sweep.pose.yaw), px = cx - ny * (rr + 8), py = cy - nx * (rr + 8); ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.textAlign = "center"; label("N", clamp(px, 6, w - 6), clamp(py, 6, h - 6)); } }
      else if (mode === "side") { ctx.beginPath(); ctx.moveTo(cx + 12, cy); ctx.lineTo(cx + 3, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx + 3, cy + 5); ctx.closePath(); ctx.fill(); }
      else { const p = proj(0, 0, 0), q = proj(Math.min(range, 4), 0, 0); if (p && q) { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, TAU); ctx.fill(); } }
    }
    ctx.restore(); return { range, n };
  };
})();
