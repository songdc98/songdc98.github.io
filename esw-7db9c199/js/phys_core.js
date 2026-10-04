/* Shared browser-side geometry physics: ray profile through the raster world (occlusion, canopy, wall chords, Deygout knife edges) and
   Theta* any-angle geodesics (taut-string path around buildings, with bend counts). Same quantities the Python engines build from the StaticScene. */
(function () {
  const ES = window.ES, P = (ES.phys = ES.phys || {});
  const STEP = 0.25;
  const hs = new Float32Array(8192);       // scratch: obstacle height along the current profile

  /* ITU-R P.526 knife-edge loss J(v) [dB] */
  P.J = (v) => (v > -0.78 ? 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) * (v - 0.1) + 1) + v - 0.1) : 0);

  /* Edges of the obstacle profile: every contiguous run of cells with height > 0 gives a front and a back edge at the run height
     (runs thinner than 2 m count as one edge), as in the Python engine (rf/geometry.py profile edges). */
  const eK = new Float32Array(2100), eH = new Float32Array(2100); let nE = 0;
  function extractEdges(n, ds) {
    nE = 0; let k = 1;
    while (k < n) {
      if (hs[k] > 0) {
        let k1 = k, hm = hs[k]; while (k1 + 1 < n && hs[k1 + 1] > 0) { k1++; if (hs[k1] > hm) hm = hs[k1]; }
        if (nE < 2090) {
          if ((k1 - k) * ds < 2.0) { eK[nE] = (k + k1) / 2; eH[nE++] = hm; } else { eK[nE] = k; eH[nE++] = hm; eK[nE] = k1; eH[nE++] = hm; }
        }
        k = k1 + 1;
      } else k++;
    }
  }
  /* Deygout over edges i0..i1-1 between sample positions k0, k1 whose ray heights are z0, z1 (P.526; depth 2 = three edges) */
  function deygout(i0, i1, k0, k1, z0, z1, ds, lam, depth) {
    if (i1 <= i0) return 0;
    let best = -9, ib = -1; const n = k1 - k0;
    for (let i = i0; i < i1; i++) {
      const k = eK[i], zl = z0 + ((z1 - z0) * (k - k0)) / n, d1 = (k - k0) * ds, d2 = (k1 - k) * ds;
      if (d1 < 0.2 || d2 < 0.2) continue;
      const v = (eH[i] - zl) * Math.sqrt((2 * (d1 + d2)) / (lam * d1 * d2));
      if (v > best) { best = v; ib = i; }
    }
    if (ib < 0 || best <= -0.78) return 0;
    let loss = P.J(best);
    if (depth > 0) loss += deygout(i0, ib, k0, eK[ib], z0, eH[ib], ds, lam, depth - 1) + deygout(ib + 1, i1, eK[ib], k1, eH[ib], z1, ds, lam, depth - 1);
    return loss;
  }

  /* Profile of the straight 3-D segment A->B.
     returns { L3, L2, blocked, T (canopy transmittance), canopyLen, walls (distinct solid crossings), wallLen, deyg(lam), hEdge, d1, d2 } */
  P.profile = function (W, ax, ay, az, bx, by, bz, lam = 0.125, depth = 2) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = Math.hypot(dx, dy), L3 = Math.hypot(L2, dz);
    const n = Math.min(8190, Math.max(2, Math.ceil(L2 / STEP))), ds = L3 / n;
    let blocked = false, T = 1, canopyLen = 0, vegLen = 0, walls = 0, wallLen = 0, inWall = false, hBlock = 0, kBlock = -1;
    hs[0] = 0; hs[n] = 0;
    for (let k = 1; k < n; k++) {
      const t = k / n, x = ax + dx * t, y = ay + dy * t, z = az + dz * t, id = W.ij(x, y);
      let h = 0;
      if (id >= 0) {
        h = W.hB[id];
        if (h > z) {
          blocked = true; wallLen += ds; if (!inWall) { walls++; inWall = true; }
          if (h > hBlock) { hBlock = h; kBlock = k; }
        } else inWall = false;
        const ch = W.cHi[id]; let dens = 0;
        if (ch > 0 && z >= W.cLo[id] && z <= ch) { canopyLen += ds; T *= Math.exp(-0.5 * W.cDen[id] * ds); dens = W.cDen[id]; }
        if (W.park[id] > dens && z < 8) dens = W.park[id];
        vegLen += dens * ds;
      } else inWall = false;
      hs[k] = h;
    }
    const out = { L3, L2, blocked, T, canopyLen, vegLen, walls, wallLen, hEdge: hBlock, d1: 0, d2: 0, deyg: 0 };
    extractEdges(n, ds);
    if (nE) out.deyg = deygout(0, nE, 0, n, az, bz, ds, lam, depth);
    if (kBlock >= 0) { out.d1 = kBlock * ds; out.d2 = L3 - out.d1; }
    return out;
  };

  /* fast boolean line of sight (opaque solids only), optional canopy transmittance threshold */
  P.los = function (W, ax, ay, az, bx, by, bz, canopyMin = 0) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = Math.hypot(dx, dy), L3 = Math.hypot(L2, dz);
    const n = Math.max(2, Math.ceil(L2 / 0.4)), ds = L3 / n; let T = 1;
    for (let k = 1; k < n; k++) {
      const t = k / n, z = az + dz * t, id = W.ij(ax + dx * t, ay + dy * t);
      if (id < 0) continue;
      if (W.hB[id] > z) return 0;
      if (canopyMin > 0) { const ch = W.cHi[id]; if (ch > 0 && z >= W.cLo[id] && z <= ch) { T *= Math.exp(-0.5 * W.cDen[id] * ds); if (T < canopyMin) return 0; } }
    }
    return T;
  };

  /* ---------- Theta* geodesic field on a coarse grid ---------- */
  class Heap {
    constructor() { this.k = []; this.v = []; }
    push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; }
    pop() { const k = this.k, v = this.v, topV = v[0], lastK = k.pop(), lastV = v.pop(), n = k.length; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lastK) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lastK; v[i] = lastV; } return topV; }
    get size() { return this.k.length; }
  }
  /* coarse obstacle mask: a coarse cell (c fine cells) is an obstacle when any fine cell has hB > zBarrier */
  P.coarseMask = function (W, c, zBarrier) {
    const Nc = Math.floor(W.N / c), m = new Uint8Array(Nc * Nc);
    for (let j = 0; j < Nc; j++) for (let i = 0; i < Nc; i++) {
      let o = 0;
      for (let b = 0; b < c && !o; b++) for (let a = 0; a < c; a++) if (W.hB[(j * c + b) * W.N + i * c + a] > zBarrier) { o = 1; break; }
      m[j * Nc + i] = o;
    }
    return { Nc, c, m, res: W.res * c, x0: W.x0, y0: W.y0 };
  };
  function losGrid(G, i0, j0, i1, j1) {      // sampled line test on the coarse mask (cell centres at integer indices)
    const dx = i1 - i0, dy = j1 - j0, n = Math.ceil(Math.hypot(dx, dy) / 0.4);
    for (let k = 1; k < n; k++) {
      const i = Math.round(i0 + (dx * k) / n), j = Math.round(j0 + (dy * k) / n);
      if (G.m[j * G.Nc + i]) return false;
    }
    return !G.m[j1 * G.Nc + i1];
  }
  /* geodesic length g (m) and hop count from (sx, sy) to every free coarse cell; unreachable = Infinity */
  P.geodesic = function (G, sx, sy) {
    const Nc = G.Nc, n = Nc * Nc, g = new Float32Array(n).fill(Infinity), par = new Int32Array(n).fill(-1), hops = new Uint8Array(n), turn = new Float32Array(n);   // turn: accumulated heading change [rad]; hops: bends > 15 deg
    const si = ES.clamp(Math.floor((sx - G.x0) / G.res), 0, Nc - 1), sj = ES.clamp(Math.floor((sy - G.y0) / G.res), 0, Nc - 1), s = sj * Nc + si;
    // if the source sits on an obstacle cell (e.g. a person at a wall), start from the nearest free neighbour
    let start = s;
    if (G.m[s]) { let bd = 1e9; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const ii = si + a, jj = sj + b; if (ii < 0 || jj < 0 || ii >= Nc || jj >= Nc || G.m[jj * Nc + ii]) continue; const d = a * a + b * b; if (d < bd) { bd = d; start = jj * Nc + ii; } } }
    g[start] = 0; par[start] = start;
    const h = new Heap(); h.push(0, start); const done = new Uint8Array(n);
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (h.size) {
      const u = h.pop(); if (done[u]) continue; done[u] = 1;
      const ui = u % Nc, uj = (u - ui) / Nc, p = par[u], pi = p % Nc, pj = (p - pi) / Nc;
      for (const [a, b] of nb) {
        const vi = ui + a, vj = uj + b; if (vi < 0 || vj < 0 || vi >= Nc || vj >= Nc) continue;
        const v = vj * Nc + vi; if (G.m[v] || done[v]) continue;
        if (a && b && (G.m[uj * Nc + vi] || G.m[vj * Nc + ui])) continue;
        let cand = g[u] + Math.hypot(a, b) * G.res, cp = u;
        if (p !== u && losGrid(G, pi, pj, vi, vj)) { const c2 = g[p] + Math.hypot(vi - pi, vj - pj) * G.res; if (c2 < cand) { cand = c2; cp = p; } }
        if (cand < g[v] - 1e-6) {
          g[v] = cand; par[v] = cp;
          let tn = 0, bn = 0;
          if (cp !== start) { const q = par[cp], ci = cp % Nc, cj = (cp - ci) / Nc, qi = q % Nc, qj = (q - qi) / Nc, d = Math.abs(ES.wrapPi(Math.atan2(vj - cj, vi - ci) - Math.atan2(cj - qj, ci - qi))); tn = turn[cp] + d; bn = hops[cp] + (d > 0.26 ? 1 : 0); }
          turn[v] = tn; hops[v] = bn; h.push(cand, v);
        }
      }
    }
    return { g, hops, turn, G, start };
  };
  P.geoAt = function (F, x, y) {
    const G = F.G, i = Math.floor((x - G.x0) / G.res), j = Math.floor((y - G.y0) / G.res);
    if (i < 0 || j < 0 || i >= G.Nc || j >= G.Nc) return { g: Infinity, hops: 0, turn: 0 };
    const id = j * G.Nc + i; return { g: F.g[id], hops: F.hops[id], turn: F.turn[id] };
  };
})();
