/* lmkernel.js: ray tracing + light-baking kernel of the interior lighting system (interiors agent).
   Pure JS, no DOM: ES.lmKernel() returns an independent kernel instance. lightmap.js runs one per Web Worker (source text via ES.lmKernel.toString()) and keeps one on the main
   thread for point queries (probes, sun flux through windows, view luminance). Geometry = the BIM boxes (oriented boxes, world pose at their default door / window state).
   Light transport is linear in the sources, so one bake serves every lighting state:
     UP    irradiance per unit horizontal sky illuminance (CIE overcast radiance pattern through the windows, + all interreflections)      [dimensionless, DF-like]
     DOWN  irradiance per unit radiance of the ground / opposite buildings seen through the windows (+ interreflections)                      [sr]
     ART   irradiance per lumen of the room's own fixtures (direct with shadows + interreflections inside the room)                          [lx / lm]
     FOR   same for the strongest fixture group of ANOTHER room that reaches this texel (open doorways, glass partitions)                    [lx / lm of that room]
   Sun: shadow-mapped in real time by the renderer; its bounce is added analytically per room (interior.js).
   Algorithm: direct terms (portal-sampled sky, fixture shadow rays) then K Jacobi gather iterations E_k = E_direct + mean(albedo_hit * E_{k-1}(hit)) over cosine-weighted
   Hammersley rays (rotated per texel by a hash), 3x3 smoothing of the indirect part inside each face, geometric tail for the remaining bounces. Deterministic (hash RNG). */
(function () {
  const ES = (window.ES = window.ES || {});
  function lmKernel() {
    "use strict";
    const K = {};
    const INF = 1e30, EPS_T = 1e-4;
    /* ================================================================ scene: boxes + BVH ================================================================
       S = { n, D: Float32Array(n*16) [c(3) ax(3) ay(3) az(3) h(3) pad], cls: Uint8Array(n) 0 opaque / 1 glass / 2 fabric (translucent) / 3 ignore, tr: Float32Array(n) transmittance for cls 1,2,
             mat: Int16Array(n*6) face materials, alb: Float32Array(nm*3) linear albedo per material, bld: Int16Array(n) }  */
    let S = null, D = null, CLS = null, TR = null;
    let nB = null, nL = null, nR = null, nC = null, nX = null, prim = null, nNodes = 0;
    const stk = new Int32Array(160);
    let rBox = -1, rT = INF, rFace = 0, rTr = 1;                                    // trace results (scratch globals)
    const tlT = new Float64Array(24), tlV = new Float64Array(24);                    // translucent hits of the current ray

    K.setScene = function (scene) {
      S = scene; D = S.D; CLS = S.cls; TR = S.tr; const n = S.n;
      const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3), cen = new Float32Array(n * 3), ids = [];
      for (let i = 0; i < n; i++) {
        if (CLS[i] === 3) continue; const b = i * 16;
        const ex = Math.abs(D[b + 3]) * D[b + 12] + Math.abs(D[b + 6]) * D[b + 13] + Math.abs(D[b + 9]) * D[b + 14], ey = Math.abs(D[b + 4]) * D[b + 12] + Math.abs(D[b + 7]) * D[b + 13] + Math.abs(D[b + 10]) * D[b + 14], ez = Math.abs(D[b + 5]) * D[b + 12] + Math.abs(D[b + 8]) * D[b + 13] + Math.abs(D[b + 11]) * D[b + 14];
        bmin[i * 3] = D[b] - ex; bmin[i * 3 + 1] = D[b + 1] - ey; bmin[i * 3 + 2] = D[b + 2] - ez; bmax[i * 3] = D[b] + ex; bmax[i * 3 + 1] = D[b + 1] + ey; bmax[i * 3 + 2] = D[b + 2] + ez;
        cen[i * 3] = D[b]; cen[i * 3 + 1] = D[b + 1]; cen[i * 3 + 2] = D[b + 2]; ids.push(i);
      }
      buildBVH(ids, bmin, bmax, cen);
    };
    function buildBVH(ids, bmin, bmax, cen) {
      const m = ids.length; prim = Int32Array.from(ids); const maxN = Math.max(2, 2 * m);
      nB = new Float32Array(maxN * 6); nL = new Int32Array(maxN); nR = new Int32Array(maxN); nC = new Int32Array(maxN); nX = new Uint8Array(maxN); nNodes = 1;
      const NBIN = 12, bc = new Int32Array(NBIN), bb = new Float32Array(NBIN * 6), rightArea = new Float64Array(NBIN);
      const st = [0, 0, m];
      while (st.length) {
        const e = st.pop(), s = st.pop(), nd = st.pop();
        let x0 = INF, y0 = INF, z0 = INF, x1 = -INF, y1 = -INF, z1 = -INF, cx0 = INF, cy0 = INF, cz0 = INF, cx1 = -INF, cy1 = -INF, cz1 = -INF;
        for (let k = s; k < e; k++) {
          const i = prim[k], j = i * 3;
          if (bmin[j] < x0) x0 = bmin[j]; if (bmin[j + 1] < y0) y0 = bmin[j + 1]; if (bmin[j + 2] < z0) z0 = bmin[j + 2]; if (bmax[j] > x1) x1 = bmax[j]; if (bmax[j + 1] > y1) y1 = bmax[j + 1]; if (bmax[j + 2] > z1) z1 = bmax[j + 2];
          if (cen[j] < cx0) cx0 = cen[j]; if (cen[j] > cx1) cx1 = cen[j]; if (cen[j + 1] < cy0) cy0 = cen[j + 1]; if (cen[j + 1] > cy1) cy1 = cen[j + 1]; if (cen[j + 2] < cz0) cz0 = cen[j + 2]; if (cen[j + 2] > cz1) cz1 = cen[j + 2];
        }
        const o = nd * 6; nB[o] = x0; nB[o + 1] = y0; nB[o + 2] = z0; nB[o + 3] = x1; nB[o + 4] = y1; nB[o + 5] = z1;
        const cnt = e - s; let ax = 0, ext = cx1 - cx0; if (cy1 - cy0 > ext) { ax = 1; ext = cy1 - cy0; } if (cz1 - cz0 > ext) { ax = 2; ext = cz1 - cz0; }
        if (cnt <= 2 || ext < 1e-6) { nL[nd] = s; nC[nd] = cnt; continue; }
        const cmin = ax === 0 ? cx0 : ax === 1 ? cy0 : cz0, scale = NBIN / ext * 0.9999;
        bc.fill(0); for (let q = 0; q < NBIN; q++) { bb[q * 6] = bb[q * 6 + 1] = bb[q * 6 + 2] = INF; bb[q * 6 + 3] = bb[q * 6 + 4] = bb[q * 6 + 5] = -INF; }
        for (let k = s; k < e; k++) {
          const i = prim[k], j = i * 3, q = Math.min(NBIN - 1, ((cen[j + ax] - cmin) * scale) | 0); bc[q]++; const w = q * 6;
          if (bmin[j] < bb[w]) bb[w] = bmin[j]; if (bmin[j + 1] < bb[w + 1]) bb[w + 1] = bmin[j + 1]; if (bmin[j + 2] < bb[w + 2]) bb[w + 2] = bmin[j + 2]; if (bmax[j] > bb[w + 3]) bb[w + 3] = bmax[j]; if (bmax[j + 1] > bb[w + 4]) bb[w + 4] = bmax[j + 1]; if (bmax[j + 2] > bb[w + 5]) bb[w + 5] = bmax[j + 2];
        }
        // sweep from the right: area of the union of bins q..end
        let rx0 = INF, ry0 = INF, rz0 = INF, rx1 = -INF, ry1 = -INF, rz1 = -INF, rcnt = 0; const rc = new Int32Array(NBIN);
        for (let q = NBIN - 1; q > 0; q--) { const w = q * 6; if (bc[q]) { if (bb[w] < rx0) rx0 = bb[w]; if (bb[w + 1] < ry0) ry0 = bb[w + 1]; if (bb[w + 2] < rz0) rz0 = bb[w + 2]; if (bb[w + 3] > rx1) rx1 = bb[w + 3]; if (bb[w + 4] > ry1) ry1 = bb[w + 4]; if (bb[w + 5] > rz1) rz1 = bb[w + 5]; } rcnt += bc[q]; rc[q] = rcnt; const dx = rx1 - rx0, dy = ry1 - ry0, dz = rz1 - rz0; rightArea[q] = rcnt ? 2 * (dx * dy + dy * dz + dz * dx) : 0; }
        let lx0 = INF, ly0 = INF, lz0 = INF, lx1 = -INF, ly1 = -INF, lz1 = -INF, lcnt = 0, best = INF, bestQ = -1;
        for (let q = 0; q < NBIN - 1; q++) {
          const w = q * 6; if (bc[q]) { if (bb[w] < lx0) lx0 = bb[w]; if (bb[w + 1] < ly0) ly0 = bb[w + 1]; if (bb[w + 2] < lz0) lz0 = bb[w + 2]; if (bb[w + 3] > lx1) lx1 = bb[w + 3]; if (bb[w + 4] > ly1) ly1 = bb[w + 4]; if (bb[w + 5] > lz1) lz1 = bb[w + 5]; } lcnt += bc[q];
          if (!lcnt || !rc[q + 1]) continue; const dx = lx1 - lx0, dy = ly1 - ly0, dz = lz1 - lz0, cost = lcnt * 2 * (dx * dy + dy * dz + dz * dx) + rc[q + 1] * rightArea[q + 1];
          if (cost < best) { best = cost; bestQ = q; }
        }
        let mid;
        if (bestQ < 0) mid = (s + e) >> 1;
        else {                                                                       // partition prim[s..e) by bin <= bestQ
          let a = s, b2 = e - 1;
          while (a <= b2) { const i = prim[a], q = Math.min(NBIN - 1, ((cen[i * 3 + ax] - cmin) * scale) | 0); if (q <= bestQ) a++; else { prim[a] = prim[b2]; prim[b2] = i; b2--; } }
          mid = a; if (mid === s || mid === e) mid = (s + e) >> 1;
        }
        const l = nNodes++, r = nNodes++; nL[nd] = l; nR[nd] = r; nC[nd] = 0; nX[nd] = ax; st.push(l, s, mid, r, mid, e);
      }
    }
    /* ray vs oriented box: entry distance (> EPS_T) or -1; sets rFace (0:+x 1:-x 2:+y 3:-y 4:+z 5:-z of the entered face). Origins inside the box are not hits. */
    function hitBox(i, ox, oy, oz, dx, dy, dz, tmax) {
      const b = i * 16, px = ox - D[b], py = oy - D[b + 1], pz = oz - D[b + 2];
      let tn = -INF, tf = INF, face = 0, lo, m, h, inv, t1, t2, q;
      lo = D[b + 3] * px + D[b + 4] * py + D[b + 5] * pz; m = D[b + 3] * dx + D[b + 4] * dy + D[b + 5] * dz; h = D[b + 12];
      if (m > -1e-9 && m < 1e-9) { if (lo > h || lo < -h) return -1; } else { inv = 1 / m; t1 = (-h - lo) * inv; t2 = (h - lo) * inv; if (t1 > t2) { q = t1; t1 = t2; t2 = q; } if (t1 > tn) { tn = t1; face = m > 0 ? 1 : 0; } if (t2 < tf) tf = t2; if (tn > tf) return -1; }
      lo = D[b + 6] * px + D[b + 7] * py + D[b + 8] * pz; m = D[b + 6] * dx + D[b + 7] * dy + D[b + 8] * dz; h = D[b + 13];
      if (m > -1e-9 && m < 1e-9) { if (lo > h || lo < -h) return -1; } else { inv = 1 / m; t1 = (-h - lo) * inv; t2 = (h - lo) * inv; if (t1 > t2) { q = t1; t1 = t2; t2 = q; } if (t1 > tn) { tn = t1; face = m > 0 ? 3 : 2; } if (t2 < tf) tf = t2; if (tn > tf) return -1; }
      lo = D[b + 9] * px + D[b + 10] * py + D[b + 11] * pz; m = D[b + 9] * dx + D[b + 10] * dy + D[b + 11] * dz; h = D[b + 14];
      if (m > -1e-9 && m < 1e-9) { if (lo > h || lo < -h) return -1; } else { inv = 1 / m; t1 = (-h - lo) * inv; t2 = (h - lo) * inv; if (t1 > t2) { q = t1; t1 = t2; t2 = q; } if (t1 > tn) { tn = t1; face = m > 0 ? 5 : 4; } if (t2 < tf) tf = t2; if (tn > tf) return -1; }
      if (tn < EPS_T || tn > tmax) return -1; rFace = face; return tn;
    }
    /* mode 0: closest hit, classes 0 and 2 are solid, glass ignored (gather rays)      -> rBox, rT, rFace
       mode 1: shadow ray, early out on a solid (class 0); glass / fabric multiply the transmittance  -> rTr (0 when blocked)
       mode 2: closest class-0 hit + transmittance of the translucent boxes in front of it (sky rays) -> rBox, rT, rFace, rTr  */
    function trace(ox, oy, oz, dx, dy, dz, tmax, mode) {
      if (!nNodes) { rBox = -1; rT = INF; rTr = 1; return; }
      const ix = 1 / (dx === 0 ? 1e-20 : dx), iy = 1 / (dy === 0 ? 1e-20 : dy), iz = 1 / (dz === 0 ? 1e-20 : dz);
      let sp = 0, best = tmax, bBox = -1, bFace = 0, ntl = 0, tr = 1; stk[sp++] = 0;
      while (sp) {
        const nd = stk[--sp], o = nd * 6;
        let t1 = (nB[o] - ox) * ix, t2 = (nB[o + 3] - ox) * ix, tn = t1 < t2 ? t1 : t2, tf = t1 < t2 ? t2 : t1;
        t1 = (nB[o + 1] - oy) * iy; t2 = (nB[o + 4] - oy) * iy; let a = t1 < t2 ? t1 : t2, c = t1 < t2 ? t2 : t1; if (a > tn) tn = a; if (c < tf) tf = c;
        t1 = (nB[o + 2] - oz) * iz; t2 = (nB[o + 5] - oz) * iz; a = t1 < t2 ? t1 : t2; c = t1 < t2 ? t2 : t1; if (a > tn) tn = a; if (c < tf) tf = c;
        if (tn > tf || tf < 0 || tn > best) continue;
        const cnt = nC[nd];
        if (cnt > 0) {
          for (let k = nL[nd], e = k + cnt; k < e; k++) {
            const i = prim[k], cl = CLS[i];
            if (mode === 0) { if (cl === 1) continue; } else if (mode === 2) { /* all classes */ }
            const t = hitBox(i, ox, oy, oz, dx, dy, dz, best); if (t < 0) continue;
            if (mode === 1) { if (cl === 0) { rTr = 0; return; } tr *= TR[i]; if (tr < 1e-3) { rTr = 0; return; } }
            else if (mode === 2) { if (cl === 0) { best = t; bBox = i; bFace = rFace; } else if (ntl < 24) { tlT[ntl] = t; tlV[ntl++] = TR[i]; } }
            else { best = t; bBox = i; bFace = rFace; }
          }
        } else if ((nX[nd] === 0 ? dx : nX[nd] === 1 ? dy : dz) < 0) { stk[sp++] = nL[nd]; stk[sp++] = nR[nd]; } else { stk[sp++] = nR[nd]; stk[sp++] = nL[nd]; }
      }
      if (mode === 1) { rTr = tr; return; }
      rBox = bBox; rT = bBox >= 0 ? best : INF; rFace = bFace;
      if (mode === 2) { let T = 1; for (let k = 0; k < ntl; k++) if (tlT[k] < best) T *= tlV[k]; rTr = T; }
    }
    K.trace = trace; K.hits = () => ({ box: rBox, t: rT, face: rFace, tr: rTr });
    /* convenience for the main thread: first solid hit of a ray (mode 0), or null */
    K.cast = function (ox, oy, oz, dx, dy, dz, tmax = INF, mode = 0) { trace(ox, oy, oz, dx, dy, dz, tmax, mode); return { box: rBox, t: rT, face: rFace, tr: rTr }; };
    K.shadow = function (ox, oy, oz, tx, ty, tz) { const dx = tx - ox, dy = ty - oy, dz = tz - oz, L = Math.hypot(dx, dy, dz); if (L < 1e-6) return 1; trace(ox, oy, oz, dx / L, dy / L, dz / L, L - 1e-3, 1); return rTr; };

    /* ================================================================ sampling helpers ================================================================ */
    function radical2(i) { let b = i >>> 0; b = ((b << 16) | (b >>> 16)) >>> 0; b = (((b & 0x55555555) << 1) | ((b & 0xAAAAAAAA) >>> 1)) >>> 0; b = (((b & 0x33333333) << 2) | ((b & 0xCCCCCCCC) >>> 2)) >>> 0; b = (((b & 0x0F0F0F0F) << 4) | ((b & 0xF0F0F0F0) >>> 4)) >>> 0; b = (((b & 0x00FF00FF) << 8) | ((b & 0xFF00FF00) >>> 8)) >>> 0; return b * 2.3283064365386963e-10; }
    function hemi(n) { const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const u = (i + 0.5) / n, r = Math.sqrt(u), phi = 6.283185307179586 * radical2(i + 1); a[i * 3] = r * Math.cos(phi); a[i * 3 + 1] = r * Math.sin(phi); a[i * 3 + 2] = Math.sqrt(1 - u); } return a; }
    function hash(x) { x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b); x ^= x >>> 16; return (x >>> 0) * 2.3283064365386963e-10; }
    K.hemi = hemi; K.radical2 = radical2;

    /* ================================================================ job: one building ================================================================
       J = { id, boxLo, boxHi (global box index range of the building), nf, fBox (global box idx), fFace, fNx, fNy, fBase, fRoom (index into rooms), fAlb: Float32Array(nf*3), nt,
             nr, lights: { n, pos: Float32Array(3n), w: Float32Array(n) (lm), typ: Uint8Array(n) 0 panel 1 pendant 2 highbay, room: Int16Array(n) }, rflux: Float32Array(nr) (sum lm), rbox: Float32Array(nr*6) room AABB,
             portals: Float32Array(np*16) [c(3) nOut(3) u(3) v(3) hw hh T open], np, params: {nAO, nGather, rAO, tailRho} }   */
    const jobs = {};
    K.setJob = function (J) {
      jobs[J.id] = J; const nt = J.nt, nf = J.nf;
      J.faceOf = new Int32Array((J.boxHi - J.boxLo) * 6).fill(-1);
      for (let f = 0; f < nf; f++) J.faceOf[(J.fBox[f] - J.boxLo) * 6 + J.fFace[f]] = f;
      J.tFace = new Int32Array(nt); J.P = new Float32Array(nt * 3);
      for (let f = 0; f < nf; f++) {
        const g = J.fBox[f], fc = J.fFace[f], nx = J.fNx[f], ny = J.fNy[f], base = J.fBase[f], b = g * 16, k = fc >> 1, sg = (fc & 1) ? -1 : 1, a1 = (k + 1) % 3, a2 = (k + 2) % 3;
        const h1 = D[b + 12 + a1], h2 = D[b + 12 + a2], hk = D[b + 12 + k], cx = D[b], cy = D[b + 1], cz = D[b + 2];
        const kx = D[b + 3 + 3 * k] * sg * hk, ky = D[b + 4 + 3 * k] * sg * hk, kz = D[b + 5 + 3 * k] * sg * hk;
        const ux = D[b + 3 + 3 * a1], uy = D[b + 4 + 3 * a1], uz = D[b + 5 + 3 * a1], vx = D[b + 3 + 3 * a2], vy = D[b + 4 + 3 * a2], vz = D[b + 5 + 3 * a2];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const s1 = -h1 + ((i + 0.5) / nx) * 2 * h1, s2 = -h2 + ((j + 0.5) / ny) * 2 * h2, t = base + j * nx + i;
          J.P[t * 3] = cx + kx + ux * s1 + vx * s2; J.P[t * 3 + 1] = cy + ky + uy * s1 + vy * s2; J.P[t * 3 + 2] = cz + kz + uz * s1 + vz * s2; J.tFace[t] = f;
        }
      }
      // per-face normals
      J.fN = new Float32Array(nf * 3);
      for (let f = 0; f < nf; f++) { const g = J.fBox[f], fc = J.fFace[f], k = fc >> 1, sg = (fc & 1) ? -1 : 1, b = g * 16; J.fN[f * 3] = D[b + 3 + 3 * k] * sg; J.fN[f * 3 + 1] = D[b + 4 + 3 * k] * sg; J.fN[f * 3 + 2] = D[b + 5 + 3 * k] * sg; }
      // rooms that can exchange light with room r: itself + rooms on the same storey whose boxes touch it (shared walls, doorways, glass partitions)
      const nr = J.nr, L = J.lights, RB = J.rbox, adj = []; J.cStart = new Int32Array(nr + 1); J.pStart = new Int32Array(nr + 1); const cand = [], pl = [];
      for (let r = 0; r < nr; r++) {
        const o = r * 6, list = [r];
        for (let q = 0; q < nr; q++) { if (q === r) continue; const u = q * 6, ov = Math.min(RB[o + 5], RB[u + 5]) - Math.max(RB[o + 2], RB[u + 2]); if (ov < 0.5) continue; const gx = Math.max(RB[o] - RB[u + 3], RB[u] - RB[o + 3]), gy = Math.max(RB[o + 1] - RB[u + 4], RB[u + 1] - RB[o + 4]); if (gx < 0.6 && gy < 0.6) list.push(q); }
        adj.push(list); J.cStart[r] = cand.length; J.pStart[r] = pl.length;
        for (let l = 0; l < L.n; l++) { if (list.indexOf(L.room[l]) < 0) continue; const x = L.pos[l * 3], y = L.pos[l * 3 + 1], z = L.pos[l * 3 + 2], dx = Math.max(RB[o] - x, 0, x - RB[o + 3]), dy = Math.max(RB[o + 1] - y, 0, y - RB[o + 4]), dz = Math.max(RB[o + 2] - z, 0, z - RB[o + 5]); if (dx * dx + dy * dy + dz * dz < 196) cand.push(l); }
        for (let q = 0; q < J.np; q++) if (list.indexOf(J.pRoom[q]) >= 0) pl.push(q);
      }
      J.cStart[nr] = cand.length; J.pStart[nr] = pl.length; J.cand = Int32Array.from(cand); J.pList = Int32Array.from(pl); J.adj = adj;
      J.hemiAO = hemi(J.params.nAO); J.hemiG = hemi(J.params.nGather);
      return J.id;
    };
    K.dropJob = function (id) { delete jobs[id]; };
    K.getJob = function (id) { return jobs[id]; };
    function frame(nx, ny, nz, out) { let ax = 0, ay = 0, az = 0; if (Math.abs(nz) < 0.9) az = 1; else ax = 1; let tx = ay * nz - az * ny, ty = az * nx - ax * nz, tz = ax * ny - ay * nx; const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l; out[0] = tx; out[1] = ty; out[2] = tz; out[3] = ny * tz - nz * ty; out[4] = nz * tx - nx * tz; out[5] = nx * ty - ny * tx; }
    const fr = new Float64Array(6);

    /* ---- pass: ambient occlusion (distance weighted visibility within rAO) per texel -> out[t - t0] ---- */
    K.passAO = function (id, t0, t1, out) {
      const J = jobs[id], H = J.hemiAO, n = J.params.nAO, R = J.params.rAO;
      for (let t = t0; t < t1; t++) {
        const f = J.tFace[t], nx = J.fN[f * 3], ny = J.fN[f * 3 + 1], nz = J.fN[f * 3 + 2]; frame(nx, ny, nz, fr);
        const ox = J.P[t * 3] + nx * 0.003, oy = J.P[t * 3 + 1] + ny * 0.003, oz = J.P[t * 3 + 2] + nz * 0.003, ang = 6.283185307179586 * hash(t * 7 + 1), ca = Math.cos(ang), sa = Math.sin(ang);
        let occ = 0;
        for (let i = 0; i < n; i++) {
          const lx = H[i * 3] * ca - H[i * 3 + 1] * sa, ly = H[i * 3] * sa + H[i * 3 + 1] * ca, lz = H[i * 3 + 2];
          const dx = fr[0] * lx + fr[3] * ly + nx * lz, dy = fr[1] * lx + fr[4] * ly + ny * lz, dz = fr[2] * lx + fr[5] * ly + nz * lz;
          trace(ox, oy, oz, dx, dy, dz, R, 0); if (rBox >= 0) occ += 1 - rT / R;
        }
        out[t - t0] = 1 - occ / n;
      }
    };

    /* ---- sky through the portals of a job at a surface point (p = point, o = ray origin 4 mm in front, n = normal): fills sk[0] = UP, sk[1] = DOWN ---- */
    const sk = new Float64Array(2);
    function skyAt(J, px, py, pz, ox, oy, oz, nx, ny, nz, seed, room) {
      let up = 0, dn = 0; const PO = J.portals, k0 = room >= 0 ? J.pStart[room] : 0, k1 = room >= 0 ? J.pStart[room + 1] : J.np;
      for (let kk = k0; kk < k1; kk++) {
        const q = room >= 0 ? J.pList[kk] : kk;
        const w = q * 16, cx = PO[w], cy = PO[w + 1], cz = PO[w + 2], nox = PO[w + 3], noy = PO[w + 4], noz = PO[w + 5];
        const rx = cx - px, ry = cy - py, rz = cz - pz, dist2 = rx * rx + ry * ry + rz * rz, side = rx * nox + ry * noy + rz * noz;
        if (side <= 0.02) continue;                                            // point is on the outer side of the portal plane
        const dist = Math.sqrt(dist2), dN = (rx * nx + ry * ny + rz * nz) / dist; if (dN < -0.6) continue;     // portal behind the surface (centre test with margin for the extent)
        const hw = PO[w + 12], hh = PO[w + 13], area = 4 * hw * hh, om = area * (side / dist) / dist2, M = Math.max(2, Math.min(4, Math.ceil(1.2 + 6 * Math.sqrt(om))));
        const ux = PO[w + 6], uy = PO[w + 7], uz = PO[w + 8], vx = PO[w + 9], vy = PO[w + 10], vz = PO[w + 11], sh = hash(seed * 13 + q * 101 + 3);
        let sUp = 0, sDn = 0;
        for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) {
          const su = ((a + ((sh * 7.13 + b * 0.37) % 1)) / M * 2 - 1) * hw, sv = ((b + ((sh * 3.77 + a * 0.61) % 1)) / M * 2 - 1) * hh;
          const qx = cx + ux * su + vx * sv, qy = cy + uy * su + vy * sv, qz = cz + uz * su + vz * sv; let dx = qx - ox, dy = qy - oy, dz = qz - oz; const d = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= d; dy /= d; dz /= d;
          const cp = dx * nx + dy * ny + dz * nz; if (cp <= 0) continue; const cq = dx * nox + dy * noy + dz * noz; if (cq <= 0) continue;
          trace(ox, oy, oz, dx, dy, dz, INF, 2); const T = rTr; if (T <= 0.001) continue;
          let kind = 1; if (rBox >= 0) { kind = J.faceOf[(rBox - J.boxLo) * 6 + rFace] >= 0 && rBox >= J.boxLo && rBox < J.boxHi ? 0 : 2; }
          if (kind === 0) continue;
          const wgt = T * cp * cq / (d * d);
          if (kind === 1 && dz > 0) sUp += wgt * 3 * (1 + 2 * dz) / (7 * Math.PI); else sDn += wgt;
        }
        const k = area / (M * M); up += sUp * k; dn += sDn * k;
      }
      sk[0] = up; sk[1] = dn;
    }
    /* sky UP / DOWN (direct only, no interreflection) at an arbitrary point of a building job: returns [up, down] */
    K.pointSky = function (id, px, py, pz, nx, ny, nz, room) { skyAt(jobs[id], px, py, pz, px + nx * 0.004, py + ny * 0.004, pz + nz * 0.004, nx, ny, nz, 7, room === undefined ? -1 : room); return [sk[0], sk[1]]; };

    /* ---- pass: direct light. out (9 floats per texel): upRGB, down, artRGB, forVal, forGid ---- */
    K.passDirect = function (id, t0, t1, out) {
      const J = jobs[id], L = J.lights, nr = J.nr; const forAcc = new Float64Array(nr), touched = new Int32Array(nr);
      for (let t = t0; t < t1; t++) {
        const f = J.tFace[t], nx = J.fN[f * 3], ny = J.fN[f * 3 + 1], nz = J.fN[f * 3 + 2], px = J.P[t * 3], py = J.P[t * 3 + 1], pz = J.P[t * 3 + 2];
        const ox = px + nx * 0.004, oy = py + ny * 0.004, oz = pz + nz * 0.004, room = J.fRoom[f]; let art = 0, nT = 0, bestV = 0, bestG = -1;
        skyAt(J, px, py, pz, ox, oy, oz, nx, ny, nz, t, room < 0 ? 0 : room); const up = sk[0], dn = sk[1];
        // ---- fixtures: own room -> art; other rooms -> keep the strongest group ----
        for (let c = J.cStart[room < 0 ? 0 : room], ce = J.cStart[(room < 0 ? 0 : room) + 1]; c < ce; c++) {
          const l = J.cand[c], lx = L.pos[l * 3] - ox, ly = L.pos[l * 3 + 1] - oy, lz = L.pos[l * 3 + 2] - oz, d2 = lx * lx + ly * ly + lz * lz; if (d2 < 0.0025) continue;
          const d = Math.sqrt(d2), dx = lx / d, dy = ly / d, dz = lz / d, cr = dx * nx + dy * ny + dz * nz; if (cr <= 0) continue;
          const ty = L.typ[l]; if (dz <= 0) continue; const g = ty === 0 ? dz / Math.PI : ty === 1 ? 0.15915494 : 1.5 * dz * dz / Math.PI;      // panel: Lambertian down; pendant / dome: uniform lower hemisphere; high bay: cos^2
          const lr = L.room[l], fl = J.rflux[lr]; if (fl <= 0) continue;
          const v = (L.w[l] / fl) * g * cr / d2; if (v < 1e-7) continue;
          trace(ox, oy, oz, dx, dy, dz, d - 0.02, 1); const T = rTr; if (T <= 0) continue;
          if (lr === room) art += v * T; else { if (forAcc[lr] === 0) touched[nT++] = lr; forAcc[lr] += v * T; }
        }
        for (let k = 0; k < nT; k++) { const r = touched[k]; if (forAcc[r] > bestV) { bestV = forAcc[r]; bestG = r; } forAcc[r] = 0; }
        const o9 = (t - t0) * 9; out[o9] = up; out[o9 + 1] = up; out[o9 + 2] = up; out[o9 + 3] = dn; out[o9 + 4] = art; out[o9 + 5] = art; out[o9 + 6] = art; out[o9 + 7] = bestV; out[o9 + 8] = bestG;
      }
    };

    /* ---- pass: one gather iteration. E: Float32Array(nt*7) [upRGB, down, artRGB] of the previous iteration; out (7 floats per texel): sum over rays of albedo * E(hit) / nRays ---- */
    K.passGather = function (id, t0, t1, E, out) {
      const J = jobs[id], H = J.hemiG, n = J.params.nGather, boxLo = J.boxLo, boxHi = J.boxHi;
      for (let t = t0; t < t1; t++) {
        const f = J.tFace[t], nx = J.fN[f * 3], ny = J.fN[f * 3 + 1], nz = J.fN[f * 3 + 2]; frame(nx, ny, nz, fr);
        const ox = J.P[t * 3] + nx * 0.003, oy = J.P[t * 3 + 1] + ny * 0.003, oz = J.P[t * 3 + 2] + nz * 0.003, ang = 6.283185307179586 * hash(t * 11 + 5), ca = Math.cos(ang), sa = Math.sin(ang), room = J.fRoom[f];
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0;
        for (let i = 0; i < n; i++) {
          const lx = H[i * 3] * ca - H[i * 3 + 1] * sa, ly = H[i * 3] * sa + H[i * 3 + 1] * ca, lz = H[i * 3 + 2];
          const dx = fr[0] * lx + fr[3] * ly + nx * lz, dy = fr[1] * lx + fr[4] * ly + ny * lz, dz = fr[2] * lx + fr[5] * ly + nz * lz;
          trace(ox, oy, oz, dx, dy, dz, INF, 0); const g = rBox; if (g < boxLo || g >= boxHi) continue;
          const hf = J.faceOf[(g - boxLo) * 6 + rFace]; if (hf < 0) continue;
          // hit texel: local coordinates of the hit point on the face
          const hp = rT, hx = ox + dx * hp, hy = oy + dy * hp, hz = oz + dz * hp, b = g * 16, k = rFace >> 1, a1i = (k + 1) % 3, a2i = (k + 2) % 3, qx = hx - D[b], qy = hy - D[b + 1], qz = hz - D[b + 2];
          const s1 = D[b + 3 + 3 * a1i] * qx + D[b + 4 + 3 * a1i] * qy + D[b + 5 + 3 * a1i] * qz, s2 = D[b + 3 + 3 * a2i] * qx + D[b + 4 + 3 * a2i] * qy + D[b + 5 + 3 * a2i] * qz;
          const h1 = D[b + 12 + a1i], h2 = D[b + 12 + a2i], nxf = J.fNx[hf], nyf = J.fNy[hf];
          let ti = ((s1 + h1) / (2 * h1) * nxf) | 0, tj = ((s2 + h2) / (2 * h2) * nyf) | 0; if (ti < 0) ti = 0; else if (ti >= nxf) ti = nxf - 1; if (tj < 0) tj = 0; else if (tj >= nyf) tj = nyf - 1;
          const th = J.fBase[hf] + tj * nxf + ti, e = th * 7, ar = J.fAlb[hf * 3], ag = J.fAlb[hf * 3 + 1], ab = J.fAlb[hf * 3 + 2];
          a0 += ar * E[e]; a1 += ag * E[e + 1]; a2 += ab * E[e + 2]; a3 += (ar + ag + ab) * 0.3333333 * E[e + 3];
          if (J.fRoom[hf] === room) { a4 += ar * E[e + 4]; a5 += ag * E[e + 5]; a6 += ab * E[e + 6]; }
        }
        const o7 = (t - t0) * 7, inv = 1 / n; out[o7] = a0 * inv; out[o7 + 1] = a1 * inv; out[o7 + 2] = a2 * inv; out[o7 + 3] = a3 * inv; out[o7 + 4] = a4 * inv; out[o7 + 5] = a5 * inv; out[o7 + 6] = a6 * inv;
      }
    };

    /* ---- smoothing of a per-texel 7-channel array inside every face (3x3, weights 1-2-1) ---- */
    K.smooth = function (id, A, nch, tmp) {
      const J = jobs[id]; const out = tmp || new Float32Array(A.length);
      for (let f = 0; f < J.nf; f++) {
        const nx = J.fNx[f], ny = J.fNy[f], base = J.fBase[f];
        if (nx * ny === 1) { for (let c = 0; c < nch; c++) out[base * nch + c] = A[base * nch + c]; continue; }
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const t = base + j * nx + i;
          for (let c = 0; c < nch; c++) {
            let s = 0, w = 0;
            for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= ny) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= nx) continue; const ww = (di ? 1 : 2) * (dj ? 1 : 2); s += ww * A[(base + jj * nx + ii) * nch + c]; w += ww; } }
            out[t * nch + c] = s / w;
          }
        }
      }
      return out;
    };

    /* ================================================================ worker protocol ================================================================ */
    K.onMessage = function (m, post) {
      switch (m.op) {
        case "scene": K.setScene(m.scene); post({ op: "ack", what: "scene", n: S.n, nodes: nNodes }); break;
        case "job": K.setJob(m.job); post({ op: "ack", what: "job", id: m.job.id }); break;
        case "drop": K.dropJob(m.id); post({ op: "ack", what: "drop", id: m.id }); break;
        case "E": jobs[m.id].E = m.E; post({ op: "ack", what: "E", id: m.id }); break;
        case "run": {
          const J = jobs[m.id], n = m.t1 - m.t0; let out;
          if (m.pass === "ao") { out = new Float32Array(n); K.passAO(m.id, m.t0, m.t1, out); }
          else if (m.pass === "direct") { out = new Float32Array(n * 9); K.passDirect(m.id, m.t0, m.t1, out); }
          else { out = new Float32Array(n * 7); K.passGather(m.id, m.t0, m.t1, J.E, out); }
          post({ op: "done", id: m.id, pass: m.pass, t0: m.t0, t1: m.t1, out, tag: m.tag }, [out.buffer]); break;
        }
      }
    };
    return K;
  }
  ES.lmKernel = lmKernel;
})();
