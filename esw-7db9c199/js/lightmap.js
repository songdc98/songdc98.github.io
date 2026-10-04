/* lightmap.js -> ES.lightmap: precomputed (baked in the browser, in Web Workers) interior lighting of the BIM buildings (interiors agent).
   Why in the browser: the BIM is regenerated often by other agents; a bake derived from the loaded BIM (content hash -> IndexedDB cache) can never be stale.
   Pipeline: layout (every interior face of every box gets an atlas rectangle; deterministic) -> geometry hook in bim3d.js (second UV set + room id attribute) -> workers trace the
   unit-source components (see lmkernel.js: UP sky, DOWN ground, ART own fixtures, FOR foreign fixtures) -> half-float atlas textures -> patched PBR materials sample them.
   Everything that depends on the lighting state (sky colour, fixture switches, sun bounce) is a uniform or a row of the small room-state texture, so switching is instantaneous.
   Docs: web/docs/interiors.md. Public API at the bottom (ES.lightmap.*). */
(function () {
  const ES = (window.ES = window.ES || {});
  const FL = { PHYS: 1, VIS: 2, NAV: 4, GLASS: 8, MOVABLE: 16, WALK: 32, DETAIL: 64 };
  const ELEM_LIGHT = 17, ATLAS_W = 2048, TEXEL = 0.25, BUDGET = 300000, BAKE_VERSION = 6;
  const lin1 = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = (ES.lightmap = ES.lightmap || {});
  L.version = BAKE_VERSION; L.on = !/[?&]lm=0/.test(location.search); L.ctx = null; L.verbose = false; L.stats = { layoutMs: 0, texels: 0, faces: 0, bakeMs: {}, state: "idle", done: 0, total: 0, stage: 0, patch: "none" };

  /* ================================================================ small helpers ================================================================ */
  const rotCols = (yaw, roll) => { const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll); return [cy, sy, 0, -sy * cr, cy * cr, sr, sy * sr, -cy * sr, cr]; };      // columns = world directions of the box axes
  /* pose of a box at its default door / window state: [cx, cy, cz, yaw, roll] */
  function poseOf(b, mov) {
    let cx = b[0], cy = b[1], cz = b[2], yaw = b[6];
    if (mov && mov.kind === "swing") { const a = mov.angle * (mov.open || 0), ca = Math.cos(a), sa = Math.sin(a), dx = cx - mov.pivot[0], dy = cy - mov.pivot[1]; cx = mov.pivot[0] + ca * dx - sa * dy; cy = mov.pivot[1] + sa * dx + ca * dy; yaw += a; }
    else if (mov && mov.kind === "slide_up") cz += mov.lift * (mov.open || 0);
    return [cx, cy, cz, yaw, b[7]];
  }
  const f32h = new Float32Array(1), u32h = new Uint32Array(f32h.buffer);
  function toHalf(v) {          // float32 -> float16 bits (round to nearest, denormals kept, saturates at 65504)
    f32h[0] = v; const x = u32h[0], sign = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
    if (e >= 31) return sign | 0x7bff; if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
    return sign | (e << 10) | ((m + 0x1000) >> 13);
  }
  function hashBuilding(B, mats) {       // content hash of everything the bake depends on (geometry, door states, rooms, lights, windows, material colours)
    let h = 2166136261 >>> 0; const mix = (v) => { h = Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0; };
    for (const b of B.boxes) for (let k = 0; k < 18; k++) if (k !== 17) mix(b[k]);
    for (const m of B.mov) if (m) { mix(m.open || 0); mix(m.angle || 0); mix(m.lift || 0); if (m.pivot) { mix(m.pivot[0]); mix(m.pivot[1]); } }
    for (const r of B.rooms) { mix(r.id); mix(r.z0); mix(r.z1); for (const p of r.poly) { mix(p[0]); mix(p[1]); } }
    for (const l of B.lights) { mix(l.pos[0]); mix(l.pos[1]); mix(l.pos[2]); mix(l.lm); mix(l.room); }
    for (const w of B.windows) { mix(w.s); mix(w.w); mix(w.z0); mix(w.z1); mix(w.open || 0); }
    for (const m of mats) { mix(m.rgb[0]); mix(m.rgb[1]); mix(m.rgb[2]); mix(m.trans); }
    return h.toString(16) + "-v" + BAKE_VERSION;
  }
  const nextFrame = () => new Promise((r) => (document.hidden ? setTimeout(r, 16) : requestAnimationFrame(() => r())));

  /* ================================================================ scene context (one per BIM json) ================================================================ */
  function ctxFor(bim) {
    if (L.ctx && L.ctx.bim === bim) return L.ctx;
    if (L.ctx) disposeCtx(L.ctx);
    const mats = bim.materials, matIdx = {}; mats.forEach((m, i) => { matIdx[m.name] = i; });
    const alb = new Float32Array(mats.length * 3); mats.forEach((m, i) => { alb[i * 3] = lin1(m.rgb[0]); alb[i * 3 + 1] = lin1(m.rgb[1]); alb[i * 3 + 2] = lin1(m.rgb[2]); });
    const c = { bim, mats, matIdx, alb, layouts: {}, order: [], rooms: [], nextRow: 1, atlas: null, nBoxes: 0, gen: 0, ready: false, baking: false, baked: {}, scene: null, kern: null };
    L.ctx = c; L.stats.layoutMs = 0; L.stats.texels = 0; L.stats.faces = 0; L.stats.state = "idle"; L.stats.bakeMs = {}; L.stats.stageMs = {}; L.stats.done = 0; L.stats.totalMs = 0; L.stats.firstMs = 0;
    const t0 = performance.now(); for (const id of Object.keys(bim.buildings)) layoutBuilding(c, bim.buildings[id], c.order.length); L.stats.layoutMs = performance.now() - t0;
    return c;
  }
  function disposeCtx(c) { c.gen++; if (c.atlas) for (const k of ["t0", "t1", "t2", "tao"]) if (c.atlas[k]) c.atlas[k].dispose(); if (c.roomTex) c.roomTex.dispose(); pool.reset(); }

  /* ================================================================ layout ================================================================
     One rectangle of coarse atlas texels per interior face: padded faces get a 1-texel replicated border (bilinear-safe), faces <= one texel are constants (all corner UVs at the texel centre). */
  function classifier(B) {
    const rooms = B.rooms.map((r, k) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of r.poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return { k, poly: r.poly, z0: r.z0, z1: r.z1, st: r.storey, x0, y0, x1, y1, fn: r.fn }; });
    const fp = B.meta.footprint, ne = fp.length, edges = [];
    let area2 = 0; for (let i = 0, j = ne - 1; i < ne; j = i++) area2 += fp[j][0] * fp[i][1] - fp[i][0] * fp[j][1];
    const sgn = area2 > 0 ? 1 : -1;                                                  // CCW -> outward normal is the right-hand side of travel
    for (let i = 0; i < ne; i++) { const a = fp[i], b = fp[(i + 1) % ne], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; edges.push([a[0], a[1], dx, dy, l, sgn * dy / l, -sgn * dx / l]); }
    const distPoly = (poly, x, y) => { let m = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); m = Math.min(m, Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y)); } return m; };
    /* returns the index of the room a face belongs to, or -1 (outdoor face). q = sample point 4 cm in front of the face, n = face normal */
    return function (qx, qy, qz, nx, ny) {
      for (const r of rooms) { if (qz < r.z0 - 0.12 || qz > r.z1 + 0.06 || qx < r.x0 || qx > r.x1 || qy < r.y0 || qy > r.y1) continue; if (ES.pip(r.poly, qx, qy)) return r.k; }
      // wall band / reveals / frames: inside the footprint and not facing outward
      if (!ES.pip(fp, qx, qy)) return -1;
      let bd = 1e9, bn = null; for (const e of edges) { const t = Math.max(0, Math.min(1, ((qx - e[0]) * e[2] + (qy - e[1]) * e[3]) / (e[4] * e[4]))), d = Math.hypot(e[0] + t * e[2] - qx, e[1] + t * e[3] - qy); if (d < bd) { bd = d; bn = e; } }
      if (!bn || bd > 0.6 || nx * bn[5] + ny * bn[6] > 0.5) return -1;
      let best = -1, bdr = 0.9; for (const r of rooms) { if (qz < r.z0 - 0.12 || qz > r.z1 + 0.06) continue; const d = distPoly(r.poly, qx, qy); if (d < bdr) { bdr = d; best = r.k; } }
      return best;
    };
  }
  function layoutBuilding(c, B, bi) {
    const boxes = B.boxes, nb = boxes.length, mats = c.mats, cls = classifier(B), roomBase = c.rooms.length;
    const lightsByRoom = {}; for (const l of B.lights) { const k = l.storey + ":" + l.room; (lightsByRoom[k] = lightsByRoom[k] || []).push(l); }
    B.rooms.forEach((r, k) => {
      const ls = lightsByRoom[r.storey + ":" + r.id] || [], flux = ls.reduce((a, l) => a + l.lm, 0), on = ls.length ? !!ls[0].on : false;
      c.rooms.push({ g: roomBase + k, bi, bid: B.id, k, id: r.id, storey: r.storey, name: r.name, fn: r.fn, z0: r.z0, z1: r.z1, poly: r.poly, area: r.area, floor: r.floor, flux, cct: ls.length ? ls[0].cct : 3500, nLights: ls.length, on0: on, on, type: ls.length ? ls[0].type : "none", wins: [], aSurf: 0, rho: 0.5, df0: 0, art0: 0 });
    });
    const F = { box: [], face: [], w: [], h: [], room: [] }, info = new Float32Array(nb * 6), faceInfo = new Int32Array(nb * 6).fill(-1), pose = new Array(nb);
    const roomIdx = {}; B.rooms.forEach((r, k) => { roomIdx[r.storey + ":" + r.id] = k; });
    for (let i = 0; i < nb; i++) {
      const b = boxes[i], fl = b[15]; pose[i] = poseOf(b, B.mov[i]); if (!(fl & FL.VIS)) continue;
      const [cx, cy, cz, yaw, roll] = pose[i], R = rotCols(yaw, roll), h = [b[3] / 2, b[4] / 2, b[5] / 2], isLight = b[14] === ELEM_LIGHT, isGlass = !!(fl & FL.GLASS);
      for (let f = 0; f < 6; f++) {
        if (!b[8 + f]) continue;
        const k = f >> 1, sg = f & 1 ? -1 : 1, nx = R[3 * k] * sg, ny = R[3 * k + 1] * sg, nz = R[3 * k + 2] * sg;
        const fx = cx + nx * h[k], fy = cy + ny * h[k], fz = cz + nz * h[k];
        if (isLight) { const rr = b[17] >= 0 ? roomIdx[b[16] + ":" + b[17]] : undefined; info[i * 6 + f] = rr !== undefined ? -(roomBase + rr + 1) : 0; continue; }
        const room = cls(fx + nx * 0.04, fy + ny * 0.04, fz + nz * 0.04, nx, ny);
        if (room < 0) continue;
        info[i * 6 + f] = roomBase + room + 1;
        if (isGlass) continue;                                                       // glass: only the room it faces (for its shading), no texels
        F.box.push(i); F.face.push(f); F.w.push(2 * h[(k + 1) % 3]); F.h.push(2 * h[(k + 2) % 3]); F.room.push(room);
      }
    }
    // texel size: keep the building within the texel budget
    const nf = F.box.length; let d = TEXEL, count = 0;
    const counts = (dd) => { let t = 0; for (let q = 0; q < nf; q++) { const nx = Math.max(1, Math.ceil(F.w[q] / dd - 1e-6)), ny = Math.max(1, Math.ceil(F.h[q] / dd - 1e-6)); t += nx >= 4 && ny >= 4 ? (nx + 2) * (ny + 2) : nx * ny; } return t; };
    for (let it = 0; it < 4; it++) { count = counts(d); if (count <= BUDGET) break; d *= Math.sqrt(count / BUDGET) * 1.02; }
    const fNx = new Uint16Array(nf), fNy = new Uint16Array(nf), fPad = new Uint8Array(nf), pw = new Int32Array(nf), ph = new Int32Array(nf);
    // faces >= 4x4 texels get a replicated 1-texel border (exact texel-edge mapping); smaller ones (strips, constants) are inset by half a texel instead (no border, <= half a texel of positional error)
    for (let q = 0; q < nf; q++) { const nx = Math.min(4000, Math.max(1, Math.ceil(F.w[q] / d - 1e-6))), ny = Math.min(4000, Math.max(1, Math.ceil(F.h[q] / d - 1e-6))); fNx[q] = nx; fNy[q] = ny; fPad[q] = nx >= 4 && ny >= 4 ? 1 : 0; pw[q] = fPad[q] ? nx + 2 : nx; ph[q] = fPad[q] ? ny + 2 : ny; }
    // shelf packing (tallest first)
    const ord = Array.from({ length: nf }, (_, q) => q).sort((a, b) => ph[b] - ph[a] || pw[b] - pw[a] || a - b), fX = new Int32Array(nf), fY = new Int32Array(nf);
    let cx = 0, cy = 0, shelf = 0;
    for (const q of ord) { if (cx + pw[q] > ATLAS_W) { cx = 0; cy += shelf; shelf = 0; } fX[q] = cx; fY[q] = cy; cx += pw[q]; if (ph[q] > shelf) shelf = ph[q]; }
    const rows = cy + shelf, fBase = new Int32Array(nf), fArea = new Float32Array(nf), fNz = new Float32Array(nf); let nt = 0; for (let q = 0; q < nf; q++) { fBase[q] = nt; nt += fNx[q] * fNy[q]; fArea[q] = F.w[q] * F.h[q]; const bq = boxes[F.box[q]], R = rotCols(pose[F.box[q]][3], pose[F.box[q]][4]), kk = F.face[q] >> 1; fNz[q] = R[3 * kk + 2] * (F.face[q] & 1 ? -1 : 1); }
    const lay = { bi, bid: B.id, B, d, nf, nt, rows, y0: c.nextRow, roomBase, nRooms: B.rooms.length, boxLo: c.nBoxes, nBoxes: nb, fBox: Int32Array.from(F.box), fFace: Uint8Array.from(F.face), fNx, fNy, fPad, fX, fY, fBase, fArea, fNz, fRoom: Int16Array.from(F.room), info, pose, faceInfo, hash: null };
    for (let q = 0; q < nf; q++) faceInfo[F.box[q] * 6 + F.face[q]] = q;
    c.nextRow += rows; c.nBoxes += nb; c.layouts[B.id] = lay; c.order.push(B.id);
    L.stats.faces += nf; L.stats.texels += nt;
    roomStats(c, B, lay);
    return lay;
  }
  /* per-room totals needed by the fallback and the sun-bounce term: surface area, mean albedo, window area; windows and exterior doors become sky portals */
  function roomStats(c, B, lay) {
    const mats = c.mats, boxes = B.boxes, R = c.rooms.slice(lay.roomBase, lay.roomBase + lay.nRooms), sumA = new Float64Array(R.length), sumRA = new Float64Array(R.length), sumC = new Float64Array(R.length * 3);
    for (let q = 0; q < lay.nf; q++) { const b = boxes[lay.fBox[q]], f = lay.fFace[q], k = lay.fRoom[q], a = lay.fArea[q], m = b[8 + f]; sumA[k] += a; sumRA[k] += a * (c.alb[m * 3] + c.alb[m * 3 + 1] + c.alb[m * 3 + 2]) / 3; for (let j = 0; j < 3; j++) sumC[k * 3 + j] += a * c.alb[m * 3 + j]; }
    R.forEach((r, k) => { r.aSurf = sumA[k]; r.rho = sumA[k] > 0 ? sumRA[k] / sumA[k] : 0.5; r.rhoRGB = sumA[k] > 0 ? [sumC[k * 3] / sumA[k], sumC[k * 3 + 1] / sumA[k], sumC[k * 3 + 2] / sumA[k]] : [0.5, 0.5, 0.5]; });
    lay.portals = []; const gl = mats.find((m) => m.name === "glass"), roomIdx = {}; B.rooms.forEach((r, k) => { roomIdx[r.storey + ":" + r.id] = k; });
    for (const w of B.windows) {
      const nO = [w.normal[0], w.normal[1], 0], ww = Math.max(0.1, w.w - 0.11), hh = Math.max(0.1, w.z1 - w.z0 - 0.11), open = w.open || 0, T = w.type === "frosted" ? 0.35 : (gl ? gl.trans : 0.85);
      lay.portals.push({ c: [w.pos[0], w.pos[1], (w.z0 + w.z1) / 2], n: nO, u: [-nO[1], nO[0], 0], v: [0, 0, 1], hw: ww / 2, hh: hh / 2, T, open, room: roomIdx[w.storey + ":" + w.room] ?? -1, id: w.id });
    }
    for (const d of B.doors) {
      if (!d.exterior || d.kind === "opening" || d.kind === "open") continue;
      const glassy = d.kind === "glass_double", open = d.open || 0; if (!glassy && open < 0.02) continue;
      const nO = [-d.normal[0], -d.normal[1], 0], wd = d.width - 0.1, ht = d.height - 0.1;
      lay.portals.push({ c: [d.pos[0], d.pos[1], d.z + d.height / 2], n: nO, u: [-nO[1], nO[0], 0], v: [0, 0, 1], hw: wd / 2, hh: ht / 2, T: glassy ? 0.85 : 1, open, room: roomIdx[d.storey + ":" + d.rooms[0]] ?? -1, id: d.id });
    }
    for (const p of lay.portals) if (p.room >= 0) R[p.room].wins.push(p);
    // fallback values: split-flux daylight factor (BRE) and integrating-sphere light per lumen
    R.forEach((r) => { const aw = r.wins.reduce((a, p) => a + 4 * p.hw * p.hh * p.T, 0), A = Math.max(1, r.aSurf); r.df0 = Math.min(0.12, (aw * 60 / (A * (1 - r.rho * r.rho))) / 100); r.art0 = 1 / (A * (1 - r.rho)); });
  }
  L.layout = (bim, B) => { const c = ctxFor(bim); return c.layouts[B.id]; };

  /* ================================================================ geometry hook for bim3d.js ================================================================ */
  ES.bim = ES.bim || {};
  ES.bim.hook = {
    begin(B, mats, bim) {
      bim = bim || ES.app.bim; if (!L.on || !bim || !B.rooms || !bim.materials) return null; const c = ctxFor(bim), lay = c.layouts[B.id]; if (!lay) return null;
      const lightOff = c.matIdx.light_off, lightOn = c.matIdx.light, uv = new Float32Array(8);
      return {
        lay, face(i, f, m) {
          const info = lay.info[i * 6 + f], q = lay.faceInfo[i * 6 + f]; let mm = m;
          if (info < 0 && m === lightOn && lightOff !== undefined) mm = lightOff;     // every fixture shares the 'off' material; the room switch drives its emission in the shader
          if (q < 0) return { m: mm, info, uv: null };
          const nx = lay.fNx[q], ny = lay.fNy[q], X = lay.fX[q], Y = lay.y0 + lay.fY[q];
          let u0, u1, v0, v1;
          if (lay.fPad[q]) { u0 = X + 1; u1 = X + 1 + nx; v0 = Y + 1; v1 = Y + 1 + ny; } else { u0 = X + 0.5; u1 = X + nx - 0.5; v0 = Y + 0.5; v1 = Y + ny - 0.5; }
          uv[0] = u0; uv[1] = v0; uv[2] = u1; uv[3] = v0; uv[4] = u1; uv[5] = v1; uv[6] = u0; uv[7] = v1;
          return { m: mm, info, uv };
        },
      };
    },
  };

  /* ================================================================ shader patch ================================================================ */
  const U = (L.U = {});
  function initUniforms() {
    if (U.lmT0) return;
    Object.assign(U, { lmT0: { value: null }, lmT1: { value: null }, lmT2: { value: null }, lmAO: { value: null }, lmRooms: { value: null }, lmInvSize: { value: new THREE.Vector2(1 / ATLAS_W, 1 / 4096) },
      lmSkyUp: { value: new THREE.Vector3(1, 1, 1) }, lmSkyDown: { value: new THREE.Vector3(0.1, 0.1, 0.1) }, lmOn: { value: 1 }, lmSpec: { value: 0.6 }, lmAOk: { value: 1 }, lmDbg: { value: 0 } });
  }
  const GLSL_PARS = `
uniform highp sampler2D lmT0; uniform highp sampler2D lmT1; uniform highp sampler2D lmT2; uniform highp sampler2D lmAO; uniform highp sampler2D lmRooms;
uniform vec3 lmSkyUp; uniform vec3 lmSkyDown; uniform float lmOn; uniform float lmSpec; uniform float lmAOk; uniform int lmDbg;
varying vec2 vLmUv; varying float vLmInfo;
// interior irradiance (renderer units: outgoing radiance = albedo * E / PI) of the baked components at this fragment; emis = fixture emission of the room (for fixture faces)
vec3 lmEval( out vec3 emis ) {
  emis = vec3( 0.0 ); int room = int( abs( vLmInfo ) + 0.5 ) - 1;
  if ( vLmInfo < 0.0 ) {                                                // fixture faces: no texels, lit by the room mean (row 3: mean sky factor, mean fixture factor)
    vec4 m = texelFetch( lmRooms, ivec2( room, 3 ), 0 ); emis = texelFetch( lmRooms, ivec2( room, 2 ), 0 ).rgb;
    return lmSkyUp * m.x + texelFetch( lmRooms, ivec2( room, 0 ), 0 ).rgb * m.y + texelFetch( lmRooms, ivec2( room, 1 ), 0 ).rgb;
  }
  vec4 t0 = texture2D( lmT0, vLmUv ); vec4 t1 = texture2D( lmT1, vLmUv ); vec4 t2 = texture2D( lmT2, vLmUv );
  float ao = mix( 1.0, texture2D( lmAO, vLmUv ).r, lmAOk );
  vec3 E = lmSkyUp * t0.rgb + lmSkyDown * t0.a;
  E += t1.rgb * texelFetch( lmRooms, ivec2( room, 0 ), 0 ).rgb;
  int g = int( t2.x + 0.5 ); if ( g >= 0 && t1.a > 0.0 ) E += t1.a * texelFetch( lmRooms, ivec2( g, 0 ), 0 ).rgb;
  E += texelFetch( lmRooms, ivec2( room, 1 ), 0 ).rgb * t2.y;
  emis = texelFetch( lmRooms, ivec2( room, 2 ), 0 ).rgb;
  return E * ao;
}`;
  function patchShader(shader, mat) {
    initUniforms(); Object.assign(shader.uniforms, U);
    const vs0 = shader.vertexShader, fs0 = shader.fragmentShader;
    shader.vertexShader = vs0
      .replace("#include <common>", "#include <common>\nattribute vec2 lmUv; attribute float lmInfo; uniform vec2 lmInvSize; varying vec2 vLmUv; varying float vLmInfo;")
      .replace("#include <uv2_vertex>", "#include <uv2_vertex>\n vLmUv = lmUv * lmInvSize; vLmInfo = lmInfo;");
    const lfb = THREE.ShaderChunk.lights_fragment_begin
      .replace("getPointDirectLightIrradiance( pointLight, geometry, directLight );", "getPointDirectLightIrradiance( pointLight, geometry, directLight ); directLight.color *= lmOutW;")
      .replace("getSpotDirectLightIrradiance( spotLight, geometry, directLight );", "getSpotDirectLightIrradiance( spotLight, geometry, directLight ); directLight.color *= lmOutW;");
    const after = `
#if defined( RE_IndirectDiffuse )
  if ( lmIn > 0.5 ) { irradiance = lmE; iblIrradiance = vec3( 0.0 ); }
#endif
#if defined( RE_IndirectSpecular )
  if ( lmIn > 0.5 ) { radiance = lmE * RECIPROCAL_PI * lmSpec; clearcoatRadiance = vec3( 0.0 ); }
#endif`;
    shader.fragmentShader = fs0
      .replace("#include <common>", "#include <common>\n" + GLSL_PARS)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n float lmIn = ( lmOn > 0.5 && abs( vLmInfo ) > 0.5 ) ? 1.0 : 0.0; float lmOutW = 1.0 - lmIn; vec3 lmEm = vec3( 0.0 ); vec3 lmE = vec3( 0.0 ); if ( lmIn > 0.5 ) { lmE = lmEval( lmEm ); if ( vLmInfo < 0.0 ) totalEmissiveRadiance += lmEm; }")
      .replace("#include <lights_fragment_begin>", lfb)
      .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n" + after);
    const ok = shader.fragmentShader.includes("lmEval( lmEm )") && shader.fragmentShader.includes("irradiance = lmE") && shader.fragmentShader.includes("directLight.color *= lmOutW") && shader.vertexShader.includes("vLmInfo = lmInfo");
    L.stats.patch = ok ? "ok" : "FAILED (anchor chunks missing: another module replaced them)"; if (!ok) console.warn("[lightmap] shader patch incomplete", mat.name || "");
  }
  /* wraps onBeforeCompile of every PBR material of a BIM material table (keeps whatever another module installed) */
  L.patchMaterials = function (mats) {
    if (!window.THREE || !L.on) return; initUniforms();
    for (const m of mats) {
      if (!m || !m.isMeshStandardMaterial || m.userData.lmDone || m.userData.glass) continue;
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null; m.userData.lmDone = true;
      m.onBeforeCompile = function (shader, renderer) { if (prev) prev.call(m, shader, renderer); patchShader(shader, m); };
      m.customProgramCacheKey = function () { return "lm4|" + (prevKey ? prevKey() : prev ? prev.toString() : ""); };
      m.needsUpdate = true;
    }
  };

  /* ================================================================ atlas textures ================================================================ */
  function makeAtlas(c) {
    if (c.atlas) return c.atlas; initUniforms();
    const H = Math.max(8, c.nextRow + 1), W = ATLAS_W, n = W * H;
    const a = { W, H, d0: new Uint16Array(n * 4), d1: new Uint16Array(n * 4), d2: new Uint16Array(n * 4), ao: new Uint8Array(n * 4).fill(255) };
    const mk = (data, w, h, fmt, type) => { const t = new THREE.DataTexture(data, w, h, fmt, type); t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
    a.t0 = mk(a.d0, W, H, THREE.RGBAFormat, THREE.HalfFloatType); a.t1 = mk(a.d1, W, H, THREE.RGBAFormat, THREE.HalfFloatType); a.t2 = mk(a.d2, W, H, THREE.RGBAFormat, THREE.HalfFloatType); a.tao = mk(a.ao, W * 2, H * 2, THREE.RedFormat, THREE.UnsignedByteType);
    c.atlas = a; fillFallback(c); return a;
  }
  /* analytic stand-in (before / without the bake): per-room daylight factor and integrating-sphere light, constant over the room */
  function fillFallback(c) {
    const a = c.atlas, one = toHalf(1), neg = toHalf(-1);
    for (const id of c.order) {
      const lay = c.layouts[id];
      for (let q = 0; q < lay.nf; q++) {
        const r = c.rooms[lay.roomBase + lay.fRoom[q]], up = toHalf(r.df0), art = toHalf(r.art0 * 0.8), nx = lay.fNx[q], ny = lay.fNy[q], pad = lay.fPad[q];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const p = ((lay.y0 + lay.fY[q] + pad + j) * a.W + lay.fX[q] + pad + i) * 4; a.d0[p] = a.d0[p + 1] = a.d0[p + 2] = up; a.d1[p] = a.d1[p + 1] = a.d1[p + 2] = art; a.d2[p] = neg; a.d2[p + 1] = one; }
        padFace(a, lay, q);
      }
    }
  }
  /* area-weighted mean sky factor and fixture factor of every room (used for fixture faces and the eye model) */
  function roomMeans(c, lay, E) {
    const nr = lay.nRooms, sA = new Float64Array(nr), sU = new Float64Array(nr), sT = new Float64Array(nr);
    for (let q = 0; q < lay.nf; q++) { const r = lay.fRoom[q], a = lay.fArea[q], nxn = lay.fNx[q] * lay.fNy[q]; let u = 0, t = 0; for (let i = lay.fBase[q], e = i + nxn; i < e; i++) { u += (E[i * 7] + E[i * 7 + 1] + E[i * 7 + 2]) / 3; t += (E[i * 7 + 4] + E[i * 7 + 5] + E[i * 7 + 6]) / 3; } sA[r] += a; sU[r] += a * u / nxn; sT[r] += a * t / nxn; }
    for (let k = 0; k < nr; k++) { const R = c.rooms[lay.roomBase + k]; if (sA[k] > 0) { R.mUp = sU[k] / sA[k]; R.mArt = sT[k] / sA[k]; } L.setRoom(R.g, 3, R.mUp !== undefined ? R.mUp : R.df0, R.mArt !== undefined ? R.mArt : R.art0 * 0.8, 0); }
  }
  function padFace(a, lay, q) {
    if (!lay.fPad[q]) return; const nx = lay.fNx[q], ny = lay.fNy[q], X = lay.fX[q], Y = lay.y0 + lay.fY[q], W = a.W;
    for (const buf of [a.d0, a.d1, a.d2]) {
      const cp = (dx, dy, sx, sy) => { const s = ((Y + sy) * W + X + sx) * 4, d = ((Y + dy) * W + X + dx) * 4; buf[d] = buf[s]; buf[d + 1] = buf[s + 1]; buf[d + 2] = buf[s + 2]; buf[d + 3] = buf[s + 3]; };
      for (let i = 1; i <= nx; i++) { cp(i, 0, i, 1); cp(i, ny + 1, i, ny); }
      for (let j = 0; j <= ny + 1; j++) { cp(0, j, 1, j); cp(nx + 1, j, nx, j); }
    }
    const A2 = a.ao, W2 = W * 2, cpa = (dx, dy, sx, sy) => { A2[(2 * Y + dy) * W2 + 2 * X + dx] = A2[(2 * Y + sy) * W2 + 2 * X + sx]; };      // AO texture has twice the resolution: 2 fine texels per coarse one
    for (let i = 2; i <= 2 * nx + 1; i++) { cpa(i, 0, i, 2); cpa(i, 1, i, 2); cpa(i, 2 * ny + 2, i, 2 * ny + 1); cpa(i, 2 * ny + 3, i, 2 * ny + 1); }
    for (let j = 0; j <= 2 * ny + 3; j++) { cpa(0, j, 2, j); cpa(1, j, 2, j); cpa(2 * nx + 2, j, 2 * nx + 1, j); cpa(2 * nx + 3, j, 2 * nx + 1, j); }
  }
  function makeRoomTexture(c) {
    if (c.roomTex) return; const n = Math.max(1, c.rooms.length), data = new Float32Array(n * 4 * 4), t = new THREE.DataTexture(data, n, 4, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true; c.roomTex = t; c.roomData = data;
    for (const r of c.rooms) { const o = (3 * n + r.g) * 4; data[o] = r.df0; data[o + 1] = r.art0 * 0.8; }          // analytic stand-ins until the bake has run
  }
  /* row 0: fixtures (rgb = flux-scaled light colour of the room), row 1: sun-bounce ambient (rgb), row 2: fixture emission (rgb) */
  L.setRoom = function (g, row, r, g_, b) { const c = L.ctx; if (!c || !c.roomData) return; const o = (row * c.rooms.length + g) * 4; c.roomData[o] = r; c.roomData[o + 1] = g_; c.roomData[o + 2] = b; c.roomTexDirty = true; };
  L.flush = function () { const c = L.ctx; if (c && c.roomTexDirty) { c.roomTex.needsUpdate = true; c.roomTexDirty = false; } };

  /* ================================================================ scene hook: allocate, bind, bake ================================================================ */
  ES.bus.on("scene:built", (V) => {
    if (!L.on || !L.ctx) return; const c = L.ctx; c.V = V; initUniforms(); makeAtlas(c); makeRoomTexture(c);
    U.lmT0.value = c.atlas.t0; U.lmT1.value = c.atlas.t1; U.lmT2.value = c.atlas.t2; U.lmAO.value = c.atlas.tao; U.lmRooms.value = c.roomTex; U.lmInvSize.value.set(1 / c.atlas.W, 1 / c.atlas.H);
    ES.bus.emit("lightmap:layout", c);
    if (!c.baking) startBake(c);
  });

  /* ================================================================ kernel scene (all boxes, default pose) ================================================================ */
  function kernelScene(c) {
    const n = c.nBoxes, D = new Float32Array(n * 16), cls = new Uint8Array(n), tr = new Float32Array(n), mat = new Int16Array(n * 6), bld = new Int16Array(n);
    c.order.forEach((id, oi) => {
      const lay = c.layouts[id], B = lay.B;
      for (let i = 0; i < lay.nBoxes; i++) {
        const b = B.boxes[i], g = lay.boxLo + i, o = g * 16, p = lay.pose[i], R = rotCols(p[3], p[4]);
        D[o] = p[0]; D[o + 1] = p[1]; D[o + 2] = p[2]; for (let k = 0; k < 9; k++) D[o + 3 + k] = R[k]; D[o + 12] = b[3] / 2; D[o + 13] = b[4] / 2; D[o + 14] = b[5] / 2; bld[g] = oi;
        for (let f = 0; f < 6; f++) mat[g * 6 + f] = b[8 + f];
        const fl = b[15]; let m0 = 0; for (let f = 0; f < 6; f++) if (b[8 + f]) { m0 = b[8 + f]; break; }
        if (!(fl & FL.VIS) || b[14] === ELEM_LIGHT || !m0) cls[g] = 3;
        else if (fl & FL.GLASS) { cls[g] = 1; tr[g] = c.mats[m0].trans || 0.85; }
        else if ((c.mats[m0].trans || 0) > 0 && c.mats[m0].trans < 0.6) { cls[g] = 2; tr[g] = c.mats[m0].trans; }
        else cls[g] = 0;
      }
    });
    return { n, D, cls, tr, mat, alb: c.alb, bld };
  }

  /* ================================================================ worker pool ================================================================ */
  function workerSource() { return "const K = (" + ES.lmKernel.toString() + ")(); onmessage = (e) => K.onMessage(e.data, (m, tr) => postMessage(m, tr || []));"; }
  const pool = (L.pool = {
    workers: [], waiters: [], blob: null,
    start() {
      if (this.workers.length) return; const n = L.nWorkers || Math.max(2, Math.min(12, (navigator.hardwareConcurrency || 4) - 3));
      this.blob = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
      for (let i = 0; i < n; i++) { const w = new Worker(this.blob); w.busy = false; w.onmessage = (e) => { const cb = w.cb; w.cb = null; w.busy = false; if (cb) cb(e.data); this.pump(); }; w.onerror = (e) => console.warn("[lightmap] worker error", e.message); this.workers.push(w); }
    },
    reset() { for (const w of this.workers) { w.cb = null; w.terminate(); } this.workers = []; this.waiters = []; if (this.blob) URL.revokeObjectURL(this.blob); this.blob = null; },
    run(msg, transfer) { return new Promise((res) => { this.waiters.push({ msg, transfer, res }); this.pump(); }); },
    pump() { for (const w of this.workers) { if (w.busy || !this.waiters.length) continue; const j = this.waiters.shift(); w.busy = true; w.cb = j.res; w.postMessage(j.msg, j.transfer || []); } },
    broadcast(makeMsg) { return Promise.all(this.workers.map((w) => new Promise((res) => { const go = () => { if (w.busy) { setTimeout(go, 2); return; } w.busy = true; w.cb = res; w.postMessage(makeMsg()); }; go(); }))); },
  });

  /* ================================================================ bake orchestration ================================================================ */
  function buildJob(c, lay, id) {
    const B = lay.B, nr = lay.nRooms, rooms = c.rooms.slice(lay.roomBase, lay.roomBase + nr), nf = lay.nf, roomIdx = {}; B.rooms.forEach((r, k) => { roomIdx[r.storey + ":" + r.id] = k; });
    const fAlb = new Float32Array(nf * 3), fBox = new Int32Array(nf);
    for (let q = 0; q < nf; q++) { const m = B.boxes[lay.fBox[q]][8 + lay.fFace[q]]; fAlb[q * 3] = c.alb[m * 3]; fAlb[q * 3 + 1] = c.alb[m * 3 + 1]; fAlb[q * 3 + 2] = c.alb[m * 3 + 2]; fBox[q] = lay.boxLo + lay.fBox[q]; }
    // fixtures: emission point = bottom centre of the light box near the BIM position (falls back to the BIM position)
    const lbox = []; B.boxes.forEach((b, i) => { if (b[14] === ELEM_LIGHT && (b[15] & FL.VIS)) lbox.push(i); });
    const ls = B.lights, nl = ls.length, pos = new Float32Array(nl * 3), w = new Float32Array(nl), typ = new Uint8Array(nl), room = new Int16Array(nl), rflux = new Float32Array(nr), rbox = new Float32Array(nr * 6);
    ls.forEach((l, i) => {
      let best = -1, bd = 0.35; for (const bi of lbox) { const b = B.boxes[bi], d = Math.hypot(b[0] - l.pos[0], b[1] - l.pos[1], b[2] - l.pos[2]); if (d < bd) { bd = d; best = bi; } }
      if (best >= 0) { const b = B.boxes[best]; pos[i * 3] = b[0]; pos[i * 3 + 1] = b[1]; pos[i * 3 + 2] = b[2] - b[5] / 2 - 0.01; } else { pos[i * 3] = l.pos[0]; pos[i * 3 + 1] = l.pos[1]; pos[i * 3 + 2] = l.pos[2] - 0.05; }
      w[i] = l.lm; typ[i] = l.type === "panel" ? 0 : l.type === "highbay" ? 2 : 1; const rr = roomIdx[l.storey + ":" + l.room] ?? -1; room[i] = rr; if (rr >= 0) rflux[rr] += l.lm;
    });
    rooms.forEach((r, k) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of r.poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } rbox.set([x0, y0, r.z0, x1, y1, r.z1], k * 6); });
    const portals = [], pRoom = new Int16Array(lay.portals.length); lay.portals.forEach((p, i) => { portals.push(...p.c, ...p.n, ...p.u, ...p.v, p.hw, p.hh, p.T, p.open); pRoom[i] = p.room; });
    return { id, pRoom, boxLo: lay.boxLo, boxHi: lay.boxLo + lay.nBoxes, nf, fBox, fFace: lay.fFace, fNx: lay.fNx, fNy: lay.fNy, fBase: lay.fBase, fRoom: lay.fRoom, fAlb, nt: lay.nt, nr, lights: { n: nl, pos, w, typ, room }, rflux, rbox, portals: Float32Array.from(portals), np: lay.portals.length, params: { nAO: 12, nGather: 24, rAO: 0.8 } };
  }
  function smoothLay(lay, A, nch) {             // 3x3 (1-2-1) smoothing of a per-texel array inside every face
    const out = new Float32Array(A.length);
    for (let f = 0; f < lay.nf; f++) {
      const nx = lay.fNx[f], ny = lay.fNy[f], base = lay.fBase[f];
      if (nx * ny === 1) { for (let c = 0; c < nch; c++) out[base * nch + c] = A[base * nch + c]; continue; }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const t = base + j * nx + i;
        for (let c = 0; c < nch; c++) { let s = 0, w = 0; for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= ny) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= nx) continue; const ww = (di ? 1 : 2) * (dj ? 1 : 2); s += ww * A[(base + jj * nx + ii) * nch + c]; w += ww; } } out[t * nch + c] = s / w; }
      }
    }
    return out;
  }
  let jobSeq = 0;
  async function bakeBuilding(c, lay, gen) {
    const t0 = performance.now(), id = ++jobSeq, job = buildJob(c, lay, id), nt = lay.nt, CH = 2048;
    const chunks = []; for (let t = 0; t < nt; t += CH) chunks.push([t, Math.min(nt, t + CH)]);
    await pool.broadcast(() => ({ op: "job", job })); if (c.gen !== gen) return null;
    const AO = new Float32Array(nt), DIR = new Float32Array(nt * 9);
    const runPass = async (pass, outArr, stride) => { let next = 0; const lanes = []; for (let w = 0; w < pool.workers.length; w++) lanes.push((async () => { while (next < chunks.length && c.gen === gen) { const [a, b] = chunks[next++]; const r = await pool.run({ op: "run", id, pass, t0: a, t1: b }); outArr.set(r.out, a * stride); } })()); await Promise.all(lanes); };
    const tm = (L.stats.stageMs = L.stats.stageMs || {}), mark = (k) => { tm[lay.bid + ":" + k] = Math.round(performance.now() - t0); };
    await runPass("ao", AO, 1); mark("ao"); await runPass("direct", DIR, 9); mark("direct"); if (c.gen !== gen) return null;
    const Dd = new Float32Array(nt * 7); for (let t = 0; t < nt; t++) for (let k = 0; k < 7; k++) Dd[t * 7 + k] = DIR[t * 9 + k];
    const res = { AO, DIR, E: Dd.slice() }; await apply(c, lay, res, 0, gen);
    const K = 3; let E = Dd.slice(); const hist = [E];
    for (let k = 1; k <= K; k++) {
      await pool.broadcast(() => ({ op: "E", id, E: E.slice() })); if (c.gen !== gen) return null;
      const G = new Float32Array(nt * 7); await runPass("gather", G, 7); mark("g" + k);
      const Gs = smoothLay(lay, G, 7); E = new Float32Array(nt * 7); for (let i = 0; i < nt * 7; i++) E[i] = Dd[i] + Gs[i]; hist.push(E);
      if (k === 1) { res.E = E; await apply(c, lay, res, k, gen); }
    }
    res.E = tail(c, lay, hist); roomMeans(c, lay, res.E); await apply(c, lay, res, 99, gen); await pool.broadcast(() => ({ op: "drop", id }));
    L.stats.bakeMs[lay.bid] = performance.now() - t0; return res;
  }
  /* geometric tail of the remaining bounces: per room, ratio r of the last two increments (measured on texel-averaged values), tail = dE_K * r / (1 - r) */
  function tail(c, lay, hist) {
    const n = hist.length, E3 = hist[n - 1], E2 = hist[n - 2], E1 = hist[n - 3], nr = lay.nRooms, s1 = new Float64Array(nr * 2), s2 = new Float64Array(nr * 2);
    for (let q = 0; q < lay.nf; q++) { const r = lay.fRoom[q]; for (let i = lay.fBase[q], e = i + lay.fNx[q] * lay.fNy[q]; i < e; i++) { const o = i * 7; s1[r * 2] += E2[o] + E2[o + 1] + E2[o + 2] - E1[o] - E1[o + 1] - E1[o + 2]; s2[r * 2] += E3[o] + E3[o + 1] + E3[o + 2] - E2[o] - E2[o + 1] - E2[o + 2]; s1[r * 2 + 1] += E2[o + 4] + E2[o + 5] + E2[o + 6] - E1[o + 4] - E1[o + 5] - E1[o + 6]; s2[r * 2 + 1] += E3[o + 4] + E3[o + 5] + E3[o + 6] - E2[o + 4] - E2[o + 5] - E2[o + 6]; } }
    const ratio = new Float32Array(nr * 2); for (let k = 0; k < nr * 2; k++) ratio[k] = s1[k] > 1e-9 ? Math.max(0, Math.min(0.9, s2[k] / s1[k])) : 0;
    const out = new Float32Array(E3.length);
    for (let q = 0; q < lay.nf; q++) { const r = lay.fRoom[q], su = ratio[r * 2] / (1 - ratio[r * 2]), sa = ratio[r * 2 + 1] / (1 - ratio[r * 2 + 1]); for (let i = lay.fBase[q], e = i + lay.fNx[q] * lay.fNy[q]; i < e; i++) for (let k = 0; k < 7; k++) { const o = i * 7 + k; out[o] = E3[o] + (E3[o] - E2[o]) * (k >= 4 ? sa : su); } }
    return out;
  }
  /* write the (partial) result of a building into the atlas arrays (time-sliced so that frames are not dropped) and mark the textures */
  async function apply(c, lay, res, stage, gen) {
    const a = c.atlas; if (!a) return; const E = res.E, DIR = res.DIR, AO = res.AO, W = a.W, W2 = W * 2, rb = lay.roomBase; let tStart = performance.now();
    for (let q = 0; q < lay.nf; q++) {
      const nx = lay.fNx[q], ny = lay.fNy[q], X = lay.fX[q], Y = lay.y0 + lay.fY[q], pad = lay.fPad[q], base = lay.fBase[q];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const t = base + j * nx + i, e = t * 7, p = ((Y + pad + j) * W + X + pad + i) * 4;
        a.d0[p] = toHalf(E[e]); a.d0[p + 1] = toHalf(E[e + 1]); a.d0[p + 2] = toHalf(E[e + 2]); a.d0[p + 3] = toHalf(E[e + 3]);
        a.d1[p] = toHalf(E[e + 4]); a.d1[p + 1] = toHalf(E[e + 5]); a.d1[p + 2] = toHalf(E[e + 6]); a.d1[p + 3] = toHalf(DIR[t * 9 + 7]);
        const gid = DIR[t * 9 + 8]; a.d2[p] = toHalf(gid >= 0 ? rb + gid : -1); a.d2[p + 1] = toHalf(1); a.d2[p + 2] = 0; a.d2[p + 3] = 0;
        const v = Math.max(0, Math.min(255, Math.round(AO[t] * 255))), pp = (2 * (Y + pad + j)) * W2 + 2 * (X + pad + i);
        a.ao[pp] = v; a.ao[pp + 1] = v; a.ao[pp + W2] = v; a.ao[pp + W2 + 1] = v;
      }
      padFace(a, lay, q);
      if ((q & 63) === 63 && performance.now() - tStart > 6) { await nextFrame(); tStart = performance.now(); if (c.gen !== gen) return; }
    }
    for (const k of ["t0", "t1", "t2", "tao"]) a[k].needsUpdate = true;
    L.stats.stage = stage; ES.bus.emit("lightmap:update", c, lay, stage);
  }
  async function startBake(c) {
    if (!window.Worker || !ES.lmKernel) { L.stats.state = "fallback"; return; }
    c.baking = true; const gen = c.gen; c.scene = kernelScene(c); pool.start(); L.stats.state = "baking"; L.stats.total = c.order.length; L.stats.done = 0; const t0 = performance.now();
    await pool.broadcast(() => ({ op: "scene", scene: c.scene })); if (c.gen !== gen) return;
    const focus = (c.V && c.V.cam) ? [c.V.cam.position.x, -c.V.cam.position.z] : [0, 0];            // nearest building first
    const mid = (id) => { const b = c.layouts[id].B.bounds; return Math.hypot((b[0][0] + b[1][0]) / 2 - focus[0], (b[0][1] + b[1][1]) / 2 - focus[1]); };
    for (const id of c.order.slice().sort((a, b) => mid(a) - mid(b))) {
      if (c.gen !== gen) return; const lay = c.layouts[id]; if (!lay.nt) { L.stats.done++; continue; }
      const res = await bakeBuilding(c, lay, gen); if (c.gen !== gen) return; L.stats.done++; if (!L.stats.firstMs) L.stats.firstMs = performance.now() - t0; c.baked[id] = !!res; ES.bus.emit("lightmap:building", c, lay, res);
    }
    L.stats.state = "done"; L.stats.totalMs = performance.now() - t0; c.ready = true; ES.bus.emit("lightmap:ready", c);
  }

  /* ================================================================ CPU access to the baked data (probes, exposure, statistics) ================================================================ */
  let H2F = null; const fromHalf = (h) => { if (!H2F) { H2F = new Float32Array(65536); for (let i = 0; i < 65536; i++) { const s = i & 0x8000 ? -1 : 1, e = (i >> 10) & 31, m = i & 1023; H2F[i] = e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? s * 65504 : s * (1 + m / 1024) * Math.pow(2, e - 15); } } return H2F[h]; };
  L.fromHalf = fromHalf;
  L.kernel = function () { const c = L.ctx; if (!c) return null; if (!c.kern) { c.scene = c.scene || kernelScene(c); c.kern = ES.lmKernel(); c.kern.setScene(c.scene); } return c.kern; };
  /* job of one building in the main-thread kernel (point queries: sky at a point, shadow rays) */
  L.job = function (bid) { const c = L.ctx, k = L.kernel(); if (!c || !k) return null; const lay = c.layouts[bid]; if (!lay) return null; if (!lay.jobId) { lay.jobId = ++jobSeq; k.setJob(buildJob(c, lay, lay.jobId)); } return lay.jobId; };
  /* the baked, state-dependent irradiance (renderer units, white-light RGB) at a surface point: g = global box index, f = face, p = world point. null for outdoor / unbaked faces. */
  L.sample = function (g, f, px, py, pz, out) {
    const c = L.ctx; if (!c || !c.atlas || !c.scene) return null; const lay = c.layouts[c.order[c.scene.bld[g]]]; if (!lay) return null;
    const i = g - lay.boxLo, q = lay.faceInfo[i * 6 + f]; if (q < 0) return null;
    const b = lay.B.boxes[i], pose = lay.pose[i], R = rotCols(pose[3], pose[4]), k = f >> 1, a1 = (k + 1) % 3, a2 = (k + 2) % 3, qx = px - pose[0], qy = py - pose[1], qz = pz - pose[2];
    const s1 = R[3 * a1] * qx + R[3 * a1 + 1] * qy + R[3 * a1 + 2] * qz, s2 = R[3 * a2] * qx + R[3 * a2 + 1] * qy + R[3 * a2 + 2] * qz, h1 = b[3 + a1] / 2, h2 = b[3 + a2] / 2, nx = lay.fNx[q], ny = lay.fNy[q];
    const ti = Math.max(0, Math.min(nx - 1, Math.floor((s1 + h1) / (2 * h1) * nx))), tj = Math.max(0, Math.min(ny - 1, Math.floor((s2 + h2) / (2 * h2) * ny))), a = c.atlas, pad = lay.fPad[q];
    const o = ((lay.y0 + lay.fY[q] + pad + tj) * a.W + lay.fX[q] + pad + ti) * 4, room = lay.roomBase + lay.fRoom[q], su = U.lmSkyUp.value, sd = U.lmSkyDown.value, rd = c.roomData, n = c.rooms.length;
    let r0 = rd[room * 4], r1 = rd[room * 4 + 1], r2 = rd[room * 4 + 2];                        // row 0: fixtures of this room
    const ar = fromHalf(a.d1[o]), ag = fromHalf(a.d1[o + 1]), ab = fromHalf(a.d1[o + 2]), fv = fromHalf(a.d1[o + 3]), gid = Math.round(fromHalf(a.d2[o])), sh = fromHalf(a.d2[o + 1]);
    let E0 = su.x * fromHalf(a.d0[o]) + sd.x * fromHalf(a.d0[o + 3]) + ar * r0, E1 = su.y * fromHalf(a.d0[o + 1]) + sd.y * fromHalf(a.d0[o + 3]) + ag * r1, E2 = su.z * fromHalf(a.d0[o + 2]) + sd.z * fromHalf(a.d0[o + 3]) + ab * r2;
    if (gid >= 0 && fv > 0 && gid < n) { E0 += fv * rd[gid * 4]; E1 += fv * rd[gid * 4 + 1]; E2 += fv * rd[gid * 4 + 2]; }
    E0 += rd[(n + room) * 4] * sh; E1 += rd[(n + room) * 4 + 1] * sh; E2 += rd[(n + room) * 4 + 2] * sh;       // row 1: sun bounce
    const m = lay.B.boxes[i][8 + f]; out = out || {}; out.E = [E0, E1, E2]; out.rho = [c.alb[m * 3], c.alb[m * 3 + 1], c.alb[m * 3 + 2]]; out.room = room; out.nz = lay.fNz[q]; return out;
  };
  L.status = () => Object.assign({}, L.stats);
  L.whenReady = () => new Promise((res) => { if (L.ctx && L.ctx.ready) res(L.ctx); else ES.bus.on("lightmap:ready", res); });
  L.toHalf = toHalf; L.hashBuilding = hashBuilding; L.poseOf = poseOf; L.rotCols = rotCols;
})();
