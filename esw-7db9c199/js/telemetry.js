/* telemetry.js -> ES.telemetry: what the sensors of a device read out (IMU, magnetometer, barometer, GNSS, radio link to the command post, battery / power, ambient light).
   Physics ports: sensors/inertial.py (noise densities, biases, ISA barometer, Earth-field magnetometer), rf/gnss.py (Walker constellations, C/N0 budget, tracking threshold, DOP, UERE error),
   bim/rf_adapter.py (link = min(2.5-D engine, FSPL + explicit box losses); same-building links use the explicit model only), bim/physics.py via ES.ray (wall losses, light transmission).
   API:  ES.telemetry.sample(body, WALK, V) -> sample of the walker's device (call at 10-20 Hz), history in ES.telemetry.history;  ES.telemetry.createProbe({kind, getPose, uid}) for other devices.
   Docs: web/docs/sensors-core.md. Frames: lab ENU (x east, y north, z up); body FLU (x forward, y left, z up); yaw CCW from +x; pitch + = nose up; roll + = right side down. */
(function () {
  "use strict";
  const ES = (window.ES = window.ES || {});
  const TL = (ES.telemetry = ES.telemetry || {});
  const RC = ES.ray, G0 = 9.80665, D2R = Math.PI / 180, R2D = 180 / Math.PI, C0 = 299792458, TAU = 2 * Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const KIND_OF = { dog: "dog", uav: "uav", human: "human", rover: "rover" };

  /* ============================== parameters (same constants as the Python sensors) ============================== */
  const P_IMU = { accelNdUg: 175.0, gyroNdDps: 0.014, accelBiasMg: 2.0, gyroBiasDps: 0.1 };                 // inertial.imu defaults (BMI088 class)
  const P_BARO = { sigmaM: 0.12, driftMPerMin: 0.3, groundPa: 101325.0 };                                    // inertial.baro defaults (BMP388 class)
  const P_MAG = { fieldUt: 51.4, inclDeg: 67.0, declDeg: -10.0, sigmaUt: 0.2 };                              // inertial.magnetometer defaults (Fairfax VA)
  /* envelopeDb: floor of the penetration loss of a ray that crosses an OPAQUE part of a building envelope (roof, wall, ceiling). The explicit P.2040 slab model counts only the dielectric of the modelled boxes; real envelopes add foil-faced insulation,
   low-E coatings, wiring and ducts: ITU-R P.2109-1 gives a median building entry loss of ~13 dB (traditional) to ~26 dB (thermally efficient) at 1.5-2 GHz. Modern residential / commercial construction takes the high value; metal-clad sheds 13 dB. Rays that
   cross glass only (windows, open doors) keep the explicit loss, so signals come through windows and doors. */
const P_GNSS = { envelopeDb: { default: 26, warehouse: 13, factory: 13 }, lat0: 38.8304, lon0: -77.3078, maskDeg: 5.0, cn0Zenith: 46.0, cn0Horizon: 38.0, cn0Min: 24.0, sigma0: 1.2, sigma1: 0.8, slowFrac: 0.8, tauS: 900.0, sigmaWhite: 0.4, sigmaPen: 6.0, mpDecorrM: 8.0, L1: 1.57542e9 };   // rf.gnss.GNSSParams
  TL.params = { imu: P_IMU, baro: P_BARO, mag: P_MAG, gnss: P_GNSS };
  const MU = 3.986004418e14, OMEGA_E = 7.2921159e-5, R_E = 6378137.0;
  const SYSTEMS = [{ name: "gps", total: 24, planes: 6, f: 1, inc: 55.0 * D2R, a: 26560e3 }, { name: "galileo", total: 24, planes: 3, f: 1, inc: 56.0 * D2R, a: 29600e3 }, { name: "beidou", total: 24, planes: 3, f: 1, inc: 55.0 * D2R, a: 27906e3 }];
  /* power model (W): UAV from view3d stepUav (hover 108 W, drag, climb); dog 25 W compute + locomotion (25-60 W); phone 5 W; rover 10 W + drive */
  const PWR = { uav: { wh: 62 }, dog: { wh: 216 }, human: { wh: 17 }, rover: { wh: 300 } };
  const wattsOf = (kind, v, u) => { if (kind === "uav") { const vh = u ? Math.hypot(u.vx || 0, u.vy || 0) : v; return u && u.landed ? 3 : 108 + 3.2 * vh * vh + 95 * Math.max(u ? u.vz || 0 : 0, 0) + 12 * Math.abs(u ? u.w || 0 : 0); } if (kind === "dog") return 25 + 35 * Math.pow(Math.min(1, v / 2.6), 0.8); if (kind === "rover") return 10 + 28 * v; return 5 + 0.3 * v; };

  /* ============================== Walker constellations (rf/gnss.py Constellation) ============================== */
  const SATS = (() => {
    const s = []; SYSTEMS.forEach((sys, si) => { const per = sys.total / sys.planes; for (let p = 0; p < sys.planes; p++) for (let j = 0; j < per; j++) s.push({ sys: si, raan: (TAU * p) / sys.planes + 0.7 * si, m0: (TAU * j) / per + (TAU * sys.f * p) / sys.total + 0.3 * si, inc: sys.inc, a: sys.a, n: Math.sqrt(MU / Math.pow(sys.a, 3)) }); });
    return s;
  })();
  /* unit vectors (ENU), elevation, azimuth of every satellite at a site, t = seconds since the epoch */
  function satsEnu(t, latDeg, lonDeg, out) {
    const la = latDeg * D2R, lo = lonDeg * D2R, cla = Math.cos(la), sla = Math.sin(la), clo = Math.cos(lo), slo = Math.sin(lo), site = [R_E * cla * clo, R_E * cla * slo, R_E * sla];
    const E = [-slo, clo, 0], N = [-sla * clo, -sla * slo, cla], U = [cla * clo, cla * slo, sla], th = OMEGA_E * t, c = Math.cos(th), s = Math.sin(th);
    for (let i = 0; i < SATS.length; i++) {
      const q = SATS[i], u = q.m0 + q.n * t, xo = q.a * Math.cos(u), yo = q.a * Math.sin(u), ci = Math.cos(q.inc), si = Math.sin(q.inc), co = Math.cos(q.raan), so = Math.sin(q.raan);
      const ex = xo * co - yo * ci * so, ey = xo * so + yo * ci * co, ez = yo * si, X = c * ex + s * ey, Y = -s * ex + c * ey, Z = ez, dx = X - site[0], dy = Y - site[1], dz = Z - site[2], r = Math.hypot(dx, dy, dz);
      const e = (dx * E[0] + dy * E[1] + dz * E[2]) / r, n = (dx * N[0] + dy * N[1] + dz * N[2]) / r, up = (dx * U[0] + dy * U[1] + dz * U[2]) / r;
      const o = out[i] || (out[i] = {}); o.e = e; o.n = n; o.u = up; o.el = Math.asin(clamp(up, -1, 1)); o.az = Math.atan2(e, n); o.sys = q.sys;
    }
    return out;
  }
  TL.satsEnu = (t, lat, lon) => satsEnu(t, lat == null ? P_GNSS.lat0 : lat, lon == null ? P_GNSS.lon0 : lon, []);

  /* small dense linear algebra (<= 6 x 6) */
  function invert(M, n) {                        // Gauss-Jordan with partial pivoting; returns null when singular
    const A = M.map((r, i) => { const row = r.slice(); for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0); return row; });
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; if (Math.abs(A[p][c]) < 1e-9) return null; const t = A[c]; A[c] = A[p]; A[p] = t;
      const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map((r) => r.slice(n));
  }
  /* DOP of unit LOS vectors (ENU), one clock column per constellation: [hdop, vdop, pdop] */
  function dop(units, sysIdx) {
    const ids = [...new Set(sysIdx)], n = units.length, m = 3 + ids.length; if (n < m) return null;
    const GtG = Array.from({ length: m }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++) { const g = new Array(m).fill(0); g[0] = -units[i][0]; g[1] = -units[i][1]; g[2] = -units[i][2]; g[3 + ids.indexOf(sysIdx[i])] = 1; for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) GtG[a][b] += g[a] * g[b]; }
    const Q = invert(GtG, m); if (!Q) return null; return { hdop: Math.sqrt(Q[0][0] + Q[1][1]), vdop: Math.sqrt(Q[2][2]), pdop: Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2]) };
  }

  /* ============================== helpers ============================== */
  const mkRng = (seed) => { let s = seed >>> 0; const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; let spare = null;
    r.gauss = () => { if (spare !== null) { const v = spare; spare = null; return v; } let u = 0; while (u < 1e-12) u = r(); const v = r(), m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(TAU * v); return m * Math.cos(TAU * v); }; return r; };
  const mulT = (R, v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];      // R^T v
  const mul = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  /* body angular rate from two rotations (body -> world): log map of R0^T R1 over dt */
  function omegaBody(R0, R1, dt) {
    const W = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) W[3 * i + j] = R0[i] * R1[j] + R0[3 + i] * R1[3 + j] + R0[6 + i] * R1[6 + j];         // R0^T R1
    const tr = W[0] + W[4] + W[8], ca = clamp((tr - 1) / 2, -1, 1), ang = Math.acos(ca), v = [W[7] - W[5], W[2] - W[6], W[3] - W[1]], sa = Math.sin(ang), k = sa > 1e-6 ? ang / (2 * sa) : 0.5;
    return [(k * v[0]) / dt, (k * v[1]) / dt, (k * v[2]) / dt];
  }
  /* quadratic least-squares of the last samples (weighted toward now): returns {v, a} per axis; samples = [{t, p:[x,y,z]}] */
  function quadFit(samples, tNow, win) {
    const S = samples.filter((s) => tNow - s.t <= win); if (S.length < 3) { if (S.length === 2) { const dt = S[1].t - S[0].t || 1e-3; return { v: S[1].p.map((q, i) => (q - S[0].p[i]) / dt), a: [0, 0, 0] }; } return { v: [0, 0, 0], a: [0, 0, 0] }; }
    const out = { v: [0, 0, 0], a: [0, 0, 0] };
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0; const w = S.map((s) => Math.exp((s.t - tNow) / (win * 0.5)));
    S.forEach((s, i) => { const t = s.t - tNow, wi = w[i]; s0 += wi; s1 += wi * t; s2 += wi * t * t; s3 += wi * t * t * t; s4 += wi * t * t * t * t; });
    const M = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], Mi = invert(M, 3); if (!Mi) return out;
    for (let ax = 0; ax < 3; ax++) { let b0 = 0, b1 = 0, b2 = 0; S.forEach((s, i) => { const t = s.t - tNow, wi = w[i], y = s.p[ax]; b0 += wi * y; b1 += wi * y * t; b2 += wi * y * t * t; }); const c1 = Mi[1][0] * b0 + Mi[1][1] * b1 + Mi[1][2] * b2, c2 = Mi[2][0] * b0 + Mi[2][1] * b1 + Mi[2][2] * b2; out.v[ax] = c1; out.a[ax] = 2 * c2; }
    return out;
  }
  const fsplDb = (d, f) => 20 * Math.log10((4 * Math.PI * Math.max(d, 1e-3) * f) / C0);
  const foliageDb = (depth, fHz) => { const fg = fHz / 1e9; return depth <= 14 ? 0.45 * Math.pow(fg, 0.284) * depth : 1.33 * Math.pow(fg, 0.284) * Math.pow(Math.min(depth, 400), 0.588); };     // Weissberger (rf.formulas.foliage_db)

  /* ============================== probe ============================== */
  const SKYN = 24;
  const SKYDIR = (() => { const d = []; for (let i = 0; i < SKYN; i++) { const u = (i + 0.5) / SKYN, z = Math.sqrt(1 - u), s = Math.sqrt(u), ph = i * 2.399963229728653; d.push([s * Math.cos(ph), s * Math.sin(ph), z]); } return d; })();      // cosine-weighted hemisphere, golden-angle spiral
  const envLux = () => { const e = ES.env; const sun = e && Number.isFinite(e.sunIlluminanceLux) ? e.sunIlluminanceLux : null, sky = e && Number.isFinite(e.skyIlluminanceLux) ? e.skyIlluminanceLux : null; return { sun, sky }; };

  /* createProbe({kind: 'dog'|'uav'|'human'|'rover', getPose: () => {x, y, z (body origin), yaw, pitch, roll, speed, phase (stride cycles), batt (0..1, UAV), uav (WALK.uav-like)}, uid (body uid: not an obstacle for itself), id, seed, rate}) */
  TL.createProbe = function (o) {
    const kind = KIND_OF[o.kind] || "human", rng = mkRng(o.seed != null ? o.seed : 4711), ES_DEV = (ES.DEVICES && ES.DEVICES[kind]) || {};
    const bias = { a: [rng.gauss() * P_IMU.accelBiasMg * 1e-3 * G0, rng.gauss() * P_IMU.accelBiasMg * 1e-3 * G0, rng.gauss() * P_IMU.accelBiasMg * 1e-3 * G0], g: [0, 0, 0].map(() => rng.gauss() * P_IMU.gyroBiasDps * D2R) };
    const pr = { kind, dev: ES_DEV, id: o.id || kind, uid: o.uid || null, getPose: o.getPose, rng, kin: [], hist: [], cap: o.cap || 640, t0: null, last: null, lastT: -1e9, R_prev: null, t_prev: null, bias, baroSign: rng() < 0.5 ? -1 : 1, energyWh: 0, pAvg: null, lux: null, battWh: PWR[kind].wh,
      gnss: { slow: new Float64Array(SATS.length), init: false, cn0off: SATS.map(() => rng.gauss() * 1.5), wx: [], px: [], lastT: null, fixOk: false, cache: null }, linkT: -1e9, linkCache: null, lightT: -1e9, lightCache: null, roomCache: null, epoch: o.epoch != null ? o.epoch : 0, wallT: 0 };
    for (let s = 0; s < SATS.length; s++) { const wx = [], px = rng() * TAU; for (let m = 0; m < 32; m++) { const k = Math.abs(rng.gauss()) + 1e-3; wx.push([rng.gauss() / k / P_GNSS.mpDecorrM, rng.gauss() / k / P_GNSS.mpDecorrM, rng() * TAU]); } pr.gnss.wx.push(wx); pr.gnss.px.push(px); }
    pr.sample = (opt) => sample(pr, opt || {}); pr.reset = () => { pr.kin.length = 0; pr.hist.length = 0; pr.R_prev = null; pr.energyWh = 0; pr.pAvg = null; pr.gnss.init = false; pr.linkT = -1e9; pr.lightT = -1e9; };
    pr.series = (path) => { const out = new Float32Array(pr.hist.length); for (let i = 0; i < pr.hist.length; i++) { let v = pr.hist[i]; for (const k of path.split(".")) v = v == null ? null : v[k]; out[i] = v == null ? NaN : +v; } return out; };
    pr.times = () => Float64Array.from(pr.hist, (s) => s.t);
    return pr;
  };

  /* ---- per-sample orchestration ---- */
  function sample(pr, opt) {
    const now = opt.t != null ? opt.t : performance.now() / 1000; if (pr.t0 === null) pr.t0 = now; const pose = pr.getPose(); if (!pose) return pr.last;
    const dt = pr.last ? clamp(now - pr.lastT, 1e-3, 1) : 0.05, rate = clamp(1 / dt, 4, 200), kind = pr.kind;
    const R = RC.rotFromPose(pose.yaw, pose.pitch || 0, pose.roll || 0);
    // ---- kinematics: quadratic fit of the last 0.6 s of true positions -> velocity, acceleration (world); orientation rate from the rotation change
    pr.kin.push({ t: now, p: [pose.x, pose.y, pose.z] }); while (pr.kin.length > 96 || (pr.kin.length > 3 && now - pr.kin[0].t > 1.2)) pr.kin.shift();
    const kf = quadFit(pr.kin, now, 0.6), vW = kf.v, aW = kf.a, speed = pose.speed != null ? pose.speed : Math.hypot(vW[0], vW[1]);
    if (!pr.R_prev) { pr.R_prev = R; pr.t_prev = now; pr.gSm = [0, 0, 0]; } else if (now - pr.t_prev >= 0.03) { pr.gSm = omegaBody(pr.R_prev, R, now - pr.t_prev); pr.R_prev = R; pr.t_prev = now; }
    const gT = pr.gSm.slice();
    // ---- IMU: specific force f = R^T (a - g), g = (0, 0, -G); gait bounce / rotor vibration; noise densities of inertial.imu
    let fb = mulT(R, [aW[0], aW[1], aW[2] + G0]); const vib = [0, 0, 0], gvib = [0, 0, 0], tt = now - pr.t0;
    if (kind === "dog" && speed > 0.03) { const f = 1.6 + 1.1 * Math.min(speed, 1.6), ph = pose.phase != null ? pose.phase : tt * f, w = 4 * Math.PI * f; vib[2] = -0.008 * w * w * Math.sin(2 * Math.PI * ph * 2); vib[0] = 0.5 * Math.sin(2 * Math.PI * ph * 2 + 1.2); gvib[1] = 0.02 * w * Math.cos(2 * Math.PI * ph * 2); gvib[0] = 0.012 * w * Math.cos(2 * Math.PI * ph + 0.7); }
    else if (kind === "human" && speed > 0.1) { const fs = 1.2 + 0.5 * speed, ph = tt * fs * TAU; vib[2] = 0.13 * G0 * Math.min(1.6, speed / 1.4) * Math.sin(ph); vib[0] = 0.05 * G0 * Math.min(1.6, speed / 1.4) * Math.sin(ph / 2 + 0.5); gvib[1] = 0.25 * Math.min(1.6, speed / 1.4) * Math.cos(ph); }
    else if (kind === "rover" && speed > 0.05) { vib[2] = 0.25 * pr.rng.gauss() * Math.min(1, speed); gvib[1] = 0.02 * pr.rng.gauss(); }
    else if (kind === "uav") { const s = pose.landed ? 0.02 : 0.3 + 0.04 * speed; vib[0] = s * pr.rng.gauss(); vib[1] = s * pr.rng.gauss(); vib[2] = 1.4 * s * pr.rng.gauss(); gvib[0] = 0.006 * pr.rng.gauss(); gvib[1] = 0.006 * pr.rng.gauss(); gvib[2] = 0.004 * pr.rng.gauss(); }
    const aSig = P_IMU.accelNdUg * 1e-6 * G0 * Math.sqrt(rate / 2) * 2, gSig = P_IMU.gyroNdDps * D2R * Math.sqrt(rate / 2) * 2;
    const accTrue = [fb[0] + vib[0], fb[1] + vib[1], fb[2] + vib[2]], gyroTrue = [gT[0] + gvib[0], gT[1] + gvib[1], gT[2] + gvib[2]];
    const acc = accTrue.map((v, i) => v + pr.bias.a[i] + aSig * pr.rng.gauss()), gyro = gyroTrue.map((v, i) => v + pr.bias.g[i] + gSig * pr.rng.gauss());
    const imu = { acc, gyro, accMag: Math.hypot(acc[0], acc[1], acc[2]), gyroMag: Math.hypot(gyro[0], gyro[1], gyro[2]), accTruth: accTrue, gyroTruth: gyroTrue, accNoiseSigma: aSig, gyroNoiseSigma: gSig, rateHz: rate };
    // ---- magnetometer: Earth field (declination, inclination) rotated into the body frame + noise; heading from the tilt-compensated horizontal field
    const hn = P_MAG.fieldUt * Math.cos(P_MAG.inclDeg * D2R), dec = P_MAG.declDeg * D2R, Bw = [hn * Math.sin(dec), hn * Math.cos(dec), -P_MAG.fieldUt * Math.sin(P_MAG.inclDeg * D2R)];
    const Bb = mulT(R, Bw).map((v) => v + P_MAG.sigmaUt * pr.rng.gauss()), Bm = mul(R, Bb), f_w = mul(R, [1, 0, 0]), nL = Math.hypot(Bm[0], Bm[1]) || 1, nx = Bm[0] / nL, ny = Bm[1] / nL;
    const headingMag = ((-Math.atan2(nx * f_w[1] - ny * f_w[0], nx * f_w[0] + ny * f_w[1]) * R2D) % 360 + 360) % 360, headingTrue = (((90 - pose.yaw * R2D) % 360) + 360) % 360;
    const mag = { headingDeg: headingMag, trueHeadingDeg: headingTrue, field: Bb, fieldMag: Math.hypot(Bb[0], Bb[1], Bb[2]), declDeg: P_MAG.declDeg, inclDeg: P_MAG.inclDeg };
    // ---- barometer (UAV; phones too): ISA pressure at the sensed altitude + noise + slow drift
    let baro = null;
    if (kind === "uav" || kind === "human") { const drift = P_BARO.driftMPerMin * ((now - pr.t0) / 60) * pr.baroSign, h = (kind === "uav" ? pose.z : pose.z + 0.8) + P_BARO.sigmaM * pr.rng.gauss() + drift, pa = P_BARO.groundPa * Math.pow(1 - 2.25577e-5 * h, 5.25588);
      baro = { altM: h, pressurePa: pa, alt: h, pressure: pa / 100, hpa: pa / 100, driftM: drift }; }
    // ---- power
    const watts = wattsOf(kind, speed, pose.uav), a = 0.12; pr.pAvg = pr.pAvg == null ? watts : pr.pAvg + (watts - pr.pAvg) * Math.min(1, dt * a * 4); pr.energyWh += (watts * dt) / 3600;
    const whTot = pr.battWh, whLeft = kind === "uav" && pose.batt != null ? whTot * pose.batt : Math.max(0, whTot - pr.energyWh);
    const power = { pct: (100 * whLeft) / whTot, watts, wattsAvg: pr.pAvg, wh: whLeft, whTotal: whTot, minutes: (whLeft / Math.max(pr.pAvg, 1)) * 60 };
    // ---- the environment-dependent readouts (rate-limited: they cast rays / evaluate the radio model)
    const ant = (pr.dev.antH != null ? pr.dev.antH : 0.5), antZ = kind === "uav" ? pose.z + 0.08 : (pose.zFloor != null ? pose.zFloor : pose.z - (kind === "dog" ? 0.30 : kind === "rover" ? 0.19 : 0.9)) + ant;
    const posA = [pose.x, pose.y, antZ], sky = skyAndLight(pr, now, pose, posA, kind, opt);
    const gnss = gnssFix(pr, now, posA, sky, opt), link = linkBudget(pr, now, posA, kind, opt), light = sky.light;
    const s = { t: now, dt, kind, imu, mag, baro, gnss, link, power, light, pose: { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch || 0, roll: pose.roll || 0, speed, vx: vW[0], vy: vW[1], vz: vW[2], ax: aW[0], ay: aW[1], az: aW[2], antennaZ: antZ, headingDeg: headingTrue } };
    pr.last = s; pr.lastT = now; pr.hist.push(s); while (pr.hist.length > pr.cap || (pr.hist.length > 2 && now - pr.hist[0].t > 30.5)) pr.hist.shift();
    return s;
  }

  /* ============================== sky visibility + daylight + electric light ============================== */
  function skyAndLight(pr, now, pose, p, kind, opt) {
    if (pr.skyCache && now >= pr.skyT && now - pr.skyT < (opt.skyEvery != null ? opt.skyEvery : 0.25)) return pr.skyCache;
    RC.sync && RC.sync(); const t0 = performance.now(); const A = ES.app, V = ES.view3d && ES.view3d.walk && ES.view3d.walk.V, night = !!(ES.env && ES.env.isNight) || (A && A.look === "night") || false;
    const rot = pr.rng() * TAU, cr = Math.cos(rot), sr = Math.sin(rot), samples = []; let tSum = 0, vis = 0, cnt = 0;
    const ignore = pr.uid || undefined;
    for (let i = 0; i < SKYN; i++) {
      const d = SKYDIR[i], x = d[0] * cr - d[1] * sr, y = d[0] * sr + d[1] * cr, z = d[2], b = [p[0] + x * 400, p[1] + y * 400, p[2] + z * 400];
      const T = skyT(p, b, ignore); samples.push(T); tSum += T; if (T > 0.3) vis++; cnt++;
    }
    const skyFactor = tSum / cnt, skyFrac = vis / cnt;
    // sun
    const env = envLux(), isEnv = env.sun != null; let sunLux = isEnv ? env.sun : night ? 0 : 88000, skyLux = isEnv ? env.sky : night ? 1.2 : 30700, sun = (ES.env && ES.env.sunDirENU) || [-0.45, 0.55, 0.62];
    const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1, sd = [sun[0] / sl, sun[1] / sl, sun[2] / sl]; let Tsun = 0;
    if (sunLux > 0 && sd[2] > 0.02) Tsun = skyT(p, [p[0] + sd[0] * 400, p[1] + sd[1] * 400, p[2] + sd[2] * 400], ignore);
    const Esun = sunLux * Math.max(0, sd[2]) * Tsun, Esky = skyLux * skyFactor;
    // electric light: BIM fixtures that are on (same building, direct, Lambertian emitter facing down), street lamps at night
    let Elamp = 0, Efix = 0; const bld = RC.buildingAt ? RC.buildingAt(p[0], p[1], p[2]) : null, lightsOn = (ES.interior && typeof ES.interior.lightOn === "function") ? ES.interior.lightOn : null;
    if (bld && A && A.bim) {
      const B = A.bim.buildings[bld.id];
      if (B && B.lights) B.lights.forEach((L, li) => {
        const on = lightsOn ? lightsOn(bld.id, li, L) : L.on; if (!on) return; const dx = p[0] - L.pos[0], dy = p[1] - L.pos[1], dz = p[2] - L.pos[2], d2 = dx * dx + dy * dy + dz * dz; if (d2 > 225) return;
        const h = L.pos[2] - p[2]; if (h <= 0.02) return; const Tl = RC.lightT([L.pos[0], L.pos[1], L.pos[2] - 0.05], p, { treat: true }); if (Tl <= 0) return;
        Efix += ((L.lm / Math.PI) * h * h * Tl) / (d2 * d2);
      });
    }
    if (night && V && V.lamps) for (const lp of V.lamps) {                          // lamp heads in three coords [x, z-up, -y]
      const lx = lp[0], ly = -lp[2], lz = lp[1], dx = p[0] - lx, dy = p[1] - ly, h = lz - p[2], d2 = dx * dx + dy * dy + h * h; if (d2 > 3600 || h <= 0.1) continue;
      const T = RC.blocked([lx, ly, lz - 0.1], p, { ignore }) ? 0 : 1; if (!T) continue; Elamp += ((6000 / Math.PI) * h * h) / (d2 * d2);
    }
    // interreflected component indoors: rho/(1-rho) * (flux on the floor / surface area) from the same direct sources sampled on the floor of the room
    let Eir = 0; if (bld && A && A.bim) Eir = interreflect(pr, now, bld, p, { sunLux, skyLux, sd, night });
    const E = Esun + Esky + Efix + Elamp + Eir, lux = E, ev100 = E > 1e-4 ? Math.log2(E / 2.5) : -14;
    const light = { lux, ev100, sunLux: Esun, skyLux: Esky, lampLux: Elamp, indoorLux: Efix, interreflectedLux: Eir, sunVisible: Tsun, skyFactor, indoor: !!bld, night, sunElevDeg: Math.asin(clamp(sd[2], -1, 1)) * R2D, source: isEnv ? "ES.env" : "default" };
    pr.skyCache = { skyFactor, skyFrac, samples, light, ms: performance.now() - t0, dirs: SKYDIR, rot }; pr.skyT = now; return pr.skyCache;
  }
  /* visible-light transmission to the open sky along a segment: BIM boxes (glass 0.85, curtains, opaque 0) x crown extinction x world solids / bodies (opaque) */
  function skyT(a, b, ignore) {
    let T = RC.lightT(a, b); if (T <= 0) return 0; const c = RC.canopy(a, b); if (c.tau > 0) T *= Math.exp(-c.tau); if (T < 0.02) return 0;
    if (RC.blocked(a, b, { ignore })) return 0; return T;
  }
  /* interreflected component indoors: rho / (1 - rho) * (flux on the floor plane) / (room surface area), the floor flux sampled at 4 points from the same direct sources (sky through windows, sun, room fixtures) */
  const SKY12 = SKYDIR.filter((_, i) => i % 2 === 0);
  function interreflect(pr, now, bld, p, env) {
    const rc = pr.roomCache; if (rc && rc.bid === bld.id && now - rc.t < 1.0 && Math.hypot(p[0] - rc.x, p[1] - rc.y) < 3 && Math.abs(p[2] - rc.z) < 1.5) return rc.val;
    const A = ES.app, V = ES.view3d.walk.V, rr = V && V.col && V.col.roomAt ? V.col.roomAt(p[0], p[1], p[2] - 0.3) : null; let val = 0;
    if (rr && rr.room && rr.room.poly) {
      const room = rr.room, poly = room.poly, xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); let area = 0, per = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]; per += Math.hypot(poly[i][0] - poly[j][0], poly[i][1] - poly[j][1]); } area = Math.abs(area) / 2;
      const At = 2 * area + per * Math.max(2.2, room.z1 - room.z0), B = A.bim.buildings[bld.id], zf = room.z0 + 0.85; let sum = 0, n = 0;
      for (let k = 0; k < 4; k++) {
        const x = x0 + (x1 - x0) * (((k + 0.5) * 0.618034) % 1), y = y0 + (y1 - y0) * (((k + 0.5) * 0.381966 * 1.7) % 1); if (!ES.pip(poly, x, y)) continue; const q = [x, y, zf]; let E = 0, T = 0;
        for (const d of SKY12) T += RC.lightT(q, [q[0] + d[0] * 400, q[1] + d[1] * 400, q[2] + d[2] * 400]); E += env.skyLux * (T / SKY12.length);
        if (env.sunLux > 0 && env.sd[2] > 0.02) E += env.sunLux * env.sd[2] * RC.lightT(q, [q[0] + env.sd[0] * 400, q[1] + env.sd[1] * 400, q[2] + env.sd[2] * 400]);
        if (B && B.lights) B.lights.forEach((L, li) => { const on = ES.interior && ES.interior.lightOn ? ES.interior.lightOn(bld.id, li, L) : L.on; if (!on || (L.room !== undefined && room.id !== undefined && L.room !== room.id)) return; const h = L.pos[2] - q[2]; if (h <= 0.1) return; const dx = q[0] - L.pos[0], dy = q[1] - L.pos[1], d2 = dx * dx + dy * dy + h * h; E += ((L.lm / Math.PI) * h * h) / (d2 * d2); });
        sum += E; n++;
      }
      if (n) { const rho = 0.5; val = (rho / (1 - rho)) * ((sum / n) * area) / At; }
    }
    pr.roomCache = { bid: bld.id, x: p[0], y: p[1], z: p[2], t: now, val }; return val;
  }

  /* ============================== GNSS ============================== */
  function gnssFix(pr, now, p, sky, opt) {
    const G = pr.gnss; if (G.cache && now >= G.cacheT && now - G.cacheT < (opt.gnssEvery != null ? opt.gnssEvery : 0.5)) return G.cache;
    const epoch = pr.epoch + (opt.t != null ? opt.t : now - pr.t0), sats = satsEnu(epoch, P_GNSS.lat0, P_GNSS.lon0, G.sats || (G.sats = [])), mask = P_GNSS.maskDeg * D2R, ignore = pr.uid || undefined; const bld = RC.buildingAt ? RC.buildingAt(p[0], p[1], p[2]) : null;
    const tracked = [], state = new Uint8Array(SATS.length), cn0 = new Float64Array(SATS.length), loss = new Float64Array(SATS.length); let nGeom = 0, nLos = 0, nPen = 0;
    for (let i = 0; i < SATS.length; i++) {
      const s = sats[i]; if (s.el < mask) continue; nGeom++;
      const open = P_GNSS.cn0Horizon + (P_GNSS.cn0Zenith - P_GNSS.cn0Horizon) * Math.sin(Math.max(s.el, 0)) + G.cn0off[i], b = [p[0] + s.e * 3000, p[1] + s.n * 3000, p[2] + s.u * 3000];
      const cr = RC.segment(p, b, { polys: true }); let L = cr.length ? RC.rfLossFromCrossings(cr, P_GNSS.L1, "TE") : 0;
      const opq = cr.find((c) => !c.glass && !c.treat); if (opq) { const bk = (RC.buildings()[opq.bi] || {}).kind, env = P_GNSS.envelopeDb[bk] != null ? P_GNSS.envelopeDb[bk] : P_GNSS.envelopeDb.default; if (L < env) L = env; }
      const can = RC.canopy(p, b); if (can.tau > 0) L += foliageDb(2 * can.tau, P_GNSS.L1);
      if (RC.blocked(p, b, { ignore, mask: RC.LAYER.WORLD | RC.LAYER.BODIES, glass: false })) L += 25;       // a vehicle, a privacy fence or a person in the way: shadowed
      loss[i] = L; cn0[i] = open - L;
      if (cn0[i] >= P_GNSS.cn0Min) { state[i] = L < 0.5 ? 1 : 2; tracked.push(i); if (state[i] === 1) nLos++; else nPen++; }
    }
    const used = tracked.length, sysIdx = tracked.map((i) => sats[i].sys), units = tracked.map((i) => [sats[i].e, sats[i].n, sats[i].u]), nSys = new Set(sysIdx).size, D = used >= 3 + Math.max(nSys, 1) ? dop(units, sysIdx) : null;
    const fixOk = used >= 4 && !!D; let err = null, sigmaH = null, errM = null, err3 = null, hdop = D ? D.hdop : Infinity, pdop = D ? D.pdop : Infinity;
    if (fixOk) {
      // pseudorange errors: slow Gauss-Markov (tau 900 s) + white + penetration multipath (spatially correlated), WLS solution
      const dtp = G.lastT == null ? 1 : clamp(now - G.lastT, 0, 5), phi = Math.exp(-dtp / P_GNSS.tauS); G.lastT = now; const px = p[0], py = p[1];
      const m = 3 + nSys, ids = [...new Set(sysIdx)], GtWG = Array.from({ length: m }, () => new Array(m).fill(0)), GtWe = new Array(m).fill(0);
      tracked.forEach((i, k) => {
        const s = sats[i], sinE = Math.sin(Math.max(s.el, mask)), sigU = Math.sqrt(P_GNSS.sigma0 * P_GNSS.sigma0 + Math.pow(P_GNSS.sigma1 / sinE, 2));
        if (!G.init) G.slow[i] = pr.rng.gauss(); else G.slow[i] = phi * G.slow[i] + Math.sqrt(1 - phi * phi) * pr.rng.gauss();
        let space = 0; if (state[i] === 2) { for (const w of G.wx[i]) space += Math.cos(w[0] * px + w[1] * py + w[2]); space *= Math.sqrt(2 / G.wx[i].length); }
        const e = Math.sqrt(P_GNSS.slowFrac) * sigU * G.slow[i] + Math.sqrt(1 - P_GNSS.slowFrac) * sigU * (P_GNSS.sigmaWhite / 0.4) * 0.5 * pr.rng.gauss() + (state[i] === 2 ? P_GNSS.sigmaPen * space : 0);
        const sig = Math.sqrt(sigU * sigU + (state[i] === 2 ? P_GNSS.sigmaPen * P_GNSS.sigmaPen : 0)), w = 1 / (sig * sig), g = new Array(m).fill(0); g[0] = -units[k][0]; g[1] = -units[k][1]; g[2] = -units[k][2]; g[3 + ids.indexOf(sysIdx[k])] = 1;
        for (let a = 0; a < m; a++) { GtWe[a] += g[a] * w * e; for (let b = 0; b < m; b++) GtWG[a][b] += g[a] * w * g[b]; }
      });
      G.init = true; const Ai = invert(GtWG, m);
      if (Ai) { err3 = [0, 1, 2].map((r) => { let v = 0; for (let c = 0; c < m; c++) v += Ai[r][c] * GtWe[c]; return v; }); errM = Math.hypot(err3[0], err3[1]); sigmaH = Math.sqrt(Ai[0][0] + Ai[1][1]); }
    } else { G.lastT = now; }
    const degraded = fixOk && (used < 6 || hdop > 4 || (sigmaH != null && sigmaH > 8) || nPen > 0.5 * used), fix = !fixOk ? "none" : degraded ? "degraded" : "3D";
    const out = { fix, sats: used, visible: nGeom, los: nLos, penetrated: nPen, hdop: Number.isFinite(hdop) ? hdop : null, pdop: Number.isFinite(pdop) ? pdop : null, vdop: D ? D.vdop : null, errM, errSigmaM: sigmaH, errEnu: err3, skyFrac: sky ? sky.skyFrac : null, skyFactor: sky ? sky.skyFactor : null,
      indoor: !!bld, building: bld ? bld.id : null, meanCn0: used ? tracked.reduce((a, i) => a + cn0[i], 0) / used : null, cn0Max: used ? Math.max(...tracked.map((i) => cn0[i])) : null, sat: tracked.map((i) => ({ id: i, sys: SYSTEMS[sats[i].sys].name, el: sats[i].el * R2D, az: sats[i].az * R2D, cn0: cn0[i], lossDb: loss[i] })) };
    G.cache = out; G.cacheT = now; return out;
  }

  /* ============================== radio link to the command post ============================== */
  function cpNode() {
    const A = ES.app; if (!A) return null; const e = (A.ents || []).find((q) => q.kind === "cp"); const dev = ES.DEVICES.cp;
    if (e) return { id: e.id, name: e.name, x: e.x, y: e.y, z: dev.antH, radios: dev.radios, kind: "cp" };
    const c = A.scene && A.scene.cp; return c ? { id: -1, name: "Command post", x: c[0], y: c[1], z: dev.antH, radios: dev.radios, kind: "cp" } : null;
  }
  const GEO = new WeakMap();
  function geoFrom(W, node) {             // around-the-corner geodesic field of the (fixed) command post, cached per world and position
    let m = GEO.get(W); if (!m) { m = {}; GEO.set(W, m); } const key = node.x.toFixed(1) + "," + node.y.toFixed(1); if (m[key] !== undefined) return m[key];
    const gm = m.mask || (m.mask = ES.phys.coarseMask(W, 2, 2.5)); const F = node.z < 8 ? ES.phys.geodesic(gm, node.x, node.y) : null; m[key] = F; return F;
  }
  /* path loss = min(2.5-D engine, FSPL + explicit box losses) as in bim/rf_adapter.py; same-building links use the explicit model only */
  function linkPathLoss(W, A, B, fGHz, F, bldA, bldB) {
    const f = fGHz * 1e9, base = ES.phys.pathLoss(W, A, B, fGHz, F), a = [A.x, A.y, A.z], b = [B.x, B.y, B.z], d3 = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const cr = RC.segment(a, b), walls = cr.length ? RC.rfLossFromCrossings(cr, f, "TE") : 0, kind = bldA && bldB && bldA.id === bldB.id ? 3 : bldA && bldB ? 2 : bldA || bldB ? 1 : 0;
    let PL = base.PL; const explicit = fsplDb(Math.max(d3, 0.5), f) + walls;
    if (kind === 3) PL = explicit; else if (kind > 0 || cr.length) PL = Math.min(PL, explicit);
    return { PL, base: base.PL, walls, explicit, kind, los: base.los && !cr.some((c) => !c.glass && !c.treat), d3, crossings: cr.length, mech: base.mech };
  }
  function linkBudget(pr, now, p, kind, opt) {
    if (pr.linkCache && now >= pr.linkT && now - pr.linkT < (opt.linkEvery != null ? opt.linkEvery : 0.5)) return pr.linkCache;
    const A = ES.app, cp = cpNode(), dev = ES.DEVICES[kind]; if (!A || !A.W || !cp || !dev) return (pr.linkCache = { rate: 0, rateMbps: 0, tech: "—", toCp: null, none: true });
    const W = A.W, me = { x: p[0], y: p[1], z: p[2], radios: dev.radios, kind }, bldA = RC.buildingAt(p[0], p[1], p[2]), bldB = RC.buildingAt(cp.x, cp.y, cp.z), F = geoFrom(W, cp), res = [];
    for (const [ka, kb] of ES.phys.radioGroupPairs(cp.radios, dev.radios)) {                    // ka: command-post radio, kb: the device's radio of the same technology
      const Ra = ES.RADIOS[ka], Rb = ES.RADIOS[kb], pl = linkPathLoss(W, cp, me, Ra.fc, F, bldB, bldA), N = (R) => -174 + 10 * Math.log10(R.B) + R.NF;
      const PrDev = Ra.Pt + Ra.G + Rb.G - pl.PL, PrCp = Rb.Pt + Rb.G + Ra.G - pl.PL, snrDown = PrDev - N(Rb), snrUp = PrCp - N(Ra);
      const phyDown = ES.phys.rateFromSNR(Rb, snrDown), phyUp = ES.phys.rateFromSNR(Ra, snrUp), phy = Math.min(phyDown, phyUp), good = Math.min(phyDown * Rb.mac, phyUp * Ra.mac);
      res.push({ tech: ka === kb ? ka : ka + "↔" + kb, radio: kb, fGHz: Ra.fc, phyMbps: phy, rateMbps: good, rssiDbm: PrDev, snrDb: Math.min(snrDown, snrUp), snrDownDb: snrDown, snrUpDb: snrUp, pathLossDb: pl.PL, enginePathLossDb: pl.base, wallsDb: pl.walls, los: pl.los, kind: pl.kind, dist: pl.d3, crossings: pl.crossings });
    }
    res.sort((a, b) => b.rateMbps - a.rateMbps || b.snrDb - a.snrDb); const best = res[0] || null;
    const toCp = best ? Object.assign({ node: cp.name, all: res }, best) : null;
    pr.linkCache = { rate: toCp ? toCp.rateMbps : 0, rateMbps: toCp ? toCp.rateMbps : 0, tech: toCp ? toCp.tech : "—", rssiDbm: toCp ? toCp.rssiDbm : null, snrDb: toCp ? toCp.snrDb : null, los: toCp ? toCp.los : false, wallsDb: toCp ? toCp.wallsDb : 0, toCp };
    pr.linkT = now; return pr.linkCache;
  }

  /* ============================== the walker's device ============================== */
  const own = {};
  function walkProbe(WALK) {
    const kind = WALK.body === "uav" ? "uav" : WALK.body === "dog" ? "dog" : "human"; let pr = own[kind];
    if (!pr) {
      pr = own[kind] = TL.createProbe({ kind, id: "own", uid: "walk", seed: 20251004 + kind.length, getPose: () => {
        const W = ES.view3d.walk.state, V = ES.view3d.walk.V; if (!W) return null; let b = ES.lidar && ES.lidar.walkPose ? ES.lidar.walkPose(W, V) : { x: W.x, y: W.y, z: W.body === "uav" ? W.z : W.zf + 0.9, yaw: W.yaw, pitch: 0, roll: 0 };
        b = Object.assign({}, b, { speed: W.speed || 0, phase: W.phase, batt: W.body === "uav" ? W.batt : null, uav: W.uav || null, zFloor: W.body === "uav" ? null : W.zv != null ? W.zv : W.zf, landed: W.uav && W.uav.landed });
        return b;
      } });
    }
    return pr;
  }
  TL.own = (WALK) => walkProbe(WALK || ES.view3d.walk.state);
  /* sample(body, WALK, V): one sample of the walker's device at the current time; keeps the 30 s history (TL.history) */
  TL.sample = function (body, WALK, V) {
    WALK = WALK || ES.view3d.walk.state; const pr = walkProbe(WALK); if (TL._cur !== pr) { TL._cur = pr; } const s = pr.sample(); TL.history = pr.hist; TL.last = s; return s;
  };
  TL.history = []; TL.last = null;
  TL.series = (path) => (TL._cur ? TL._cur.series(path) : new Float32Array(0));
  TL.reset = () => { for (const k in own) own[k].reset(); TL.history = []; TL.last = null; };
  ES.bus.on("walk:exit", () => TL.reset());
  ES.bus.on("scene:built", () => { for (const k in own) { own[k].roomCache = null; own[k].linkCache = null; own[k].skyCache = null; } });
})();
