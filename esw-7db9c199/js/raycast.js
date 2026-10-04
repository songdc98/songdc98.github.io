/* raycast.js -> ES.ray: ray casting against the building model + the outdoor world + dynamic bodies, and the occlusion physics (RF slab loss, mass-law sound loss,
   optical / light transmission) of the straight path. Port of scripts/esworld/bim/physics.py (crossings, rf_loss_db, sound_tl_db, optical_blocked, light_transmission, cast)
   and rf/materials.py (ITU-R P.2040 slab transmission). Frames: lab ENU metres (x east, y north, z up). Docs: web/docs/sensors-core.md.
   Static geometry is packed once per scene build (bus "scene:built") into typed arrays + a 2 m xy grid (CSR cell lists, per-cell z ranges); door leaves / opening windows
   are grid members over their whole swept volume and read their CURRENT open state (V.col.doors). Dynamic bodies (live agents, placed entities, the walker) are re-collected every frame. */
(function () {
  "use strict";
  const ES = (window.ES = window.ES || {});
  const RC = (ES.ray = ES.ray || {});
  const FL = { PHYS: 1, VIS: 2, NAV: 4, GLASS: 8, MOVABLE: 16, WALK: 32, DETAIL: 64 };
  const PS = 16, EPS = 1e-6, C0 = 299792458;
  const LAYER = { BIM: 1, WORLD: 2, GROUND: 4, BODIES: 8, FOLIAGE: 16, DETAIL: 32, TREAT: 64, ALL: 15 };   // default mask = ALL = BIM | WORLD | GROUND | BODIES (Python parity); FOLIAGE (stochastic crowns), DETAIL (VIS-only frames / trim / small furniture) and TREAT (curtains, blinds) are opt-in
  const T_AABB = 0, T_YAW = 1, T_ROLL = 2, T_CYL = 3, T_TRI = 4, T_FENCE = 5, T_ELLIP = 6, T_PRISM = 7;
  const PF_GLASS = 1, PF_TREAT = 2, PF_SOLID = 4, PF_MOVER = 8, PF_OPAQUE_WORLD = 16;

  /* ============================== semantic classes (scripts/esworld/classes.py) ============================== */
  const SEM = { sky: 0, road: 1, sidewalk: 2, building: 3, vegetation: 4, vehicle: 5, person: 6, uav: 7, ugv: 8, debris: 9, fire_smoke: 10, water: 11, furniture: 12, ground: 13, victim: 14, command_post: 15 };
  const SEM_NAME = {}; for (const k in SEM) SEM_NAME[SEM[k]] = k;
  const SEM_COLOR = { 0: [200, 220, 240], 1: [70, 70, 80], 2: [160, 160, 150], 3: [214, 156, 60], 4: [60, 160, 70], 5: [0, 114, 178], 6: [213, 94, 0], 7: [204, 121, 167], 8: [240, 228, 66], 9: [120, 80, 50], 10: [230, 30, 30], 11: [86, 180, 233], 12: [110, 110, 130], 13: [190, 175, 140], 14: [255, 0, 120], 15: [0, 0, 0] };
  RC.CLASSES = { id: SEM, name: SEM_NAME, color: SEM_COLOR };
  const FURN_ELEM = new Set(["furniture", "appliance", "rack", "machine", "fixture", "pallet", "plant", "deco", "light", "treat"]);       // BIM elements labelled furniture (12); the Blender dataset merges the whole BIM into 'building' (3), see CFG.bimFurnitureClass
  RC.CFG = { bimFurnitureClass: SEM.furniture };

  /* ============================== 905 nm reflectivity ==============================
     name -> [diffuse reflectivity, specular peak (near-normal mirror lobe, added on top), NIR transmission of the box (0 = opaque)].
     Physical sources: typical NIR albedo of building materials (Lambertian equivalent at 905 nm), Fresnel 4 % per glass surface, retro-reflective road paint, water ~2 % diffuse.
     Python master copy: scripts/esworld/sensors/lidar.py REFL_NAMED (exported to web/data/lidar_models.json; lidar.js overrides these defaults from it). */
  const REFL = {
    none: [0.30, 0, 0], brick: [0.30, 0, 0], concrete: [0.40, 0, 0], stucco: [0.62, 0, 0], siding: [0.55, 0, 0], metal_panel: [0.45, 0.25, 0],
    curtain_glass: [0, 0.05, 0.55], glass: [0, 0.06, 0.85], glass_frosted: [0.25, 0.04, 0.35], frame_white: [0.75, 0, 0], frame_dark: [0.12, 0, 0],
    gypsum: [0.72, 0, 0], gypsum_accent: [0.55, 0, 0], wood_floor: [0.45, 0.04, 0], carpet: [0.25, 0, 0], tile: [0.60, 0.12, 0], polished_concrete: [0.35, 0.10, 0], ceiling: [0.80, 0, 0],
    door_wood: [0.45, 0, 0], door_metal: [0.40, 0.20, 0], roof_shingle: [0.12, 0, 0], roof_tile: [0.40, 0, 0], roof_metal: [0.50, 0.25, 0], roof_membrane: [0.30, 0, 0],
    fabric: [0.35, 0, 0], fabric_b: [0.30, 0, 0], wood_furn: [0.40, 0.04, 0], metal_furn: [0.45, 0.25, 0], appliance: [0.80, 0.20, 0], steel: [0.50, 0.30, 0],
    rack_blue: [0.40, 0.10, 0], rack_orange: [0.55, 0.10, 0], cardboard: [0.60, 0, 0], pallet: [0.45, 0, 0], machine_green: [0.40, 0.10, 0], machine_yellow: [0.65, 0.10, 0],
    whiteboard: [0.85, 0.10, 0], screen: [0.08, 0.10, 0], bedding: [0.75, 0, 0], ceramic: [0.85, 0.15, 0], countertop: [0.20, 0.10, 0], curtain: [0.55, 0, 0.25], blinds: [0.65, 0, 0.12],
    stair_wood: [0.45, 0.04, 0], stair_concrete: [0.40, 0, 0], rail: [0.30, 0.10, 0], grating: [0.40, 0.05, 0], light: [0.90, 0, 0], rubber: [0.05, 0, 0], paper: [0.85, 0, 0],
    plant: [0.45, 0, 0], counter_wood: [0.50, 0.05, 0], lockers: [0.35, 0.15, 0], brick_brown: [0.28, 0, 0], siding_blue: [0.45, 0, 0], siding_sage: [0.50, 0, 0],
    stucco_white: [0.80, 0, 0], stucco_peach: [0.62, 0, 0], concrete_light: [0.50, 0, 0], floor_vinyl: [0.50, 0.05, 0], asphalt_shingle_dark: [0.08, 0, 0], light_off: [0.80, 0, 0],
    // world (not in the BIM): ground, vegetation, vehicles, people, fences, poles ...
    asphalt: [0.10, 0, 0], road_paint: [0.75, 0.15, 0], sidewalk: [0.40, 0, 0], grass: [0.40, 0, 0], gravel: [0.30, 0, 0], soil: [0.20, 0, 0], bark: [0.20, 0, 0], foliage: [0.45, 0, 0],
    water: [0.002, 0.30, 0], car_paint: [0.35, 0.30, 0], car_glass: [0.02, 0.06, 0], person: [0.30, 0, 0], fence_white: [0.80, 0, 0], fence_wood: [0.35, 0, 0], fence_chain: [0.50, 0.20, 0],
    pole_metal: [0.35, 0.20, 0], building_generic: [0.45, 0, 0], rubble: [0.25, 0, 0], container: [0.45, 0.15, 0], shed: [0.45, 0, 0], plastic: [0.40, 0.05, 0],
    uav_body: [0.50, 0.05, 0], dog_body: [0.55, 0.05, 0], rover_body: [0.45, 0.10, 0], cp_body: [0.50, 0.15, 0],
  };
  const WORLD_MATS = ["asphalt", "road_paint", "sidewalk", "grass", "gravel", "soil", "bark", "foliage", "water", "car_paint", "car_glass", "person", "fence_white", "fence_wood", "fence_chain", "pole_metal", "building_generic", "rubble", "container", "shed", "plastic", "uav_body", "dog_body", "rover_body", "cp_body"];
  RC.REFL = REFL;

  /* ============================== scene cache ============================== */
  let P = new Float32Array(0), PT = new Uint8Array(0), PL = new Uint8Array(0), PF = new Uint8Array(0), PM = new Uint8Array(0), PC = new Uint8Array(0), PZ0 = new Float32Array(0), PZ1 = new Float32Array(0);
  let FM = new Uint8Array(0), BCORE = new Uint8Array(0), BELEM = new Uint8Array(0), BFL = new Uint8Array(0), BBLD = new Int16Array(0), BSTO = new Int8Array(0), BTAG = new Int32Array(0), BROOM = new Int16Array(0), BCLS = new Uint8Array(0);
  let PIV = new Float32Array(0), stamp = new Int32Array(0), sid = 0;
  let CS = new Int32Array(1), CI = new Int32Array(0), CZ0 = new Float32Array(0), CZ1 = new Float32Array(0);
  let GX0 = 0, GY0 = 0, GNX = 0, GNY = 0, GCELL = 2, GINV = 0.5, GZ0 = -1, GZ1 = 10, NP = 0, NB = 0;
  let INFO = [], TAGS = [], BLD = [], DOORS = [], MATS = [], MATIDX = {}, NBIMMAT = 0, ELEM = {}, RINGS = new Float32Array(0), EL_NAME = {};
  let W = null, GZ = null, GN = 0, GRES = 0.5, GWX0 = -20, GZMAX = 0.2, CLSR = null, MATR = null, MARK = null;
  let builtFor = null, doorDirty = false, bimLoaded = false;
  RC.stats = { prims: 0, boxes: 0, cells: 0, buildMs: 0, builds: 0 };

  /* ----------- helpers for build ----------- */
  const rot9 = (yaw, roll) => { const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll); return [cy, -sy * cr, sy * sr, sy, cy * cr, -cy * sr, 0, sr, cr]; };
  function build(V) {
    const t0 = performance.now();
    V = V || (ES.view3d && ES.view3d.walk && ES.view3d.walk.V); if (!V || !V.A || !V.A.W) return false;
    const A = V.A, sc = A.scene, bim = A.bim || null; W = A.W; GZ = W.gz; GN = W.N; GRES = W.res; GWX0 = W.x0;
    GZMAX = 0; for (let i = 0; i < GZ.length; i++) if (GZ[i] > GZMAX) GZMAX = GZ[i]; GZMAX += 0.01;
    const occ = A.occ || { fences: true, trees: true, vehicles: true };
    const prims = [], pz0 = [], pz1 = [], pt = [], pl = [], pf = [], pm = [], pc = [], pbb = [], piv = [], info = [];
    ELEM = (bim && bim.elements) || {}; EL_NAME = {}; for (const k in ELEM) EL_NAME[ELEM[k]] = k;
    const E_SLAB = ELEM.slab || 3, E_CEIL = ELEM.ceiling || 4;
    // ---- materials: the BIM table first (ids as in the BIM json), then the world materials
    MATS = []; MATIDX = {}; NBIMMAT = bim ? bim.materials.length : 0;
    const addMat = (name, extra) => { const r = REFL[name] || [0.3, 0, 0]; const m = Object.assign({ name, refl: r[0], spec: r[1], nir: r[2] }, extra || {}); MATIDX[name] = MATS.length; MATS.push(m); return MATS.length - 1; };
    if (bim) for (const m of bim.materials) addMat(m.name, { glass: /glass/.test(m.name) && m.trans >= 0.1, trans: m.trans, rf: m.rf, rho: m.rho, rgb: m.rgb });
    const wm = {}; for (const n of WORLD_MATS) wm[n] = addMat(n, {});
    RC.MATS = MATS; RC.WM = wm;
    const bimElemCls = (e) => (FURN_ELEM.has(EL_NAME[e]) ? RC.CFG.bimFurnitureClass : SEM.building);
    // ---- primitive adders (world prims; BIM boxes use the same table, first)
    const add = (type, layer, cls, mat, flags, bb, f, infoObj, pv) => {
      const row = new Array(PS).fill(0); for (let i = 0; i < f.length; i++) row[i] = f[i]; for (let i = 0; i < PS; i++) prims.push(row[i]);
      pt.push(type); pl.push(layer); pc.push(cls); pm.push(mat); pf.push(flags); pbb.push(bb[0], bb[1], bb[2], bb[3]); pz0.push(bb[4]); pz1.push(bb[5]);
      piv.push(pv ? pv[0] : 0, pv ? pv[1] : 0, pv ? pv[2] : 0); info.push(infoObj || null); return pt.length - 1;
    };
    /* box record: [cx, cy, cz, hx, hy, hz (LOCAL half sizes), cos yaw, sin yaw, cos roll, sin roll, rot code (axis-aligned boxes: 0 / 90 / 180 / -90 deg), world half x, world half y].
       Axis-aligned boxes (yaw a multiple of 90 deg, no roll) take the fast slab path with the world half sizes; the code maps the world face back to the local face (per-face materials). */
    const addBox = (cx, cy, cz, hx, hy, hz, yaw, roll, layer, cls, mat, flags, infoObj, pv, zrange) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
      const ex = Math.abs(c) * hx + Math.abs(s * cr) * hy + Math.abs(s * sr) * hz, ey = Math.abs(s) * hx + Math.abs(c * cr) * hy + Math.abs(c * sr) * hz, ez = Math.abs(sr) * hy + Math.abs(cr) * hz;
      const rolled = Math.abs(roll) > 1e-6, axis = !rolled && !pv && (Math.abs(s) < 1e-6 || Math.abs(c) < 1e-6);
      let code = 0; if (axis) code = Math.abs(s) < 1e-6 ? (c > 0 ? 0 : 2) : s > 0 ? 1 : 3;
      const type = rolled ? T_ROLL : axis ? T_AABB : T_YAW, hxw = code & 1 ? hy : hx, hyw = code & 1 ? hx : hy, zr = zrange || [cz - ez, cz + ez];
      const bb = pv && pv[2] > 0 ? [pv[0] - pv[2], pv[0] + pv[2], pv[1] - pv[2], pv[1] + pv[2], zr[0], zr[1]] : [cx - ex, cx + ex, cy - ey, cy + ey, zr[0], zr[1]];
      return add(type, layer, cls, mat, flags, bb, [cx, cy, cz, hx, hy, hz, c, s, cr, sr, code, hxw, hyw], infoObj, pv);
    };
    const gzAt = (x, y) => W.groundZ(x, y);

    // ---- BIM: PHYS boxes (+ VIS-only 'treat' boxes flagged), roof polygons; one entry per box, in file order
    const fm = [], bcore = [], belem = [], bfl = [], bbld = [], bsto = [], btag = [], broom = [], bcls = [];
    BLD = []; TAGS = []; DOORS = []; const tagIdx = {}; const doorByKey = {};
    const col = V.col;
    if (bim && col) for (const [bid, B] of Object.entries(bim.buildings)) {
      const finfo = col.byBuilding && col.byBuilding[bid]; if (!finfo) continue;      // not modelled in this scene build (collapsed building drawn as a prism)
      const dmg = W.damage && W.damage[bid], flo = (sc.buildings[finfo.bi] || {}).floors || 1, keep = dmg && dmg.state === "partial" ? Math.max(1, Math.floor(0.7 * flo)) : 99;
      if (dmg && dmg.state === "collapsed") continue;
      const bi = BLD.length; BLD.push({ id: bid, kind: B.kind, bi: finfo.bi, zTop: finfo.zTop, roofRise: finfo.roofRise, poly: finfo.poly, lo: finfo.lo, hi: finfo.hi, z0: finfo.z0, keep });
      B.boxes.forEach((r, i) => {
        const fl = r[15]; if (r[16] >= keep) return;
        const visOnly = !(fl & FL.PHYS); if (visOnly && !(fl & FL.VIS)) return; const treat = visOnly && EL_NAME[r[14]] === "treat";
        const mov = B.mov[i], mats = r.slice(8, 14); let core = mats[0] || mats[2] || mats[4] || mats[1] || mats[3] || mats[5]; const ename = EL_NAME[r[14]];
        let pv = null, zr = null, info0 = null;
        if (mov) {
          const key = bid + "/" + B.tags[i], px = mov.kind === "swing" ? mov.pivot[0] : r[0], py = mov.kind === "swing" ? mov.pivot[1] : r[1], rad = mov.kind === "swing" ? Math.hypot(r[0] - px, r[1] - py) + Math.hypot(r[3] / 2, r[4] / 2) : 0;
          pv = [px, py, rad]; zr = [r[2] - r[5] / 2 - 0.01, r[2] + r[5] / 2 + (mov.kind === "slide_up" ? mov.lift : 0) + 0.01];
          info0 = key;
        }
        const flags = (fl & FL.GLASS ? PF_GLASS : 0) | (treat ? PF_TREAT : 0) | (pv ? PF_MOVER : 0);
        const id = addBox(r[0], r[1], r[2], r[3] / 2, r[4] / 2, r[5] / 2, r[6], r[7], treat ? LAYER.TREAT : visOnly ? LAYER.DETAIL : LAYER.BIM, bimElemCls(r[14]), core, flags, null, pv && (mov.kind === "swing" ? pv : [r[0], r[1], 0]), zr);
        for (let k = 0; k < 6; k++) fm.push(mats[k]); bcore.push(core); belem.push(r[14]); bfl.push(fl); bbld.push(bi); bsto.push(r[16]); broom.push(r[17]);
        const tg = B.tags[i] || ""; let ti = tagIdx[bid + "/" + tg]; if (ti === undefined) { ti = TAGS.length; TAGS.push(tg); tagIdx[bid + "/" + tg] = ti; } btag.push(ti); bcls.push(bimElemCls(r[14]));
        if (mov) {
          const key = info0; let rec = doorByKey[key]; if (!rec) { rec = doorByKey[key] = { key, d: col.doors[key] || null, mov, pids: [], base: [], open: null }; DOORS.push(rec); }
          rec.pids.push(id); rec.base.push([r[0], r[1], r[2], r[6]]);
        }
      });
      if (keep >= 99) for (const pl_ of B.polys || []) {
        if (!(pl_.flags & FL.PHYS) || pl_.storey >= keep) continue; const v = pl_.v;
        for (let k = 1; k + 1 < v.length; k++) {
          const a = v[0], b = v[k], c = v[k + 1], e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const nl = Math.hypot(n[0], n[1], n[2]); if (nl < 1e-9) continue; n = n.map((q) => q / nl);
          add(T_TRI, LAYER.BIM, SEM.building, pl_.mat, 0, [Math.min(a[0], b[0], c[0]), Math.max(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.max(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2]), Math.max(a[2], b[2], c[2])],
            [a[0], a[1], a[2], e1[0], e1[1], e1[2], e2[0], e2[1], e2[2], n[0], n[1], n[2]], { kind: "roof", bld: bi, mat: pl_.mat });
        }
      }
    }
    NB = fm.length / 6; const nBoxPrims = pt.length;      // the BIM boxes are the first NB prims, but polygons come after boxes of the SAME building: keep a map prim -> box index
    // (boxes and roof triangles are interleaved per building above: boxes must be the first NB prims for the face-material table, so move to a prim->box map)
    const boxOf = new Int32Array(pt.length).fill(-1); { let k = 0; for (let i = 0; i < pt.length; i++) if (info[i] === null && pt[i] <= T_ROLL) boxOf[i] = k++; }
    // ---- world: parked vehicles, objects, lamps, trees, fences, prisms
    const wmat = wm;
    const VEH = { sedan: [0.60, 0.52, -0.04, 0.88], hatchback: [0.60, 0.52, -0.04, 0.88], taxi: [0.60, 0.52, -0.04, 0.88], police: [0.60, 0.52, -0.04, 0.88], suv: [0.60, 0.62, -0.06, 0.90], pickup: [0.62, 0.36, 0.10, 0.90] };
    if (occ.vehicles !== false) (W.vehicles || []).forEach((v, vi) => {
      const [L, Wd, H] = v.dims, yaw = ES.rad(v.yaw), z0 = gzAt(v.xy[0], v.xy[1]), prof = VEH[v.vtype || v.kind], cs = Math.cos(yaw), sn = Math.sin(yaw);
      const inf = { kind: "vehicle", i: vi, id: v.id, vtype: v.vtype };
      if (prof) {
        const bt = prof[0] * H; addBox(v.xy[0], v.xy[1], z0 + 0.16 + (bt - 0.16) / 2, L / 2, Wd * 0.48, (bt - 0.16) / 2, yaw, 0, LAYER.WORLD, SEM.vehicle, wmat.car_paint, PF_OPAQUE_WORLD, inf);
        const cl = prof[1] * L, off = prof[2] * L, cw = prof[3] * Wd; addBox(v.xy[0] + cs * off, v.xy[1] + sn * off, z0 + bt + (H - bt) / 2, cl / 2, cw / 2, (H - bt) / 2, yaw, 0, LAYER.WORLD, SEM.vehicle, wmat.car_glass, PF_OPAQUE_WORLD, inf);
      } else addBox(v.xy[0], v.xy[1], z0 + 0.2 + (H - 0.2) / 2, L / 2, Wd / 2, (H - 0.2) / 2, yaw, 0, LAYER.WORLD, SEM.vehicle, wmat.car_paint, PF_OPAQUE_WORLD, inf);
    });
    const objs = sc.objects || [];
    objs.forEach((o, oi) => {
      if (o.type === "box") {
        const nm = o.name, m = nm === "container" ? wmat.container : nm === "shed" ? wmat.shed : nm === "bins" ? wmat.plastic : wmat.pole_metal, inf = { kind: "object", name: nm, i: oi };
        addBox(o.xy[0], o.xy[1], 0.14 + o.size[2] / 2, o.size[0] / 2, o.size[1] / 2, o.size[2] / 2, o.yaw || 0, 0, LAYER.WORLD, SEM.furniture, m, PF_OPAQUE_WORLD, inf);
        if (nm === "shed") addBox(o.xy[0], o.xy[1], 0.14 + o.size[2] + 0.06, (o.size[0] + 0.3) / 2, (o.size[1] + 0.3) / 2, 0.06, o.yaw || 0, 0, LAYER.WORLD, SEM.furniture, wmat.shed, PF_OPAQUE_WORLD, inf);
      } else if (o.type === "cyl") add(T_CYL, LAYER.WORLD, SEM.furniture, wmat.container, PF_OPAQUE_WORLD, [o.xy[0] - o.r, o.xy[0] + o.r, o.xy[1] - o.r, o.xy[1] + o.r, 0, o.h], [o.xy[0], o.xy[1], 0, o.h, o.r], { kind: "object", name: o.name, i: oi });
      else if (o.type === "post") {
        add(T_CYL, LAYER.WORLD, SEM.furniture, wmat.pole_metal, 0, [o.xy[0] - 0.05, o.xy[0] + 0.05, o.xy[1] - 0.05, o.xy[1] + 0.05, 0.14, 0.14 + o.h], [o.xy[0], o.xy[1], 0.14, 0.14 + o.h, 0.05], { kind: "object", name: o.name, i: oi });
        if (o.name === "mailbox") addBox(o.xy[0], o.xy[1], 0.14 + o.h + 0.1, 0.11, 0.25, 0.1, 0, 0, LAYER.WORLD, SEM.furniture, wmat.pole_metal, 0, { kind: "object", name: o.name, i: oi });
      }
    });
    (sc.lamps || []).forEach((l, li) => {
      const hx = l[0] + Math.cos(l[2]) * 1.6, hy = l[1] + Math.sin(l[2]) * 1.6, inf = { kind: "lamp", i: li };
      add(T_CYL, LAYER.WORLD, SEM.furniture, wmat.pole_metal, 0, [l[0] - 0.1, l[0] + 0.1, l[1] - 0.1, l[1] + 0.1, 0.14, 7.14], [l[0], l[1], 0.14, 7.14, 0.085], inf);
      addBox((l[0] + hx) / 2, (l[1] + hy) / 2, 7.0, 0.85, 0.04, 0.04, l[2], 0, LAYER.WORLD, SEM.furniture, wmat.pole_metal, 0, inf);
      addBox(hx, hy, 6.95, 0.35, 0.15, 0.06, l[2], 0, LAYER.WORLD, SEM.furniture, wmat.pole_metal, 0, inf);
    });
    if (occ.trees !== false) (sc.trees || []).forEach((t, ti) => {
      const k = ES.TREE[t[2]] || ES.TREE.round, s = t[3], z0 = 0.14, inf = { kind: "tree", i: ti, species: t[2] }, tr = 0.13 * s, ztop = z0 + (k.lo + 0.45 * (k.h - k.lo)) * s;
      add(T_CYL, LAYER.WORLD, SEM.vegetation, wmat.bark, 0, [t[0] - tr, t[0] + tr, t[1] - tr, t[1] + tr, z0, ztop], [t[0], t[1], z0, ztop, tr], inf);
      const rz = (k.h - k.lo) * 0.5 * s, cz = z0 + (k.lo * s + rz), rx = k.r * s;
      add(T_ELLIP, LAYER.FOLIAGE, SEM.vegetation, wmat.foliage, 0, [t[0] - rx, t[0] + rx, t[1] - rx, t[1] + rx, cz - rz, cz + rz], [t[0], t[1], cz, rx, rz, 0.5 * k.den], inf);
    });
    if (occ.fences !== false) objs.forEach((o, oi) => {
      if (o.type !== "fence") return; const st = o.style === "privacy" ? 0 : o.style === "chain" ? 2 : 1, z0 = 0.14;
      o.lines.forEach((ln, li) => { let acc = 0; for (let k = 0; k + 1 < ln.length; k++) {
        const a = ln[k], b = ln[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.2) continue; const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nPost = Math.max(1, Math.round(L / 2.4));
        add(T_FENCE, LAYER.WORLD, SEM.furniture, st === 1 ? wmat.fence_white : st === 0 ? wmat.fence_wood : wmat.fence_chain, st === 0 ? PF_OPAQUE_WORLD : 0,
          [Math.min(a[0], b[0]) - 0.06, Math.max(a[0], b[0]) + 0.06, Math.min(a[1], b[1]) - 0.06, Math.max(a[1], b[1]) + 0.06, z0, z0 + o.h + 0.1], [a[0], a[1], ux, uy, L, z0, o.h, st, nPost, acc], { kind: "fence", style: o.style, i: oi, line: li }); acc += L; } });
    });
    // prism buildings (collapsed ones, or any building the BIM does not model)
    const ring = []; const ringStart = [];
    (sc.buildings || []).forEach((b, bi) => {
      if (V.bimSkip && V.bimSkip.has(bi + 1)) return; const dmg = W.damage && W.damage[b.id]; let h = b.h;
      if (dmg && dmg.state === "collapsed") h = Math.min(2.2, 0.18 * b.h); else if (dmg && dmg.state === "partial") h = 0.7 * b.h;
      const rings = b.parts && b.parts.length ? b.parts : [b.fp], collapsed = dmg && dmg.state === "collapsed";
      for (const rg of rings) {
        let area = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) { area += (rg[j][0] * rg[i][1] - rg[i][0] * rg[j][1]); x0 = Math.min(x0, rg[i][0]); x1 = Math.max(x1, rg[i][0]); y0 = Math.min(y0, rg[i][1]); y1 = Math.max(y1, rg[i][1]); }
        const off = ring.length / 2; for (const p of rg) ring.push(p[0], p[1]);
        add(T_PRISM, LAYER.WORLD, collapsed ? SEM.debris : SEM.building, collapsed ? wmat.rubble : wmat.building_generic, PF_OPAQUE_WORLD, [x0, x1, y0, y1, 0.14, h], [off, rg.length, h, 0.14, area >= 0 ? 1 : -1], { kind: collapsed ? "rubble" : "prism", i: bi, id: b.id });
      }
    });
    RINGS = new Float32Array(ring);

    // ---- typed arrays
    NP = pt.length; P = new Float32Array(prims); PT = Uint8Array.from(pt); PL = Uint8Array.from(pl); PF = Uint8Array.from(pf); PM = Uint8Array.from(pm); PC = Uint8Array.from(pc);
    PZ0 = Float32Array.from(pz0); PZ1 = Float32Array.from(pz1); PIV = Float32Array.from(piv); INFO = info; stamp = new Int32Array(NP); sid = 0;
    // BIM box arrays are indexed by box index; prims point to them through BOX (prim -> box idx)
    FM = Uint8Array.from(fm); BCORE = Uint8Array.from(bcore); BELEM = Uint8Array.from(belem); BFL = Uint8Array.from(bfl); BBLD = Int16Array.from(bbld); BSTO = Int8Array.from(bsto); BTAG = Int32Array.from(btag); BROOM = Int16Array.from(broom); BCLS = Uint8Array.from(bcls);
    BOX = boxOf; PRIM_OF_BOX = new Int32Array(NB); for (let i = 0; i < NP; i++) if (boxOf[i] >= 0) PRIM_OF_BOX[boxOf[i]] = i;
    // ---- ground rasters: class + material (asphalt / sidewalk / grass / gravel / water)
    buildGroundRasters(sc, wm);
    // ---- grid
    buildGrid(pbb);
    for (const rec of DOORS) { rec.open = null; if (!rec.d && col) rec.d = col.doors[rec.key] || null; }
    syncDoors(true);
    builtFor = V.scene; bimLoaded = !!bim; doorDirty = false;
    RC.stats = { prims: NP, boxes: NB, cells: GNX * GNY, items: CI.length, buildMs: performance.now() - t0, builds: (RC.stats.builds || 0) + 1, doors: DOORS.length };
    return true;
  }
  let BOX = new Int32Array(0), PRIM_OF_BOX = new Int32Array(0);

  function buildGroundRasters(sc, wm) {
    const N = GN; CLSR = new Uint8Array(N * N).fill(SEM.ground); MATR = new Uint8Array(N * N).fill(wm.grass); MARK = new Uint8Array(N * N);
    const set = (ring, cls, mat) => W.fillPoly(ring, (id) => { CLSR[id] = cls; MATR[id] = mat; });
    for (const b of sc.blocks || []) set(b.ring, b.ground === "paved" ? SEM.sidewalk : SEM.ground, b.ground === "paved" ? wm.sidewalk : b.ground === "gravel" ? wm.gravel : wm.grass);
    for (const p of sc.parks || []) set(p, SEM.ground, wm.grass); for (const p of sc.plazas || []) set(p, SEM.sidewalk, wm.sidewalk);
    for (const p of sc.ponds || []) set(p, SEM.water, wm.water);
    for (const p of sc.road_poly || []) set(p.ring, SEM.road, wm.asphalt);
    for (const p of sc.sidewalk_poly || []) set(p.ring, SEM.sidewalk, wm.sidewalk); for (const p of sc.path_poly || []) set(p.ring, SEM.sidewalk, wm.sidewalk);
    for (const o of sc.objects || []) {
      if (o.type === "pave") set(o.ring, o.surface === "concrete" ? SEM.sidewalk : SEM.road, o.surface === "concrete" ? wm.sidewalk : wm.asphalt);
      else if (o.type === "walkway") W.fillSeg(o.from, o.to, o.w / 2, (id) => { CLSR[id] = SEM.sidewalk; MATR[id] = wm.sidewalk; }); else if (o.type === "pool") set(o.ring, SEM.water, wm.water);
    }
    // road markings: cells that contain paint (crosswalk stripes, dashed centre lines): painted-asphalt reflectivity is evaluated per hit point in groundMark()
    MARKS = []; for (const z of sc.crosswalks || []) MARKS.push({ cx: z.c[0], cy: z.c[1], dx: z.d[0], dy: z.d[1], len: z.len, w: z.w, n: Math.floor(z.w / 0.9) });
    CLINES = (sc.centrelines || []).filter((c) => c.dashed);
    for (const m of MARKS) { const r = Math.hypot(m.len, m.w) / 2 + 0.5; W.fillCircle(m.cx, m.cy, r, (id) => { MARK[id] = 1; }); }
    for (const c of CLINES) for (let k = 0; k + 1 < c.line.length; k++) W.fillSeg(c.line[k], c.line[k + 1], 0.4, (id) => { MARK[id] |= 2; });
  }
  let MARKS = [], CLINES = [];
  /* is (x, y) on road paint? crosswalk stripes (0.45 m wide, 0.9 m pitch) and dashed centre lines (3 m dash / 3 m gap, 0.15 m wide) */
  function groundMark(x, y, id) {
    const m = MARK[id]; if (!m) return false;
    if (m & 1) for (const z of MARKS) {       // stripes: length z.len along d, 0.45 m wide, pitch 0.9 m across (same layout as the renderer)
      const rx = x - z.cx, ry = y - z.cy, a = rx * z.dx + ry * z.dy, b = -rx * z.dy + ry * z.dx;
      if (Math.abs(a) <= z.len / 2) { const k = Math.round(b / 0.9 + (z.n - 1) / 2); if (k >= 0 && k < z.n && Math.abs(b - (k - (z.n - 1) / 2) * 0.9) <= 0.225) return true; }
    }
    if (m & 2) for (const c of CLINES) for (let k = 0; k + 1 < c.line.length; k++) {       // dashes: 3 m long every 6 m from 1 m, 0.15 m wide
      const a = c.line[k], b = c.line[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, rx = x - a[0], ry = y - a[1], u = rx * ux + ry * uy, v = -rx * uy + ry * ux;
      if (u >= 1 && u < L && Math.abs(v) <= 0.075 && ((u - 1) % 6) < 3 && 1 + 6 * Math.floor((u - 1) / 6) < L - 3) return true;
    }
    return false;
  }

  /* ----------- the 2 m grid ----------- */
  function buildGrid(bb) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, zlo = 1e9, zhi = -1e9;
    for (let i = 0; i < NP; i++) { x0 = Math.min(x0, bb[4 * i]); x1 = Math.max(x1, bb[4 * i + 1]); y0 = Math.min(y0, bb[4 * i + 2]); y1 = Math.max(y1, bb[4 * i + 3]); zlo = Math.min(zlo, PZ0[i]); zhi = Math.max(zhi, PZ1[i]); }
    if (!NP) { x0 = y0 = 0; x1 = y1 = 1; zlo = 0; zhi = 1; }
    GX0 = Math.floor(x0 / GCELL) * GCELL - GCELL; GY0 = Math.floor(y0 / GCELL) * GCELL - GCELL; GNX = Math.ceil((x1 - GX0) / GCELL) + 2; GNY = Math.ceil((y1 - GY0) / GCELL) + 2; GZ0 = Math.min(zlo, 0) - 0.5; GZ1 = zhi + 0.5;
    const ncell = GNX * GNY, cnt = new Int32Array(ncell + 1);
    const cells = (i, fn) => {
      const t = PT[i], p = i * PS, ix0 = Math.max(0, Math.floor((bb[4 * i] - GX0) * GINV)), ix1 = Math.min(GNX - 1, Math.floor((bb[4 * i + 1] - GX0) * GINV)), iy0 = Math.max(0, Math.floor((bb[4 * i + 2] - GY0) * GINV)), iy1 = Math.min(GNY - 1, Math.floor((bb[4 * i + 3] - GY0) * GINV));
      const rotBox = t === T_YAW || ((PF[i] & PF_MOVER) && t <= T_ROLL), rad = PIV[3 * i + 2];
      for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
        const qx = GX0 + (ix + 0.5) * GCELL, qy = GY0 + (iy + 0.5) * GCELL, hc = GCELL / 2;
        if (rotBox && !(PF[i] & PF_MOVER)) { const cx = P[p], cy = P[p + 1], hx = P[p + 3], hy = P[p + 4], c = P[p + 6], s = P[p + 7], dx = qx - cx, dy = qy - cy, u = dx * c + dy * s, v = -dx * s + dy * c;
          if (Math.abs(u) > hx + hc * (Math.abs(c) + Math.abs(s)) || Math.abs(v) > hy + hc * (Math.abs(c) + Math.abs(s))) continue; }
        else if (t === T_FENCE) { const ax = P[p], ay = P[p + 1], ux = P[p + 2], uy = P[p + 3], L = P[p + 4], rx = qx - ax, ry = qy - ay, u = Math.max(0, Math.min(L, rx * ux + ry * uy)), ex = rx - ux * u, ey = ry - uy * u; if (Math.hypot(ex, ey) > hc * 1.4143 + 0.1) continue; }
        else if (t === T_CYL || t === T_ELLIP) { const r = t === T_CYL ? P[p + 4] : P[p + 3], dx = Math.max(0, Math.abs(qx - P[p]) - hc), dy = Math.max(0, Math.abs(qy - P[p + 1]) - hc); if (dx * dx + dy * dy > r * r) continue; }
        else if ((PF[i] & PF_MOVER) && rad > 0) { const dx = Math.max(0, Math.abs(qx - PIV[3 * i]) - hc), dy = Math.max(0, Math.abs(qy - PIV[3 * i + 1]) - hc); if (dx * dx + dy * dy > rad * rad) continue; }
        fn(iy * GNX + ix);
      }
    };
    for (let i = 0; i < NP; i++) cells(i, (c) => { cnt[c + 1]++; });
    for (let c = 0; c < ncell; c++) cnt[c + 1] += cnt[c];
    CS = cnt; CI = new Int32Array(cnt[ncell]); CZ0 = new Float32Array(cnt[ncell]); CZ1 = new Float32Array(cnt[ncell]); const fill = cnt.slice(0, ncell);
    for (let i = 0; i < NP; i++) cells(i, (c) => { const k = fill[c]++; CI[k] = i; CZ0[k] = PZ0[i]; CZ1[k] = PZ1[i]; });
  }

  /* ----------- doors: leaves follow V.col.doors[key].open ----------- */
  function syncDoors(force) {
    for (const rec of DOORS) {
      const d = rec.d; if (!d) continue; const o = d.open; if (!force && o === rec.open) continue; rec.open = o; const m = rec.mov;
      for (let k = 0; k < rec.pids.length; k++) {
        const pid = rec.pids[k], b = rec.base[k], p = pid * PS;
        if (m.kind === "swing") { const a = m.angle * o, ca = Math.cos(a), sa = Math.sin(a), dx = b[0] - m.pivot[0], dy = b[1] - m.pivot[1], yaw = b[3] + a; P[p] = m.pivot[0] + ca * dx - sa * dy; P[p + 1] = m.pivot[1] + sa * dx + ca * dy; P[p + 6] = Math.cos(yaw); P[p + 7] = Math.sin(yaw); }
        else if (m.kind === "slide_up") P[p + 2] = b[2] + m.lift * o;
      }
    }
    doorDirty = false;
  }
  // door changes are announced by BimCol.setDoor: wrap it once so a query right after a change already sees the new leaf position
  if (ES.BimCol && !ES.BimCol.prototype._rayWrapped) { const orig = ES.BimCol.prototype.setDoor; ES.BimCol.prototype.setDoor = function (d, open) { orig.call(this, d, open); doorDirty = true; }; ES.BimCol.prototype._rayWrapped = true; }

  /* ============================== dynamic bodies ============================== */
  const DBCAP = 64, DB = new Float64Array(DBCAP * 16); const DBT = new Uint8Array(DBCAP), DBCLS = new Uint8Array(DBCAP), DBMAT = new Uint8Array(DBCAP), DBUID = new Array(DBCAP).fill(""), DBKIND = new Array(DBCAP).fill("");
  let DBn = 0; RC.bodies = [];
  /* body = {uid, kind, x, y, z (feet / floor height; UAV: centre), yaw}  kinds: person | lying | dog | uav | rover | cp | vehicle */
  const BODY = {
    person: { t: 1, r: 0.25, h: 1.7, cls: SEM.person, mat: "person" }, lying: { t: 2, hx: 0.85, hy: 0.25, hz: 0.12, cls: SEM.victim, mat: "person", lift: 0.12 },
    dog: { t: 2, hx: 0.35, hy: 0.155, hz: 0.2, cls: SEM.ugv, mat: "dog_body", lift: 0.2 }, uav: { t: 2, hx: 0.125, hy: 0.125, hz: 0.05, cls: SEM.uav, mat: "uav_body", lift: 0 },
    rover: { t: 2, hx: 0.33, hy: 0.23, hz: 0.3, cls: SEM.ugv, mat: "rover_body", lift: 0.3 }, cp: { t: 2, hx: 3.5, hy: 1.25, hz: 1.65, cls: SEM.command_post, mat: "cp_body", lift: 1.65 }, vehicle: { t: 2, hx: 2.1, hy: 0.9, hz: 0.75, cls: SEM.vehicle, mat: "car_paint", lift: 0.75 },
  };
  RC.BODY = BODY;
  function setBodies(list) {
    DBn = 0; RC.bodies = list;
    for (const b of list) {
      if (DBn >= DBCAP) break; const k = BODY[b.kind]; if (!k) continue; const i = DBn++, o = i * 16, c = Math.cos(b.yaw || 0), s = Math.sin(b.yaw || 0);
      DBT[i] = k.t; DBCLS[i] = k.cls; DBMAT[i] = MATIDX[k.mat] || 0; DBUID[i] = b.uid || ""; DBKIND[i] = b.kind;
      if (k.t === 1) { const r = k.r, z0 = b.z, z1 = b.z + (b.h || k.h); DB[o] = b.x; DB[o + 1] = b.y; DB[o + 2] = z0 + r; DB[o + 3] = z1 - r; DB[o + 4] = r; DB[o + 9] = b.x - r; DB[o + 10] = b.x + r; DB[o + 11] = b.y - r; DB[o + 12] = b.y + r; DB[o + 13] = z0; DB[o + 14] = z1; }
      else { const dm = b.dims || null, hx = dm ? dm[0] / 2 : k.hx, hy = dm ? dm[1] / 2 : k.hy, hz = dm ? dm[2] / 2 : k.hz, cz = b.kind === "uav" ? b.z : b.z + (dm ? dm[2] / 2 : k.lift), ex = Math.abs(c) * hx + Math.abs(s) * hy, ey = Math.abs(s) * hx + Math.abs(c) * hy;
        DB[o] = b.x; DB[o + 1] = b.y; DB[o + 2] = cz; DB[o + 3] = hx; DB[o + 4] = hy; DB[o + 5] = hz; DB[o + 6] = c; DB[o + 7] = s; DB[o + 9] = b.x - ex; DB[o + 10] = b.x + ex; DB[o + 11] = b.y - ey; DB[o + 12] = b.y + ey; DB[o + 13] = cz - hz; DB[o + 14] = cz + hz; }
    }
  }
  function collectBodies() {
    const V = ES.view3d && ES.view3d.walk && ES.view3d.walk.V, WALK = ES.view3d && ES.view3d.walk && ES.view3d.walk.state, out = []; if (!V || !V.A) { setBodies(out); return out; }
    const A = V.A, sz = ES.view3d.walk.surfZ;
    if (V.live && V.live.parent && V.live.userData.items) for (const it of V.live.userData.items) {
      const m = it.model; if (!m) continue; const k = it.kind === "dog" ? "dog" : it.kind === "uav" ? "uav" : it.kind === "rover" ? "rover" : it.kind === "t:lying" ? "lying" : "person";
      out.push({ uid: "live:" + it.id, kind: k, x: m.position.x, y: -m.position.z, z: m.position.y, yaw: m.rotation.y });
    }
    for (const e of A.ents || []) {
      if (e.id === V.hide || e.kind === "sound") continue; const k = e.kind === "human" || e.kind === "t:person" ? "person" : e.kind === "t:lying" ? "lying" : e.kind === "t:vehicle" ? "vehicle" : e.kind;
      if (!BODY[k]) continue; const b = { uid: "ent:" + e.id, kind: k, x: e.x, y: e.y, z: e.kind === "uav" ? e.z : e.zf != null ? e.zf : sz ? sz(e.x, e.y) : 0, yaw: e.yaw || 0 };
      if (k === "cp") b.dims = A.scene.cp_dims || [7, 2.5, 3.3]; if (k === "vehicle") b.dims = [4.2, 1.8, 1.5]; out.push(b);
    }
    if (WALK && WALK.active) out.push({ uid: "walk", kind: WALK.body === "uav" ? "uav" : WALK.body === "dog" ? "dog" : "person", x: WALK.x, y: WALK.y, z: WALK.body === "uav" ? WALK.z : WALK.zf, yaw: WALK.yaw });
    setBodies(out); return out;
  }

  /* ============================== ray tracing ============================== */
  let rT = 0, rId = -1, rKind = 0, rFace = 0, rNx = 0, rNy = 0, rNz = 1, rFol = 0;
  let gMask = LAYER.ALL, gGlass = true, gIgnore = -1, gSkip = -1, gRng = 2463534242;
  const rnd = () => { let x = gRng; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; gRng = x; return x / 4294967296; };
  RC.seed = (s) => { gRng = (s >>> 0) || 2463534242; };
  const gzAt = (x, y) => { const i = Math.floor((x - GWX0) / GRES), j = Math.floor((y - GWX0) / GRES); return i < 0 || j < 0 || i >= GN || j >= GN ? 0 : GZ[j * GN + i]; };

  /* oriented box (yaw) entry test: returns entry t (> EPS) or -1; sets hx_ (axis) and hs_ (sign of the entering face normal along that axis: +1 / -1) */
  let hAx = 0, hSg = 1;
  const FACEMAP = Uint8Array.from([0, 1, 2, 3, 4, 5, 3, 2, 0, 1, 4, 5, 1, 0, 3, 2, 4, 5, 2, 3, 1, 0, 4, 5]);       // rot code (0, +90, 180, -90 deg) x world face -> local face
  function obbYaw(cx, cy, cz, hx, hy, hz, c, s, ox, oy, oz, dx, dy, dz) {
    const rx = ox - cx, ry = oy - cy, rz = oz - cz, lx = c * rx + s * ry, ly = -s * rx + c * ry, ldx = c * dx + s * dy, ldy = -s * dx + c * dy;
    return slab3(lx, ly, rz, ldx, ldy, dz, hx, hy, hz);
  }
  function slab3(ox, oy, oz, dx, dy, dz, hx, hy, hz) {
    if (Math.abs(dx) < 1e-12) dx = dx < 0 ? -1e-12 : 1e-12; if (Math.abs(dy) < 1e-12) dy = dy < 0 ? -1e-12 : 1e-12; if (Math.abs(dz) < 1e-12) dz = dz < 0 ? -1e-12 : 1e-12;
    let ix = 1 / dx, a = (-hx - ox) * ix, b = (hx - ox) * ix, tn, tf, ax = 0, sg; if (a < b) { tn = a; tf = b; sg = -1; } else { tn = b; tf = a; sg = 1; }
    ix = 1 / dy; a = (-hy - oy) * ix; b = (hy - oy) * ix; let n2, f2, s2; if (a < b) { n2 = a; f2 = b; s2 = -1; } else { n2 = b; f2 = a; s2 = 1; } if (n2 > tn) { tn = n2; ax = 1; sg = s2; } if (f2 < tf) tf = f2;
    ix = 1 / dz; a = (-hz - oz) * ix; b = (hz - oz) * ix; if (a < b) { n2 = a; f2 = b; s2 = -1; } else { n2 = b; f2 = a; s2 = 1; } if (n2 > tn) { tn = n2; ax = 2; sg = s2; } if (f2 < tf) tf = f2;
    if (tn > tf || tn <= EPS) return -1; hAx = ax; hSg = sg; return tn;
  }
  /* rolled box (R = Rz(yaw) Rx(roll)) */
  function obbRoll(cx, cy, cz, hx, hy, hz, c, s, cr, sr, ox, oy, oz, dx, dy, dz) {
    const rx = ox - cx, ry = oy - cy, rz = oz - cz;
    return slab3(c * rx + s * ry, -s * cr * rx + c * cr * ry + sr * rz, s * sr * rx - c * sr * ry + cr * rz, c * dx + s * dy, -s * cr * dx + c * cr * dy + sr * dz, s * sr * dx - c * sr * dy + cr * dz, hx, hy, hz);
  }
  /* vertical cylinder (side + caps), entering hits; sets hAx = 0 side / 1 top / 2 bottom */
  function cylHit(cx, cy, z0, z1, r, ox, oy, oz, dx, dy, dz) {
    const ex = ox - cx, ey = oy - cy, a = dx * dx + dy * dy; let t = -1;
    if (a > 1e-12) { const b = ex * dx + ey * dy, c = ex * ex + ey * ey - r * r, disc = b * b - a * c; if (disc >= 0) { const tt = (-b - Math.sqrt(disc)) / a; if (tt > EPS) { const z = oz + dz * tt; if (z >= z0 && z <= z1) { t = tt; hAx = 0; } } } }
    if (Math.abs(dz) > 1e-12) { const zc = dz < 0 ? z1 : z0, tt = (zc - oz) / dz; if (tt > EPS && (t < 0 || tt < t)) { const x = ex + dx * tt, y = ey + dy * tt; if (x * x + y * y <= r * r) { t = tt; hAx = dz < 0 ? 1 : 2; } } }
    return t;
  }
  function sphereHit(cx, cy, cz, r, ox, oy, oz, dx, dy, dz) { const ex = ox - cx, ey = oy - cy, ez = oz - cz, b = ex * dx + ey * dy + ez * dz, c = ex * ex + ey * ey + ez * ez - r * r, disc = b * b - c; if (disc < 0) return -1; const t = -b - Math.sqrt(disc); return t > EPS ? t : -1; }
  /* vertical capsule: axis from (cx, cy, zc0) to (cx, cy, zc1), radius r */
  function capsuleHit(cx, cy, zc0, zc1, r, ox, oy, oz, dx, dy, dz) {
    let t = cylHitSide(cx, cy, zc0, zc1, r, ox, oy, oz, dx, dy, dz);
    const tb = sphereHit(cx, cy, zc0, r, ox, oy, oz, dx, dy, dz); if (tb > 0 && oz + dz * tb <= zc0 && (t < 0 || tb < t)) t = tb;
    const tt = sphereHit(cx, cy, zc1, r, ox, oy, oz, dx, dy, dz); if (tt > 0 && oz + dz * tt >= zc1 && (t < 0 || tt < t)) t = tt;
    return t;
  }
  function cylHitSide(cx, cy, z0, z1, r, ox, oy, oz, dx, dy, dz) {
    const ex = ox - cx, ey = oy - cy, a = dx * dx + dy * dy; if (a < 1e-12) return -1; const b = ex * dx + ey * dy, c = ex * ex + ey * ey - r * r, disc = b * b - a * c; if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / a; if (t <= EPS) return -1; const z = oz + dz * t; return z >= z0 && z <= z1 ? t : -1;
  }
  const hash2 = (a, b) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

  /* ground: heightfield z = gz(x, y) in [0, GZMAX]; marches the band in 0.25 m xy steps, then bisects */
  function groundHit(ox, oy, oz, dx, dy, dz, tmax) {
    if (dz >= -1e-9) return -1; let ta = (GZMAX - oz) / dz; if (ta < 0) ta = 0; const tb = (0 - oz) / dz; if (ta > tmax) return -1;
    if (oz <= gzAt(ox, oy) && ta === 0) return -1;
    const tEnd = Math.min(tb, tmax), hz = Math.hypot(dx, dy), ds = hz > 1e-6 ? Math.min(0.25 / hz, 0.1 / -dz + 0.05) : tEnd - ta + 1; let tp = ta;
    for (let t = ta + ds; ; t += ds) {
      if (t > tEnd) t = tEnd; const z = oz + dz * t;
      if (z <= gzAt(ox + dx * t, oy + dy * t)) { let lo = tp, hi = t; for (let k = 0; k < 7; k++) { const m = 0.5 * (lo + hi); if (oz + dz * m <= gzAt(ox + dx * m, oy + dy * m)) hi = m; else lo = m; } return hi; }
      if (t >= tEnd) return -1; tp = t;
    }
  }

  function traceRay(ox, oy, oz, dx, dy, dz, tmax) {
    rKind = 0; rId = -1; let best = tmax; const mask = gMask;
    if (Math.abs(dx) < 1e-12) dx = dx < 0 ? -1e-12 : 1e-12; if (Math.abs(dy) < 1e-12) dy = dy < 0 ? -1e-12 : 1e-12; if (Math.abs(dz) < 1e-12) dz = dz < 0 ? -1e-12 : 1e-12;
    // ---- dynamic bodies (few, tested first so that the grid walk can stop early)
    if (DBn && (mask & LAYER.BODIES)) for (let b = 0; b < DBn; b++) {
      if (b === gIgnore) continue; const o = b * 16;
      // aabb reject
      let tn = -1e30, tf = 1e30, a1 = (DB[o + 9] - ox) / dx, a2 = (DB[o + 10] - ox) / dx; if (a1 > a2) { const q = a1; a1 = a2; a2 = q; } tn = a1; tf = a2;
      a1 = (DB[o + 11] - oy) / dy; a2 = (DB[o + 12] - oy) / dy; if (a1 > a2) { const q = a1; a1 = a2; a2 = q; } if (a1 > tn) tn = a1; if (a2 < tf) tf = a2;
      a1 = (DB[o + 13] - oz) / dz; a2 = (DB[o + 14] - oz) / dz; if (a1 > a2) { const q = a1; a1 = a2; a2 = q; } if (a1 > tn) tn = a1; if (a2 < tf) tf = a2;
      if (tn > tf || tf < EPS || tn > best) continue;
      let t;
      if (DBT[b] === 1) t = capsuleHit(DB[o], DB[o + 1], DB[o + 2], DB[o + 3], DB[o + 4], ox, oy, oz, dx, dy, dz);
      else t = obbYaw(DB[o], DB[o + 1], DB[o + 2], DB[o + 3], DB[o + 4], DB[o + 5], DB[o + 6], DB[o + 7], ox, oy, oz, dx, dy, dz);
      if (t > 0 && t < best) { best = t; rKind = 3; rId = b; rFace = DBT[b] === 1 ? 0 : hAx * 2 + (hSg > 0 ? 0 : 1); }
    }
    // ---- ground
    if (dz < 0 && (mask & LAYER.GROUND)) { const t = groundHit(ox, oy, oz, dx, dy, dz, best); if (t > 0 && t < best) { best = t; rKind = 2; rId = -1; } }
    if (!NP || !(mask & (LAYER.BIM | LAYER.WORLD | LAYER.FOLIAGE))) { rT = best; return rKind !== 0; }
    // ---- static: clip to the grid volume, walk the 2D grid
    let t0 = 0, t1 = best, a, b;
    const gx1 = GX0 + GNX * GCELL, gy1 = GY0 + GNY * GCELL;
    a = (GX0 - ox) / dx; b = (gx1 - ox) / dx; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b;
    a = (GY0 - oy) / dy; b = (gy1 - oy) / dy; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b;
    a = (GZ0 - oz) / dz; b = (GZ1 - oz) / dz; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b;
    if (t0 > t1) { rT = best; return rKind !== 0; }
    const sdx = dx > 0 ? 1 : -1, sdy = dy > 0 ? 1 : -1, tdx = GCELL / Math.abs(dx), tdy = GCELL / Math.abs(dy);
    let ix = Math.floor((ox + dx * t0 - GX0) * GINV), iy = Math.floor((oy + dy * t0 - GY0) * GINV); if (ix < 0) ix = 0; else if (ix >= GNX) ix = GNX - 1; if (iy < 0) iy = 0; else if (iy >= GNY) iy = GNY - 1;
    let tmx = ((dx > 0 ? (ix + 1) * GCELL : ix * GCELL) + GX0 - ox) / dx, tmy = ((dy > 0 ? (iy + 1) * GCELL : iy * GCELL) + GY0 - oy) / dy, tc0 = t0;
    if (++sid >= 2147483640) { stamp.fill(0); sid = 1; }
    const P_ = P, PT_ = PT, CI_ = CI, CS_ = CS, CZ0_ = CZ0, CZ1_ = CZ1, PL_ = PL, PF_ = PF, stamp_ = stamp, sid_ = sid, fol = (mask & LAYER.FOLIAGE) !== 0, wantGlass = gGlass, skip = gSkip;
    for (;;) {
      let tc1 = tmx < tmy ? tmx : tmy; if (tc1 > t1) tc1 = t1;
      const cell = iy * GNX + ix, k0 = CS_[cell], k1 = CS_[cell + 1];
      if (k1 > k0) {
        let za = oz + dz * tc0, zb = oz + dz * tc1, zlo, zhi; if (za < zb) { zlo = za; zhi = zb; } else { zlo = zb; zhi = za; } zlo -= 1e-4; zhi += 1e-4;
        for (let k = k0; k < k1; k++) {
          if (CZ1_[k] < zlo || CZ0_[k] > zhi) continue;
          const id = CI_[k]; if (stamp_[id] === sid_) continue; stamp_[id] = sid_;
          const lay = PL_[id]; if (!(lay & mask)) continue; const pf = PF_[id]; if (id === skip) continue; if ((pf & PF_GLASS) && !wantGlass) continue;
          const p = id * PS, ty = PT_[id]; let t = -1, face = 0;
          if (ty === T_AABB) {                     // axis-aligned box: the common case (walls, slabs, furniture)
            const hx = P_[p + 11], hy = P_[p + 12], hz = P_[p + 5], cx = P_[p], cy = P_[p + 1], cz = P_[p + 2];
            let i1 = 1 / dx, q1 = (cx - hx - ox) * i1, q2 = (cx + hx - ox) * i1, tn, tf, ax = 0, sg; if (q1 < q2) { tn = q1; tf = q2; sg = -1; } else { tn = q2; tf = q1; sg = 1; }
            i1 = 1 / dy; q1 = (cy - hy - oy) * i1; q2 = (cy + hy - oy) * i1; let n2, f2, s2; if (q1 < q2) { n2 = q1; f2 = q2; s2 = -1; } else { n2 = q2; f2 = q1; s2 = 1; } if (n2 > tn) { tn = n2; ax = 1; sg = s2; } if (f2 < tf) tf = f2;
            if (tn > tf || tf < EPS) continue; i1 = 1 / dz; q1 = (cz - hz - oz) * i1; q2 = (cz + hz - oz) * i1; if (q1 < q2) { n2 = q1; f2 = q2; s2 = -1; } else { n2 = q2; f2 = q1; s2 = 1; } if (n2 > tn) { tn = n2; ax = 2; sg = s2; } if (f2 < tf) tf = f2;
            if (tn > tf || tn <= EPS || tn >= best) continue;
            t = tn; face = FACEMAP[((P_[p + 10] | 0) * 6) + ax * 2 + (sg > 0 ? 0 : 1)];     // world face -> local face (+x -x +y -y +z -z) of the box
          } else if (ty === T_YAW) { t = obbYaw(P_[p], P_[p + 1], P_[p + 2], P_[p + 3], P_[p + 4], P_[p + 5], P_[p + 6], P_[p + 7], ox, oy, oz, dx, dy, dz); if (t <= 0 || t >= best) continue; face = hAx * 2 + (hSg > 0 ? 0 : 1); }
          else if (ty === T_ROLL) { t = obbRoll(P_[p], P_[p + 1], P_[p + 2], P_[p + 3], P_[p + 4], P_[p + 5], P_[p + 6], P_[p + 7], P_[p + 8], P_[p + 9], ox, oy, oz, dx, dy, dz); if (t <= 0 || t >= best) continue; face = hAx * 2 + (hSg > 0 ? 0 : 1); }
          else if (ty === T_CYL) { t = cylHit(P_[p], P_[p + 1], P_[p + 2], P_[p + 3], P_[p + 4], ox, oy, oz, dx, dy, dz); if (t <= 0 || t >= best) continue; face = hAx; }
          else if (ty === T_TRI) {
            const e1x = P_[p + 3], e1y = P_[p + 4], e1z = P_[p + 5], e2x = P_[p + 6], e2y = P_[p + 7], e2z = P_[p + 8];
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (det > -1e-12 && det < 1e-12) continue; const inv = 1 / det;
            const tx = ox - P_[p], ty_ = oy - P_[p + 1], tz = oz - P_[p + 2], u = (tx * px + ty_ * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
            const qx = ty_ * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty_ * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
            t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t <= EPS || t >= best) continue;
          } else if (ty === T_FENCE) { t = fenceHit(p, ox, oy, oz, dx, dy, dz, best); if (t <= 0 || t >= best) continue; face = hAx; }
          else if (ty === T_ELLIP) {
            if (!fol) continue; const cx = P_[p], cy = P_[p + 1], cz = P_[p + 2], rx = P_[p + 3], rz = P_[p + 4], kap = P_[p + 5];
            const ex = (ox - cx) / rx, ey = (oy - cy) / rx, ez = (oz - cz) / rz, fx = dx / rx, fy = dy / rx, fz = dz / rz, qa = fx * fx + fy * fy + fz * fz, qb = ex * fx + ey * fy + ez * fz, qc = ex * ex + ey * ey + ez * ez - 1, disc = qb * qb - qa * qc;
            if (disc <= 0) continue; const sq = Math.sqrt(disc); let ta = (-qb - sq) / qa; const tb = (-qb + sq) / qa; if (tb <= EPS) continue; if (ta < EPS) ta = EPS; const len = Math.min(tb, best) - ta; if (len <= 0) continue;
            const u = rnd(), pAbs = 1 - Math.exp(-kap * len); if (u >= pAbs) continue; t = ta - Math.log(1 - u) / kap; if (t >= best) continue; face = 7;
          } else if (ty === T_PRISM) { t = prismHit(p, ox, oy, oz, dx, dy, dz, best); if (t <= 0 || t >= best) continue; face = hAx; }
          if (t > 0 && t < best) { best = t; rKind = 1; rId = id; rFace = face; if (ty === T_PRISM) { rPx = hPx; rPy = hPy; } if (t < t1) t1 = t; }
        }
      }
      if (best <= tc1 || tc1 >= t1) break;
      if (tmx < tmy) { ix += sdx; if (ix < 0 || ix >= GNX) break; tc0 = tmx; tmx += tdx; } else { iy += sdy; if (iy < 0 || iy >= GNY) break; tc0 = tmy; tmy += tdy; }
    }
    rT = best; return rKind !== 0;
  }
  /* fence plane (2 cm board / mesh): hit when the point on the plane is covered by boards, rails, posts (picket), planks (privacy) or wire (chain-link, stochastic by position hash) */
  function fenceHit(p, ox, oy, oz, dx, dy, dz, best) {
    const ax = P[p], ay = P[p + 1], ux = P[p + 2], uy = P[p + 3], L = P[p + 4], z0 = P[p + 5], h = P[p + 6], st = P[p + 7], nPost = P[p + 8], acc = P[p + 9];
    const nx = -uy, ny = ux, den = dx * nx + dy * ny; if (Math.abs(den) < 1e-9) return -1; const t = ((ax - ox) * nx + (ay - oy) * ny) / den; if (t <= EPS || t >= best) return -1;
    const x = ox + dx * t - ax, y = oy + dy * t - ay, u = x * ux + y * uy, z = oz + dz * t; if (u < 0 || u > L || z < z0 || z > z0 + h) return -1;
    const zr = (z - z0) / h; let hit = false;
    if (st === 0) hit = true;
    else if (st === 1) { const pitch = 0.15, f = (((u + acc) % pitch) + pitch) % pitch; if (f >= 0.028 && f <= 0.122) hit = true; else if ((zr >= 0.234 && zr <= 0.3125) || (zr >= 0.703 && zr <= 0.781)) hit = true; else { const sp = L / nPost, q = u % sp; if (Math.min(q, sp - q) < 0.05) hit = true; } }
    else { const pc = Math.min(0.85, (0.004 + 0.0075 * t) / 0.177 * 2); hit = hash2(Math.floor(u * 40) + Math.floor(acc), Math.floor(z * 40)) < pc; }
    if (!hit) return -1; hAx = den < 0 ? 0 : 1; return t;
  }
  /* vertical prism (building footprint ring, extruded to height h) */
  function prismHit(p, ox, oy, oz, dx, dy, dz, best) {
    const off = P[p], n = P[p + 1], top = P[p + 2], base = P[p + 3], sg = P[p + 4]; let bt = -1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = RINGS[2 * (off + j)], ay = RINGS[2 * (off + j) + 1], bx = RINGS[2 * (off + i)], by = RINGS[2 * (off + i) + 1], ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey); if (L < 1e-9) continue;
      const nx = (ey / L) * sg, ny = (-ex / L) * sg, den = dx * nx + dy * ny; if (den >= -1e-9) continue;
      const t = ((ax - ox) * nx + (ay - oy) * ny) / den; if (t <= EPS || t >= best || (bt > 0 && t >= bt)) continue; const z = oz + dz * t; if (z < base || z > top) continue;
      const u = ((ox + dx * t - ax) * ex + (oy + dy * t - ay) * ey) / (L * L); if (u < 0 || u > 1) continue; bt = t; hAx = 0; hPx = nx; hPy = ny;
    }
    if (dz < 0 && oz > top) { const t = (top - oz) / dz; if (t > EPS && t < best && (bt < 0 || t < bt)) { const x = ox + dx * t, y = oy + dy * t; let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = RINGS[2 * (off + i)], ay = RINGS[2 * (off + i) + 1], bx = RINGS[2 * (off + j)], by = RINGS[2 * (off + j) + 1]; if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c; } if (c) { bt = t; hAx = 1; } } }
    return bt;
  }
  let hPx = 0, hPy = 0;

  /* ----------- finish: material, class, normal of the last hit ----------- */
  let fMat = 0, fCls = 0, fGlass = 0, fSoft = 0, fWalk = 0;
  function finishHit(ox, oy, oz, dx, dy, dz) {
    fGlass = 0; fSoft = 0; fWalk = 0;
    if (rKind === 2) {           // ground
      fWalk = 1; rNx = 0; rNy = 0; rNz = 1; const x = ox + dx * rT, y = oy + dy * rT, i = Math.floor((x - GWX0) / GRES), j = Math.floor((y - GWX0) / GRES), id = i < 0 || j < 0 || i >= GN || j >= GN ? -1 : j * GN + i;
      if (id < 0) { fCls = SEM.ground; fMat = RC.WM.grass; } else { fCls = CLSR[id]; fMat = MATR[id]; if (fCls === SEM.road && MARK[id] && groundMark(x, y, id)) fMat = RC.WM.road_paint; else if (fCls === SEM.water) fWalk = 0; }
      return;
    }
    if (rKind === 3) {           // dynamic body
      fCls = DBCLS[rId]; fMat = DBMAT[rId]; const o = rId * 16; const x = ox + dx * rT, y = oy + dy * rT, z = oz + dz * rT;
      if (DBT[rId] === 1) { const zc = Math.max(DB[o + 2], Math.min(DB[o + 3], z)); let nx = x - DB[o], ny = y - DB[o + 1], nz = z - zc; const l = Math.hypot(nx, ny, nz) || 1; rNx = nx / l; rNy = ny / l; rNz = nz / l; }
      else { const ax = rFace >> 1, sg = rFace & 1 ? -1 : 1, c = DB[o + 6], s = DB[o + 7]; if (ax === 0) { rNx = c * sg; rNy = s * sg; rNz = 0; } else if (ax === 1) { rNx = -s * sg; rNy = c * sg; rNz = 0; } else { rNx = 0; rNy = 0; rNz = sg; } }
      return;
    }
    const id = rId, ty = PT[id];
    if (ty <= T_ROLL) {
      const p = id * PS, ax = rFace >> 1, sg = rFace & 1 ? -1 : 1, c = P[p + 6], s = P[p + 7];
      if (ty === T_ROLL) { const cr = P[p + 8], sr = P[p + 9]; if (ax === 0) { rNx = c * sg; rNy = s * sg; rNz = 0; } else if (ax === 1) { rNx = -s * cr * sg; rNy = c * cr * sg; rNz = sr * sg; } else { rNx = s * sr * sg; rNy = -c * sr * sg; rNz = cr * sg; } }
      else if (ax === 0) { rNx = c * sg; rNy = s * sg; rNz = 0; } else if (ax === 1) { rNx = -s * sg; rNy = c * sg; rNz = 0; } else { rNx = 0; rNy = 0; rNz = sg; }
      const bx = BOX[id]; if (bx >= 0) { fMat = FM[bx * 6 + rFace] || BCORE[bx]; fCls = BCLS[bx]; fGlass = BFL[bx] & FL.GLASS ? 1 : 0; fWalk = BFL[bx] & FL.WALK ? 1 : 0; } else { fMat = PM[id]; fCls = PC[id]; }
      return;
    }
    fCls = PC[id]; fMat = PM[id];
    if (ty === T_TRI) { const p = id * PS; let nx = P[p + 9], ny = P[p + 10], nz = P[p + 11]; if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; } rNx = nx; rNy = ny; rNz = nz; fMat = PM[id]; }
    else if (ty === T_CYL) { const p = id * PS; if (rFace === 0) { const x = ox + dx * rT - P[p], y = oy + dy * rT - P[p + 1], l = Math.hypot(x, y) || 1; rNx = x / l; rNy = y / l; rNz = 0; } else { rNx = 0; rNy = 0; rNz = rFace === 1 ? 1 : -1; } }
    else if (ty === T_FENCE) { const p = id * PS, nx = -P[p + 3], ny = P[p + 2]; const s = nx * dx + ny * dy > 0 ? -1 : 1; rNx = nx * s; rNy = ny * s; rNz = 0; }
    else if (ty === T_ELLIP) { rNx = -dx; rNy = -dy; rNz = -dz; fSoft = 1; }
    else if (ty === T_PRISM) { if (rFace === 1) { rNx = 0; rNy = 0; rNz = 1; } else { rNx = rPx; rNy = rPy; rNz = 0; } }
  }
  let rPx = 0, rPy = 0;

  /* ============================== public: cast / castBatch ============================== */
  function ensure() { const V = ES.view3d && ES.view3d.walk && ES.view3d.walk.V; if (V && V.scene && V.scene !== builtFor && V.A && V.A.W) build(V); if (doorDirty) syncDoors(false); }
  function setOpt(opt) {
    gMask = LAYER.ALL; gGlass = true; gIgnore = -1; gSkip = -1;
    if (!opt) return;
    if (opt.mask != null) gMask = opt.mask; if (opt.foliage) gMask |= LAYER.FOLIAGE; if (opt.detail) gMask |= LAYER.DETAIL; if (opt.treat) gMask |= LAYER.TREAT; if (opt.glass === false) gGlass = false; if (opt.skip != null) gSkip = opt.skip;
    if (opt.ignore != null) { gIgnore = -1; for (let i = 0; i < DBn; i++) if (DBUID[i] === opt.ignore) { gIgnore = i; break; } }
  }
  /* cast(ox,oy,oz, dx,dy,dz, maxT, opt) -> {t, cls, mat, glass, nx,ny,nz, id, kind, x,y,z, soft} | null.  d must be a unit vector.
     opt: {mask: LAYER bits (default BIM|WORLD|GROUND|BODIES), foliage: true (stochastic canopy hits), glass: false (ignore glass boxes), treat: true (curtains / blinds), ignore: body uid, skip: prim id} */
  RC.cast = function (ox, oy, oz, dx, dy, dz, maxT, opt) {
    ensure(); setOpt(opt); if (!traceRay(ox, oy, oz, dx, dy, dz, maxT || 1e4)) return null; finishHit(ox, oy, oz, dx, dy, dz);
    return { t: rT, cls: fCls, mat: fMat, glass: !!fGlass, nx: rNx, ny: rNy, nz: rNz, id: rKind === 2 ? -1 : rKind === 3 ? -2 - rId : rId, kind: rKind === 2 ? "ground" : rKind === 3 ? "body" : "static", x: ox + dx * rT, y: oy + dy * rT, z: oz + dz * rT, soft: !!fSoft };
  };
  /* castBatch(origin3, dirs (Float32Array, 3 per ray, unit), n, maxT, out, opt) -> hit count. out = { t: Float32Array(n) (-1 = miss), cls: Uint8Array, mat: Uint8Array|Uint16Array, nx, ny, nz: Float32Array, id: Int32Array, glass: Uint8Array } (all optional) */
  RC.castBatch = function (origin3, dirs, n, maxT, out, opt) {
    ensure(); setOpt(opt); const ox = origin3[0], oy = origin3[1], oz = origin3[2], mt = maxT || 1e4; let cnt = 0;
    const T = out && out.t, C = out && out.cls, M = out && out.mat, NX = out && out.nx, NY = out && out.ny, NZ = out && out.nz, I = out && out.id, G = out && out.glass, S = out && out.soft;
    for (let i = 0; i < n; i++) {
      const dx = dirs[3 * i], dy = dirs[3 * i + 1], dz = dirs[3 * i + 2];
      if (traceRay(ox, oy, oz, dx, dy, dz, mt)) {
        finishHit(ox, oy, oz, dx, dy, dz); cnt++;
        if (T) T[i] = rT; if (C) C[i] = fCls; if (M) M[i] = fMat; if (NX) { NX[i] = rNx; NY[i] = rNy; NZ[i] = rNz; } if (I) I[i] = rKind === 2 ? -1 : rKind === 3 ? -2 - rId : rId; if (G) G[i] = fGlass; if (S) S[i] = fSoft;
      } else { if (T) T[i] = -1; if (C) C[i] = 0; if (M) M[i] = 0; if (I) I[i] = -9; if (G) G[i] = 0; if (S) S[i] = 0; }
    }
    return cnt;
  };
  /* like castBatch with one origin per ray (origins: Float32Array 3 per ray) */
  RC.castMulti = function (origins, dirs, n, maxT, out, opt) {
    ensure(); setOpt(opt); const mt = maxT || 1e4; let cnt = 0; const T = out && out.t, C = out && out.cls, M = out && out.mat, NX = out && out.nx, NY = out && out.ny, NZ = out && out.nz, I = out && out.id, G = out && out.glass;
    for (let i = 0; i < n; i++) {
      const ox = origins[3 * i], oy = origins[3 * i + 1], oz = origins[3 * i + 2], dx = dirs[3 * i], dy = dirs[3 * i + 1], dz = dirs[3 * i + 2];
      if (traceRay(ox, oy, oz, dx, dy, dz, mt)) { finishHit(ox, oy, oz, dx, dy, dz); cnt++; if (T) T[i] = rT; if (C) C[i] = fCls; if (M) M[i] = fMat; if (NX) { NX[i] = rNx; NY[i] = rNy; NZ[i] = rNz; } if (I) I[i] = rKind === 2 ? -1 : rKind === 3 ? -2 - rId : rId; if (G) G[i] = fGlass; }
      else { if (T) T[i] = -1; if (C) C[i] = 0; if (M) M[i] = 0; if (I) I[i] = -9; if (G) G[i] = 0; }
    }
    return cnt;
  };
  /* LiDAR-internal fast path: one ray, raw module state (no allocation). Returns hit flag; fields via RC._r */
  RC._ray = function (ox, oy, oz, dx, dy, dz, maxT) { if (!traceRay(ox, oy, oz, dx, dy, dz, maxT)) return false; finishHit(ox, oy, oz, dx, dy, dz); return true; };
  RC._r = () => ({ t: rT, cls: fCls, mat: fMat, glass: fGlass, nx: rNx, ny: rNy, nz: rNz, id: rKind === 2 ? -1 : rKind === 3 ? -2 - rId : rId, kind: rKind, soft: fSoft });
  RC._rv = { get t() { return rT; }, get cls() { return fCls; }, get mat() { return fMat; }, get glass() { return fGlass; }, get nx() { return rNx; }, get ny() { return rNy; }, get nz() { return rNz; }, get kind() { return rKind; }, get soft() { return fSoft; }, get walk() { return fWalk; }, get id() { return rKind === 2 ? -1 : rKind === 3 ? -2 - rId : rId; } };
  RC._setOpt = setOpt; RC._ensure = ensure;

  /* ============================== segment crossings + occlusion physics ============================== */
  /* RF dielectrics (rf/materials.py DIELECTRICS: eps' = a f^b, sigma = c f^d, f in GHz) */
  const DIEL = { air: [1, 0, 0, 0], concrete: [5.31, 0, 0.0326, 0.8095], brick: [3.75, 0, 0.038, 0], plasterboard: [2.94, 0, 0.0116, 0.7076], wood: [1.99, 0, 0.0047, 1.0718], glass: [6.27, 0, 0.0043, 1.1925], ceiling_board: [1.5, 0, 0.0005, 1.1634], metal: [1, 0, 1e7, 0] };
  const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const csqrt = (a) => { const r = Math.hypot(a[0], a[1]), re = Math.sqrt(Math.max(0, (r + a[0]) / 2)); let im = Math.sqrt(Math.max(0, (r - a[0]) / 2)); if (a[1] < 0) im = -im; return [re, im]; };
  const ccos = (a) => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])], csin = (a) => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])];
  /* power transmission |t|^2 of a layered slab in air; layers [[material, thickness_m], ...]; transfer-matrix method of rf.materials.slab_transmission */
  function slabTransmission(layers, fHz, cosInc, pol) {
    const k0 = 2 * Math.PI * fHz / C0, ci = Math.min(1, Math.max(0.02, cosInc)), s2 = 1 - ci * ci, fG = fHz / 1e9, eta0 = pol === "TM" ? 1 / ci : ci;
    let M11 = [1, 0], M12 = [0, 0], M21 = [0, 0], M22 = [1, 0];
    for (const [mat, th] of layers) {
      const d = DIEL[mat] || DIEL.air, eps = [d[0] * Math.pow(fG, d[1]), 17.98 * (d[2] * Math.pow(fG, d[3])) / fG];       // conj of eps_complex (exp(-iwt) convention)
      const kz = csqrt([eps[0] - s2, eps[1]]), eta = pol === "TM" ? cdiv(eps, kz) : kz, delta = [k0 * th * kz[0], k0 * th * kz[1]], cd = ccos(delta), sd = csin(delta);
      const a11 = cd, a12 = cmul([0, -1], cdiv(sd, eta)), a21 = cmul([0, -1], cmul(eta, sd)), a22 = cd;
      const n11 = [cmul(M11, a11)[0] + cmul(M12, a21)[0], cmul(M11, a11)[1] + cmul(M12, a21)[1]], n12 = [cmul(M11, a12)[0] + cmul(M12, a22)[0], cmul(M11, a12)[1] + cmul(M12, a22)[1]];
      const n21 = [cmul(M21, a11)[0] + cmul(M22, a21)[0], cmul(M21, a11)[1] + cmul(M22, a21)[1]], n22 = [cmul(M21, a12)[0] + cmul(M22, a22)[0], cmul(M21, a12)[1] + cmul(M22, a22)[1]];
      M11 = n11; M12 = n12; M21 = n21; M22 = n22;
    }
    const den = [eta0 * M11[0] + eta0 * eta0 * M12[0] + M21[0] + eta0 * M22[0], eta0 * M11[1] + eta0 * eta0 * M12[1] + M21[1] + eta0 * M22[1]], t = cdiv([2 * eta0, 0], den), T = t[0] * t[0] + t[1] * t[1];
    return Number.isFinite(T) ? T : 0;
  }
  RC.slabTransmission = slabTransmission;
  const RHO_EFF = { gypsum: 250, gypsum_accent: 250, brick: 1500, brick_brown: 1500, stucco: 1100, stucco_white: 1100, stucco_peach: 1100, siding: 450, siding_blue: 450, siding_sage: 450, ceiling: 150, door_wood: 450, door_metal: 1200, glass: 2500, frame_white: 600 };
  const GLASS_NAMES = new Set(["glass", "curtain_glass", "glass_frosted"]);
  /* thin roof / gable polygons have no thickness: a typical assembly per surface material (shingle on sheathing, tile, standing-seam metal, membrane on deck); used only when the caller asks for polygons (GNSS through roofs) */
  const ROOF_ASSEMBLY = { roof_shingle: [["wood", 0.04]], asphalt_shingle_dark: [["wood", 0.04]], roof_tile: [["concrete", 0.03]], roof_metal: [["metal", 0.001]], roof_membrane: [["concrete", 0.06]], default: (m) => (m && m.rf ? [[m.rf, 0.1]] : null) };
  const GLASS_STACK = [["glass", 0.006], ["air", 0.012], ["glass", 0.006]];

  /* all PHYS boxes crossed by the segment a->b (+ optional VIS 'treat' boxes with opt.treat): [{id, box, bid, tag, elem, mat, matName, core, glass, thick, len, t0, t1, cos, storey, room}] ordered along the path */
  RC.segment = function (a, b, opt) {
    ensure(); const out = [], ox = a[0], oy = a[1], oz = a[2], vx = b[0] - ox, vy = b[1] - oy, vz = b[2] - oz, L = Math.hypot(vx, vy, vz); if (L < 1e-9 || !NP) return out;
    const dx = vx / L, dy = vy / L, dz = vz / L, skipG = opt && opt.glass === false, mask = (opt && opt.mask != null ? opt.mask : LAYER.BIM) | (opt && opt.treat ? LAYER.TREAT : 0) | (opt && opt.detail ? LAYER.DETAIL : 0);
    const polys = !!(opt && opt.polys);
    collectCells(ox, oy, oz, dx, dy, dz, L, (id) => {
      const pf = PF[id]; if (!(PL[id] & mask)) return; if ((pf & PF_GLASS) && skipG) return; const ty = PT[id];
      if (ty === T_TRI) {                       // roof / gable polygons (thin shells): only when asked for (RF through roofs: GNSS); not part of the Python crossings
        if (!polys) return; const p = id * PS, e1x = P[p + 3], e1y = P[p + 4], e1z = P[p + 5], e2x = P[p + 6], e2y = P[p + 7], e2z = P[p + 8], px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) return; const inv = 1 / det, tx = ox - P[p], ty_ = oy - P[p + 1], tz = oz - P[p + 2], u = (tx * px + ty_ * py + tz * pz) * inv; if (u < 0 || u > 1) return;
        const qx = ty_ * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty_ * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) return; const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t <= 0 || t >= L) return;
        const mi = MATS[PM[id]] || {}; out.push({ id, box: -1, roof: true, bi: INFO[id].bld, bid: BLD[INFO[id].bld] ? BLD[INFO[id].bld].id : "", tag: "roof", elem: 0, elemName: "roof", mat: PM[id], matName: mi.name, core: PM[id], glass: false, treat: false, thick: 0, len: 0, t0: t / L, t1: t / L, cos: Math.max(Math.abs(P[p + 9] * dx + P[p + 10] * dy + P[p + 11] * dz), 0.05), storey: 0, room: -1 }); return;
      }
      if (ty > T_ROLL) return;
      const p = id * PS, hx = P[p + 3], hy = P[p + 4], hz = P[p + 5], c = P[p + 6], s = P[p + 7], rx = ox - P[p], ry = oy - P[p + 1], rz = oz - P[p + 2]; let lx, ly, lz, ldx, ldy, ldz;
      if (ty === T_ROLL) { const cr = P[p + 8], sr = P[p + 9]; lx = c * rx + s * ry; ly = -s * cr * rx + c * cr * ry + sr * rz; lz = s * sr * rx - c * sr * ry + cr * rz; ldx = c * vx + s * vy; ldy = -s * cr * vx + c * cr * vy + sr * vz; ldz = s * sr * vx - c * sr * vy + cr * vz; }
      else { lx = c * rx + s * ry; ly = -s * rx + c * ry; lz = rz; ldx = c * vx + s * vy; ldy = -s * vx + c * vy; ldz = vz; }
      // parametric interval on [0, 1] (vx.. are the full vector): entry / exit per axis
      let tmin = -1e30, tmax = 1e30; const hh = [hx, hy, hz], ll = [lx, ly, lz], dd = [ldx, ldy, ldz];
      for (let k = 0; k < 3; k++) { if (Math.abs(dd[k]) < 1e-12) { if (Math.abs(ll[k]) > hh[k]) return; continue; } const q1 = (-hh[k] - ll[k]) / dd[k], q2 = (hh[k] - ll[k]) / dd[k]; const lo = q1 < q2 ? q1 : q2, hi = q1 < q2 ? q2 : q1; if (lo > tmin) tmin = lo; if (hi < tmax) tmax = hi; }
      const a0 = Math.max(tmin, 0), b0 = Math.min(tmax, 1); if (!(b0 > a0 + 1e-9)) return;
      const bx = BOX[id]; let thin = 0, mn = hx; if (hy < mn) { thin = 1; mn = hy; } if (hz < mn) thin = 2;       // argmin of the half sizes (first on ties, as numpy): the box's thin axis
      let axx, axy, axz; if (ty === T_ROLL) { const cr = P[p + 8], sr = P[p + 9]; if (thin === 0) { axx = c; axy = s; axz = 0; } else if (thin === 1) { axx = -s * cr; axy = c * cr; axz = sr; } else { axx = s * sr; axy = -c * sr; axz = cr; } }
      else if (thin === 0) { axx = c; axy = s; axz = 0; } else if (thin === 1) { axx = -s; axy = c; axz = 0; } else { axx = 0; axy = 0; axz = 1; }
      const cosA = Math.max(Math.abs(axx * dx + axy * dy + axz * dz), 0.05);
      if (bx < 0) return; const mats = FM.subarray(bx * 6, bx * 6 + 6);
      out.push({ id, box: bx, bid: BLD[BBLD[bx]].id, bi: BBLD[bx], tag: TAGS[BTAG[bx]], elem: BELEM[bx], elemName: EL_NAME[BELEM[bx]] || "", mat: mats[2] || BCORE[bx], matName: (MATS[mats[2] || BCORE[bx]] || {}).name, core: BCORE[bx], glass: !!(BFL[bx] & FL.GLASS), treat: !!(pf & PF_TREAT),
        thick: 2 * Math.min(hx, hy, hz), len: (b0 - a0) * L, t0: a0, t1: b0, cos: cosA, storey: BSTO[bx], room: BROOM[bx] });
    });
    out.sort((p, q) => p.t0 - q.t0); return out;
  };
  /* candidate prims whose cell column the segment passes (z-range filtered, each prim once) */
  function collectCells(ox, oy, oz, dx, dy, dz, L, fn) {
    if (Math.abs(dx) < 1e-12) dx = dx < 0 ? -1e-12 : 1e-12; if (Math.abs(dy) < 1e-12) dy = dy < 0 ? -1e-12 : 1e-12; if (Math.abs(dz) < 1e-12) dz = dz < 0 ? -1e-12 : 1e-12;
    let t0 = 0, t1 = L, a, b; const gx1 = GX0 + GNX * GCELL, gy1 = GY0 + GNY * GCELL;
    a = (GX0 - ox) / dx; b = (gx1 - ox) / dx; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b;
    a = (GY0 - oy) / dy; b = (gy1 - oy) / dy; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b;
    a = (GZ0 - oz) / dz; b = (GZ1 - oz) / dz; if (a > b) { const q = a; a = b; b = q; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return;
    const sdx = dx > 0 ? 1 : -1, sdy = dy > 0 ? 1 : -1, tdx = GCELL / Math.abs(dx), tdy = GCELL / Math.abs(dy);
    let ix = Math.floor((ox + dx * t0 - GX0) * GINV), iy = Math.floor((oy + dy * t0 - GY0) * GINV); ix = Math.max(0, Math.min(GNX - 1, ix)); iy = Math.max(0, Math.min(GNY - 1, iy));
    let tmx = ((dx > 0 ? (ix + 1) * GCELL : ix * GCELL) + GX0 - ox) / dx, tmy = ((dy > 0 ? (iy + 1) * GCELL : iy * GCELL) + GY0 - oy) / dy, tc0 = t0; if (++sid >= 2147483640) { stamp.fill(0); sid = 1; }
    for (;;) {
      const tc1 = Math.min(tmx, tmy, t1), cell = iy * GNX + ix; let za = oz + dz * tc0, zb = oz + dz * tc1; if (za > zb) { const q = za; za = zb; zb = q; } za -= 1e-4; zb += 1e-4;
      for (let k = CS[cell]; k < CS[cell + 1]; k++) { if (CZ1[k] < za || CZ0[k] > zb) continue; const id = CI[k]; if (stamp[id] === sid) continue; stamp[id] = sid; fn(id); }
      if (tc1 >= t1) break; if (tmx < tmy) { ix += sdx; if (ix < 0 || ix >= GNX) break; tc0 = tmx; tmx += tdx; } else { iy += sdy; if (iy < 0 || iy >= GNY) break; tc0 = tmy; tmy += tdy; }
    }
  }
  /* RF penetration loss [dB] of the crossings at frequency f (rf/materials slab model per box: glass = 6/12/6 double glazing, stud partitions = board / air / board, timber floors = wood + air + board) */
  function rfLoss(cr, fHz, pol, maxEach) {
    let tot = 0; maxEach = maxEach || 45; pol = pol || "TE";
    for (const c of cr) {
      if (c.treat) continue;
      if (c.roof) { const layers = ROOF_ASSEMBLY[c.matName] || ROOF_ASSEMBLY.default(MATS[c.mat]); if (!layers) continue; const T = slabTransmission(layers, fHz, c.cos, pol); tot += Math.min(maxEach, -10 * Math.log10(Math.max(T, 1e-9))); continue; }
      const bx = c.box; const e = BELEM[bx], kind = BLD[BBLD[bx]].kind, E_SLAB = RC.E.slab, E_CEIL = RC.E.ceiling;
      let m = c.core; if (e === E_SLAB || e === E_CEIL) m = MATIDX[kind === "house" || kind === "rowhouse" ? "wood_floor" : "concrete"]; const mi = MATS[m], nm = mi && mi.rf; if (!nm) continue; const t = c.thick; let layers;
      if (BFL[bx] & FL.GLASS || GLASS_NAMES.has(mi.name)) layers = GLASS_STACK;
      else if (e === E_SLAB && (kind === "house" || kind === "rowhouse")) layers = [["wood", 0.04], ["air", t - 0.06], ["plasterboard", 0.013]];
      else if (mi.name === "gypsum" || mi.name === "gypsum_accent") layers = [["plasterboard", 0.0125], ["air", Math.max(t - 0.025, 0)], ["plasterboard", 0.0125]];
      else layers = [[nm, t]];
      const T = slabTransmission(layers, fHz, c.cos, pol); tot += Math.min(maxEach, -10 * Math.log10(Math.max(T, 1e-9)));
    }
    return tot;
  }
  /* field-incidence mass-law transmission loss [dB] summed over the crossed walls (glass: coincidence dip) */
  function soundTl(cr, fHz) {
    let tot = 0;
    for (const c of cr) {
      if (c.treat) continue; const bx = c.box, e = BELEM[bx], kind = BLD[BBLD[bx]].kind; let m = c.core; if (e === RC.E.slab || e === RC.E.ceiling) m = MATIDX[kind === "house" || kind === "rowhouse" ? "wood_floor" : "concrete"];
      const mi = MATS[m], name = mi.name; let tl;
      if (BFL[bx] & FL.GLASS || GLASS_NAMES.has(name)) { const mass = 2 * 0.006 * 2500; tl = 20 * Math.log10(mass * fHz) - 47 - 8 * Math.exp(-0.5 * Math.pow(Math.log2(fHz / 2000) / 0.5, 2)); }
      else { const rho = RHO_EFF[name] != null ? RHO_EFF[name] : mi.rho || 600; tl = 20 * Math.log10(rho * c.thick * fHz) - 47; }
      tot += Math.min(60, Math.max(0, tl));
    }
    return tot;
  }
  /* light: product of the visible transmissions of everything on the path (glass 0.85, curtain 0.25, blinds 0.12, opaque 0) */
  function lightT(cr) { let T = 1; for (const c of cr) { const m = MATS[c.mat]; const tr = m && m.trans > 0 ? m.trans : 0; T *= tr; if (T === 0) break; } return T; }
  /* occlusion(a, b, f_hz?, opt) -> {optical (true = an opaque box is in the way), walls (non-glass, non-furniture boxes), solids (all opaque boxes), glass (glass boxes), rfLossDb(f, pol), soundTlDb(f), lightT, crossings}.
     When f_hz is given the numbers rf / sound at that frequency are also filled in. */
  RC.occlusion = function (a, b, f_hz, opt) {
    const cr = RC.segment(a, b, opt), o = { crossings: cr, optical: false, walls: 0, solids: 0, glass: 0, lightT: 1 };
    for (const c of cr) { if (c.glass) o.glass++; else if (!c.treat) { o.optical = true; o.solids++; if (!FURN_ELEM.has(c.elemName)) o.walls++; } }
    o.rfLossDb = (f, pol) => rfLoss(cr, f, pol); o.soundTlDb = (f) => soundTl(cr, f); o.lightT = lightT(cr);
    if (f_hz) { o.rf = rfLoss(cr, f_hz); o.sound = soundTl(cr, f_hz); }
    return o;
  };
  RC.rfLossFromCrossings = (cr, f, pol, maxEach) => rfLoss(cr, f, pol, maxEach); RC.soundTlFromCrossings = (cr, f) => soundTl(cr, f);
  RC.rfLossDb = (a, b, f, pol, opt) => rfLoss(RC.segment(a, b, opt), f, pol); RC.soundTlDb = (a, b, f, opt) => soundTl(RC.segment(a, b, opt), f);
  /* visible-light transmission of the path (BIM boxes; curtains / blinds included unless opt.treat === false) */
  RC.lightT = (a, b, opt) => lightT(RC.segment(a, b, Object.assign({ treat: true }, opt)));
  RC.opticalBlocked = (a, b, opt) => { for (const c of RC.segment(a, b, opt)) if (!c.glass && !c.treat) return true; return false; };
  /* first-hit visibility test of the whole scene (BIM + world + bodies): true when something is between a and b */
  RC.blocked = (a, b, opt) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 1e-6) return false; const h = RC.cast(a[0], a[1], a[2], dx / L, dy / L, dz / L, L - 0.02, Object.assign({ glass: false }, opt)); return !!h; };
  /* canopy along a segment: {len (m inside tree crowns), tau (optical depth sum k * len)} */
  RC.canopy = function (a, b) {
    ensure(); const ox = a[0], oy = a[1], oz = a[2], vx = b[0] - ox, vy = b[1] - oy, vz = b[2] - oz, L = Math.hypot(vx, vy, vz); let len = 0, tau = 0; if (L < 1e-9 || !NP) return { len, tau }; const dx = vx / L, dy = vy / L, dz = vz / L;
    collectCells(ox, oy, oz, dx, dy, dz, L, (id) => {
      if (PT[id] !== T_ELLIP) return; const p = id * PS, cx = P[p], cy = P[p + 1], cz = P[p + 2], rx = P[p + 3], rz = P[p + 4], kap = P[p + 5];
      const ex = (ox - cx) / rx, ey = (oy - cy) / rx, ez = (oz - cz) / rz, fx = dx / rx, fy = dy / rx, fz = dz / rz, qa = fx * fx + fy * fy + fz * fz, qb = ex * fx + ey * fy + ez * fz, qc = ex * ex + ey * ey + ez * ez - 1, disc = qb * qb - qa * qc; if (disc <= 0) return;
      const sq = Math.sqrt(disc), ta = Math.max(0, (-qb - sq) / qa), tb = Math.min(L, (-qb + sq) / qa); if (tb > ta) { len += tb - ta; tau += kap * (tb - ta); }
    });
    return { len, tau };
  };
  /* is (x, y, z) inside any PHYS box? (origin sanity checks) */
  RC.insideSolid = function (x, y, z) {
    ensure(); const ix = Math.floor((x - GX0) * GINV), iy = Math.floor((y - GY0) * GINV); if (ix < 0 || iy < 0 || ix >= GNX || iy >= GNY) return -1; const cell = iy * GNX + ix;
    for (let k = CS[cell]; k < CS[cell + 1]; k++) { const id = CI[k]; if (PT[id] > T_ROLL || !(PL[id] & LAYER.BIM) || (PF[id] & PF_TREAT)) continue; const p = id * PS, rx = x - P[p], ry = y - P[p + 1], rz = z - P[p + 2], c = P[p + 6], s = P[p + 7]; let lx, ly, lz;
      if (PT[id] === T_ROLL) { const cr = P[p + 8], sr = P[p + 9]; lx = c * rx + s * ry; ly = -s * cr * rx + c * cr * ry + sr * rz; lz = s * sr * rx - c * sr * ry + cr * rz; } else { lx = c * rx + s * ry; ly = -s * rx + c * ry; lz = rz; }
      if (Math.abs(lx) < P[p + 3] && Math.abs(ly) < P[p + 4] && Math.abs(lz) < P[p + 5]) return id; }
    return -1;
  };

  /* ============================== queries / info ============================== */
  RC.groundZ = (x, y) => gzAt(x, y);
  RC.groundClass = (x, y) => { ensure(); const i = Math.floor((x - GWX0) / GRES), j = Math.floor((y - GWX0) / GRES); return i < 0 || j < 0 || i >= GN || j >= GN ? SEM.ground : CLSR[j * GN + i]; };
  /* building (BIM) containing the footprint point and below its roof: {id, kind, ...} | null */
  RC.buildingAt = (x, y, z) => { ensure(); for (const b of BLD) { if (x < b.lo[0] || x > b.hi[0] || y < b.lo[1] || y > b.hi[1]) continue; if (ES.pip(b.poly, x, y) && (z == null || z < b.zTop + b.roofRise)) return b; } return null; };
  RC.describe = (id) => {
    if (id === -1) return { kind: "ground" }; if (id <= -2) return { kind: "body", uid: DBUID[-2 - id], bodyKind: DBKIND[-2 - id] }; if (id < 0 || id >= NP) return null;
    const bx = BOX[id]; if (bx >= 0) return { kind: "bim", box: bx, bid: BLD[BBLD[bx]].id, tag: TAGS[BTAG[bx]], elem: EL_NAME[BELEM[bx]], storey: BSTO[bx], room: BROOM[bx], glass: !!(BFL[bx] & FL.GLASS), mats: Array.from(FM.subarray(bx * 6, bx * 6 + 6)).map((m) => (MATS[m] || {}).name) };
    return Object.assign({ kind: "world", type: ["aabb", "yaw", "roll", "cyl", "tri", "fence", "ellipsoid", "prism"][PT[id]] }, INFO[id] || {});
  };
  RC.matName = (i) => (MATS[i] ? MATS[i].name : "?"); RC.matInfo = (i) => MATS[i] || null;
  /* body orientation: R = Rz(yaw) Ry(-pitch) Rx(roll), pitch + = nose up, roll + = right side down (FLU body frame: x forward, y left, z up); returns the row-major 3x3 [r00 r01 r02 r10 ...] (body -> world) */
  RC.buildings = () => BLD;
  RC.rotFromPose = (yaw, pitch, roll) => { const cy = Math.cos(yaw), sy = Math.sin(yaw), cb = Math.cos(-pitch), sb = Math.sin(-pitch), cf = Math.cos(roll), sf = Math.sin(roll);
    return [cy * cb, cy * sb * sf - sy * cf, cy * sb * cf + sy * sf, sy * cb, sy * sb * sf + cy * cf, sy * sb * cf - cy * sf, -sb, cb * sf, cb * cf]; };
  RC.LAYER = LAYER; RC.sync = () => { ensure(); syncDoors(false); }; RC.build = build; RC.refreshBodies = collectBodies; RC.setBodies = setBodies;
  Object.defineProperty(RC, "E", { get: () => ({ slab: ELEM.slab || 3, ceiling: ELEM.ceiling || 4 }) });
  RC.state = () => ({ prims: NP, boxes: NB, built: !!builtFor, bodies: DBn });
  ES.bus.on("scene:built", (V) => { build(V); collectBodies(); });
  ES.bus.on("walk:frame", () => { if (doorDirty) syncDoors(false); collectBodies(); });
})();
