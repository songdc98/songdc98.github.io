/* audio.js: physically grounded spatial audio for the first-person walk-through (ES.audio).
   Sound sources are looped / one-shot signals rendered by scripts/export_web_audio.py with the Python acoustics library (assets/audio/*.ogg + manifest.json: level at 1 m, octave spectrum,
   directivity). Propagation ports the Python engine: spherical spreading from the 1 m level, ISO 9613-1 air absorption, field-incidence mass-law transmission loss through the BIM boxes
   (bim/physics.py sound_tl_db), Kurze-Anderson diffraction around corners / over roofs / through open doors and windows, ISO 9613-2 ground effect, foliage; indoors a per-room impulse
   response from the BIM room volume and surface absorption (Sabine / Eyring RT60 per octave); HRTF panning; Doppler by playback rate; the listener hears what this identity's microphones hear.
   Layout: 0 constants . 1 atmosphere + diffraction maths . 2 acoustic geometry (boxes, TL, portals, corners, rooms) . 3 path analysis . 4 room acoustics + impulse responses
           5 filter fitting . 6 engine (Web Audio graph, voices, listener) . 7 sources (ambient layers, agents, entities, events) . 8 HUD, keys . 9 test hooks. */
(function () {
  const ES = (window.ES = window.ES || {});
  const AU = (ES.audio = ES.audio || {});
  const PI = Math.PI, log10 = Math.log10, clamp = (v, a, b) => (v < a ? a : v > b ? b : v), hyp = Math.hypot, TAU = 2 * PI;
  const lin = (db) => Math.pow(10, db / 20), dB = (x) => 20 * log10(Math.max(x, 1e-12)), eSum = (arr) => 10 * log10(arr.reduce((a, l) => a + Math.pow(10, l / 10), 0) + 1e-30);

  /* ===================================== 0. constants ===================================== */
  const NB = 8, BF = [62.5, 125, 250, 500, 1000, 2000, 4000, 8000];                         // octave bands (exact 1000 * 2^k), the 8 bands of the 22.05 kHz assets
  const AW = [-26.2, -16.1, -8.6, -3.2, 0.0, 1.2, 1.0, -1.1];                                // IEC 61672-1 A-weighting at the band centres (acoustics/constants.py)
  const CL = { T: 15, RH: 70, p: 101.325, c: 331.3 + 0.606 * 15 };                           // Climate defaults of the Python engine
  const CFG = { ground: true, foliage: true, tlStructural: true, diffraction: true, maxVoices: 24, hrtfVoices: 8, hrtf: true, reverb: true, doppler: true, dbfs: 85, verbose: false };
  AU.CFG = CFG; AU.NB = NB; AU.BF = BF; AU.AW = AW; AU.CL = CL;

  /* ===================================== 1. atmosphere + diffraction maths ===================================== */
  /* ISO 9613-1 pure-tone attenuation (dB/m): same equations as acoustics/atmosphere.py iso9613_alpha */
  function alphaISO(f, Tc = CL.T, RH = CL.RH, pk = CL.p) {
    const T = Tc + 273.15, T0 = 293.15, T01 = 273.16, pr = 101.325, pp = pk / pr, C = -6.8346 * Math.pow(T01 / T, 1.261) + 4.6151, h = (RH * Math.pow(10, C)) / pp;
    const frO = pp * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h)), frN = pp * Math.pow(T / T0, -0.5) * (9 + 280 * h * Math.exp(-4.17 * (Math.pow(T / T0, -1 / 3) - 1))), f2 = f * f;
    return 8.686 * f2 * ((1.84e-11 / pp) * Math.sqrt(T / T0) + Math.pow(T / T0, -2.5) * ((0.01275 * Math.exp(-2239.1 / T)) / (frO + f2 / frO) + (0.1068 * Math.exp(-3352 / T)) / (frN + f2 / frN)));
  }
  let ALPHA = BF.map((f) => alphaISO(f));
  AU.setClimate = (o) => { Object.assign(CL, o); CL.c = 331.3 + 0.606 * CL.T; ALPHA = BF.map((f) => alphaISO(f)); };
  /* Kurze & Anderson (1971) insertion loss of a thin screen from the signed Fresnel number N = 2 delta / lambda (materials.py kurze_anderson_il) */
  function kaIL(N) {
    if (N > 0) { const x = Math.sqrt(2 * PI * N); return 5 + 20 * log10(x / Math.tanh(Math.max(x, 1e-12))); }
    if (N > -0.2) { const x = Math.sqrt(2 * PI * Math.abs(N)), r = x > 1e-9 ? x / Math.tan(clamp(x, 1e-12, 1.4)) : 1; return Math.max(0, 5 + 20 * log10(Math.max(r, 1e-6))); }
    return 0;
  }
  const c3 = (lam, e) => { const q = Math.pow((5 * lam) / Math.max(e, 1e-3), 2); return (1 + q) / (1 / 3 + q); };       // ISO 9613-2 multiple-edge factor
  /* per-band diffraction loss for a path-length difference delta (m, > 0 in the shadow); ne edges, e = edge separation; caps as propagation.py (20 / 25 + 5 per extra corner, <= 45) */
  function diffIL(delta, ne = 1, e = 0, corner = false) {
    const out = new Float32Array(NB);
    for (let b = 0; b < NB; b++) { const lam = CL.c / BF[b]; let N = (2 * delta) / lam; if (ne >= 2 && N > 0) N *= c3(lam, e); const il = kaIL(N), cap = ne >= 2 ? 25 + (corner ? 5 * (ne - 2) : 0) : 20; out[b] = Math.min(il, Math.min(cap, 45)); }
    return out;
  }
  /* ISO 9613-2 section 7.3.1 ground attenuation per band (dB, negative = gain): source / receiver / middle regions, G = ground factor 0 (hard) .. 1 (porous) */
  function groundDb(b, dp, hs, hr, Gs, Gr, Gm) {
    const k = 1 - Math.exp(-dp / 50), a = (h) => 1.5 + 3 * Math.exp(-0.12 * (h - 5) * (h - 5)) * k + 5.7 * Math.exp(-0.09 * h * h) * (1 - Math.exp(-2.8e-6 * dp * dp)), bb = (h) => 1.5 + 8.6 * Math.exp(-0.09 * h * h) * k,
      cc = (h) => 1.5 + 14 * Math.exp(-0.46 * h * h) * k, dd = (h) => 1.5 + 5 * Math.exp(-0.9 * h * h) * k, q = dp <= 30 * (hs + hr) ? 0 : 1 - (30 * (hs + hr)) / dp;
    const F = [null, a, bb, cc, dd], seg = (G, h) => (b === 0 ? -1.5 : b <= 4 ? -1.5 + G * F[b](h) : -1.5 * (1 - G));
    return seg(Gs, hs) + seg(Gr, hr) + (b === 0 ? -3 * q : -3 * q * (1 - Gm));
  }
  /* source directivity (amplitude factor in dB re the reference axis), as acoustics/directivity.py */
  const SPEECH_FB = [-0.5, -1.0, -2.0, -3.5, -6.0, -9.0, -12.0, -14.0];
  function dirDb(d, cosT, b) {
    if (!d || d.type === "omni") return 0;
    if (d.type === "speech") return SPEECH_FB[b] * 0.5 * (1 - cosT);
    if (d.type === "horn") { const th = Math.acos(clamp(cosT, -1, 1)), thh = ((d.beam_deg_1k || 70) * PI / 180) * Math.sqrt(1000 / BF[b]), g = Math.pow(2, -Math.pow(th / thh, 2)); return Math.max(dB(g), d.floor_db ?? -20); }
    if (d.type === "rotor") return dB(0.4 + 0.6 * Math.sqrt(Math.max(0, 1 - cosT * cosT)));
    if (d.type === "cardioid") return Math.max(dB(Math.abs(0.5 + 0.5 * cosT)), -30);
    return 0;
  }
  /* A-weighted sum of a band-level array (dB) */
  const dbA = (L) => { let s = 0; for (let b = 0; b < NB; b++) s += Math.pow(10, (L[b] + AW[b]) / 10); return 10 * log10(s + 1e-30); };

  /* ===================================== 2. acoustic geometry ===================================== */
  const FL = { PHYS: 1, VIS: 2, NAV: 4, GLASS: 8, MOVABLE: 16, WALK: 32, DETAIL: 64 };
  /* effective density (kg/m3) where a box is a simplified lump of a real assembly (bim/physics.py RHO_EFF) */
  const RHO_EFF = { gypsum: 250, gypsum_accent: 250, brick: 1500, brick_brown: 1500, stucco: 1100, stucco_white: 1100, stucco_peach: 1100, siding: 450, siding_blue: 450, siding_sage: 450, ceiling: 150, door_wood: 450, door_metal: 1200, glass: 2500, frame_white: 600 };
  const TL_CAP = 60;
  /* transmission loss (dB) of one box at f: field-incidence mass law 20 log10(m f) - 47 (+ 8 dB coincidence dip at 2 kHz for glass), clamped to [0, 60] */
  function tlOne(tl, f) {
    let v;
    if (tl.glass) { v = 20 * log10(30 * f) - 47 - 8 * Math.exp(-0.5 * Math.pow(Math.log2(f / 2000) / 0.5, 2)); } else v = 20 * log10(tl.m * f) - 47;
    return Math.min(TL_CAP, Math.max(0, v));
  }
  const pip = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const polyArea = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return Math.abs(s) / 2; };
  const CELL = 2.0, ck = (i, j) => i * 100003 + j;

  /* octave absorption classes: shape = alpha(band) / alpha(500 Hz); the BIM table gives alpha(500 Hz) per material (Kuttruff / Egan / ISO 354 typical shapes; 63 Hz = 0.85 x 125 Hz, 8k = 4k) */
  const ABS_SHAPE = {
    hard: [0.4, 0.5, 0.75, 1, 1, 1, 1, 1], panel: [4.6, 5.8, 2.0, 1, 0.8, 1.4, 1.8, 1.8], glass: [1.6, 1.94, 1.39, 1, 0.67, 0.39, 0.22, 0.22], porous: [0.1, 0.14, 0.42, 1, 1.21, 1.25, 1.28, 1.28],
    ceilt: [0.35, 0.4, 0.6, 1, 1.1, 1.0, 0.95, 0.95], metal: [1.5, 1.7, 1.3, 1, 0.8, 0.8, 0.8, 0.8], wood: [1.9, 2.2, 1.6, 1, 0.8, 0.8, 0.9, 0.9],
  };
  function absClass(name) {
    if (/glass|screen/.test(name)) return "glass"; if (/carpet|fabric|bedding|curtain|blinds|cardboard|paper|plant|rubber/.test(name)) return "porous"; if (name === "ceiling") return "ceilt";
    if (/metal|steel|rail|appliance|rack|machine|lockers|grating|frame_dark/.test(name)) return "metal"; if (/gypsum|whiteboard|door|frame_white|siding/.test(name)) return "panel";
    if (/wood|floor_vinyl|stair_wood|pallet|counter|roof_shingle|asphalt/.test(name)) return "wood"; return "hard";
  }
  const absBands = (name, a500) => { const s = ABS_SHAPE[absClass(name)], out = new Float32Array(NB); for (let b = 0; b < NB; b++) out[b] = Math.min(0.98, Math.max(0.005, a500 * s[b])); return out; };

  class Geo {
    /* bim: parsed bim_<scene>.json; scene: scene_<scene>.json; W: World (damage state) or null; doorState(key) -> open fraction override (optional) */
    constructor(bim, scene, W, opts = {}) {
      this.bim = bim; this.scene = scene; this.W = W; this.opts = Object.assign({ structural: CFG.tlStructural }, opts);
      this.boxes = []; this.grid = new Map(); this.doors = {}; this.blds = {}; this.bldList = []; this.stamp = 0; this.foot = []; this.portals = []; this.nodes = []; this.rooms = {};
      this.bimBld = new Set(); this.tmp = { t0: 0, t1: 0 };
      if (bim) this._build();
      if (scene) this._footprints();
    }
    _build() {
      const bim = this.bim, EL = bim.elements, mats = bim.materials, W = this.W, sc = this.scene; this.rho = {}; for (const m of mats) this.rho[m.name] = m.rho;
      const STRUCT = new Set([EL.wall_ext, EL.wall_int, EL.slab, EL.ceiling, EL.roof, EL.glass, EL.door, EL.column, EL.parapet, EL.chimney]);
      this.EL = EL; this.STRUCT = STRUCT;
      const bi = {}; if (sc) sc.buildings.forEach((b, i) => { bi[b.id] = i; });
      for (const [bid, B] of Object.entries(bim.buildings)) {
        const dmg = W && W.damage ? W.damage[bid] : null, sb = sc && sc.buildings[bi[bid]];
        if (dmg && dmg.state === "collapsed") continue;
        const keep = dmg && dmg.state === "partial" ? Math.max(1, Math.floor(0.7 * (sb ? sb.floors : B.meta.floors))) : 99;
        const info = { id: bid, B, kind: B.kind, keep, z0: B.meta.z0, zTop: B.meta.z_top, rise: B.meta.roof_rise || 0, poly: B.meta.footprint, lo: B.bounds[0], hi: B.bounds[1], rooms: B.rooms.filter((r) => r.fn !== "void"), yaw: (B.meta.frame && B.meta.frame.yaw) || 0, o: (B.meta.frame && B.meta.frame.o) || [0, 0], acoustics: null };
        this.blds[bid] = info; this.bldList.push(info); this.bimBld.add(sb ? bi[bid] + 1 : -1);
        B.boxes.forEach((r, i) => {
          const fl = r[15]; if (!(fl & FL.PHYS) || (fl & FL.DETAIL) || r[16] >= keep) return;
          const elem = r[14]; if (this.opts.structural && !STRUCT.has(elem)) return;
          this._addBox(r, B.mov[i], B.tags[i], info, mats);
        });
        for (const d of B.doors) this._portal(info, d, "door"); for (const w of B.windows) this._portal(info, w, "win");
      }
      for (const d of Object.values(this.doors)) this._doorBounds(d);
    }
    _addBox(r, mov, tag, info, mats) {
      const [cx, cy, cz, sx, sy, sz, yaw, roll] = r, cy_ = Math.cos(yaw), sy_ = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
      const R = [cy_, -sy_ * cr, sy_ * sr, sy_, cy_ * cr, -cy_ * sr, 0, sr, cr], H = [sx / 2, sy / 2, sz / 2];
      const m = r[8] ? r[8] : r[10], name = mats[m] ? mats[m].name : "concrete", t = Math.min(sx, sy, sz), elem = r[14], EL = this.EL;
      let tl;
      if (r[15] & FL.GLASS || name === "glass" || name === "curtain_glass" || name === "glass_frosted") tl = { glass: true };
      else if (elem === EL.slab || elem === EL.ceiling) tl = { m: (RHO_EFF[info.kind === "house" || info.kind === "rowhouse" ? "wood_floor" : "concrete"] || this.rho[info.kind === "house" || info.kind === "rowhouse" ? "wood_floor" : "concrete"] || 600) * t };   // floor slabs: timber in houses, concrete elsewhere (bim/physics.py _core_material)
      else tl = { m: (RHO_EFF[name] !== undefined ? RHO_EFF[name] : this.rho[name] || 600) * t };
      const box = { c: [cx, cy, cz], R, H, tl, bld: info.id, storey: r[16], elem, stamp: 0, mov: mov || null, tag, door: null, open: null };
      if (mov) {
        const key = info.id + "/" + tag, d = (this.doors[key] = this.doors[key] || { key, bld: info.id, open: mov.open || 0, mov, boxes: [], kind: mov.kind });
        d.boxes.push(box); box.door = d; box.c0 = [cx, cy, cz]; box.R0 = R.slice(); box.yaw0 = yaw; box.roll = roll; box.pose = NaN; this._pose(box);
      } else this._index(box);
      this.boxes.push(box);
    }
    /* movable leaf: pose from the door's open fraction (as bim/physics.py: rotate about the pivot / lift) */
    _pose(b) {
      const d = b.door; if (b.pose === d.open) return; b.pose = d.open; const m = d.mov;
      if (m.kind === "swing") {
        const a = m.angle * d.open, ca = Math.cos(a), sa = Math.sin(a), dx = b.c0[0] - m.pivot[0], dy = b.c0[1] - m.pivot[1], R0 = b.R0;
        b.c[0] = m.pivot[0] + ca * dx - sa * dy; b.c[1] = m.pivot[1] + sa * dx + ca * dy; b.c[2] = b.c0[2];
        b.R[0] = ca * R0[0] - sa * R0[3]; b.R[1] = ca * R0[1] - sa * R0[4]; b.R[2] = ca * R0[2] - sa * R0[5]; b.R[3] = sa * R0[0] + ca * R0[3]; b.R[4] = sa * R0[1] + ca * R0[4]; b.R[5] = sa * R0[2] + ca * R0[5];
      } else if (m.kind === "slide_up") { b.c[0] = b.c0[0]; b.c[1] = b.c0[1]; b.c[2] = b.c0[2] + m.lift * d.open; }
    }
    _aabb(b) { const R = b.R, H = b.H; return [0, 1, 2].map((i) => Math.abs(R[i * 3]) * H[0] + Math.abs(R[i * 3 + 1]) * H[1] + Math.abs(R[i * 3 + 2]) * H[2]); }
    _index(box, ext) {
      const e = ext || this._aabb(box), x0 = Math.floor((box.c[0] - e[0]) / CELL), x1 = Math.floor((box.c[0] + e[0]) / CELL), y0 = Math.floor((box.c[1] - e[1]) / CELL), y1 = Math.floor((box.c[1] + e[1]) / CELL);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = ck(i, j), a = this.grid.get(k); if (a) a.push(box); else this.grid.set(k, [box]); }
    }
    _doorBounds(d) {   // movable leaves are indexed once by the circle they can sweep (pivot-centred for swings, the box itself for lifts)
      for (const b of d.boxes) {
        const e = this._aabb(b), rad = Math.hypot(e[0], e[1]);
        if (d.mov.kind === "swing") { const r = Math.hypot(b.c0[0] - d.mov.pivot[0], b.c0[1] - d.mov.pivot[1]) + rad, save = b.c; b.c = [d.mov.pivot[0], d.mov.pivot[1], b.c0[2]]; this._index(b, [r, r, 0]); b.c = save; this._pose(b); }
        else this._index(b, [e[0], e[1], 0]);
      }
    }
    setDoor(key, open) { const d = this.doors[key]; if (d && Math.abs(d.open - open) > 1e-4) { d.open = open; this.ver = (this.ver || 0) + 1; return true; } return false; }
    /* door / window apertures: centre, tangent, size, current open fraction -> clear aperture for diffraction */
    _portal(info, rec, kind) {
      const nrm = rec.normal || [0, 1], t = kind === "door" ? rec.dir || [-nrm[1], nrm[0]] : [-nrm[1], nrm[0]], z0 = kind === "door" ? rec.z : rec.z0, z1 = kind === "door" ? rec.z + rec.height : rec.z1;
      this.portals.push({ key: info.id + "/" + rec.id, bld: info.id, kind, rec, c: [rec.pos[0], rec.pos[1], 0.5 * (z0 + z1)], t, n: [-t[1], t[0]], hw: (kind === "door" ? rec.width : rec.w) / 2, hh: (z1 - z0) / 2, z0, z1 });
    }
    /* clear width of a portal at the current door state (m): swing leaves open by w (1 - cos(angle)), BIM `gap` for windows built open */
    portalWidth(p) {
      const d = this.doors[p.key], w = 2 * p.hw;
      if (d) { const a = d.mov.kind === "swing" ? Math.abs(d.mov.angle) * d.open : 0; if (d.mov.kind === "slide_up") return w * d.open; const v = w * (1 - Math.cos(a)); return p.kind === "win" && p.rec.gap && p.rec.open > 1e-3 ? Math.max(v, (p.rec.gap * d.open) / p.rec.open) : v; }
      return p.kind === "win" ? Math.max(0, p.rec.gap || 0) : (p.rec.open || 0) * w;                 // fixed geometry (double-hung): BIM clear gap
    }
    /* ---- outdoor footprints (all buildings, heights as the World raster) + convex corner nodes for the visibility graph ---- */
    _footprints() {
      const sc = this.scene, W = this.W; this.foot = []; this.nodes = [];
      sc.buildings.forEach((b, bi) => {
        const dmg = W && W.damage ? W.damage[b.id] : null; let h = b.h; if (dmg && dmg.state === "collapsed") h = Math.min(2.2, 0.18 * b.h); else if (dmg && dmg.state === "partial") h = 0.7 * b.h;
        const rings = b.parts && b.parts.length ? b.parts : [b.fp];
        for (const ring of rings) {
          const lo = [1e9, 1e9], hi = [-1e9, -1e9]; for (const p of ring) { lo[0] = Math.min(lo[0], p[0]); lo[1] = Math.min(lo[1], p[1]); hi[0] = Math.max(hi[0], p[0]); hi[1] = Math.max(hi[1], p[1]); }
          const f = { poly: ring, h: h + (b.roof_rise || 0) * 0.4, lo, hi, bi }; this.foot.push(f);
          let ar = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) ar += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; const sgn = ar > 0 ? 1 : -1;   // CCW > 0
          for (let i = 0; i < ring.length; i++) {
            const p0 = ring[(i + ring.length - 1) % ring.length], p1 = ring[i], p2 = ring[(i + 1) % ring.length], e0 = [p1[0] - p0[0], p1[1] - p0[1]], e1 = [p2[0] - p1[0], p2[1] - p1[1]], cr = (e0[0] * e1[1] - e0[1] * e1[0]) * sgn;
            if (cr <= 1e-6) continue;                                                                    // concave corners do not diffract
            const n0 = [e0[1] * sgn, -e0[0] * sgn], n1 = [e1[1] * sgn, -e1[0] * sgn], l0 = hyp(...n0) || 1, l1 = hyp(...n1) || 1; let nx = n0[0] / l0 + n1[0] / l1, ny = n0[1] / l0 + n1[1] / l1; const nl = hyp(nx, ny) || 1;
            this.nodes.push({ x: p1[0] + (0.3 * nx) / nl, y: p1[1] + (0.3 * ny) / nl, h: f.h, f });
          }
        }
      });
    }
    /* ---- segment queries ---- */
    _cells(ax, ay, bx, by, fn) {                                              // Amanatides-Woo grid traversal
      let i = Math.floor(ax / CELL), j = Math.floor(ay / CELL); const i1 = Math.floor(bx / CELL), j1 = Math.floor(by / CELL), dx = bx - ax, dy = by - ay, si = dx > 0 ? 1 : -1, sj = dy > 0 ? 1 : -1;
      const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdy = dy !== 0 ? Math.abs(CELL / dy) : Infinity;
      let tx = dx !== 0 ? ((si > 0 ? (i + 1) * CELL - ax : ax - i * CELL) / Math.abs(dx)) : Infinity, ty = dy !== 0 ? ((sj > 0 ? (j + 1) * CELL - ay : ay - j * CELL) / Math.abs(dy)) : Infinity;
      for (let n = 0; n < 4000; n++) { fn(i, j); if (i === i1 && j === j1) break; if (tx < ty) { i += si; tx += tdx; } else { j += sj; ty += tdy; } }
    }
    /* intersection of the segment p -> q with an oriented box: sets this.tmp.t0/t1 (fractions), returns true when the segment is inside the box for a positive length */
    _seg(b, ax, ay, az, dx, dy, dz) {
      const R = b.R, c = b.c, H = b.H, px = ax - c[0], py = ay - c[1], pz = az - c[2]; let tmin = -Infinity, tmax = Infinity;
      for (let a = 0; a < 3; a++) {
        const pl = R[a] * px + R[3 + a] * py + R[6 + a] * pz, dl = R[a] * dx + R[3 + a] * dy + R[6 + a] * dz, h = H[a];
        if (Math.abs(dl) < 1e-12) { if (Math.abs(pl) > h) return false; continue; }
        let t1 = (-h - pl) / dl, t2 = (h - pl) / dl; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return false;
      }
      const a0 = Math.max(tmin, 0), b0 = Math.min(tmax, 1); this.tmp.t0 = a0; this.tmp.t1 = b0; return b0 > a0 + 1e-9;
    }
    /* every box crossed by p -> q (acoustic structure only unless opts.structural = false), ordered by entry */
    crossings(p, q, skipDoor) {
      const out = [], dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], st = ++this.stamp;
      this._cells(p[0], p[1], q[0], q[1], (i, j) => {
        const a = this.grid.get(ck(i, j)); if (!a) return;
        for (const b of a) {
          if (b.stamp === st) continue; b.stamp = st; if (b.door) { if (skipDoor && b.door.key === skipDoor) continue; this._pose(b); }
          if (this._seg(b, p[0], p[1], p[2], dx, dy, dz)) out.push({ b, t0: this.tmp.t0, t1: this.tmp.t1 });
        }
      });
      out.sort((u, v) => u.t0 - v.t0); return out;
    }
    /* mass-law transmission loss per band (dB) summed over the crossed boxes, + counts */
    tlBands(p, q, skipDoor) {
      const cr = this.crossings(p, q, skipDoor), tl = new Float32Array(NB); let nWalls = 0, nGlass = 0;
      for (const x of cr) { nWalls++; if (x.b.tl.glass) nGlass++; for (let b = 0; b < NB; b++) tl[b] += tlOne(x.b.tl, BF[b]); }
      return { tl, n: nWalls, nGlass, cr };
    }
    tlAt(p, q, f) { let s = 0; for (const x of this.crossings(p, q)) s += tlOne(x.b.tl, f); return s; }
    /* ---- spaces: which room (or outdoors) a point is in ---- */
    buildingAt(x, y) { for (const f of this.bldList) { if (x < f.lo[0] || x > f.hi[0] || y < f.lo[1] || y > f.hi[1]) continue; if (pip(f.poly, x, y)) return f; } return null; }
    roomAt(x, y, z) {
      const f = this.buildingAt(x, y); if (!f || z > f.zTop + f.rise + 0.5) return { bld: null, room: null, key: "out" };
      for (const r of f.rooms) { if (z < r.z0 - 0.5 || z > r.z1 + 0.5) continue; if (pip(r.poly, x, y)) return { bld: f, room: r, key: f.id + "/" + r.id }; }
      return { bld: f, room: null, key: f.id + "/-" };
    }
  }
  AU.Geo = Geo;

  /* ===================================== 3. surfaces, raster march, path analysis ===================================== */
  const SURF = { SOIL: 0, ASPHALT: 1, PAVED: 2, GRASS: 3, GRAVEL: 4 }, GFAC = [1, 0, 0, 1, 0.5];            // ISO 9613-2 ground factor G per surface (0 hard .. 1 porous)
  const STEP_OF = ["grass", "concrete", "concrete", "grass", "gravel"];
  /* ground type raster on the World grid (same indexing as W.ij): lawn / paved / gravel blocks, parks, plazas, roads, sidewalks, paths */
  class Surf {
    constructor(sc, W) {
      this.W = W; this.m = new Uint8Array(W.N * W.N); if (!sc) return;
      const fill = (ring, v) => W.fillPoly(ring, (id) => { this.m[id] = v; });
      for (const b of sc.blocks || []) fill(b.ring, b.ground === "paved" ? SURF.PAVED : b.ground === "gravel" ? SURF.GRAVEL : SURF.GRASS);
      for (const p of sc.parks || []) fill(p, SURF.GRASS); for (const p of sc.plazas || []) fill(p, SURF.PAVED);
      for (const p of sc.road_poly || []) fill(p.ring, SURF.ASPHALT); for (const p of sc.sidewalk_poly || []) fill(p.ring, SURF.PAVED); for (const p of sc.path_poly || []) fill(p.ring, SURF.PAVED);
      for (const o of sc.objects || []) { if (o.type === "pave") fill(o.ring, o.surface === "concrete" ? SURF.PAVED : SURF.ASPHALT); else if (o.type === "walkway") W.fillSeg(o.from, o.to, o.w / 2, (id) => { this.m[id] = SURF.PAVED; }); }
    }
    at(x, y) { const id = this.W.ij(x, y); return id >= 0 ? this.m[id] : 0; }
    G(x, y) { return GFAC[this.at(x, y)]; }
    step(x, y) { const id = this.W.ij(x, y); if (id >= 0 && this.W.rub[id] > 0.25) return "rubble"; return STEP_OF[id >= 0 ? this.m[id] : 0]; }
  }
  const FLOOR_STEP = { wood_floor: "wood", stair_wood: "wood", carpet: "carpet", tile: "tile", floor_vinyl: "tile", ceramic: "tile", polished_concrete: "concrete", concrete: "concrete", stair_concrete: "concrete", concrete_light: "concrete", grating: "concrete" };
  AU.Surf = Surf;

  /* march a straight 3-D segment through the World raster: obstacles that are not modelled by BIM boxes (trunks, parked cars, privacy fences, rubble ...), tree canopy length */
  function march(W, skip, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = hyp(dx, dy), L3 = hyp(L2, dz), n = Math.max(2, Math.ceil(L2 / 0.5)), ds = L3 / n; let blocked = false, hEdge = 0, kE = -1, canopy = 0;
    for (let k = 1; k < n; k++) {
      const t = k / n, x = ax + dx * t, y = ay + dy * t, z = az + dz * t, id = W.ij(x, y); if (id < 0) continue;
      const h = W.hB[id], bd = W.bid[id]; if (h > z && !(bd && skip.has(bd))) { blocked = true; if (h > hEdge) { hEdge = h; kE = k; } }
      const ch = W.cHi[id]; if (ch > 0 && z >= W.cLo[id] && z <= ch) canopy += ds;
    }
    return { blocked, hEdge, d1: kE >= 0 ? kE * ds : 0, canopy, L3 };
  }
  /* ---- 2-D helpers for the visibility graph and the roof skyline ---- */
  const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;
  function segPolyInterval(f, ax, ay, bx, by) {              // parameters (0..1) along a -> b where the segment is inside polygon f: [[t0, t1], ...]
    const poly = f.poly, rx = bx - ax, ry = by - ay, ts = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p0 = poly[j], p1 = poly[i], sx = p1[0] - p0[0], sy = p1[1] - p0[1], den = cross2(rx, ry, sx, sy); if (Math.abs(den) < 1e-12) continue;
      const qx = p0[0] - ax, qy = p0[1] - ay, t = cross2(qx, qy, sx, sy) / den, u = cross2(qx, qy, rx, ry) / den; if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((a, b) => a - b); if (pip(poly, ax, ay)) ts.unshift(0); if (pip(poly, bx, by)) ts.push(1);
    const out = []; for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 1e-6) out.push([ts[i], ts[i + 1]]); return out;
  }
  /* is the 2-D segment blocked by a building whose roof is above the segment height? (height interpolated, taken at the middle of the overlap) */
  function segBlocked(G, ax, ay, az, bx, by, bz) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    for (const f of G.foot) { if (f.hi[0] < x0 || f.lo[0] > x1 || f.hi[1] < y0 || f.lo[1] > y1) continue; for (const [t0, t1] of segPolyInterval(f, ax, ay, bx, by)) if (f.h > az + ((bz - az) * (t0 + t1)) / 2 - 0.05) return true; }
    return false;
  }
  /* shortest path around convex building corners (visibility graph, Dijkstra) between 3-D points S and R at ground level; null when the direct line is clear or no path exists */
  function cornerPath(G, S, R) {
    const D = hyp(R[0] - S[0], R[1] - S[1]); if (D < 0.5 || !G.nodes.length) return null;
    const ux = (R[0] - S[0]) / D, uy = (R[1] - S[1]) / D, cand = [];
    for (const nd of G.nodes) {
      const d1 = hyp(nd.x - S[0], nd.y - S[1]), d2 = hyp(nd.x - R[0], nd.y - R[1]), exc = d1 + d2 - D; if (exc > 40) continue;
      const fr = clamp(((nd.x - S[0]) * ux + (nd.y - S[1]) * uy) / D, 0, 1), zn = S[2] + (R[2] - S[2]) * fr; if (nd.h <= zn + 0.2) continue; cand.push({ nd, exc, zn });
    }
    if (!cand.length) return null; cand.sort((a, b) => a.exc - b.exc); cand.length = Math.min(cand.length, 24);
    const P = [{ x: S[0], y: S[1], z: S[2] }, ...cand.map((c) => ({ x: c.nd.x, y: c.nd.y, z: c.zn })), { x: R[0], y: R[1], z: R[2] }], n = P.length, dist = new Float64Array(n).fill(Infinity), prev = new Int16Array(n).fill(-1), done = new Uint8Array(n); dist[0] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1, best = Infinity; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; } if (u < 0 || u === n - 1) break; done[u] = 1;
      for (let v = 0; v < n; v++) { if (done[v]) continue; const w = hyp(P[u].x - P[v].x, P[u].y - P[v].y); if (dist[u] + w >= dist[v]) continue; if (segBlocked(G, P[u].x, P[u].y, P[u].z, P[v].x, P[v].y, P[v].z)) continue; dist[v] = dist[u] + w; prev[v] = u; }
    }
    if (!isFinite(dist[n - 1])) return null; const path = [n - 1]; while (path[path.length - 1] !== 0) path.push(prev[path[path.length - 1]]); path.reverse(); if (path.length <= 2) return null;
    // heights interpolated by arc length, 3-D length
    const V = path.map((i) => P[i]), arc = [0]; for (let i = 1; i < V.length; i++) arc.push(arc[i - 1] + hyp(V[i].x - V[i - 1].x, V[i].y - V[i - 1].y));
    for (let i = 0; i < V.length; i++) V[i] = { x: V[i].x, y: V[i].y, z: V[0].z + (V[V.length - 1].z - V[0].z) * (arc[i] / arc[arc.length - 1]) };
    let L = 0, e = 0; for (let i = 1; i < V.length; i++) { const w = hyp(V[i].x - V[i - 1].x, V[i].y - V[i - 1].y, V[i].z - V[i - 1].z); L += w; if (i >= 2 && i <= V.length - 2) e += w; }
    return { L, V, ne: V.length - 2, e };
  }
  /* taut string over the roof skyline in the vertical plane through S and R (upper convex hull of the roof edges), as propagation.py diff_roof */
  function roofPath(G, S, R) {
    const D = hyp(R[0] - S[0], R[1] - S[1]); if (D < 0.5) return null; const pts = [[0, S[2]], [D, R[2]]], x0 = Math.min(S[0], R[0]), x1 = Math.max(S[0], R[0]), y0 = Math.min(S[1], R[1]), y1 = Math.max(S[1], R[1]);
    for (const f of G.foot) { if (f.hi[0] < x0 || f.lo[0] > x1 || f.hi[1] < y0 || f.lo[1] > y1) continue; for (const [t0, t1] of segPolyInterval(f, S[0], S[1], R[0], R[1])) { pts.push([t0 * D, f.h], [t1 * D, f.h]); } }
    if (pts.length < 3) return null; pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const h = []; for (const p of pts) { while (h.length >= 2 && (h[h.length - 1][0] - h[h.length - 2][0]) * (p[1] - h[h.length - 2][1]) - (h[h.length - 1][1] - h[h.length - 2][1]) * (p[0] - h[h.length - 2][0]) >= 0) h.pop(); h.push(p); }
    if (h.length < 3) return null; let L = 0, e = 0; for (let i = 1; i < h.length; i++) { const w = hyp(h[i][0] - h[i - 1][0], h[i][1] - h[i - 1][1]); L += w; if (i >= 2 && i <= h.length - 2) e += w; }
    const last = h[h.length - 2], u = last[0] / D; return { L, ne: h.length - 2, e, V: [{ x: S[0] + (R[0] - S[0]) * u, y: S[1] + (R[1] - S[1]) * u, z: last[1] }] };
  }
  /* aperture path S -> Q -> R through a door / window: Q = the point of the aperture rectangle nearest to where the straight line crosses its plane (taut-string path through the opening) */
  function portalPath(G, p, wClear, S, R) {
    const n = p.n, sS = (S[0] - p.c[0]) * n[0] + (S[1] - p.c[1]) * n[1], sR = (R[0] - p.c[0]) * n[0] + (R[1] - p.c[1]) * n[1]; if (sS * sR >= 0) return null;     // the portal must lie between the two points
    const t = sS / (sS - sR), X = [S[0] + (R[0] - S[0]) * t, S[1] + (R[1] - S[1]) * t, S[2] + (R[2] - S[2]) * t], u = (X[0] - p.c[0]) * p.t[0] + (X[1] - p.c[1]) * p.t[1], v = X[2] - p.c[2];
    const hw = wClear / 2, uc = clamp(u, -hw, hw), vc = clamp(v, -p.hh, p.hh), Q = [p.c[0] + p.t[0] * uc, p.c[1] + p.t[1] * uc, p.c[2] + vc];
    const d1 = hyp(Q[0] - S[0], Q[1] - S[1], Q[2] - S[2]), d2 = hyp(R[0] - Q[0], R[1] - Q[1], R[2] - Q[2]); return { Q, L: d1 + d2, d1, d2, inside: Math.abs(u) <= hw && Math.abs(v) <= p.hh };
  }
  /* Environment of one scene: geometry + raster + ground */
  class Env {
    constructor(G, W, surf) { this.G = G; this.W = W; this.surf = surf; this.skip = G.bimBld; this.version = 0; }
    inBuilding(x, y, z) { const r = this.G.roomAt(x, y, z); return r.bld ? r : null; }
    gz(x, y) { return this.W ? this.W.groundZ(x, y) : 0; }
  }
  const foliageDb = (len) => { const o = new Float32Array(NB), a = Math.min(10, 0.1 * len); for (let b = 0; b < NB; b++) o[b] = a * Math.sqrt(BF[b] / 1000); return o; };

  /* The path analysis of one source / listener pair. S, R = [x, y, z] (ENU, m). Returns the loss (dB per band) of
       A  the straight path (spreading from 1 m, air, transmission loss of the crossed boxes, foliage, ground effect, rubble leak),
       B  the dominant diffracted path when A is blocked (corner / roof / open door or window), with its apparent position,
     plus the transmission-loss detail for the HUD.  Directivity and source level are added by the caller. */
  function analyze(env, S, R, o = {}) {
    const G = env.G, W = env.W, dx = R[0] - S[0], dy = R[1] - S[1], dz = R[2] - S[2], d = Math.max(hyp(dx, dy, dz), 0.05), out = { d, A: new Float32Array(NB), B: null, tl: null, n: 0, nGlass: 0, blocked: false, tlDba: 0, sp: null, kind: "direct", ground: false };
    const spS = G.roomAt(S[0], S[1], S[2]), spR = G.roomAt(R[0], R[1], R[2]); out.sp = { S: spS, R: spR };
    const tl = G.tlBands(S, R, null); out.tl = tl.tl; out.n = tl.n; out.nGlass = tl.nGlass;
    const mr = W ? march(W, env.skip, S[0], S[1], S[2], R[0], R[1], R[2]) : { blocked: false, canopy: 0, hEdge: 0, d1: 0, L3: d }, outdoor = !spS.bld && !spR.bld;
    const fol = CFG.foliage ? foliageDb(mr.canopy) : new Float32Array(NB);
    // raster obstacles that are not BIM buildings (parked cars, privacy fences, trunks, rubble): over-the-top edge, treated like a thin screen
    let obs = null; if (mr.blocked) { const he = Math.max(mr.hEdge, 0.1), dTop = Math.sqrt(mr.d1 * mr.d1 + Math.pow(he - S[2], 2)) + Math.sqrt(Math.pow(mr.L3 - mr.d1, 2) + Math.pow(he - R[2], 2)) - mr.L3; obs = diffIL(Math.max(dTop, 0), 1, 0, false); }
    const sRub = W && W.rub[W.ij(S[0], S[1])] > 0.3 ? 13 : 0;                                    // source buried in rubble: leak-limited 13 dB (acoustics/materials.py rubble heap)
    const gnd = new Float32Array(NB); let useGround = false;
    if (CFG.ground && outdoor && W && !mr.blocked && tl.n === 0) {
      const sf = env.surf, hs = Math.max(S[2] - env.gz(S[0], S[1]), 0.05), hr = Math.max(R[2] - env.gz(R[0], R[1]), 0.05), dp = Math.max(hyp(dx, dy), 0.5), Gm = (sf.G((S[0] + R[0]) / 2, (S[1] + R[1]) / 2) + sf.G(S[0] + dx / 3, S[1] + dy / 3) + sf.G(S[0] + (2 * dx) / 3, S[1] + (2 * dy) / 3)) / 3;
      for (let b = 0; b < NB; b++) gnd[b] = groundDb(b, dp, hs, hr, sf.G(S[0], S[1]), sf.G(R[0], R[1]), Gm); useGround = true;
    }
    out.ground = useGround;
    out.air = new Float32Array(NB); for (let b = 0; b < NB; b++) { out.A[b] = 20 * log10(d) + tl.tl[b] + fol[b] + gnd[b] + sRub + (obs ? obs[b] : 0); out.air[b] = ALPHA[b] * d; }
    out.blocked = tl.tl[4] > 6 || (mr.blocked && obs && obs[4] > 6);
    out.tlDba = tl.tl[4];
    out.canopy = mr.canopy;
    // ---- diffracted paths when the straight one is blocked ----
    if (CFG.diffraction && (out.blocked || tl.tl[4] > 3) && d > 0.5) {
      const cands = [];
      const add = (kind, L, il, V, extra) => { const lo = new Float32Array(NB); for (let b = 0; b < NB; b++) lo[b] = 20 * log10(d) + ALPHA[b] * L + il[b] + (extra ? extra[b] : 0); cands.push({ kind, L, loss: lo, pos: V }); };
      if (outdoor) {
        const cp = cornerPath(G, S, R), rp = roofPath(G, S, R);
        if (cp) add("corner", cp.L, diffIL(cp.L - d, cp.ne, cp.e, true), [cp.V[1].x, cp.V[1].y, cp.V[1].z]);
        if (rp) { const dd = hyp(R[0] - S[0], R[1] - S[1], R[2] - S[2]); add("roof", rp.L, diffIL(rp.L - dd, rp.ne, rp.e, false), [rp.V[0].x, rp.V[0].y, rp.V[0].z]); }
      }
      if (cands.length === 2) { const e0 = eSum(Array.from(cands[0].loss).map((v) => -v)), e1 = eSum(Array.from(cands[1].loss).map((v) => -v)); cands.splice(e0 >= e1 ? 1 : 0, 1); }   // 'dominant' as PropConfig.diffraction
      // doors and windows: aperture paths (both legs may still cross other walls, their transmission loss is added)
      const near = []; for (const p of G.portals) { const w = G.portalWidth(p); if (w < 0.04) continue; if (Math.abs(p.c[0] - (S[0] + R[0]) / 2) > 0.5 * hyp(dx, dy) + 30 || Math.abs(p.c[1] - (S[1] + R[1]) / 2) > 0.5 * hyp(dx, dy) + 30) continue; near.push([p, w]); }
      const pc = [];
      for (const [p, w] of near) {
        const pp = portalPath(G, p, w, S, R); if (!pp || pp.L - d > 25) continue;
        const key = p.key, t1 = G.tlBands(S, pp.Q, key), t2 = G.tlBands(pp.Q, R, key), il = diffIL(pp.inside ? 0 : pp.L - d, 1, 0, false), ex = new Float32Array(NB);
        for (let b = 0; b < NB; b++) { const lam = CL.c / BF[b], cor = w < lam / 2 ? Math.min(30, -20 * log10(Math.max(2 * w / lam, 0.03))) : 0; ex[b] = t1.tl[b] + t2.tl[b] + cor; }
        const lo = new Float32Array(NB); for (let b = 0; b < NB; b++) lo[b] = 20 * log10(d) + ALPHA[b] * pp.L + il[b] + ex[b]; pc.push({ kind: "portal", L: pp.L, loss: lo, pos: pp.Q, p });
      }
      pc.sort((a, b) => a.loss[4] - b.loss[4]); for (const c of pc.slice(0, 3)) cands.push(c);
      if (cands.length) {                                                                       // energy sum of the alternatives per band; direction of the strongest one at 1 kHz
        cands.sort((a, b) => a.loss[4] - b.loss[4]); const loss = new Float32Array(NB);
        for (let b = 0; b < NB; b++) { let e = 0; for (const c of cands) e += Math.pow(10, -c.loss[b] / 10); loss[b] = -10 * log10(e); }
        out.B = { loss, pos: cands[0].pos, kind: cands[0].kind, L: cands[0].L, n: cands.length };
      }
    }
    return out;
  }
  AU.analyze = analyze; AU.Env = Env;

  /* ===================================== 4. room acoustics + impulse responses ===================================== */
  /* Per room of a building: volume V, absorption area A(band) = sum over the room-facing faces of every physical box (walls, floors, ceilings, doors, glass, furniture) of S * alpha(material, band)
     [alpha(500 Hz) from the BIM material table, octave shape by material class] + 4 m V (air), RT60 by Sabine (small mean absorption) / Eyring (alpha > 0.2). */
  Geo.prototype.roomAcoustics = function (info) {
    if (info.acoustics) return info.acoustics;
    const B = info.B, mats = this.bim.materials, EL = this.EL, rooms = info.rooms, nR = rooms.length, acc = rooms.map((r) => ({ A: new Float64Array(NB), Sb: 0, bb: null }));
    const bb = rooms.map((r) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of r.poly) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return [x0, y0, x1, y1]; });
    const bounding = new Set([EL.wall_ext, EL.wall_int, EL.slab, EL.ceiling, EL.glass, EL.door, EL.roof, EL.column]);
    const aCache = {};
    for (const r of B.boxes) {
      const fl = r[15]; if (!(fl & FL.PHYS) || (fl & FL.DETAIL)) continue;
      const [cx, cy, cz, sx, sy, sz, yaw, roll] = r, cyw = Math.cos(yaw), syw = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll), R = [cyw, -syw * cr, syw * sr, syw, cyw * cr, -cyw * sr, 0, sr, cr], H = [sx / 2, sy / 2, sz / 2];
      for (let f = 0; f < 6; f++) {
        const m = r[8 + f]; if (!m) continue; const ax = f >> 1, a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, sg = f % 2 === 0 ? 1 : -1, area = 4 * H[a1] * H[a2]; if (area < 0.02) continue;
        const l = [0, 0, 0]; l[ax] = sg * H[ax]; const wx = cx + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], wy = cy + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], wz = cz + R[6] * l[0] + R[7] * l[1] + R[8] * l[2];
        const nx = sg * R[ax], ny = sg * R[3 + ax], nz = sg * R[6 + ax], px = wx + 0.06 * nx, py = wy + 0.06 * ny, pz = wz + 0.06 * nz;
        for (let k = 0; k < nR; k++) {
          const q = bb[k]; if (px < q[0] || px > q[2] || py < q[1] || py > q[3] || pz < rooms[k].z0 - 0.05 || pz > rooms[k].z1 + 0.05 || !pip(rooms[k].poly, px, py)) continue;
          const mat = mats[m], key = m, al = aCache[key] || (aCache[key] = absBands(mat.name, Math.max(mat.alpha || 0.05, 0.01)));
          for (let b = 0; b < NB; b++) acc[k].A[b] += area * al[b]; if (bounding.has(r[14])) acc[k].Sb += area; break;
        }
      }
    }
    const res = {}, gyp = absBands("gypsum", 0.05), cl = Math.cos(info.yaw), sl = Math.sin(info.yaw);
    rooms.forEach((rm, k) => {
      const Ap = polyArea(rm.poly), H = Math.max(rm.z1 - rm.z0, 2), V = Ap * H; let per = 0; for (let i = 0, j = rm.poly.length - 1; i < rm.poly.length; j = i++) per += hyp(rm.poly[i][0] - rm.poly[j][0], rm.poly[i][1] - rm.poly[j][1]);
      const Stot = 2 * Ap + per * H, a = acc[k], Sb = a.Sb, A = new Float64Array(NB); for (let b = 0; b < NB; b++) A[b] = a.A[b] + Math.max(0, Stot - Sb) * gyp[b];
      const S = Math.max(Stot, Sb), T = new Float64Array(NB), Ts = new Float64Array(NB), Te = new Float64Array(NB), abar = new Float64Array(NB);
      for (let b = 0; b < NB; b++) {
        const m4 = (4 * ALPHA[b] * V) / 4.343, At = A[b] + m4, ab = Math.min(0.95, A[b] / S); abar[b] = ab;
        Ts[b] = (0.161 * V) / At; Te[b] = (0.161 * V) / (-S * Math.log(1 - ab) + m4); T[b] = clamp(ab <= 0.2 ? Ts[b] : Te[b], 0.08, 4.0);
      }
      // bounding rectangle in the building frame (for the first reflections)
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of rm.poly) { const dx = q[0] - info.o[0], dy = q[1] - info.o[1], u = cl * dx + sl * dy, v = -sl * dx + cl * dy; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      res[rm.id] = { id: rm.id, fn: rm.fn, V, S, H, A, T, Ts, Te, abar, dims: [x1 - x0, y1 - y0, H], key: info.id + "/" + rm.id };
    });
    return (info.acoustics = res);
  };
  Geo.prototype.roomInfo = function (rr) { return rr && rr.room ? this.roomAcoustics(rr.bld)[rr.room.id] : null; };
  /* Impulse-response plan of a space: octave-band RT60 (s), band energy E_b = 16 pi / A_b (reverberant energy re the source's 1 m amplitude, diffuse-field theory: p_rev^2 / p_1m^2 = 16 pi / A),
     first-reflection taps. Street plan from the canyon index (0 open .. 1 narrow street). */
  function irPlanRoom(ra) {
    const T = Array.from(ra.T), E = Array.from(ra.A).map((a) => (16 * PI) / Math.max(a, 2)), [Lx, Ly, Lz] = ra.dims, cc = CL.c, taps = [];
    const sx = Lx / 3, rx = (2 * Lx) / 3, y = Ly / 2, zs = 1.4, zr = 1.5, rho = Math.sqrt(1 - Math.min(0.9, ra.abar[4]));                       // notional source / receiver positions
    const walls = [[0, "x", -1], [Lx, "x", 1], [0, "y", -1], [Ly, "y", 1], [0, "z", -1], [Lz, "z", 1]];
    for (const [w, ax, sg] of walls) {
      const S = [sx, y, zs], R = [rx, y, zr], im = S.slice(), i = ax === "x" ? 0 : ax === "y" ? 1 : 2; im[i] = 2 * w - S[i]; const d = hyp(im[0] - R[0], im[1] - R[1], im[2] - R[2]); taps.push({ t: d / cc, g: rho / d });
    }
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) for (const wi of [0, 1]) for (const wj of [0, 1]) {      // 2nd order: pairs of walls of different axes
      const S = [sx, y, zs], R = [rx, y, zr], L = [Lx, Ly, Lz], im = S.slice(); im[i] = 2 * wi * L[i] - S[i]; im[j] = 2 * wj * L[j] - S[j]; const d = hyp(im[0] - R[0], im[1] - R[1], im[2] - R[2]); taps.push({ t: d / cc, g: (rho * rho) / d });
    }
    return { T, E, taps, tmin: Math.min(...taps.map((q) => q.t)), erShare: 0.22, len: Math.min(2.2, 0.85 * Math.max(...T) + 0.08), hf: 5200 / Math.sqrt(1 + 4 * ra.abar[6]), key: ra.key, kind: "room", V: ra.V, A: Array.from(ra.A) };
  }
  function irPlanStreet(canyon, dists) {
    const c = clamp(canyon, 0, 1), Tm = 0.25 + 0.95 * c, T = [1, 1, 1, 1, 0.97, 0.88, 0.7, 0.5].map((k) => Tm * k), Aeff = Math.exp(Math.log(3.1e5) + (Math.log(4.2e4) - Math.log(3.1e5)) * c), E = T.map(() => (16 * PI) / Aeff), taps = [];
    (dists || []).forEach((d, i) => { if (d > 2 && d < 60) taps.push({ t: (2 * d) / CL.c, g: 0.8 / (2 * d) * (1 + 0.1 * Math.sin(i * 12.9)) }); });
    return { T, E, taps, tmin: taps.length ? Math.min(...taps.map((q) => q.t)) : 0.03, erShare: 0.35, len: Math.min(1.4, 0.85 * Tm + 0.08), hf: 4200, key: "street" + c.toFixed(1), kind: "street", V: 0, A: [] };
  }
  /* band-limited-noise IR of a plan at sample rate sr, rendered natively (OfflineAudioContext): decaying noise per octave band, scaled so that the mean-square frequency response of band b equals E_b
     (reverberant power spectral density re the direct sound at 1 m: 16 pi / A_b), plus the first reflections. Resolves with a stereo AudioBuffer (decorrelated channels). */
  const edgeHz = (b, sr) => [b === 0 ? 0 : BF[b] / Math.SQRT2, b === NB - 1 ? sr / 2 : BF[b] * Math.SQRT2];
  function rbj(type, fc, Q, sr) {                                      // RBJ biquad (the formulas of the Web Audio spec), Q linear
    const w0 = (2 * PI * fc) / sr, al = Math.sin(w0) / (2 * Q), cw = Math.cos(w0); let b0, b1, b2;
    if (type === "lowpass") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; } else if (type === "highpass") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    return { b: [b0, b1, b2], a: [1 + al, -2 * cw, 1 - al] };
  }
  const biquadMag2 = (c, w) => { const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w), nr = c.b[0] + c.b[1] * c1 + c.b[2] * c2, ni = -c.b[1] * s1 - c.b[2] * s2, dr = c.a[0] + c.a[1] * c1 + c.a[2] * c2, di = -c.a[1] * s1 - c.a[2] * s2; return (nr * nr + ni * ni) / (dr * dr + di * di); };
  function noiseGain2(type, fc, Q, sr) { const c = rbj(type, fc, Q, sr), n = 4096; let s = 0; for (let i = 0; i < n; i++) s += biquadMag2(c, (PI * (i + 0.5)) / n); return s / n; }   // output variance for unit-variance white noise
  const BUTT_DB = 20 * log10(Math.SQRT1_2);                             // Web Audio lowpass / highpass Q is in dB
  async function renderIR(sr, plan) {
    const nch = plan.kind === "street" ? 1 : 2, N = Math.ceil(plan.len * sr) + 64, off = new OfflineAudioContext(nch, N, sr), t0 = Math.max(0.006, plan.tmin * 0.6), Q = Math.SQRT2, noise = off.createBuffer(nch, N, sr);
    for (let c = 0; c < nch; c++) { const d = noise.getChannelData(c); for (let i = 0; i < N; i += 2) { const u = Math.random() || 1e-9, v = Math.random(), r = Math.sqrt(-2 * Math.log(u)); d[i] = r * Math.cos(TAU * v); if (i + 1 < N) d[i + 1] = r * Math.sin(TAU * v); } }
    let eMean = 0;
    for (let b = 0; b < NB; b++) {
      const [lo, hi] = edgeHz(b, sr), Bw = hi - lo, type = b === 0 ? "lowpass" : b === NB - 1 ? "highpass" : "bandpass", fc = b === 0 ? hi : b === NB - 1 ? lo : BF[b], Ql = type === "bandpass" ? Q : Math.SQRT1_2;
      const lam = (3 * Math.LN10) / plan.T[b], tail = (1 - plan.erShare) * plan.E[b] * ((2 * Bw) / sr), g2 = noiseGain2(type, fc, Ql, sr), a = Math.sqrt((tail * 2 * lam) / (g2 * sr));   // sum h^2 = a^2 g2 sr / (2 lam)
      eMean += plan.E[b] * Bw / (sr / 2);
      const src = off.createBufferSource(); src.buffer = noise; const bp = off.createBiquadFilter(); bp.type = type; bp.frequency.value = fc; bp.Q.value = type === "bandpass" ? Q : BUTT_DB;
      // envelope from 1 (Chrome snaps setTargetAtTime to its target once within 1.5e-6 of it, which would cut a quiet tail): the amplitude is a separate constant gain
      const g = off.createGain(); g.gain.setValueAtTime(0, 0); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(Math.exp(-lam * 0.02), t0 + 0.02); g.gain.setTargetAtTime(0, t0 + 0.02, 1 / lam); const amp = off.createGain(); amp.gain.value = a;
      src.connect(bp); bp.connect(g); g.connect(amp); amp.connect(off.destination); src.start(0);
    }
    const buf = await off.startRendering(), ch = nch === 2 ? [buf.getChannelData(0), buf.getChannelData(1)] : [buf.getChannelData(0)];
    // first reflections: sparse taps through a one-pole low-pass (HF wall absorption); total tap energy = erShare x mean E (flat spectrum): sum g^2 = erShare * eMean
    const taps = plan.taps.filter((q) => q.t < plan.len - 0.01), eT = taps.reduce((a, q) => a + q.g * q.g, 0) || 1, sc = Math.sqrt((plan.erShare * eMean) / eT), a1 = Math.exp((-TAU * plan.hf) / sr), norm = Math.sqrt((1 + a1) / (1 - a1));
    for (let c = 0; c < nch; c++) for (const q of taps) {
      const i0 = Math.round((q.t + (c ? 0.0007 : 0)) * sr), amp = q.g * sc * norm; let y = 0;
      for (let k = 0; k < 40 && i0 + k < N; k++) { y = (1 - a1) * (k === 0 ? amp : 0) + a1 * y; ch[c][i0 + k] += y; }
    }
    return buf;
  }
  AU.irPlanRoom = irPlanRoom; AU.irPlanStreet = irPlanStreet; AU.renderIR = renderIR;

  /* ===================================== 5. filter fitting ===================================== */
  /* A voice carries three biquads: a low-pass "tl" (everything smooth: transmission loss, diffraction, directivity, ground, foliage), a peaking "pk" (the 8 dB glass coincidence dip at 2 kHz) and a
     low-pass "air" (air absorption). The low-pass sections are fitted to the per-band target (dB re the best band) on the exact digital response of the Web Audio biquad (RBJ formulas, verified
     against BiquadFilterNode.getFrequencyResponse): a table of responses over cut-off x Q is built once per sample rate and searched by least squares; a negative Q (dB) gives two real poles = a straight
     -6 dB/oct slope over many octaves (the mass law, 125 Hz ... 8 kHz), Q = -3 dB a Butterworth knee. The gain offset follows in closed form. Results are memoised. */
  const FIT_F = []; for (let i = 0; i < 16; i++) FIT_F.push(BF[0] * Math.pow(2, i / 2));                   // 62.5 ... 11.3 kHz (the assets hold nothing above ~11 kHz), 2 points per octave
  const FC_GRID = []; for (let i = 0; i < 72; i++) FC_GRID.push(6 * Math.pow(21000 / 6, i / 71));
  const Q_GRID = [-50, -44, -38, -32, -26, -20, -14, -9, -6, -4.5, -3, -2, -1, 0, 1, 2, 3];
  const FIT_TAB = {};
  function lpMag2(fc, Qdb, f, sr) { const c = rbj("lowpass", Math.min(fc, 0.49 * sr), Math.pow(10, Qdb / 20), sr); return biquadMag2(c, (TAU * f) / sr); }
  function fitTable(sr) {
    if (FIT_TAB[sr]) return FIT_TAB[sr]; const tab = new Float32Array(FC_GRID.length * Q_GRID.length * FIT_F.length); let k = 0;
    for (const fc of FC_GRID) for (const q of Q_GRID) { const c = rbj("lowpass", Math.min(fc, 0.49 * sr), Math.pow(10, q / 20), sr); for (const f of FIT_F) tab[k++] = 10 * log10(biquadMag2(c, (TAU * f) / sr) + 1e-30); }
    return (FIT_TAB[sr] = tab);
  }
  function pkMagDb(fc, Q, gdb, f, sr) {
    const w0 = (TAU * fc) / sr, A = Math.pow(10, gdb / 40), al = Math.sin(w0) / (2 * Q), cw = Math.cos(w0), c = { b: [1 + al * A, -2 * cw, 1 - al * A], a: [1 + al / A, -2 * cw, 1 - al / A] };
    return 10 * log10(biquadMag2(c, (TAU * f) / sr));
  }
  const interpBands = (R, f) => { const u = Math.log2(f / BF[0]), i = clamp(Math.floor(u), 0, NB - 2), t = clamp(u - i, 0, 1); return R[i] + (R[i + 1] - R[i]) * t; };
  const FIT_MEMO = new Map();
  /* R: 8 band targets (dB, <= 0 re the best band); W: optional per-band weights (audibility: bands far below the loudest one hardly matter). kind "air": Q restricted to -6 .. +3 dB (knee shapes).
     Returns {fc, q, g0, err (max |error| at the band centres, dB), errW (same over the audible bands)} */
  function fitCurve(R, sr, kind = "rest", W) {
    const key = kind + sr + Array.from(R, (v) => Math.round(Math.max(v, -80) * 2)).join(",") + (W ? "w" + Array.from(W, (v) => Math.round(v * 4)).join("") : ""), hit = FIT_MEMO.get(key); if (hit) return hit;
    const tab = fitTable(sr), nf = FIT_F.length, tg = FIT_F.map((f) => Math.max(interpBands(R, f), -80)), w = FIT_F.map((f) => (f > 9000 ? 0.25 : f < 90 ? 0.6 : 1) * (W ? Math.max(0.02, interpBands(W, f)) : 1)); let sw = 0; for (const v of w) sw += v;
    let best = { c: Infinity }, k = 0;
    for (let i = 0; i < FC_GRID.length; i++) for (let j = 0; j < Q_GRID.length; j++, k += nf) {
      if (kind === "air" && Q_GRID[j] < -6) continue;
      let sd = 0; for (let m = 0; m < nf; m++) sd += w[m] * (tg[m] - tab[k + m]); const g0 = sd / sw; let e = 0; for (let m = 0; m < nf; m++) { const d = tg[m] - tab[k + m] - g0; e += w[m] * d * d; }
      if (e < best.c) best = { c: e, i, j, g0 };
    }
    let fc = FC_GRID[best.i], q = Q_GRID[best.j], g0 = best.g0, cst = best.c;                       // refine: cut-off +-3 %, Q +- 0.7 dB
    for (let it = 0; it < 30; it++) {
      let moved = false; for (const [a, b] of [[1.03, 0], [1 / 1.03, 0], [1, 0.7], [1, -0.7]]) {
        const fc2 = fc * a, q2 = clamp(q + b, kind === "air" ? -6 : -52, 3), c = rbj("lowpass", Math.min(fc2, 0.49 * sr), Math.pow(10, q2 / 20), sr), m = FIT_F.map((f) => 10 * log10(biquadMag2(c, (TAU * f) / sr) + 1e-30));
        let sd = 0; for (let t = 0; t < nf; t++) sd += w[t] * (tg[t] - m[t]); const gg = sd / sw; let e = 0; for (let t = 0; t < nf; t++) { const d = tg[t] - m[t] - gg; e += w[t] * d * d; }
        if (e < cst - 1e-6) { cst = e; fc = fc2; q = q2; g0 = gg; moved = true; }
      }
      if (!moved) break;
    }
    let maxe = 0, maxw = 0; for (let b = 0; b < NB; b++) { const er = Math.abs(10 * log10(lpMag2(fc, q, BF[b], sr)) + g0 - Math.max(R[b], -80)); maxe = Math.max(maxe, er); if (!W || W[b] > 0.5) maxw = Math.max(maxw, er); }
    const res = { fc, q, g0, err: maxe, errW: maxw, cost: cst }; if (FIT_MEMO.size > 4000) FIT_MEMO.clear(); FIT_MEMO.set(key, res); return res;
  }
  /* air absorption of a path of length L: R_b = -alpha_b L (memoised by length, 5 % steps) */
  function fitAir(L, sr) {
    const Lq = Math.pow(1.05, Math.round(Math.log(Math.max(L, 1)) / Math.log(1.05))), R = BF.map((f, b) => -ALPHA[b] * Lq);
    if (R[7] > -0.25) return { fc: 0.45 * sr, q: -3.01, g0: 0, err: 0, errW: 0 }; return fitCurve(R, sr, "air");
  }
  AU.fitCurve = fitCurve; AU.fitAir = fitAir; AU.lpMag2 = lpMag2; AU.pkMagDb = pkMagDb;

  /* ===================================== 6. engine: Web Audio graph, voices, listener ===================================== */
  /* Calibration: digital amplitude 1.0 (RMS) = CFG.dbfs dB SPL (unweighted), so a source of p Pa RMS plays at p / PA_FS. Playback level is relative (the master volume decides what the speakers do);
     the dB(A) numbers of the HUD are the physical level at the simulated ear.  Identities that listen through a microphone get a monitoring gain (recorder gain staging): the platform's own noise is
     loud (UAV 92 dB(A) at the microphone, dog 78) and would otherwise drown the ears. */
  const MON_DB = { human: 0, dog: -8, uav: -24 };
  const paFS = () => 20e-6 * lin(CFG.dbfs);
  const wp = (v, d = 0) => (Number.isFinite(v) ? v : d);
  class Voice {
    constructor(eng, idx) {
      const c = (this.ctx = eng.ctx); this.eng = eng; this.idx = idx; this.id = null; this.src = null; this.state = 0; this.prio = 0; this.mode = "hrtf"; this.t0 = 0; this.until = 0; this.outNode = null;
      const g = () => { const n = c.createGain(); n.gain.value = 0; return n; }, bq = (type, f, q) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
      this.gSrc = g(); this.gDist = g(); this.leak = g(); this.sendA = g(); this.sendB = g();
      this.lp1 = bq("lowpass", 20000, -3); this.pk = bq("peaking", 2000, 1.2); this.pk.gain.value = 0; this.lp2 = bq("lowpass", 20000, -3);
      this.pan = c.createPanner(); this.pan.panningModel = "HRTF"; this.pan.distanceModel = "inverse"; this.pan.refDistance = 1; this.pan.rolloffFactor = 0; this.pan.maxDistance = 1e5; this.st = c.createStereoPanner();
      this.gSrc.connect(this.gDist); this.gDist.connect(this.lp1); this.lp1.connect(this.pk); this.pk.connect(this.lp2); this.gDist.connect(this.leak); this.leak.connect(this.lp2); this.gSrc.connect(this.sendA); this.lp2.connect(this.sendB);
      this.sendA.connect(eng.rvIn); this.sendB.connect(eng.rvIn); this.pan.connect(eng.bus); this.st.connect(eng.bus);
    }
    route(mode) {                                                      // hrtf | mono | left | right
      if (mode === this.mode && this.outNode) return; if (this.outNode) { try { this.lp2.disconnect(this.outNode); } catch (e) {} }   // (mode "pan": equal-power panner driven by the bearing)
      this.outNode = mode === "hrtf" ? this.pan : this.st; this.lp2.connect(this.outNode); this.st.pan.value = mode === "left" ? -1 : mode === "right" ? 1 : 0; this.mode = mode;
    }
    /* set every parameter at once (a new assignment starts from silence at these values) */
    init(p) {
      const t = this.ctx.currentTime, f = (prm, v) => { prm.cancelScheduledValues(t); prm.setValueAtTime(wp(v), t); };
      f(this.gSrc.gain, 0); f(this.gDist.gain, p.gDist); f(this.lp1.frequency, p.fc1); f(this.lp1.Q, p.q1); f(this.pk.gain, p.pk); f(this.lp2.frequency, p.fc2); f(this.lp2.Q, p.q2); f(this.leak.gain, p.leak); f(this.sendA.gain, p.sendA); f(this.sendB.gain, p.sendB);
      if (p.pos) { f(this.pan.positionX, p.pos[0]); f(this.pan.positionY, p.pos[1]); f(this.pan.positionZ, p.pos[2]); } f(this.st.pan, p.pan || 0);
    }
    set(p, tc = 0.06) {
      const t = this.ctx.currentTime, s = (prm, v, k = tc) => { if (Number.isFinite(v)) prm.setTargetAtTime(v, t, k); };
      s(this.gSrc.gain, p.gSrc); s(this.gDist.gain, p.gDist); s(this.lp1.frequency, p.fc1); s(this.lp1.Q, p.q1); s(this.pk.gain, p.pk); s(this.lp2.frequency, p.fc2); s(this.lp2.Q, p.q2); s(this.leak.gain, p.leak);
      s(this.sendA.gain, p.sendA); s(this.sendB.gain, p.sendB);
      if (p.pos) { s(this.pan.positionX, p.pos[0], 0.04); s(this.pan.positionY, p.pos[1], 0.04); s(this.pan.positionZ, p.pos[2], 0.04); } if (p.pan !== undefined) s(this.st.pan, p.pan, 0.05);
      if (p.rate && this.src) s(this.src.playbackRate, p.rate, 0.04);
    }
    start(buf, o) {                                                      // o: {loop, offset, rate, when, dur, fadeIn}
      const t = this.ctx.currentTime, when = Math.max(o.when || t, t), s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = !!o.loop; s.playbackRate.value = o.rate || 1; s.connect(this.gSrc); this.src = s;
      const gain = o.gain === undefined ? 1 : o.gain, fi = o.fadeIn === undefined ? 0.04 : o.fadeIn; this.gSrc.gain.cancelScheduledValues(t); this.gSrc.gain.setValueAtTime(0, t); this.gSrc.gain.setValueAtTime(0, when); this.gSrc.gain.linearRampToValueAtTime(gain, when + fi);
      if (o.dur) { const end = when + o.dur / (o.rate || 1); this.gSrc.gain.setValueAtTime(gain, Math.max(when + fi, end - 0.006)); this.gSrc.gain.linearRampToValueAtTime(0, end); s.start(when, o.offset || 0, o.dur); this.until = end + 0.05; } else { s.start(when, o.offset || 0); this.until = 0; }
      s.onended = () => { if (this.src === s) { this.src = null; this.state = 0; this.id = null; } }; this.state = 1; this.t0 = when;
    }
    release(fade = 0.12) {
      if (this.state !== 1) return; const t = this.ctx.currentTime; this.state = 2; this.gSrc.gain.cancelScheduledValues(t); this.gSrc.gain.setValueAtTime(this.gSrc.gain.value, t); this.gSrc.gain.linearRampToValueAtTime(0, t + fade);
      const s = this.src; if (s) { try { s.stop(t + fade + 0.02); } catch (e) {} } setTimeout(() => { if (this.state === 2) { this.state = 0; this.id = null; this.src = null; } }, (fade + 0.08) * 1000);
    }
  }
  class Engine {
    constructor(ctx, o = {}) {
      this.ctx = ctx; this.sr = ctx.sampleRate; const c = ctx; this.body = "human"; this.listener = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }; this.buffers = {}; this.man = null; this.volDb = 0; this.muted = false; this.o = o;
      this.bus = c.createGain(); this.rvIn = c.createGain(); this.mon = c.createGain(); this.vol = c.createGain(); this.hp = c.createBiquadFilter(); this.hp.type = "highpass"; this.hp.frequency.value = 28; this.hp.Q.value = -3;
      this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.knee.value = 8; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
      this.mk = c.createGain(); this.mk.gain.value = 1; this.shaper = c.createWaveShaper(); const cv = new Float32Array(4097); for (let i = 0; i <= 4096; i++) cv[i] = Math.tanh((i / 2048 - 1) * 1.0); this.shaper.curve = cv; this.shaper.oversample = "2x";
      this.ana = c.createAnalyser(); this.ana.fftSize = 2048; this.anaBuf = new Float32Array(2048);
      this.bus.connect(this.mon); this.mon.connect(this.vol); this.vol.connect(this.hp); this.hp.connect(this.comp); this.comp.connect(this.mk); this.mk.connect(this.shaper); this.shaper.connect(c.destination); this.bus.connect(this.ana);
      this.rv = [0, 1].map(() => { const conv = c.createConvolver(); conv.normalize = false; const g = c.createGain(); g.gain.value = 0; this.rvIn.connect(conv); conv.connect(g); g.connect(this.bus); return { conv, g, key: null }; }); this.rvCur = -1; this.rvBusy = false;
      this.voices = Array.from({ length: o.voices || CFG.maxVoices }, (_, i) => new Voice(this, i)); this.setBody("human"); this.setVolume(0);
    }
    setBody(b) { this.body = b; this.mon.gain.setTargetAtTime(lin(MON_DB[b] ?? 0), this.ctx.currentTime, 0.1); }
    setVolume(db) { this.volDb = db; this.vol.gain.setTargetAtTime(this.muted ? 0 : lin(db), this.ctx.currentTime, 0.04); }
    setMuted(m) { this.muted = m; this.vol.gain.setTargetAtTime(m ? 0 : lin(this.volDb), this.ctx.currentTime, 0.04); }
    /* listener: position, orientation (ENU yaw CCW from +x, pitch up); Web Audio frame = (x, z, -y), which is right-handed */
    setListener(L) {
      const l = this.ctx.listener, cp = Math.cos(L.pitch), sp = Math.sin(L.pitch), cy = Math.cos(L.yaw), sy = Math.sin(L.yaw), t = this.ctx.currentTime, a = AU.A2W;
      this.listener = L; const fwd = [cy * cp, sy * cp, sp], up = [-sp * cy, -sp * sy, cp], P = a(L.x, L.y, L.z), F = a(...fwd), U = a(...up);
      const set = (prm, v) => { if (prm.setValueAtTime) prm.setValueAtTime(v, t); else prm.value = v; };
      if (l.positionX) { set(l.positionX, P[0]); set(l.positionY, P[1]); set(l.positionZ, P[2]); set(l.forwardX, F[0]); set(l.forwardY, F[1]); set(l.forwardZ, F[2]); set(l.upX, U[0]); set(l.upY, U[1]); set(l.upZ, U[2]); }
      else { l.setPosition(...P); l.setOrientation(F[0], F[1], F[2], U[0], U[1], U[2]); }
    }
    acquire(prio, id) {
      let free = this.voices.find((v) => v.state === 0 && (v.until === 0 || v.until < this.ctx.currentTime)); if (free) return free;
      let victim = null; for (const v of this.voices) if (v.state === 1 && v.prio < prio && (!victim || v.prio < victim.prio)) victim = v; if (victim) { victim.release(0.05); } return null;
    }
    active() { return this.voices.filter((v) => v.state === 1).length; }
    /* decode the manifest assets (the context decodes to its own sample rate) */
    async load(base, names) {
      if (!this.man) this.man = await (await fetch(base + "manifest.json", { cache: "no-cache" })).json();
      const todo = (names || Object.keys(this.man.assets)).filter((n) => !this.buffers[n] && this.man.assets[n]);
      await Promise.all(todo.map(async (n) => { try { const ab = await (await fetch(base + this.man.assets[n].file)).arrayBuffer(); this.buffers[n] = await this.ctx.decodeAudioData(ab); } catch (e) { console.warn("audio asset", n, e); this.buffers[n] = null; } }));
      return this.man;
    }
    /* reverb of the listener's current space: build the impulse response (native offline render), assign it to the idle convolver, cross-fade over 0.35 s */
    async setReverb(plan) {
      if (!plan || !CFG.reverb) return; const cur = this.rv[this.rvCur], idle = this.rv[this.rvCur < 0 ? 0 : 1 - this.rvCur]; if (cur && cur.key === plan.key) return; if (this.rvBusy) { this.rvPending = plan; return; }
      this.rvBusy = true; let buf; try { buf = await renderIR(this.sr, plan); } catch (e) { this.rvBusy = false; return; }
      const t = this.ctx.currentTime; idle.conv.buffer = buf; idle.key = plan.key; idle.g.gain.cancelScheduledValues(t); idle.g.gain.setValueAtTime(0, t); idle.g.gain.linearRampToValueAtTime(1, t + 0.35);
      if (cur) { cur.g.gain.cancelScheduledValues(t); cur.g.gain.setValueAtTime(cur.g.gain.value, t); cur.g.gain.linearRampToValueAtTime(0, t + 0.35); cur.key = null; setTimeout(() => { if (cur.key === null && cur !== this.rv[this.rvCur]) cur.conv.buffer = null; }, 700); }
      this.rvCur = this.rvCur < 0 ? 0 : 1 - this.rvCur; this.rvBusy = false; this.irPlan = plan;
      if (this.rvPending) { const q = this.rvPending; this.rvPending = null; this.setReverb(q); }
    }
    level() { this.ana.getFloatTimeDomainData(this.anaBuf); let s = 0; for (let i = 0; i < this.anaBuf.length; i++) s += this.anaBuf[i] * this.anaBuf[i]; return 10 * log10(s / this.anaBuf.length + 1e-20); }   // dBFS (RMS) before master volume
  }
  /* world (ENU: x east, y north, z up) -> Web Audio frame, the one used by listener and panners */
  AU.A2W = (x, y, z) => [x, z, -y];
  AU.Engine = Engine; AU.Voice = Voice; AU.MON_DB = MON_DB;

  /* ===================================== 7. sources, mixing ===================================== */
  const Q_OF = { omni: 1, speech: 2.2, horn: 5, rotor: 1.3, cardioid: 3 };
  const TAG = { direct: "直达", same: "同室", wall: "穿墙", diffr: "绕射", portal: "门窗", blocked: "遮挡", self: "自身", bed: "环境" };
  /* a looping sound source of the scene (one-shots go through Mixer.shot). Behaviours move it and set dyn / rate / active each frame. */
  class Src {
    constructor(o) {
      Object.assign(this, { id: "", name: "", asset: "", levelDb: 0, dyn: 0, rate: 1, mode: "hrtf", spread: "sphere", prio: 0, dir: null, axis: [1, 0, 0], pos: [0, 0, 0], vel: [0, 0, 0], active: true, diffuse: false, self: false, selfDist: 0.25,
        offset: Math.random(), cylRef: 20, an: null, anT: -9, lvl: -99, lvlA: -99, lvlB: -99, tag: "", az: 0, dist: 0, vA: null, vB: null, pA: null, pB: null, doppler: true, phase0: 0, startT: 0 }, o);
    }
  }
  const dirOf = (src, man) => src.dir || (man && man.dir) || null;
  /* Mixer: owns the engine, the geometry of the current scene, the sources and the per-frame update. */
  class Mixer {
    constructor(eng, geo, env) {
      this.eng = eng; this.geo = geo; this.env = env; this.srcs = new Map(); this.L = { x: 0, y: 0, z: 1.6, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, body: "human", space: { bld: null, room: null, key: "out" }, key: "out" }; this.t = 0; this.floorDba = 40;
      this.bedTL = new Float32Array(NB); this.bedT = -9; this.bedDba = 0; this.lamb = 45; this.ego = -99; this.list = []; this.spl = 0; this.splBands = new Float32Array(NB); this.stats = { an: 0, anMs: 0, fits: 0, shots: 0, dropped: 0 }; this.frame = 0; this.canyon = 0.4;
    }
    get man() { return this.eng.man ? this.eng.man.assets : {}; }
    add(s) { this.srcs.set(s.id, s); return s; }
    remove(id) { const s = this.srcs.get(id); if (s) { this.drop(s); this.srcs.delete(id); } }
    drop(s) { for (const k of ["vA", "vB"]) { if (s[k]) { s[k].release(0.15); s[k] = null; } } }
    /* ---- listener ---- */
    setListener(L) {
      const o = this.L, dt = Math.max(1e-3, L.dt || 0.016);
      let vx = (L.x - o.x) / dt, vy = (L.y - o.y) / dt, vz = (L.z - o.z) / dt; if (L.reset || Math.hypot(vx, vy, vz) > 60) vx = vy = vz = 0; const k = Math.min(1, dt * 8);
      L.vx = o.vx + (vx - o.vx) * k; L.vy = o.vy + (vy - o.vy) * k; L.vz = o.vz + (vz - o.vz) * k; L.space = this.geo.roomAt(L.x, L.y, L.z); L.key = L.space.key; this.L = Object.assign(o, L); this.eng.setListener(this.L);
    }
    /* diffuse-field transmission of the outside into the listener's space: 16 rays to 60 m, energy average of the mass-law transmission (open doors / windows are free paths; leak floor 5e-4 as the
       Python facade model); outdoors it is 0 dB */
    updateBed(now) {
      if (now - this.bedT < 0.3) return; this.bedT = now; const L = this.L; if (!L.space.bld) { this.bedTL.fill(0); this.bedDba = 0; return; }
      const tau = new Float64Array(NB), R = [L.x, L.y, L.z];
      for (let i = 0; i < 16; i++) { const a = (TAU * i) / 8, el = i < 8 ? 0.15 : 0.9, c = Math.cos(el), Q = [R[0] + 60 * c * Math.cos(a), R[1] + 60 * c * Math.sin(a), R[2] + 60 * Math.sin(el) + 2], t = this.geo.tlBands(Q, R); for (let b = 0; b < NB; b++) tau[b] += Math.pow(10, -t.tl[b] / 10); }
      for (let b = 0; b < NB; b++) this.bedTL[b] = -10 * log10(tau[b] / 16 + 5e-4);
      this.bedDba = -dbA(Array.from(this.bedTL, (v) => -v));                                      // A-weighted attenuation of a flat spectrum (indicative)
    }
    /* per-band loss (dB re 1 m), air absorption and arrival geometry of one source along path A (straight / transmitted) or B (diffracted) */
    pathLoss(src, an, which, man) {
      const L = this.L, S = src.pos, R = [L.x, L.y, L.z], loss = new Float32Array(NB), air = new Float32Array(NB);
      if (src.self) { const d = Math.max(src.selfDist, 0.05); loss.fill(20 * log10(d)); return { loss, air, d, Lp: d, app: R, dirV: [0, 0, 1], nGlass: 0 }; }
      if (src.diffuse) { for (let b = 0; b < NB; b++) loss[b] = this.bedTL[b]; return { loss, air, d: 10, Lp: 10, app: R, dirV: [0, 0, 1], nGlass: 0 }; }
      const d = an.d; let app = S, nGlass = 0, Lp = d;
      if (which === "A") { for (let b = 0; b < NB; b++) { loss[b] = an.A[b]; air[b] = an.air[b]; } nGlass = an.nGlass; } else { const B = an.B; for (let b = 0; b < NB; b++) loss[b] = B.loss[b]; app = B.pos; Lp = B.L; }
      if (src.spread === "cyl") { const dd = Math.max(d, 6); for (let b = 0; b < NB; b++) loss[b] += 10 * log10(dd / src.cylRef) - 20 * log10(Math.max(d, 0.05)); }
      else if (src.spread === "none") { for (let b = 0; b < NB; b++) loss[b] -= 20 * log10(Math.max(d, 0.05)); }
      const dr = dirOf(src, man), dl = hyp(R[0] - app[0], R[1] - app[1], R[2] - app[2]) || 1, dirV = [(R[0] - app[0]) / dl, (R[1] - app[1]) / dl, (R[2] - app[2]) / dl];
      if (dr && dr.type !== "omni") {                                                         // directivity at the departure direction (source -> first path vertex, or -> listener)
        const q = which === "A" ? dirV : (() => { const v = [app[0] - S[0], app[1] - S[1], app[2] - S[2]], l = hyp(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; })();
        const cs = q[0] * src.axis[0] + q[1] * src.axis[1] + q[2] * src.axis[2]; for (let b = 0; b < NB; b++) loss[b] -= dirDb(dr, cs, b);
      }
      return { loss, air, d, Lp, app, dirV, nGlass };
    }
    spaceOf(src) { if (src.spaceCache && src.spaceVer === this.geo.ver && Math.abs(src.spaceX - src.pos[0]) + Math.abs(src.spaceY - src.pos[1]) + Math.abs(src.spaceZ - src.pos[2]) < 0.3) return src.spaceCache; src.spaceVer = this.geo.ver; src.spaceX = src.pos[0]; src.spaceY = src.pos[1]; src.spaceZ = src.pos[2]; return (src.spaceCache = this.geo.roomAt(src.pos[0], src.pos[1], src.pos[2])); }
    /* voice parameters of a path: filter fit (tl low-pass + glass peak + air low-pass), gains, reverb sends; also the per-band level at the ear */
    voiceParams(src, pl, which, m, kind) {
      const sr = this.eng.sr, T = new Float32Array(NB), Labs = new Float32Array(NB), lv = src.levelDb + src.dyn; let Tmax = -1e9, Lmax = -1e9;
      for (let b = 0; b < NB; b++) { T[b] = -pl.loss[b]; if (T[b] > Tmax) Tmax = T[b]; }
      for (let b = 0; b < NB; b++) { Labs[b] = m.bands_db[b] + lv + T[b] - pl.air[b]; if (Labs[b] > Lmax) Lmax = Labs[b]; }
      const R = new Float32Array(NB), W = new Float32Array(NB), pkG = which === "A" ? 8 * pl.nGlass : 0;
      for (let b = 0; b < NB; b++) { R[b] = T[b] - Tmax - (pkG ? pkMagDb(2000, 1.2, pkG, BF[b], sr) : 0); W[b] = clamp(1 - (Lmax - Labs[b] - 15) / 30, 0.02, 1); }
      const fr = fitCurve(R, sr, "rest", W), fa = fitAir(pl.Lp || pl.d, sr); this.stats.fits++;
      const sp = this.L.space, same = src.self || src.diffuse || this.spaceOf(src).key === sp.key; let sendA = 0, sendB = 0;
      if (CFG.reverb && !src.noVerb) { if (same) sendA = 1 / Math.sqrt(Q_OF[(dirOf(src, m) || {}).type || "omni"] || 1); else if (sp.bld) sendB = Math.sqrt((kind === "portal" ? 2 : 10) / (16 * PI)); }
      return { gSrcBase: m.gain_pa / paFS(), gDist: lin(Tmax + fr.g0 + fa.g0), fc1: fr.fc, q1: fr.q, pk: pkG, fc2: fa.fc, q2: fa.q, leak: 0, sendA, sendB, dba: dbA(Labs), Labs, err: fr.errW, same };
    }
    /* refresh the analysis of one source: geometry, both paths, parameters, level, tag */
    refresh(src, now) {
      const m = this.man[src.asset]; if (!m) return; const L = this.L, t0 = performance.now(); src.anT = now; src.vers = this.geo.ver;
      if (src.self || src.diffuse) {
        src.an = null; const pl = this.pathLoss(src, null, "A", m); src.pl = pl; src.pA = this.voiceParams(src, pl, "A", m, "direct"); src.pB = null; src.lvlA = src.pA.dba; src.lvlB = -99; src.lvl = src.lvlA; src.tag = src.self ? "self" : "bed"; src.dist = src.self ? src.selfDist : 0; src.az = 0; return;
      }
      const an = analyze(this.env, src.pos, [L.x, L.y, L.z], {}); src.an = an; this.stats.an++;
      const plA = this.pathLoss(src, an, "A", m), pA = this.voiceParams(src, plA, "A", m, "direct"); src.pl = plA; src.pA = pA; src.dist = an.d;
      let pB = null, plB = null; if (an.B) { plB = this.pathLoss(src, an, "B", m); pB = this.voiceParams(src, plB, "B", m, an.B.kind); }
      src.plB = plB; src.pB = pB; src.lvlA = pA.dba; src.lvlB = pB ? pB.dba : -99; src.lvl = eSum([src.lvlA, src.lvlB]);
      const dl = hyp(src.pos[0] - L.x, src.pos[1] - L.y), brg = Math.atan2(src.pos[1] - L.y, src.pos[0] - L.x) - L.yaw; src.az = (ES.deg(ES.wrapPi(brg)) * -1);   // + = to the right of the heading
      if (pB && src.lvlB > src.lvlA) { const q = [plB.app[0] - L.x, plB.app[1] - L.y]; src.az = -ES.deg(ES.wrapPi(Math.atan2(q[1], q[0]) - L.yaw)); }
      const sameRoom = this.spaceOf(src).key === L.space.key;
      src.tag = pB && src.lvlB > src.lvlA - 1 ? (an.B.kind === "portal" ? "portal" : "diffr") : an.blocked ? "wall" : sameRoom && L.space.bld ? "same" : "direct";
      this.stats.anMs += performance.now() - t0;
    }
    nHrtf() { let n = 0; for (const v of this.eng.voices) if (v.state === 1 && v.mode === "hrtf") n++; return n; }
    outMode(s) { if (this.L.body === "uav") return "mono"; if (s.mode === "left" || s.mode === "right") return s.mode; if (s.self || s.mode === "mono") return "mono"; return CFG.hrtf && this.nHrtf() < CFG.hrtfVoices ? "hrtf" : "pan"; }
    /* position that the panner uses (Web Audio frame): the apparent source of the path */
    panPos(src, which) { const pl = which === "A" ? src.pl : src.plB; const a = pl && pl.app && which === "B" ? pl.app : src.pos; return AU.A2W(a[0], a[1], a[2]); }
    /* Doppler factor of a path: (c - v_listener . n) / (c - v_source . n), n = unit vector source -> listener */
    dopplerOf(src, which) {
      if (!CFG.doppler || !src.doppler || src.self || src.diffuse) return 1; const L = this.L, a = which === "B" && src.plB ? src.plB.app : src.pos; let nx = L.x - a[0], ny = L.y - a[1], nz = L.z - a[2]; const l = hyp(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const vs = src.vel[0] * nx + src.vel[1] * ny + src.vel[2] * nz, vl = L.vx * nx + L.vy * ny + L.vz * nz; return clamp((CL.c - vl) / (CL.c - vs), 0.7, 1.4);
    }
    /* the frame update: refresh analyses (budgeted), keep the loudest sources on voices, update dynamic parameters. Events are fired by behaviours through shot(). */
    update(dt, now) {
      this.t = now; this.frame++; this.updateBed(now); const eng = this.eng, L = this.L, mans = this.man; this.stats.shots = 0;
      // ambient floor (what masks): the lab's urban background, attenuated indoors; the platform's own noise for microphones
      this.floorDba = Math.max(this.lamb - this.bedDba * 0.5, 12);
      const all = []; let ego = -99; for (const s of this.srcs.values()) { if (s.active && mans[s.asset]) { all.push(s); if (s.self && s.lvl > ego) ego = s.lvl; } else if (s.vA || s.vB) this.drop(s); }
      this.ego = ego; if (ego > -90) this.floorDba = Math.max(this.floorDba, ego - 6); if (this.noCull) this.floorDba = -200;
      // cheap level estimate between analyses, due list
      const due = []; for (const s of all) {
        if (s.self || s.diffuse) { if (now - s.anT > 0.2 || s.vers !== this.geo.ver) due.push(s); continue; }
        const d = Math.max(hyp(s.pos[0] - L.x, s.pos[1] - L.y, s.pos[2] - L.z), 0.3), m = mans[s.asset], est = m.level_dba + s.levelDb + s.dyn + (s.spread === "cyl" ? -10 * log10(Math.max(d, 6) / s.cylRef) : s.spread === "none" ? 0 : -20 * log10(d));
        s.est = est; const ago = now - s.anT, per = s.lvl > this.floorDba - 6 ? 0.1 : 0.4; if (est < this.floorDba - 24 && !s.vA) { s.lvl = est - 20; s.anT = now - per * 0.5; continue; }
        if (ago > per || s.vers !== this.geo.ver) due.push(s);
      }
      due.sort((a, b) => a.anT - b.anT); for (const s of due.slice(0, 7)) this.refresh(s, now);
      // voice assignment: the loudest first, hysteresis
      const cand = all.filter((s) => s.lvl > this.floorDba - 15 || s.vA || s.self), thr = (s) => (s.vA ? this.floorDba - 20 : this.floorDba - 12);
      cand.sort((a, b) => b.lvl + b.prio - (a.lvl + a.prio)); let nLoop = eng.voices.filter((v) => v.state === 1 && v.kind === "loop").length;
      const maxLoops = Math.max(4, eng.voices.length - 8);
      for (const s of cand) {
        const m = mans[s.asset], want = (s.self || s.diffuse || s.lvl > thr(s)) && s.pA;
        if (want) {
          if (!s.vA && nLoop < maxLoops) { const v = eng.acquire(s.prio + 5, s.id); if (v) { this.startVoice(v, s, "A", m); s.vA = v; nLoop++; } }
          const wantB = s.pB && s.lvlB > thr(s) && s.lvlB > s.lvlA - 15;
          if (wantB && !s.vB && nLoop < maxLoops) { const v = eng.acquire(s.prio + 4, s.id + "#B"); if (v) { this.startVoice(v, s, "B", m); s.vB = v; nLoop++; } }
          if (!wantB && s.vB && !(s.pB && s.lvlB > thr(s) - 6)) { s.vB.release(0.2); s.vB = null; nLoop--; }
        } else {
          for (const k of ["vA", "vB"]) if (s[k]) { s[k].release(0.25); s[k] = null; nLoop--; }
        }
      }
      for (const s of all) for (const k of ["vA", "vB"]) { const v = s[k]; if (v && v.state !== 1) s[k] = null; }
      // parameters of the sounding voices
      for (const s of all) {
        const m = mans[s.asset];
        for (const [k, which, p] of [["vA", "A", s.pA], ["vB", "B", s.pB]]) {
          const v = s[k]; if (!v || !p) continue; const lv = s.levelDb + s.dyn, rate = (s.rate || 1) * this.dopplerOf(s, which);
          const par = { gSrc: p.gSrcBase * lin(lv), gDist: p.gDist, fc1: p.fc1, q1: p.q1, pk: p.pk, fc2: p.fc2, q2: p.q2, leak: p.leak, sendA: p.sendA, sendB: p.sendB, rate };
          if (v.mode === "hrtf") par.pos = this.panPos(s, which); else if (v.mode === "pan") par.pan = Math.sin((s.az * PI) / 180); else if (s.mode === "left" || s.mode === "right") par.pan = s.mode === "left" ? -1 : 1;
          v.set(par, s.vers !== undefined && now - s.anT < 0.03 ? 0.05 : 0.07);
        }
      }
      // overall level at the ear: energy sum of the sources in the list
      const ls = all.filter((s) => s.lvl > -20 && (s.vA || s.vB || s.lvl > this.floorDba - 6)); let e = 0; for (const s of ls) e += Math.pow(10, s.lvl / 10);
      const inst = 10 * log10(e + 1e-9); this.spl = this.spl + (inst - this.spl) * Math.min(1, dt / 0.6) + (this.spl === 0 ? inst : 0); this.list = ls.sort((a, b) => b.lvl - a.lvl);
    }
    startVoice(v, s, which, m) {
      const p = which === "A" ? s.pA : s.pB, pl = which === "A" ? s.pl : s.plB, mode = this.outMode(s);
      v.kind = "loop"; v.id = s.id + (which === "B" ? "#B" : ""); v.prio = s.prio + 5; v.route(mode); const buf = this.eng.buffers[s.asset]; if (!buf) { v.state = 0; return; }
      const lv = s.levelDb + s.dyn, rate = (s.rate || 1) * this.dopplerOf(s, which);
      v.init({ gDist: p.gDist, fc1: p.fc1, q1: p.q1, pk: p.pk, fc2: p.fc2, q2: p.q2, leak: p.leak, sendA: p.sendA, sendB: p.sendB, pos: mode === "hrtf" ? this.panPos(s, which) : null, pan: s.mode === "left" ? -1 : s.mode === "right" ? 1 : mode === "pan" ? Math.sin((s.az * PI) / 180) : 0 });
      v.start(buf, { loop: true, offset: ((s.offset % 1) * buf.duration) % buf.duration, rate, gain: p.gSrcBase * lin(lv), fadeIn: 0.12 });
    }
    /* one-shot: fire an event sound now (footstep, bark ...) from position pos (ENU) with an optional delay (propagation time added here). opts: {slot, levelDb, mode, prio, self, selfDist, dir, axis, noDelay, rate} */
    shot(asset, pos, o = {}) {
      const m = this.man[asset], eng = this.eng, buf = eng.buffers[asset]; if (!m || !buf) return null; const L = this.L; this.stats.shots++;
      const src = new Src({ id: "shot:" + asset, asset, pos, levelDb: o.levelDb || 0, dyn: 0, self: !!o.self, selfDist: o.selfDist || 0.3, dir: o.dir, axis: o.axis || [1, 0, 0], mode: o.mode || "hrtf", spread: "sphere", prio: o.prio || 0, noVerb: o.noVerb });
      let pl, p, an = null, d = o.self ? src.selfDist : 1;
      if (o.self) { pl = this.pathLoss(src, null, "A", m); p = this.voiceParams(src, pl, "A", m, "direct"); }
      else {
        an = analyze(this.env, pos, [L.x, L.y, L.z], {}); d = an.d; pl = this.pathLoss(src, an, "A", m); p = this.voiceParams(src, pl, "A", m, "direct"); src.pl = pl;
        if (an.B) { const plB = this.pathLoss(src, an, "B", m), pB = this.voiceParams(src, plB, "B", m, an.B.kind); if (pB.dba > p.dba - 6) { src.plB = plB; return this._fire(src, m, buf, pB, "B", o, d, an) || this._fire(src, m, buf, p, "A", o, d, an); } }
      }
      return this._fire(src, m, buf, p, "A", o, d, an);
    }
    _fire(src, m, buf, p, which, o, d, an) {
      const eng = this.eng, floor = this.floorDba; if (p.dba < floor - 14 && !o.force) { this.stats.dropped++; return null; }
      const v = eng.acquire((o.prio || 0) + 2, src.id); if (!v) { this.stats.dropped++; return null; }
      const mode = this.L.body === "uav" ? "mono" : o.mode === "mono" || o.self ? "mono" : CFG.hrtf && this.nHrtf() < CFG.hrtfVoices + 2 ? "hrtf" : "pan"; v.kind = "shot"; v.id = src.id; v.prio = (o.prio || 0) + 2; v.route(mode);
      const delay = o.self || o.noDelay ? 0 : d / CL.c, slot = o.slot !== undefined && m.slots ? m.slots[o.slot % m.slots.length] : null, lv = src.levelDb, rate = o.rate || 1, pos = mode === "hrtf" ? this.panPos(src, which) : null;
      v.init({ gDist: p.gDist, fc1: p.fc1, q1: p.q1, pk: p.pk, fc2: p.fc2, q2: p.q2, leak: 0, sendA: p.sendA, sendB: p.sendB, pos, pan: mode === "pan" ? Math.sin(-ES.wrapPi(Math.atan2(src.pos[1] - this.L.y, src.pos[0] - this.L.x) - this.L.yaw)) : 0 });
      v.start(buf, { loop: false, offset: slot ? slot[0] : 0, dur: slot ? slot[1] : m.dur, rate, gain: p.gSrcBase * lin(lv), when: eng.ctx.currentTime + delay + 0.005, fadeIn: 0.002 });
      this.stats.fired = (this.stats.fired || 0) + 1; this.lastShots = this.lastShots || []; this.lastShots.push({ t: this.t, asset: src.asset, dba: p.dba, d, delay }); if (this.lastShots.length > 12) this.lastShots.shift();
      return p;
    }
  }
  AU.Mixer = Mixer; AU.Src = Src; AU.TAG = TAG;

  /* ===================================== 9. test hooks (offline rendering, measurements) ===================================== */
  const BASE = () => (ES.ASSET_DIR || "assets") + "/audio/";
  /* geometry + raster + ground of a scene without WebGL (the lab state may not have loaded it) */
  AU.loadScene = async function (name, variant = "day") {
    const bim = await ES.bimLoad(name), sc = await ES.loadJSON(`${ES.DATA_DIR}/scene_${name}.json`), W = new ES.World(sc, variant), geo = new Geo(bim, sc, W), surf = new Surf(sc, W);
    return { name, bim, sc, W, geo, surf, env: new Env(geo, W, surf) };
  };
  /* render a scripted scenario with the real engine into an OfflineAudioContext: o = {scene (object of loadScene), dur, step, sr, assets: [...], listener(t) -> {x,y,z,yaw,pitch,body}, setup(mixer, eng), tick(t, mixer)}
     returns {L, R (Float32Array), sr, mixer, eng, wall_ms} */
  AU.offlineRender = async function (o) {
    const sr = o.sr || 48000, N = Math.round(o.dur * sr), ctx = new OfflineAudioContext(2, N, sr), eng = new Engine(ctx, { voices: o.voices }); await eng.load(BASE(), o.assets);
    if (o.body) eng.setBody(o.body); if (o.volDb !== undefined) eng.setVolume(o.volDb); if (o.noMaster) { eng.mon.gain.value = 1; eng.comp.threshold.value = 0; eng.comp.ratio.value = 1; }
    const sc = o.scene || (await AU.loadScene(o.sceneName || "mainstreet")), mx = new Mixer(eng, sc.geo, sc.env); mx.lamb = o.lamb ?? 45; if (o.setup) await o.setup(mx, eng, ctx);
    if (o.reverb) { const t1 = performance.now(); await eng.setReverb(o.reverb); eng.irMs = performance.now() - t1; }
    const step = o.step || 0.02, t0w = performance.now(), upd = async (t) => { const L = o.listener(t); L.dt = step; L.body = L.body || o.body || "human"; if (t === 0) L.reset = true; mx.setListener(L); if (o.tick) await o.tick(t, mx, eng); mx.update(step, t); };
    await upd(0); const quantum = 128 / sr;
    for (let t = step; t < o.dur - step; t += step) { const tq = Math.ceil(t / quantum) * quantum; ctx.suspend(tq).then(async () => { await upd(tq); ctx.resume(); }); }
    const buf = await ctx.startRendering(); return { L: buf.getChannelData(0), R: buf.getChannelData(1), sr, mixer: mx, eng, wall_ms: performance.now() - t0w, ctx };
  };
  /* tone / band level measurement helpers */
  const T = (AU.test = AU.test || {});
  T.goertzel = function (x, sr, f, i0 = 0, i1 = x.length) {                  // RMS amplitude of the component at f (Hann window)
    const n = i1 - i0, w = TAU * f / sr; let re = 0, im = 0, ws = 0; for (let i = 0; i < n; i++) { const h = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1)), v = x[i0 + i] * h; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); ws += h; }
    return (Math.hypot(re, im) / ws) * Math.SQRT2 / Math.SQRT2;                // peak amplitude / sqrt2 = RMS: (|X| 2/ws) / sqrt2 = |X| sqrt2 / ws
  };
  T.rms = (x, i0 = 0, i1 = x.length) => { let s = 0; for (let i = i0; i < i1; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
  T.fft = function (re, im) {                                                // in-place radix-2 FFT (n power of two)
    const n = re.length; for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) { const ang = (-TAU) / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = i + k + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  };
  /* octave-band levels (dB, arbitrary ref) of a segment via Hann-windowed FFT (mean square within the band edges) */
  T.bands = function (x, sr, i0 = 0, i1 = x.length) {
    let n = 1; while (n < i1 - i0) n <<= 1; n >>= 1; n = Math.min(n, 1 << 17); const re = new Float64Array(n), im = new Float64Array(n); let ws = 0; for (let i = 0; i < n; i++) { const h = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1)); re[i] = x[i0 + i] * h; ws += h * h; }
    T.fft(re, im); const out = new Float32Array(NB); for (let b = 0; b < NB; b++) { const lo = b === 0 ? 0 : BF[b] / Math.SQRT2, hi = b === NB - 1 ? sr / 2 : BF[b] * Math.SQRT2; let e = 0; for (let k = Math.ceil((lo * n) / sr); k < Math.floor((hi * n) / sr); k++) e += (re[k] * re[k] + im[k] * im[k]) * (k === 0 ? 1 : 2); out[b] = 10 * log10(e / (ws * n) + 1e-30); } return out;
  };
  T.b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  Object.assign(T, { Geo, Surf, Env, Engine, Mixer, Src, analyze, kaIL, diffIL, groundDb, tlOne, alphaISO, dirDb, dbA, renderIR, irPlanRoom, irPlanStreet, fitCurve, fitAir, march, cornerPath, roofPath, portalPath, absBands, ABS_SHAPE, noiseGain2 });

  /* ===================================== 8. runtime: behaviours, HUD, keys ===================================== */
  const LSK = "esw-audio", prefLoad = () => { try { return Object.assign({ on: false, vol: 0.7, mute: false }, JSON.parse(localStorage.getItem(LSK) || "{}")); } catch (e) { return { on: false, vol: 0.7, mute: false }; } };
  const S = (AU.S = { ctx: null, eng: null, mx: null, scn: null, V: null, loading: false, err: "", frame: 0, rvKey: "", pref: prefLoad(), lv: {}, step: {}, ev: {}, tree: { t: -9, ids: [] }, hudT: 0, t: 0, scnKey: "", rooms: { t: -9 }, canyon: { t: -9, c: 0.4, d: [] }, bound: false });
  const prefSave = (o) => { Object.assign(S.pref, o); try { localStorage.setItem(LSK, JSON.stringify(S.pref)); } catch (e) {} };
  const volDb = () => -40 + 60 * S.pref.vol;
  const hash = (a, b = 0) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
  const gauss = () => { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) * 1.7; };
  const NAMES = { rotor: "无人机旋翼", dog_servo: "机械狗电机", rover: "配送机器人", birds_a: "鸟鸣", birds_b: "鸟鸣", wind_trees: "风吹树叶", traffic: "远处车流", crickets: "夜虫", siren_wail: "救护车警笛", siren_yelp: "警笛", car: "汽车驶过", dog_bark: "狗叫", hvac: "空调风机", fridge: "冰箱嗡嗡", generator: "发电机", transformer: "变压器嗡声", school_bell: "校铃", phone_ring: "手机铃声", horn: "汽车喇叭", fire: "火焰声", creak: "结构吱嘎", speech_help_m: "呼救", speech_help_f: "呼救", speech_anyone_m: "喊\"有人吗\"", speech_anyone_f: "喊\"有人吗\"", speech_conv_m: "说话声", speech_conv_f: "说话声", speech_overhere_m: "喊话", speech_babble: "人群嘈杂", breath_rest: "自己的呼吸", breath_hard: "自己的喘息", cloth: "衣物摩擦", windmic: "麦克风风噪", steps_concrete: "脚步", steps_grass: "脚步(草地)", steps_gravel: "脚步(碎石)", steps_rubble: "脚步(瓦砾)", steps_wood: "脚步(木地板)", steps_tile: "脚步(瓷砖)", steps_carpet: "脚步(地毯)", dog_feet: "机械狗脚步", door_open: "开门", door_close: "关门" };
  const ESND = { speech_normal: ["speech_conv_m", 0], speech_shout: ["speech_help_m", 0], footsteps: ["steps", 0], quadruped: ["dog_servo", 0], multicopter: ["rotor", 0], car: ["car", 0], dog_bark: ["dog_bark", 0], car_horn: ["horn", 0], siren: ["siren_wail", 0], generator: ["generator", 0], school_bell: ["school_bell", 0], phone_ring: ["phone_ring", 0] };
  const A_ = () => ES.app, LOOK = () => (A_() && A_().look === "night" ? "night" : "day");
  /* ---- scene binding ---- */
  function bindScene(V) {
    const A = A_(); if (!A || !A.scene || !A.W) return false; const key = [A.name, A.variant, A.look, A.bim ? 1 : 0, V && V.col ? V.col.foot.length : 0, A.W.N].join("|");
    if (S.scn && S.scnKey === key && S.scn.W === A.W) return true;
    if (S.mx) for (const s of [...S.mx.srcs.values()]) S.mx.drop(s);
    const geo = new Geo(A.bim || null, A.scene, A.W), surf = new Surf(A.scene, A.W), env = new Env(geo, A.W, surf); S.scn = { geo, surf, env, W: A.W, sc: A.scene, bim: A.bim, key }; S.scnKey = key;
    S.mx = S.eng ? new Mixer(S.eng, geo, env) : null; S.rvKey = ""; S.lv = {}; S.step = {}; S.ev = {}; S.tree = { t: -9, ids: [] }; S.rooms = { t: -9 }; S.hist = {}; return true;
  }
  /* door state of the collision model -> acoustic geometry; latch / thud sounds when a door opens or closes within 25 m */
  function syncDoors(V) {
    const g = S.scn && S.scn.geo; if (!g || !V || !V.col) return; let ch = false; const dp = S.doorPrev || (S.doorPrev = {}), L = S.mx && S.mx.L;
    for (const k in V.col.doors) {
      const o = V.col.doors[k].open; if (g.setDoor(k, o)) ch = true; const pv = dp[k] === undefined ? o : dp[k]; dp[k] = o;
      if (L && S.mx && g.doors[k] && ((pv < 0.2 && o >= 0.2 && o > pv) || (pv > 0.08 && o <= 0.08 && o < pv))) { const c = g.doors[k].boxes[0].c; if (hyp(c[0] - L.x, c[1] - L.y) < 25) S.mx.shot(o > pv ? "door_open" : "door_close", [c[0], c[1], c[2]], { prio: 3 }); }
    } return ch;
  }
  /* ---- helpers ---- */
  const put = (id, o) => { const mx = S.mx; let s = mx.srcs.get(id); if (!s) s = mx.add(new Src(Object.assign({ id, eph: 1 }, o))); else Object.assign(s, o); s.seen = S.frame; return s; };
  const surfAt = (x, y, z) => { const r = S.scn.geo.roomAt(x, y, z); if (r.room) return FLOOR_STEP[r.room.floor] || "concrete"; if (r.bld) return "concrete"; return S.scn.surf.step(x, y); };
  const stepAt = (x, y, z, db) => { const a = "steps_" + surfAt(x, y, z); S.mx.shot(a, [x, y, z + 0.04], { slot: (Math.random() * 8) | 0, levelDb: db + gauss() * 0.9, prio: 1 }); };
  const near = (pt, poly) => { let best = [0, 0, 1e9]; for (let i = 0; i + 1 < poly.length; i++) { const a = poly[i], b = poly[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, t = clamp(((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2, 0, 1), x = a[0] + t * dx, y = a[1] + t * dy, d = hyp(x - pt[0], y - pt[1]); if (d < best[2]) best = [x, y, d]; } return best; };
  /* ---- the listener's own body ---- */
  function selfBody(L, W, dt, now) {
    const v = W.speed || 0, body = L.body, st = S.step, mx = S.mx;
    if (body === "human") {
      put("self:br0", { asset: "breath_rest", name: NAMES.breath_rest, self: true, selfDist: 0.15, mode: "mono", dyn: 0, active: v < 2.4, prio: 8, noVerb: true }); put("self:br1", { asset: "breath_hard", name: NAMES.breath_hard, self: true, selfDist: 0.15, mode: "mono", dyn: dB(clamp((v - 1.2) / 2.4, 0.05, 1)), active: v > 1.2, prio: 8, noVerb: true });
      put("self:cl", { asset: "cloth", name: NAMES.cloth, self: true, selfDist: 0.35, mode: "mono", dyn: dB(clamp(v / 1.5, 0.03, 1) / 0.5), active: v > 0.2, prio: 7, noVerb: true });
      if (v > 0.15) { st.ph = (st.ph || 0) + ((1 + 0.65 * v) / 2) * dt; const idx = Math.floor(2 * st.ph); if (st.last === undefined) st.last = idx; if (idx > st.last) { st.last = idx; const side = idx & 1 ? 1 : -1, c = Math.cos(L.yaw), s = Math.sin(L.yaw); stepAt(L.x - s * 0.1 * side, L.y + c * 0.1 * side, W.zf, clamp(8 * log10(v / 1.4), -8, 6)); } } else st.last = undefined;
    } else if (body === "dog") {
      const a = clamp(v / 1.0, 0, 1.2); put("self:servo", { asset: "dog_servo", name: NAMES.dog_servo, self: true, selfDist: 0.25, mode: "mono", dyn: dB(0.15 + 0.85 * a), rate: 0.6 + 0.4 * Math.min(a, 1.5), prio: 9, noVerb: true });
      if (v > 0.08) { const ph = W.phase || 0, idx = Math.floor(2 * ph); if (st.dl === undefined) st.dl = idx; if (idx > st.dl) { st.dl = idx; const c = Math.cos(L.yaw), s = Math.sin(L.yaw), pair = idx & 1 ? [[0.2, -0.11], [-0.2, 0.11]] : [[0.2, 0.11], [-0.2, -0.11]], m = mx.man.dog_feet, k = 0.5 + 0.5 * Math.min(v, 1.5);
        for (const [fx, fy] of pair) mx.shot("dog_feet", [L.x + c * fx - s * fy, L.y + s * fx + c * fy, W.zf + 0.03], { slot: (Math.random() * 6) | 0, levelDb: dB(k), prio: 3 });
        if (m) mx.shot("dog_feet", [L.x, L.y, L.z], { self: true, selfDist: 1, slot: (Math.random() * 6) | 0, mode: "mono", force: true, noVerb: true, levelDb: dB((0.112 * k) / (m.gain_pa * 0.89)) }); } } else st.dl = undefined;
    } else {
      const U = S.uavU || (S.uavU = { vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0 }), uv = W.uav || { vx: 0, vy: 0, vz: W.vz || 0 }, kk = Math.min(1, dt * 6);
      U.ax += ((uv.vx - U.vx) / Math.max(dt, 1e-3) - U.ax) * kk; U.ay += ((uv.vy - U.vy) / Math.max(dt, 1e-3) - U.ay) * kk; U.az += ((uv.vz - U.vz) / Math.max(dt, 1e-3) - U.az) * kk; U.vx = uv.vx; U.vy = uv.vy; U.vz = uv.vz;
      const tau = Math.sqrt(U.ax * U.ax + U.ay * U.ay + Math.pow(9.81 + U.az, 2)) / 9.81, drag = 1 + 0.0009 * v * v, ratio = clamp(Math.sqrt(tau * drag), 0.9, 1.25), U5 = Math.max(v, 0.3);
      put("self:rotor", { asset: "rotor", name: NAMES.rotor + "(自己)", self: true, selfDist: 0.17, mode: "mono", dyn: 60 * log10(ratio), rate: ratio, prio: 9, noVerb: true, dir: { type: "omni" } });
      put("self:wind", { asset: "windmic", name: NAMES.windmic, self: true, selfDist: 1, mode: "mono", dyn: -10 + 55 * log10(U5 / 5), active: v > 0.5, prio: 6, noVerb: true });
    }
  }
  /* ---- live episode agents: exact gait phase of the rendered legs (same clock as tickLive) ---- */
  function liveAgents(V, nowMs, dt, L) {
    const live = V.live, ep = V.liveEp; if (!live || !ep) return; const mx = S.mx, t = (nowMs / 1000) * V.liveSpeed + (V.liveOffset || 0), res = ep.indoor && ep.indoor.resident;
    for (const it of live.userData.items) {
      const a = it.a, id = it.id, pp = it.model.position, x = pp.x, y = -pp.z, z = pp.y, h = S.lv[id] || (S.lv[id] = { x, y, z, vx: 0, vy: 0, vz: 0, k: undefined, gu: undefined }), kk = Math.min(1, dt * 5);
      if (hyp(x - h.x, y - h.y) > 4) { h.vx = h.vy = h.vz = 0; } else { h.vx += ((x - h.x) / Math.max(dt, 1e-3) - h.vx) * kk; h.vy += ((y - h.y) / Math.max(dt, 1e-3) - h.vy) * kk; h.vz += ((z - h.z) / Math.max(dt, 1e-3) - h.vz) * kk; }
      h.x = x; h.y = y; h.z = z; const spd = hyp(h.vx, h.vy), yaw = it.model.rotation.y, axis = [Math.cos(yaw), Math.sin(yaw), 0], T = (a.n - 1) * ep.dt, tt = T > 0 ? t % T : 0, f = tt / ep.dt, i0 = Math.min(a.n - 2, Math.floor(f)), p0 = a.pos[i0], p1 = a.pos[i0 + 1] || p0, mv = hyp(p1[0] - p0[0], p1[1] - p0[1]) / ep.dt > 0.25;
      const base = { pos: [x, y, z], vel: [h.vx, h.vy, h.vz], axis };
      if (it.kind === "uav") { const vh = spd, ratio = 1 + 0.004 * vh + 0.02 * Math.max(h.vz, 0); put("live:" + id, Object.assign(base, { asset: "rotor", name: NAMES.rotor, dyn: 60 * log10(ratio), rate: ratio, axis: [0, 0, 1], prio: 6 })); }
      else if (it.kind === "dog") {
        put("live:" + id, Object.assign(base, { asset: "dog_servo", name: NAMES.dog_servo, dyn: dB(0.15 + 0.85 * clamp(spd, 0, 1.2)), rate: 0.6 + 0.4 * Math.min(spd, 1.5), pos: [x, y, z + 0.3], prio: 5 }));
        if (mv && it.gph !== undefined) { const g = it.gph; if (h.gu === undefined) { h.gu = g; h.gl = Math.floor(2 * g); } else { let d = g - (h.g0 ?? g); d = d - Math.round(d); h.gu += d; } h.g0 = g; const idx = Math.floor(2 * h.gu); if (h.gl === undefined) h.gl = idx;
          if (idx > h.gl) { h.gl = idx; const c = Math.cos(yaw), s = Math.sin(yaw), pair = idx & 1 ? [[0.2, -0.11], [-0.2, 0.11]] : [[0.2, 0.11], [-0.2, -0.11]], k = 0.5 + 0.5 * Math.min(spd, 1.5); for (const [fx, fy] of pair) mx.shot("dog_feet", [x + c * fx - s * fy, y + s * fx + c * fy, z + 0.03], { slot: (Math.random() * 6) | 0, levelDb: dB(k), prio: 2 }); } }
      } else if (it.kind === "rover") put("live:" + id, Object.assign(base, { asset: "rover", name: NAMES.rover, dyn: dB(clamp(spd / 1.4, 0.2, 2)), rate: 0.7 + 0.3 * (spd / 1.4), active: spd > 0.1, pos: [x, y, z + 0.3], prio: 4 }));
      else {
        const sex = (parseInt(id.replace(/\D/g, ""), 10) || 0) % 2 ? "f" : "m", role = a.role, head = it.kind === "t:lying" ? z + 0.3 : z + 1.5;
        if (role === "walk") { const ph = (nowMs / 1000) * 7 + it.phase, k = Math.floor((ph - PI / 2) / PI); if (spd > 0.25) { if (h.k !== undefined && k > h.k && k - h.k < 3) stepAt(x, y, z, clamp(8 * log10(Math.max(spd, 0.3) / 1.4), -8, 6)); h.k = k; } else h.k = undefined; }
        else if (role === "stand") put("live:" + id, Object.assign(base, { asset: "speech_conv_" + sex, name: NAMES.speech_conv_m, pos: [x, y, head], dyn: 0, prio: 3 }));
        else if (role === "wave") put("live:" + id, Object.assign(base, { asset: (id === res ? "speech_help_" : "speech_anyone_") + (id === res || sex === "f" ? sex : "m"), name: id === res ? "窗口居民呼救" : "喊\"有人吗\"", pos: [x, y, head], prio: 7 }));
        else if (role === "lie" || it.kind === "t:lying") put("live:" + id, Object.assign(base, { asset: "speech_help_" + sex, name: "倒地者呼救", pos: [x, y, head], dyn: -10, prio: 7 }));
      }
    }
  }
  /* ---- user-placed entities ---- */
  function entities(L, now) {
    const A = A_(), mx = S.mx, liveOn = !!(S.V && S.V.live && S.V.liveEp), self = A.par.self !== false && !liveOn;          // the episode's own agents replace the placed copies of them
    for (const e of A.ents) {
      const id = "ent:" + e.id, pos = [e.x, e.y, e.z || 1.2], yaw = e.yaw || 0, axis = [Math.cos(yaw), Math.sin(yaw), 0], nm = e.name || "";
      if (e.kind === "sound") {
        const m = ESND[e.sound]; if (!m) continue;
        if (m[0] === "steps") { const t = S.ev[id] || (S.ev[id] = { next: now + 0.2 }); if (now >= t.next) { t.next = now + (1 / 1.9) * (1 + 0.04 * gauss()); stepAt(e.x, e.y, e.z - 1.0 > 0 ? e.z - 1.0 : 0, 0); } }
        else put(id, { asset: m[0], name: nm, pos, axis, levelDb: m[1], prio: 4 });
      } else if (e.kind === "uav" && self) put(id, { asset: "rotor", name: nm + " 旋翼", pos, axis: [0, 0, 1], prio: 4 });
      else if (e.kind === "dog" && self) put(id, { asset: "dog_servo", name: nm + " 电机", pos: [e.x, e.y, 0.3], dyn: dB(0.15), prio: 3 });
      else if (e.kind === "t:lying" && !liveOn) put(id, { asset: "speech_help_m", name: nm + " 呼救", pos, axis, dyn: -10, prio: 6 });
      else if (e.kind === "t:vehicle" && !liveOn) put(id, { asset: "car", name: nm + " 发动机", pos: [e.x, e.y, 0.6], prio: 3 });
    }
  }
  /* ---- ambience: traffic, wind in the trees, birds, crickets, room tones, events on the roads, machines, the quake variant ---- */
  const polyAt = (pts, cum, s) => { s = clamp(s, 0, cum[cum.length - 1]); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9), a = pts[i - 1], b = pts[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / Math.max(cum[i] - cum[i - 1], 1e-9), (b[1] - a[1]) / Math.max(cum[i] - cum[i - 1], 1e-9)]; };
  function roadEvent(kind, L, now, T0) {
    const sc = S.scn.sc, ev = S.ev[kind] || (S.ev[kind] = { next: now + T0, cur: null, n: 0 }), mx = S.mx; if (!sc.roads || !sc.roads.length) return;
    if (!ev.cur && now >= ev.next) {
      const R = sc.roads.map((r) => ({ r, n: near([L.x, L.y], r.line) })).filter((q) => q.n[2] < 140).sort((a, b) => a.n[2] - b.n[2]); const q = R[0] || { r: sc.roads[(Math.random() * sc.roads.length) | 0] };
      let line = q.r.line.map((p) => [p[0], p[1]]); if (Math.random() < 0.5) line.reverse(); const a = line[0], b = line[1], z = line[line.length - 1], y = line[line.length - 2], ua = [a[0] - b[0], a[1] - b[1]], la = hyp(...ua) || 1, ub = [z[0] - y[0], z[1] - y[1]], lb = hyp(...ub) || 1, pad = 110;
      line = [[a[0] + (ua[0] / la) * pad, a[1] + (ua[1] / la) * pad], ...line, [z[0] + (ub[0] / lb) * pad, z[1] + (ub[1] / lb) * pad]]; const cum = [0]; for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + hyp(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
      ev.cur = { line, cum, t0: now, v: kind === "amb" ? 12 : 8 + Math.random() * 6, off: (Math.random() * 3) | 0 }; ev.n++;
    }
    if (ev.cur) {
      const c = ev.cur, s = c.v * (now - c.t0);
      if (s > c.cum[c.cum.length - 1]) { ev.cur = null; ev.next = now + (kind === "amb" ? 70 + Math.random() * 40 : 18 + Math.random() * 25); mx.remove("ev:" + kind); return; }
      const p = polyAt(c.line, c.cum, s), vx = p[2] * c.v, vy = p[3] * c.v;
      put("ev:" + kind, { asset: kind === "amb" ? (ev.n % 2 ? "siren_wail" : "siren_yelp") : "car", name: kind === "amb" ? NAMES.siren_wail : NAMES.car, pos: [p[0], p[1], kind === "amb" ? 1.5 : 0.6], vel: [vx, vy, 0], axis: [p[2], p[3], 0], prio: kind === "amb" ? 9 : 2, offset: 0 });
    }
  }
  function ambience(L, now, dt) {
    const mx = S.mx, A = A_(), sc = S.scn.sc, night = LOOK() === "night"; const AMB = (ES.phys && ES.phys.AMBIENT) || { day: 45, night: 36 }; mx.lamb = night ? AMB.night : AMB.day;
    // traffic: nearest road as a line source (cylindrical spreading, 20 m reference) + a diffuse urban background (two decorrelated copies)
    let best = [0, 0, 1e9]; for (const r of sc.roads || []) { const q = near([L.x, L.y], r.line); if (q[2] < best[2]) best = q; }
    if (best[2] < 1e8) put("amb:traffic", { asset: "traffic", name: NAMES.traffic, pos: [best[0], best[1], 1], spread: "cyl", cylRef: 20, levelDb: mx.lamb - 2 - 45, doppler: false, prio: 1, offset: 0.1 });
    put("amb:bedL", { asset: "traffic", name: "城市背景声", diffuse: true, mode: "left", levelDb: mx.lamb - 8 - 45, prio: 1, offset: 0.37, doppler: false, noVerb: false }); put("amb:bedR", { asset: "traffic", name: "城市背景声", diffuse: true, mode: "right", levelDb: mx.lamb - 8 - 45, prio: 1, offset: 0.81, doppler: false });
    if (night) { put("amb:crL", { asset: "crickets", name: NAMES.crickets, diffuse: true, mode: "left", levelDb: 41 - 55.7, prio: 1, offset: 0.2, doppler: false }); put("amb:crR", { asset: "crickets", name: NAMES.crickets, diffuse: true, mode: "right", levelDb: 41 - 55.7, prio: 1, offset: 0.7, doppler: false }); }
    // trees: wind rustle at the two nearest crowns, birds (daytime) in a third of the nearby trees
    if (now - S.tree.t > 1.0) { S.tree.t = now; const tr = sc.trees || []; S.tree.ids = tr.map((t, i) => [i, hyp(t[0] - L.x, t[1] - L.y)]).filter((q) => q[1] < 45).sort((a, b) => a[1] - b[1]).slice(0, 12).map((q) => q[0]); }
    let nw = 0, nb = 0; for (const i of S.tree.ids) {
      const t = sc.trees[i], K = ES.TREE[t[2]] || ES.TREE.round, zc = ((K.lo + K.h) / 2) * t[3];
      if (nw < 2) { put("amb:wind" + i, { asset: "wind_trees", name: NAMES.wind_trees, pos: [t[0], t[1], zc], levelDb: 25 * log10(3 / 4), prio: 2, offset: hash(i, 1), doppler: false }); nw++; }
      if (!night && nb < 3 && hash(i, 7) < 0.4) { put("amb:bird" + i, { asset: hash(i, 3) < 0.5 ? "birds_a" : "birds_b", name: NAMES.birds_a, pos: [t[0], t[1], zc * 1.1], levelDb: 0, prio: 3, offset: hash(i, 5), doppler: false }); nb++; }
    }
    // events on the roads
    roadEvent("amb", L, now, 14); roadEvent("car", L, now, 6);
    // scene machines and fixed sources
    const gate = (id, on, per) => { const t = (now + hash(id.length, id.charCodeAt(id.length - 1)) * per) % per; return t < on; };
    for (const f of S.fixed || []) { if (f.gate && !gate(f.id, f.gate[0], f.gate[1])) continue; put(f.id, Object.assign({}, f.o)); }
    // room tones around the listener
    if (now - S.rooms.t > 1.0 && S.scn.geo.bldList.length) {
      S.rooms.t = now; const out = [];
      for (const b of S.scn.geo.bldList) { if (L.x < b.lo[0] - 14 || L.x > b.hi[0] + 14 || L.y < b.lo[1] - 14 || L.y > b.hi[1] + 14) continue; const ra = S.scn.geo.roomAcoustics(b);
        for (const r of b.rooms) { const c = r.poly.reduce((q, p) => [q[0] + p[0] / r.poly.length, q[1] + p[1] / r.poly.length], [0, 0]), d = hyp(c[0] - L.x, c[1] - L.y, (r.z0 + 1.5) - L.z); if (d > 16) continue;
          const hv = /office|classroom|lab|shop|lobby|meeting|hall|workshop|control|corridor|storage/.test(r.fn), fr = r.fn === "kitchen"; if (!hv && !fr) continue; out.push({ id: "room:" + b.id + "/" + r.id, d, hv, fr, c, r }); } }
      out.sort((a, b) => a.d - b.d); S.rooms.list = out.slice(0, 5);
    }
    for (const q of S.rooms.list || []) put(q.id, { asset: q.fr ? "fridge" : "hvac", name: q.fr ? NAMES.fridge : NAMES.hvac, pos: [q.c[0], q.c[1], q.fr ? q.r.z0 + 0.9 : q.r.z1 - 0.3], levelDb: q.fr ? 0 : 44 - 72, prio: 1, doppler: false });
  }
  /* fixed sources of the scene (built once per scene): barking dog in a yard, industrial machines, school bell, fires / survivors / creaks of the quake variant */
  function buildFixed() {
    const sc = S.scn.sc, W = S.scn.W, F = (S.fixed = []), bl = sc.buildings || [];
    const cen = (b) => b.fp.reduce((a, p) => [a[0] + p[0] / b.fp.length, a[1] + p[1] / b.fp.length], [0, 0]);
    const homes = bl.filter((b) => /house|rowhouse|apartment/.test(b.kind));
    if (homes.length) { const b = homes[Math.floor(homes.length / 2)], c = cen(b); F.push({ id: "fx:bark", gate: [14, 40], o: { asset: "dog_bark", name: NAMES.dog_bark, pos: [c[0] + 8, c[1], 0.5], axis: [-1, 0, 0], prio: 3, doppler: false } }); }
    for (const b of bl.filter((b) => /factory|warehouse/.test(b.kind)).slice(0, 2)) { const c = cen(b); F.push({ id: "fx:hvac" + b.id, o: { asset: "hvac", name: "屋顶空调机组", pos: [c[0], c[1], b.h + 1], levelDb: 0, prio: 2, doppler: false } }); }
    const cont = (sc.objects || []).filter((o) => o.name === "container"); if (cont.length) F.push({ id: "fx:gen", o: { asset: "generator", name: NAMES.generator, pos: [cont[0].xy[0] + 4, cont[0].xy[1], 0.8], prio: 3, doppler: false } });
    const tank = (sc.objects || []).find((o) => o.name === "tank"); if (tank) F.push({ id: "fx:trf", o: { asset: "transformer", name: NAMES.transformer, pos: [tank.xy[0], tank.xy[1] + 6, 1.2], prio: 2, doppler: false } });
    const camp = bl.filter((b) => b.kind === "campus"); if (camp.length) { const c = cen(camp[0]); F.push({ id: "fx:bell", gate: [3.5, 150], o: { asset: "school_bell", name: NAMES.school_bell, pos: [c[0], c[1], 6], prio: 3, doppler: false } }); }
    const vd = W.variantData || {}; (vd.fires || []).forEach((f, i) => F.push({ id: "fx:fire" + i, o: { asset: "fire", name: NAMES.fire, pos: [f.xy[0], f.xy[1], 1.5], levelDb: clamp(10 * log10(Math.max(600 * PI * f.r * f.r, 50) / 1000), -10, 8), prio: 4, doppler: false } }));
    (vd.survivors || []).forEach((s, i) => F.push({ id: "fx:sv" + i, o: { asset: "speech_help_" + "mf"[i % 2], name: "废墟下呼救", pos: [s.xy[0], s.xy[1], (s.z || 0) + 0.4], dyn: -10, prio: 7, doppler: false } }));
    for (const b of bl) { const dm = W.damage && W.damage[b.id]; if (dm && dm.state === "partial") { const c = cen(b); F.push({ id: "fx:creak" + b.id, o: { asset: "creak", name: NAMES.creak, pos: [c[0], c[1], 3], prio: 2, doppler: false } }); } }
  }
  /* street reverb: openness of the surroundings from a fan of rays against the building raster */
  function canyonUpdate(L, now) {
    if (now - S.canyon.t < 1.5) return; S.canyon.t = now; const W = S.scn.W, ds = []; let hit = 0;
    for (let k = 0; k < 8; k++) { const a = (TAU * k) / 8; let d = 40; for (let r = 2; r < 40; r += 1.5) { const id = W.ij(L.x + r * Math.cos(a), L.y + r * Math.sin(a)); if (id >= 0 && W.hB[id] > 3) { d = r; break; } } ds.push(d); if (d < 25) hit++; }
    S.canyon.c = hit / 8; S.canyon.d = ds.filter((d) => d < 40);
  }
  function reverbUpdate(L, now) {
    const eng = S.eng; canyonUpdate(L, now); const sp = L.space; let key, plan;
    if (sp.room) { key = sp.key; if (key === S.rvKey) return; const ri = S.scn.geo.roomInfo(sp); if (!ri) return; plan = irPlanRoom(ri); }
    else if (sp.bld) return; else { const cb = Math.round(S.canyon.c * 4) / 4; key = "street" + cb; if (key === S.rvKey) return; plan = irPlanStreet(cb, S.canyon.d); }
    S.rvKey = key; eng.setReverb(plan);
  }
  /* ---- frame hook ---- */
  function onFrame(dt, nowMs, W, V) {
    S.V = V; S.frame++; const now = nowMs / 1000; S.t = now; if (now - S.hudT > 0.25) { S.hudT = now; hudUpdate(); }
    if (!S.on || !S.eng || S.eng.ctx.state === "closed") return; if (!bindScene(V) || !S.mx) return; if (S.fixedFor !== S.scn.key) { S.fixedFor = S.scn.key; buildFixed(); }
    const mx = S.mx, B = W.body, L = { x: W.x, y: W.y, z: B === "uav" ? W.z + 0.06 : B === "dog" ? W.zv + 0.4 : W.zv + 1.6, yaw: W.yaw, pitch: B === "uav" ? 0 : W.pitch, body: B, dt: Math.min(dt, 0.1), reset: S.lastBody !== B };
    if (S.lastBody !== B) { S.eng.setBody(B); S.step = {}; S.lastBody = B; } syncDoors(V); S.scn.geo.ver = S.scn.geo.ver || 0; mx.setListener(L); reverbUpdate(mx.L, now);
    selfBody(mx.L, W, dt, now); liveAgents(V, nowMs, dt, mx.L); entities(mx.L, now); ambience(mx.L, now, dt);
    for (const s of [...mx.srcs.values()]) if (s.eph && s.seen !== S.frame) mx.remove(s.id);
    mx.update(dt, now); S.cpu = (S.cpu || 0) * 0.95 + 0.05 * (performance.now() - S.f0);
  }
  ES.bus.on("walk:frame", (dt, nowMs, W, V) => { S.f0 = performance.now(); try { onFrame(dt, nowMs, W, V); } catch (e) { if (!S.errShown) { S.errShown = 1; console.error("audio frame", e); } S.err = String(e && e.message || e); } });
  ES.bus.on("scene:built", (V) => { S.V = V; S.scnKey = ""; });
  ES.bus.on("fpbody", (b) => { if (S.eng) S.eng.setBody(b); hudUpdate(true); });
  ES.bus.on("walk:enter", (W, V) => { S.V = V; S.frame = 0; panelShow(true); if (S.pref.on && !S.on) AU.enable(true); else if (S.on && S.eng) S.eng.ctx.resume().catch(() => {}); hudUpdate(true); });
  ES.bus.on("walk:exit", () => { panelShow(false); if (S.mx) for (const s of [...S.mx.srcs.values()]) S.mx.remove(s.id); if (S.eng) { for (const v of S.eng.voices) v.release(0.1); setTimeout(() => { if (S.eng && S.eng.ctx.state === "running" && !(ES.view3d && ES.view3d.walk.active)) S.eng.ctx.suspend().catch(() => {}); }, 400); } });
  document.addEventListener("visibilitychange", () => { if (!S.eng || !S.on) return; if (document.hidden) S.eng.ctx.suspend().catch(() => {}); else if (ES.view3d && ES.view3d.walk.active) S.eng.ctx.resume().catch(() => {}); });
  /* ---- public API ---- */
  AU.enable = async function (quiet) {
    if (S.loading) return; S.loading = true; S.err = ""; hudUpdate(true);
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error("浏览器不支持 Web Audio");
      if (!S.ctx) S.ctx = new AC({ latencyHint: "interactive" }); if (S.ctx.state === "suspended") await S.ctx.resume().catch(() => {});
      if (!S.eng) { S.eng = new Engine(S.ctx); await S.eng.load(BASE()); if (S.V && !S.V.col) S.V = null; }
      S.eng.setMuted(S.pref.mute); S.eng.setVolume(volDb()); S.eng.setBody((ES.view3d && ES.view3d.walk.state.body) || "human"); S.on = true; S.scnKey = ""; if (!quiet || S.ctx.state === "running") prefSave({ on: true });
      if (S.ctx.state !== "running") { const kick = () => { S.ctx.resume().then(() => { hudUpdate(true); }); window.removeEventListener("pointerdown", kick); window.removeEventListener("keydown", kick); }; window.addEventListener("pointerdown", kick); window.addEventListener("keydown", kick); }
    } catch (e) { S.err = String((e && e.message) || e); console.warn("audio enable", e); }
    S.loading = false; hudUpdate(true);
  };
  AU.disable = function () { S.on = false; prefSave({ on: false }); if (S.mx) for (const s of [...S.mx.srcs.values()]) S.mx.remove(s.id); if (S.eng) { for (const v of S.eng.voices) v.release(0.1); S.eng.ctx.suspend().catch(() => {}); } hudUpdate(true); };
  AU.setMute = (m) => { prefSave({ mute: !!m }); if (S.eng) S.eng.setMuted(!!m); hudUpdate(true); }; AU.toggleMute = () => { if (!S.on) { AU.enable(); return; } AU.setMute(!S.pref.mute); };
  AU.setVolume = (v) => { prefSave({ vol: clamp(v, 0, 1) }); if (S.eng) S.eng.setVolume(volDb()); hudUpdate(true); };
  AU.spl = () => (S.mx ? S.mx.spl : 0);
  AU.sources = () => (S.mx ? S.mx.list.filter((s) => s.lvl > S.mx.floorDba - 10).map((s) => ({ id: s.id, name: s.name || NAMES[s.asset] || s.asset, asset: s.asset, distance: s.dist, bearing: s.az, levelDba: s.lvl, tag: TAG[s.tag] || s.tag, occluded: s.tag === "wall" || s.tag === "diffr" || s.tag === "portal", tlDb: s.an ? s.an.tlDba : 0, voice: !!(s.vA || s.vB) })) : []);
  AU.state = () => ({ on: S.on, ctx: S.ctx ? S.ctx.state : "none", sampleRate: S.ctx ? S.ctx.sampleRate : 0, voices: S.eng ? S.eng.active() : 0, loaded: S.eng ? Object.keys(S.eng.buffers).filter((k) => S.eng.buffers[k]).length : 0, vol: S.pref.vol, mute: S.pref.mute, spl: AU.spl(), floor: S.mx ? S.mx.floorDba : 0, srcs: S.mx ? S.mx.srcs.size : 0, space: S.mx ? S.mx.L.key : "", cpu_ms: S.cpu || 0, stats: S.mx ? S.mx.stats : null, err: S.err });
  AU.trigger = (what) => { const e = S.ev[what === "ambulance" ? "amb" : what]; if (e && !e.cur) e.next = 0; return !!e; };
  /* ---- HUD panel ---- */
  const $ = (q) => document.querySelector(q), esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  function panel() {
    let p = $(".fp-audio"); if (p) return p; const left = $("#fp-left"); if (!left) return null; p = document.createElement("section"); p.className = "fp-panel fp-audio"; p.setAttribute("aria-label", "你听到的声音");
    p.innerHTML = `<h4>你听到的<span id="fa-who"></span></h4><div class="fa-ctl"><button type="button" class="btn" id="fa-on">🔊 开启声音</button><button type="button" class="btn" id="fa-mute" title="M" hidden>静音</button><input type="range" id="fa-vol" min="0" max="100" step="1" aria-label="主音量" hidden><span class="fa-st" id="fa-st"></span></div><div class="fa-meter" hidden><i id="fa-bar"></i><b id="fa-spl">— dB(A)</b></div><ul class="fa-list" id="fa-list"></ul><small class="fa-note" id="fa-note"></small>`;
    left.insertBefore(p, $("#fp-near-l")); $("#fa-on").addEventListener("click", (e) => { e.target.blur(); if (S.on) AU.disable(); else AU.enable(); }); $("#fa-mute").addEventListener("click", (e) => { e.target.blur(); AU.toggleMute(); });
    const vol = $("#fa-vol"); vol.value = Math.round(S.pref.vol * 100); vol.addEventListener("input", () => AU.setVolume(vol.value / 100)); return p;
  }
  const panelShow = (on) => { const p = panel(); if (p) p.hidden = !on; };
  const WHO = { human: "双耳 HRTF · 1.6 m 耳高", dog: "4 麦阵列 → 立体声监听 · 含自身电机/脚步噪声", uav: "机载单麦克风 · 被自身旋翼主导(监听 -24 dB)" };
  function hudUpdate(force) {
    const p = $(".fp-audio"); if (!p || p.hidden) return; const on = $("#fa-on"), body = (ES.view3d && ES.view3d.walk.state.body) || "human", running = S.on && S.ctx && S.ctx.state === "running";
    $("#fa-who").textContent = `· ${WHO[body]}`; on.textContent = S.loading ? "加载声音…" : S.on ? (running ? "🔊 声音已开启" : "▶ 点击页面恢复声音") : "🔊 开启声音"; on.classList.toggle("pulse", !S.on && !S.loading); on.title = S.on ? "再点一次关闭" : "浏览器需要一次点击才允许播放声音";
    const mute = $("#fa-mute"), vol = $("#fa-vol"), met = p.querySelector(".fa-meter"); mute.hidden = vol.hidden = met.hidden = !S.on; mute.textContent = S.pref.mute ? "取消静音" : "静音"; mute.classList.toggle("on", !!S.pref.mute);
    const note = $("#fa-note"), list = $("#fa-list");
    if (!S.on) { list.innerHTML = ""; note.textContent = S.err ? "声音出错:" + S.err : "声音按物理计算:距离衰减、空气吸收、穿墙损失、绕射、室内混响、多普勒。需要点一次\"开启声音\"。"; return; }
    $("#fa-st").textContent = S.err ? "出错" : ""; const mx = S.mx; if (!mx) { note.textContent = "进入场景后开始计算"; return; }
    const spl = mx.spl, bar = $("#fa-bar"); bar.style.width = clamp(((spl - 20) / 80) * 100, 0, 100) + "%"; $("#fa-spl").textContent = `${spl.toFixed(0)} dB(A)`;
    const rows = AU.sources().slice(0, 7), shots = (mx.lastShots || []).filter((q) => S.t - q.t < 0.7 && q.dba > mx.floorDba - 8);
    const arrow = (az) => `<span class="fa-ar" style="transform:rotate(${az.toFixed(0)}deg)">▲</span>`;
    list.innerHTML = rows.map((r) => `<li class="${r.occluded ? "occ" : ""}">${arrow(r.bearing)}<span class="fa-n">${esc(r.name)}</span><span class="fa-d">${r.distance < 1e8 && r.distance > 0 ? r.distance.toFixed(r.distance < 10 ? 1 : 0) + " m" : ""}</span><span class="fa-l">${r.levelDba.toFixed(0)}</span><em class="${r.tag}">${esc(r.tag)}</em></li>`).join("") + shots.slice(-2).map((q) => `<li class="shot"><span class="fa-ar">·</span><span class="fa-n">${esc(NAMES[q.asset] || q.asset)}</span><span class="fa-d">${q.d.toFixed(1)} m</span><span class="fa-l">${q.dba.toFixed(0)}</span><em>瞬时</em></li>`).join("");
    note.textContent = `${mx.L.space.room ? "室内 · " + (mx.L.space.room.name || mx.L.space.room.fn) : mx.L.space.bld ? "建筑内" : "室外"} · 噪声底 ${mx.floorDba.toFixed(0)} dB(A) · 声源 ${S.eng.active()}/${S.eng.voices.length} 路`;
  }
  /* ---- keys (listed in the HUD legend) ---- */
  if (ES.controls && ES.controls.add) {
    ES.controls.add({ bodies: "all", group: "声音", keys: ["M"], codes: ["KeyM"], desc: "静音 / 取消静音(首次按下开启声音)", fn: (code, down) => { if (down) AU.toggleMute(); } });
    ES.controls.add({ bodies: "all", group: "声音", keys: ["-", "="], codes: ["Minus", "Equal"], desc: "音量减小 / 增大", fn: (code, down) => { if (down) AU.setVolume(S.pref.vol + (code === "Equal" ? 0.08 : -0.08)); } });
  }
  panel(); panelShow(false);

})();
