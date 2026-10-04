/* Browser-side physics models: camera visibility, acoustics, radio links, ground / air routes, LiDAR.
   They are compact versions of the mechanisms in the Python engines (scripts/esworld/{acoustics,rf,dynamics}); web/data/fidelity.json reports their measured agreement. */
(function () {
  const ES = window.ES, P = ES.phys, C0 = 299792458;
  const log10 = Math.log10;

  /* ================================ cameras / visibility ================================ */
  /* cam = { x, y, z, yaw (rad, ENU, 0 = east), pitch (rad, + up), hfov (deg), aspect (w/h), range (m), omni } */
  P.camBasis = (c) => {
    const cp = Math.cos(c.pitch), f = [Math.cos(c.yaw) * cp, Math.sin(c.yaw) * cp, Math.sin(c.pitch)];
    const r = [Math.sin(c.yaw), -Math.cos(c.yaw), 0];                                  // right-hand side of the heading
    return { f, r, up: [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]] };   // up = r x f
  };
  P.inFrustum = (c, B, tx, ty, tz) => {
    const dx = tx - c.x, dy = ty - c.y, dz = tz - c.z, d = Math.hypot(dx, dy, dz);
    if (d < 0.5) return false;
    if (c.omni) return d <= c.range;
    const df = (dx * B.f[0] + dy * B.f[1] + dz * B.f[2]);
    if (df <= 0) return false;
    const dr = dx * B.r[0] + dy * B.r[1] + dz * B.r[2], du = dx * B.up[0] + dy * B.up[1] + dz * B.up[2];
    const th = Math.tan(ES.rad(c.hfov) / 2);
    return Math.abs(dr / df) <= th && Math.abs(du / df) <= th / c.aspect && d <= c.range;
  };
  /* longest range at which a target of height h still covers >= minPx pixels */
  P.detectRange = (c, h, minPx = 14) => {
    const W = c.res ? c.res[0] : 1280, ppr = W / ES.rad(c.hfov);       // pixels per radian
    return (h * ppr) / minPx;
  };
  /* visibility of a point from a camera: returns transmittance (0 = hidden) */
  P.visibleT = (W, c, B, tx, ty, tz) => (P.inFrustum(c, B, tx, ty, tz) ? P.los(W, c.x, c.y, c.z, tx, ty, tz, 0.25) : 0);
  /* viewshed raster on a 1 m grid at target height zt: Float32 transmittance (0 hidden), plus coverage stats over free ground */
  P.viewshed = function (W, c, zt = 1.0, step = 2) {
    const B = P.camBasis(c), N = Math.floor(W.N / step), out = new Float32Array(N * N);
    let free = 0, seen = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const id = (j * step) * W.N + i * step;
      if (W.hB[id] > 0.05) continue;
      const [x, y] = [W.x0 + (i + 0.5) * step * W.res, W.y0 + (j + 0.5) * step * W.res];
      if (x < 0 || y < 0 || x > W.S || y > W.S) continue;
      free++;
      const t = P.visibleT(W, c, B, x, y, zt);
      if (t > 0.25) { out[j * N + i] = t; seen++; }
    }
    return { grid: out, N, step, res: W.res * step, x0: W.x0, y0: W.y0, free, seen, frac: free ? seen / free : 0 };
  };
  /* ground footprint polygon of a camera frustum (corner rays hit z = 0 or are cut at range) */
  P.footprint = (c) => {
    if (c.omni) { const pts = []; for (let k = 0; k < 48; k++) { const a = (2 * Math.PI * k) / 48; pts.push([c.x + c.range * Math.cos(a), c.y + c.range * Math.sin(a)]); } return pts; }
    const B = P.camBasis(c), th = Math.tan(ES.rad(c.hfov) / 2), tv = th / c.aspect, pts = [];
    for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const d = [B.f[0] + sx * th * B.r[0] + sy * tv * B.up[0], B.f[1] + sx * th * B.r[1] + sy * tv * B.up[1], B.f[2] + sx * th * B.r[2] + sy * tv * B.up[2]];
      let t = d[2] < -1e-3 ? -c.z / d[2] : 1e9; const h = Math.hypot(d[0], d[1]) || 1e-9;
      t = Math.min(t, c.range / h); pts.push([c.x + d[0] * t, c.y + d[1] * t]);
    }
    return pts;
  };

  /* ================================ acoustics ================================ */
  /* ISO 9613-1 pure-tone attenuation coefficient [dB/m] (T in K, RH %, pressure in kPa) */
  P.alphaISO = (f, T = 293.15, RH = 50, pa = 101.325) => {
    const pr = 101.325, T0 = 293.15, T01 = 273.16, psatRel = Math.pow(10, -6.8346 * Math.pow(T01 / T, 1.261) + 4.6151);
    const h = RH * psatRel * (pr / pa);                                               // molar concentration of water vapour [%]
    const frO = (pa / pr) * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
    const frN = (pa / pr) * Math.pow(T / T0, -0.5) * (9 + 280 * h * Math.exp(-4.17 * (Math.pow(T / T0, -1 / 3) - 1)));
    return 8.686 * f * f * (1.84e-11 * (pr / pa) * Math.sqrt(T / T0) + Math.pow(T / T0, -2.5) * (0.01275 * Math.exp(-2239.1 / T) / (frO + (f * f) / frO) + 0.1068 * Math.exp(-3352 / T) / (frN + (f * f) / frN)));
  };
  const ALPHA_1K = P.alphaISO(1000);
  const GROUND_DB = 2.3;           // hard-ground reflection gain on direct paths, fitted to acoustics.AcousticSimulator (rms 0.1 dB spread across 5 scenes)
  const maekawa = (delta, lam = 0.343) => { const N = (2 * delta) / lam; return N < -0.2 ? 0 : 10 * log10(3 + 20 * N); };
  const eSum = (...ls) => 10 * log10(ls.reduce((a, l) => a + Math.pow(10, l / 10), 0) + 1e-30);
  P.FAST = false;                  // while a marker is being dragged the fields use a coarser grid; the full-resolution result follows on release
  P.AMBIENT = { day: 45, night: 36 };
  P.NOISE_FLOOR = (dev, ambient) => eSum(ambient, (ES.DEVICES[dev] || {}).ego || 0);
  /* sound level (dB(A)) of source s at receiver (x,y,z); F = geodesic field of the source (coarse 1 m mask), returns {Lp, direct, path} */
  P.soundAt = function (W, s, x, y, z, F) {
    const dx = x - s.x, dy = y - s.y, dz = z - s.z, d3 = Math.max(1, Math.hypot(dx, dy, dz));
    const base = s.l1m - 20 * log10(d3) - ALPHA_1K * d3;
    const pr = P.profile(W, s.x, s.y, s.z, x, y, z, 0.343, 1);
    const foliage = Math.min(10, 0.1 * pr.canopyLen);
    if (!pr.blocked) return { Lp: base - foliage + GROUND_DB, direct: true, A: foliage };
    // blocked: over-roof edge, around-corner taut path, through-wall leak; energy sum of the three
    const he = Math.max(pr.hEdge, 0.1);
    const dTop = Math.sqrt(pr.d1 * pr.d1 + Math.pow(he - s.z, 2)) + Math.sqrt(pr.d2 * pr.d2 + Math.pow(he - z, 2)) - pr.L3;
    const aTop = Math.min(25, maekawa(dTop)), terms = [base - aTop - foliage];
    if (F) { const g = P.geoAt(F, x, y); if (isFinite(g.g)) { const dSide = Math.sqrt(g.g * g.g + dz * dz) - d3; terms.push(base - Math.min(g.hops > 0 ? 25 : 20, maekawa(Math.max(0, dSide))) - foliage); } }
    terms.push(base - (30 + 1.5 * Math.min(3, pr.walls)));              // mass-law leak through brick / concrete walls
    const Lp = eSum(...terms);
    return { Lp, direct: false, A: base - Lp };
  };
  /* A-weighted level field of several sources on a coarse grid (step fine cells), receiver height zr */
  P.soundField = function (W, sources, zr = 1.6, step = 4) {
    if (P.FAST) step *= 2;
    const N = Math.floor(W.N / step), out = new Float32Array(N * N).fill(-20);
    const gm = P.coarseMask(W, P.FAST ? 4 : 2, 2.5);
    const geo = sources.map((s) => P.geodesic(gm, s.x, s.y));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = W.x0 + (i + 0.5) * step * W.res, y = W.y0 + (j + 0.5) * step * W.res;
      if (x < -5 || y < -5 || x > W.S + 5 || y > W.S + 5) continue;
      if (W.hB[(j * step) * W.N + i * step] > zr) { out[j * N + i] = NaN; continue; }
      const ls = [];
      sources.forEach((s, k) => ls.push(P.soundAt(W, s, x, y, zr, geo[k]).Lp));
      out[j * N + i] = eSum(...ls);
    }
    return { grid: out, N, step, res: W.res * step, x0: W.x0, y0: W.y0 };
  };

  /* ================================ radio ================================ */
  const fsplDb = (d, fGHz) => 20 * log10(4 * Math.PI * Math.max(d, 1) * fGHz * 1e9 / C0);
  /* mechanism parameters calibrated against the Python engine (rf.PropagationEngine) on suburb + mainstreet; knots at 0.915 / 3.5 / 5.775 GHz, linear in log f */
  const knot = (f, a, b, c) => { const k = [0.915, 3.5, 5.775], v = [a, b, c], lf = Math.log10(f); let i = f < k[1] ? 0 : 1; const t = (lf - Math.log10(k[i])) / (Math.log10(k[i + 1]) - Math.log10(k[i])); return v[i] + (v[i + 1] - v[i]) * t; };
  const wallLoss = (f) => knot(f, 25.4, 34.5, 44.1);                       // dB per building crossed (two facades + interior)
  const cornerLoss = (f, turn, bends) => knot(f, 13.7, 18.5, 20.4) + knot(f, 23.4, 27.8, 29.5) * turn + knot(f, 4.5, 5.6, 5.9) * bends;
  const foliage = (d, fGHz) => (d <= 0 ? 0 : d <= 14 ? 0.45 * Math.pow(fGHz, 0.284) * d : 1.33 * Math.pow(fGHz, 0.284) * Math.pow(Math.min(d, 400), 0.588));   // Weissberger, as rf.formulas.foliage_db
  const umiNLOS = (d3, fGHz, hUT) => Math.max(35.3 * log10(d3) + 22.4 + 21.3 * log10(fGHz) - 0.3 * (hUT - 1.5), fsplDb(d3, fGHz));
  const pSum = (...pl) => -10 * log10(pl.reduce((a, l) => a + Math.pow(10, -l / 10), 0) + 1e-40);
  /* mean path loss A->B at carrier fGHz; F = geodesic field from A (ground-level around-corner path) or null */
  P.pathLoss = function (W, A, B, fGHz, F) {
    const lam = C0 / (fGHz * 1e9), pr = P.profile(W, A.x, A.y, A.z, B.x, B.y, B.z, lam, 2);
    const d3 = pr.L3, base = fsplDb(d3, fGHz);
    const fol = foliage(pr.vegLen, fGHz);
    const out = { los: !pr.blocked, d3, mech: {} };
    if (!pr.blocked) {                                           // LOS: two-ray asymptote + Fresnel clearance loss + foliage
      const dx = 4 * Math.PI * Math.max(A.z, 0.3) * Math.max(B.z, 0.3) / lam, d2 = pr.L2;
      out.PL = base + (d2 > dx ? 20 * log10(d2 / dx) : 0) + pr.deyg + fol; out.mech.los = out.PL; return out;
    }
    const over = base + 0.93 * pr.deyg + fol, thru = base + Math.min(120, pr.walls * wallLoss(fGHz)) + fol, floor = umiNLOS(d3, fGHz, Math.min(A.z, B.z) < 10 ? Math.max(A.z, B.z) : Math.min(A.z, B.z)) + 10;
    const parts = [over, thru, floor]; out.mech = { over, thru, floor };
    if (F && A.z < 8 && B.z < 8) {
      const g = P.geoAt(F, B.x, B.y);
      if (isFinite(g.g)) { const around = fsplDb(Math.hypot(g.g, B.z - A.z), fGHz) + cornerLoss(fGHz, g.turn, g.hops) + fol; out.mech.around = around; parts.push(around); }
    }
    out.PL = pSum(...parts); return out;
  };
  P.rateFromSNR = (radio, snr) => { let r = 0; for (const [t, mbps] of radio.ladder) if (snr >= t) r = mbps; return r; };      // PHY rate; goodput = rate x MAC efficiency
  /* link A->B with tech tx (radio of A) and rx (radio of B): returns { PL, snr, rate (Mbit/s), Pr } */
  P.link = function (W, A, B, txR, rxR, F) {
    const fGHz = txR.fc, pl = P.pathLoss(W, A, B, fGHz, F), Pr = txR.Pt + txR.G + rxR.G - pl.PL, N = -174 + 10 * log10(rxR.B) + rxR.NF, snr = Pr - N;
    const phy = P.rateFromSNR(rxR, snr); return { PL: pl.PL, los: pl.los, Pr, snr, rate: phy, good: phy * rxR.mac, mech: pl.mech, d3: pl.d3 };
  };
  P.radioGroupPairs = (ra, rb) => {                              // shared technology between two radio lists -> [[txKey, rxKey]]
    const out = [];
    for (const a of ra) for (const b of rb) { const A = ES.RADIOS[a], B = ES.RADIOS[b]; if (A.group === B.group && !(a === "nr_ue" && b === "nr_ue") && !(a === "nr_gnb" && b === "nr_gnb")) out.push([a, b]); }
    return out;
  };
  /* coverage map of a transmitter (node + radio key) toward ground receivers at zr */
  P.coverage = function (W, node, rKey, zr = 1.2, step = 4) {
    if (P.FAST) step *= 2;
    const R = ES.RADIOS[rKey], N = Math.floor(W.N / step), snr = new Float32Array(N * N).fill(NaN), rate = new Float32Array(N * N);
    const gm = P.coarseMask(W, P.FAST ? 4 : 2, 2.5), F = node.z < 8 ? P.geodesic(gm, node.x, node.y) : null;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = W.x0 + (i + 0.5) * step * W.res, y = W.y0 + (j + 0.5) * step * W.res;
      if (x < -5 || y < -5 || x > W.S + 5 || y > W.S + 5) continue;
      if (W.hB[(j * step) * W.N + i * step] > zr) continue;
      const rxR = rKey === "nr_gnb" ? ES.RADIOS.nr_ue : rKey === "nr_ue" ? ES.RADIOS.nr_gnb : R;
      const L = P.link(W, node, { x, y, z: zr }, R, rxR, F);
      snr[j * N + i] = L.snr; rate[j * N + i] = L.rate;
    }
    return { snr, rate, N, step, res: W.res * step, x0: W.x0, y0: W.y0 };
  };
  /* widest-path routing over node links: nodes = [{id, x,y,z, radios:[keys]}]; returns links list + best route src->dst (bottleneck rate, hops, latency for payload bytes) */
  P.network = function (W, nodes) {
    const gm = P.coarseMask(W, P.FAST ? 4 : 2, 2.5), Fs = nodes.map((n) => (n.z < 8 ? P.geodesic(gm, n.x, n.y) : null));
    const links = [];
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      let best = null;
      for (const [ka, kb] of P.radioGroupPairs(nodes[a].radios, nodes[b].radios)) {
        const ab = P.link(W, nodes[a], nodes[b], ES.RADIOS[ka], ES.RADIOS[kb], Fs[a]), ba = P.link(W, nodes[b], nodes[a], ES.RADIOS[kb], ES.RADIOS[ka], Fs[b]);
        const rate = Math.min(ab.rate, ba.rate), good = Math.min(ab.good, ba.good);
        if (!best || good > best.good) best = { a, b, tech: ka === kb ? ka : ka + "↔" + kb, rate, good, snr: Math.min(ab.snr, ba.snr), PL: ab.PL, los: ab.los, d3: ab.d3 };
      }
      if (best) links.push(best);
    }
    return links;
  };
  P.route = function (nodes, links, src, dst, bytes = 2048) {
    const adj = nodes.map(() => []); for (const l of links) if (l.good > 0) { adj[l.a].push([l.b, l]); adj[l.b].push([l.a, l]); }
    // widest path (max bottleneck rate), ties by fewer hops
    const best = nodes.map(() => ({ r: 0, h: 99, prev: -1, link: null })); best[src] = { r: Infinity, h: 0, prev: -1, link: null };
    const q = [src], seen = new Set();
    while (q.length) {
      q.sort((x, y) => best[y].r - best[x].r || best[x].h - best[y].h); const u = q.shift(); if (seen.has(u)) continue; seen.add(u);
      for (const [v, l] of adj[u]) { const r = Math.min(best[u].r, l.good), h = best[u].h + 1; if (r > best[v].r || (r === best[v].r && h < best[v].h)) { best[v] = { r, h, prev: u, link: l }; q.push(v); } }
    }
    if (best[dst].r <= 0) return null;
    const path = []; for (let v = dst; v >= 0; v = best[v].prev) path.unshift(v);
    let lat = 0; for (let k = 1; k < path.length; k++) { const l = best[path[k]].link; lat += (bytes * 8) / (l.good * 1e6) + 0.002; }
    return { path, rate: best[dst].r, hops: path.length - 1, latency_s: lat };
  };

  /* ================================ navigation ================================ */
  ES.EMB = { human: { r: 0.35, maxRub: 0.2, v: 1.4, pref: 1.5 }, dog: { r: 0.35, maxRub: 0.5, v: 1.0, pref: 1.5 }, rover: { r: 0.4, maxRub: 0.1, v: 1.4, pref: 1.0 }, uav: { r: 3.0, v: 5.0 } };
  const navCache = new WeakMap();
  P.navField = function (W, embKey) {
    let m = navCache.get(W); if (!m) navCache.set(W, (m = {}));
    if (m[embKey]) return m[embKey];
    const E = ES.EMB[embKey], N = W.N, n = N * N, blk = new Uint8Array(n);
    for (let i = 0; i < n; i++) blk[i] = W.hB[i] > 0.05 || W.hT[i] > 0.05 || W.navBlk[i] || W.rub[i] > E.maxRub ? 1 : 0;
    const clr = new Float32Array(n).fill(1e3); for (let i = 0; i < n; i++) if (blk[i]) clr[i] = 0;
    const a = 1, b = Math.SQRT2;                                  // chamfer distance transform (cells)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const id = j * N + i; let v = clr[id];
      if (i > 0) v = Math.min(v, clr[id - 1] + a); if (j > 0) { v = Math.min(v, clr[id - N] + a); if (i > 0) v = Math.min(v, clr[id - N - 1] + b); if (i < N - 1) v = Math.min(v, clr[id - N + 1] + b); } clr[id] = v; }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const id = j * N + i; let v = clr[id];
      if (i < N - 1) v = Math.min(v, clr[id + 1] + a); if (j < N - 1) { v = Math.min(v, clr[id + N] + a); if (i < N - 1) v = Math.min(v, clr[id + N + 1] + b); if (i > 0) v = Math.min(v, clr[id + N - 1] + b); } clr[id] = v; }
    const free = new Uint8Array(n), cost = new Float32Array(n), rmin = E.r + 0.71 * W.res;
    for (let i = 0; i < n; i++) { const c = clr[i] * W.res; free[i] = c >= rmin ? 1 : 0; const pen = Math.max(0, 1 - (c - E.r) / E.pref); cost[i] = 1 + 4 * pen * pen; }
    return (m[embKey] = { free, cost, clr, blk });
  };
  function nearestFree(W, F, x, y) {
    const id0 = W.ij(x, y); if (id0 >= 0 && F.free[id0]) return id0;
    let best = -1, bd = 1e9; const i0 = Math.floor((x - W.x0) / W.res), j0 = Math.floor((y - W.y0) / W.res);
    for (let r = 1; r < 40 && best < 0; r++) for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
      if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue; const i = i0 + a, j = j0 + b; if (i < 0 || j < 0 || i >= W.N || j >= W.N) continue;
      const id = j * W.N + i; if (F.free[id] && a * a + b * b < bd) { bd = a * a + b * b; best = id; }
    }
    return best;
  }
  function freeLine(W, F, i0, j0, i1, j1) {
    const dx = i1 - i0, dy = j1 - j0, n = Math.ceil(Math.hypot(dx, dy) / 0.5);
    for (let k = 0; k <= n; k++) { const i = Math.round(i0 + (dx * k) / n), j = Math.round(j0 + (dy * k) / n); if (!F.free[j * W.N + i]) return false; }
    return true;
  }
  /* A* + string pulling. returns { ok, pts: [[x,y]], length, time, reason } */
  P.route2d = function (W, a, b, embKey) {
    const E = ES.EMB[embKey], F = P.navField(W, embKey), N = W.N;
    const s = nearestFree(W, F, a[0], a[1]), g = nearestFree(W, F, b[0], b[1]);
    if (s < 0 || g < 0) return { ok: false, reason: "起点或终点附近没有可通行区域" };
    const gx = g % N, gy = (g - gx) / N, G = new Float32Array(N * N).fill(Infinity), par = new Int32Array(N * N).fill(-1), done = new Uint8Array(N * N);
    const hz = (id) => { const x = id % N, y = (id - x) / N, dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
    const heap = []; const push = (k, v) => { let i = heap.length; heap.push([k, v]); while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= k) break; heap[i] = heap[p]; i = p; } heap[i] = [k, v]; };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top[1]; };
    G[s] = 0; push(hz(s), s); const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false;
    while (heap.length) {
      const u = pop(); if (done[u]) continue; done[u] = 1; if (u === g) { found = true; break; }
      const ui = u % N, uj = (u - ui) / N;
      for (const [da, db, w] of nb) {
        const vi = ui + da, vj = uj + db; if (vi < 0 || vj < 0 || vi >= N || vj >= N) continue; const v = vj * N + vi; if (!F.free[v] || done[v]) continue;
        if (da && db && (!F.free[uj * N + vi] || !F.free[vj * N + ui])) continue;
        const c = G[u] + w * F.cost[v]; if (c < G[v]) { G[v] = c; par[v] = u; push(c + hz(v), v); }
      }
    }
    if (!found) return { ok: false, reason: "没有可通行路径(被建筑、围栏或废墟围住)" };
    let cells = []; for (let v = g; v !== -1; v = par[v]) cells.push(v); cells.reverse();
    // string pulling over the inflated free mask
    const out = [cells[0]]; let anchor = 0;
    for (let k = 2; k < cells.length; k++) { const A = cells[anchor], K = cells[k]; if (!freeLine(W, F, A % N, (A - (A % N)) / N, K % N, (K - (K % N)) / N)) { out.push(cells[k - 1]); anchor = k - 1; } }
    out.push(cells[cells.length - 1]);
    const pts = out.map((id) => W.xy(id)); pts[0] = [a[0], a[1]]; pts[pts.length - 1] = [b[0], b[1]];
    let L = 0; for (let k = 1; k < pts.length; k++) L += ES.dist(pts[k - 1], pts[k]);
    return { ok: true, pts, length: L, time: L / E.v, cells: cells.length };
  };
  /* UAV: straight line at cruise altitude; reports clearance over buildings and the climb needed */
  P.routeUAV = function (W, a, b, alt = 28, margin = 5) {
    const L = ES.dist(a, b), n = Math.ceil(L / 0.5); let hmax = 0;
    for (let k = 0; k <= n; k++) { const id = W.ij(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n); if (id >= 0 && W.hB[id] > hmax) hmax = W.hB[id]; }
    const need = Math.max(alt, hmax + margin);
    return { ok: true, length: L, time: L / ES.EMB.uav.v + (need - 0) / 2.5, altitude: need, climbed: need > alt + 0.1, hmax };
  };
  /* time-to-reach field (seconds) from a start for an embodiment, on the coarse nav grid */
  P.reach = function (W, a, embKey, step = 2) {
    const E = ES.EMB[embKey], F = P.navField(W, embKey), N = W.N, s = nearestFree(W, F, a[0], a[1]);
    const G = new Float32Array(N * N).fill(Infinity), heap = []; if (s < 0) return null;
    const push = (k, v) => { let i = heap.length; heap.push([k, v]); while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= k) break; heap[i] = heap[p]; i = p; } heap[i] = [k, v]; };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top[1]; };
    G[s] = 0; push(0, s); const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]], done = new Uint8Array(N * N);
    while (heap.length) { const u = pop(); if (done[u]) continue; done[u] = 1; const ui = u % N, uj = (u - ui) / N;
      for (const [da, db, w] of nb) { const vi = ui + da, vj = uj + db; if (vi < 0 || vj < 0 || vi >= N || vj >= N) continue; const v = vj * N + vi; if (!F.free[v] || done[v]) continue;
        if (da && db && (!F.free[uj * N + vi] || !F.free[vj * N + ui])) continue; const c = G[u] + w * W.res; if (c < G[v]) { G[v] = c; push(c, v); } } }
    const Nc = Math.floor(N / step), out = new Float32Array(Nc * Nc).fill(Infinity);
    for (let j = 0; j < Nc; j++) for (let i = 0; i < Nc; i++) out[j * Nc + i] = G[(j * step) * N + i * step] / E.v;
    return { grid: out, N: Nc, step, res: W.res * step, x0: W.x0, y0: W.y0 };
  };

  /* ================================ LiDAR ================================ */
  /* multi-ring scan: elevation rings [deg], azimuth step; returns points [x,y,z,range,hitType] (hitType 0 ground, 1 solid, 2 thin) */
  P.lidar = function (W, o, { range = 30, azStep = 1.0, elev = [-12, -6, 0, 8, 16, 28], noise = 0.02 } = {}) {
    const pts = [];
    for (const el of elev) {
      const ce = Math.cos(ES.rad(el)), se = Math.sin(ES.rad(el));
      for (let az = 0; az < 360; az += azStep) {
        const ca = Math.cos(ES.rad(az)), sa = Math.sin(ES.rad(az)), dx = ca * ce, dy = sa * ce, dz = se; let hit = -1, type = 0;
        for (let r = 0.3; r <= range; r += 0.1) {
          const x = o.x + dx * r, y = o.y + dy * r, z = o.z + dz * r;
          if (z <= 0) { hit = r; type = 0; break; }
          const id = W.ij(x, y); if (id < 0) break;
          if (W.hB[id] > z) { hit = r; type = 1; break; }
          if (W.hT[id] > z) { hit = r; type = 2; break; }
        }
        if (hit > 0) { const r = hit + noise * (Math.random() - 0.5) * 2; pts.push([o.x + dx * r, o.y + dy * r, o.z + dz * r, r, type]); }
      }
    }
    return pts;
  };
})();
