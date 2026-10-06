/* inspector.js: the OBJECT INSPECTOR of the first-person view (key I). Point the crosshair at a wall, door, fridge, car, tree, dog ...: the thing is outlined and a card lists what it is, what it is made of and what it does,
   with the numbers the sensor models use (mass, density, sound transmission loss, RF loss, visible-light transmission, LiDAR reflectivity, friction) and whether a person / quadruped / rover / UAV can pass it.
   Picks are ES.ray casts (the geometry the physics uses, door leaves at their current angle) plus a deterministic crown test for trees; the BIM item catalogue (data/catalog.json, docs/bim-catalog.md) gives names, functions and
   passability. Every physics number is computed by ES.ray (soundTlFromCrossings / rfLossFromCrossings: the same code as the sensors) or read from the data; the tooltip of each row names the formula. Docs: web/docs/inspector.md.
   Right-click on any object pins the card to it (right-click again or press I to release). Nothing here runs while the mode is off except the key handler. */
(function () {
  "use strict";
  const ES = (window.ES = window.ES || {}), INS = (ES.inspector = ES.inspector || {});
  const $ = (s, r = document) => r.querySelector(s);
  const E = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const f1 = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : "—");
  const big = (v) => (!Number.isFinite(v) ? "—" : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const R2D = 180 / Math.PI, FL = { PHYS: 1, VIS: 2, NAV: 4, GLASS: 8, MOVABLE: 16, WALK: 32, DETAIL: 64, LOOSE: 128 };
  const WK = () => ES.view3d && ES.view3d.walk && ES.view3d.walk.state, VV = () => ES.view3d && ES.view3d.walk && ES.view3d.walk.V;
  const compass = (yaw) => { const hd = Math.round((((90 - yaw * R2D) % 360) + 360) % 360) % 360; return [hd, ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(hd / 45) % 8]]; };

  /* ================================================================ Chinese names ================================================================ */
  const ELEM_ZH = { wall_ext: "Exterior wall", wall_int: "Interior wall", slab: "Floor slab", ceiling: "Ceiling", roof: "Roof", glass: "Glass", frame: "Frame", door: "Door leaf", stair: "Stair", furniture: "Furniture", column: "Column", step: "Step", trim: "Trim", appliance: "Appliance", rack: "Rack", machine: "Machine", light: "Luminaire", treat: "Curtain / blinds", rail: "Railing", parapet: "Parapet", chimney: "Chimney", ramp: "Ramp", fixture: "Sanitary ware / fixed fitting", pallet: "Pallet", plant: "Plant", deco: "Decoration" };
  const CAT_ZH = { structure: "Building structure", opening: "Doors and windows", furniture: "Furniture", appliance: "Appliance", fixture: "Fixed fitting", light: "Luminaire", equipment: "Equipment", circulation: "Circulation element", decor: "Furnishing", trim: "Trim", signage: "Signage" };
  const BKIND_ZH = { house: "House", commercial: "Shop", apartment: "Apartment block", campus: "Campus building", warehouse: "Warehouse", factory: "Factory", rowhouse: "Row house", office: "Office building", civic: "Public building", cottage: "Cottage" };
  const ROOM_ZH = { bedroom: "bedroom", bath: "bathroom", living: "living room", kitchen: "kitchen", landing: "stair landing", office: "office", void: "stairwell", classroom: "classroom", core: "stair / lift core", restroom: "public restroom", corridor: "corridor", stair: "stairwell room", lab: "laboratory", meeting: "meeting room", entry: "entrance hall", utility: "utility room", shop: "shop floor", storage: "storeroom", hall: "hall", lobby: "lobby", dining: "dining room", study: "study", hall_big: "large hall", family: "family room", workshop: "workshop", control: "control room" };
  const MAT_ZH = { none: "none", brick: "brick", brick_brown: "brown brick", concrete: "concrete", concrete_light: "light concrete", concrete_dark: "dark concrete", polished_concrete: "polished concrete", stucco: "stucco", stucco_white: "white stucco", stucco_peach: "peach stucco", siding: "siding board", siding_blue: "blue siding", siding_sage: "sage siding", metal_panel: "metal wall panel",
    curtain_glass: "curtain-wall glass", glass: "glass", glass_frosted: "frosted glass", frame_white: "white frame", frame_dark: "dark frame", gypsum: "plasterboard", gypsum_accent: "coloured plasterboard", wood_floor: "wood floor", carpet: "carpet", tile: "tile", ceiling: "ceiling board", door_wood: "wooden door leaf", door_metal: "steel door leaf",
    roof_shingle: "asphalt shingle", roof_tile: "roof tile", roof_metal: "metal roof", roof_membrane: "roof membrane", asphalt_shingle_dark: "dark asphalt shingle", wood_furn: "furniture wood", metal_furn: "furniture steel", appliance: "appliance panel", steel: "steel", rack_blue: "blue rack paint", rack_orange: "orange rack paint", cardboard: "cardboard", pallet: "pallet wood",
    machine_green: "green machine paint", machine_yellow: "yellow machine paint", whiteboard: "whiteboard", screen: "screen (off)", screen_on: "screen (on)", ceramic: "ceramic", countertop: "countertop stone", curtain: "curtain fabric", blinds: "blinds", stair_wood: "wooden stair", stair_concrete: "concrete stair", rail: "railing steel", grating: "steel grating",
    light: "luminaire emitting face", light_off: "luminaire (off)", rubber: "rubber", rubber_grey: "grey rubber", paper: "paper", plant: "plant", plant_dark: "dark plant", counter_wood: "wood counter", lockers: "locker steel", leather: "leather", leather_black: "black leather", blanket: "blanket", cork: "cork", foam: "foam", mirror: "mirror", porcelain: "porcelain", tile_wall: "wall tile",
    tile_dark: "dark tile", marble: "marble", granite: "granite", quartz: "quartz", terracotta: "terracotta", soil: "soil", wicker: "wicker", floor_vinyl: "vinyl floor", chrome_steel: "chrome steel", brass_metal: "brass metal", dark_steel: "dark steel", black_metal: "black metal", stainless_steel: "stainless steel", galv_steel: "galv steel",
    alu_white_metal: "alu white metal", alu_brown_metal: "alu brown metal",
    asphalt: "asphalt road", road_paint: "road marking", sidewalk: "sidewalk", grass: "grass", gravel: "gravel", water: "water", bark: "bark", foliage: "foliage", car_paint: "car paint", car_glass: "car glass", person: "human body (clothing)", fence_white: "white-painted wood fence", fence_wood: "wood board fence", fence_chain: "galvanised chain-link", pole_metal: "steel pole", building_generic: "building facade (simplified)", rubble: "rubble", container: "container steel", shed: "shed boards", plastic: "plastic", uav_body: "UAV body", dog_body: "quadruped body", rover_body: "robot shell", cp_body: "command-vehicle body" };
  function matZh(n) {
    if (MAT_ZH[n]) return MAT_ZH[n]; if (!n) return "—";
    const col = { white: "white", grey: "grey", blue: "blue", green: "green", red: "red", yellow: "yellow", black: "black", cream: "cream", peach: "peach", purple: "purple", teal: "teal", orange: "orange", pink: "pink", brown: "brown", oak: "oak", walnut: "walnut" };
    let m = /^(plastic|paint|laminate|wood|pc|fabric|bedding|cloth|awning|emit)_?(\w*)$/.exec(n);
    if (m) { const fam = { plastic: "plastic", paint: "paint", laminate: "laminate", wood: "wood", pc: "printed packaging", fabric: "fabric", bedding: "bedding", cloth: "cloth", awning: "awning fabric", emit: "emissive face" }[m[1]], c = col[m[2]] || ""; return (c ? c + " " : "") + fam; }
    return n;
  }
  const PART_ZH = { leg: "leg", handle: "handle", baseboard: "baseboard", product: "product", ext: "ext", label: "label", books: "books", part: "part", top: "top", carton: "carton", back: "back", seat: "seat", light: "light", book_rack: "book rack", foot: "foot", pallet_stringer: "pallet stringer", price_tag: "price tag", board: "board", brace: "brace", step: "step", canopy: "canopy", nosing: "nosing", drawer: "drawer", carcass: "carcass", vents: "vents", frame: "frame", plinth: "plinth", beam: "beam", knob: "knob", shelf: "shelf", armrest: "armrest", post: "post", pallet_deck: "pallet deck", worktop: "worktop", screen: "screen", pillow: "pillow", upright: "upright", seat_cushion: "seat cushion", back_cushion: "back cushion", ceiling: "ceiling", toe_kick: "toe kick", pedestal: "pedestal", base: "base", side: "side", side_panel: "side panel", mirror: "mirror", mirror_frame: "mirror frame", plant: "plant", monitor: "monitor", keyboard: "keyboard", cistern: "cistern", bowl: "bowl", seat_lid: "seat lid", mattress: "mattress", headboard: "headboard", footboard: "footboard", duvet: "duvet", blanket: "blanket", pot: "pot", slat: "slat", body: "body", freezer_door: "freezer door", fridge_door: "fridge door", backsplash: "backsplash", wall_cabinet: "wall cabinet", tv: "tv", cabinet: "cabinet", console: "console", parapet: "parapet", tub_wall: "tub wall", tub_floor: "tub floor", basin: "basin", lamp_base: "lamp base", lamp_shade: "lamp shade", tray: "tray", stoop: "stoop", gutter: "gutter", plate: "plate", housing: "housing", pad: "pad", top_vent: "top vent" };
  Object.assign(PART_ZH, { door: "door", basin_wall: "basin wall", price_rail: "price rail", textbook: "textbook", bottle: "bottle", support_bar: "support bar", base_bar: "base bar", wrap_band: "wrap band", tap_spout: "tap spout", bin: "bin", arm: "arm", arm_cap: "arm cap", cup: "cup", basin_floor: "basin floor", tap_base: "tap base", tap_neck: "tap neck", drain: "drain", beam_label: "beam label", lift: "lift", ornament: "ornament", awning: "awning", valance: "valance", lettering: "lettering", garment: "garment", modesty_panel: "modesty panel", marker: "marker", stand_base: "stand base", stand_neck: "stand neck", mouse: "mouse", phone: "phone", cistern_lid: "cistern lid", flush_button: "flush button", hinge_block: "hinge block", soap: "soap", papers: "papers", headboard_pad: "headboard pad", duvet_fold: "duvet fold", wrapped_load: "wrapped load", crown: "crown", screen_trim: "screen trim", apron: "apron", magazine: "magazine", digit: "digit", door_gap: "door gap", tap_lever: "tap lever", dish_soap: "dish soap", spine: "spine", cap: "cap", lamp_stem: "lamp stem", brace_low: "brace low", flask: "flask", guard: "guard", louvre: "louvre", cushion: "cushion", soap_dispenser: "soap dispenser", notepad: "notepad", leg_frame: "leg frame", mug: "mug", top_edge: "top edge", neck: "neck", back_post: "back post", eraser: "eraser", foliage: "foliage", tub_basin: "tub basin", tap_body: "tap body", shower_riser: "shower riser", shower_head: "shower head", shower_arm: "shower arm", hazard_stripe: "hazard stripe", vase: "vase", rod: "rod", screen_case: "screen case", notebook: "notebook", downspout: "downspout", stretcher: "stretcher", fan_grille: "fan grille", reagent_shelf: "reagent shelf", sink: "sink", tap: "tap", back_panel: "back panel", seat_frame: "seat frame", glass: "glass", elbow: "elbow", laptop_base: "laptop base", laptop_lid: "laptop lid", reflector: "reflector", handrail: "handrail", trestle: "trestle", table_leg: "table leg", hvac: "hvac", flowers: "flowers", tower_lamp: "tower lamp", membrane: "membrane", rail: "rail", burner: "burner", burner_cap: "burner cap", guard_slat: "guard slat", backrest_bar: "backrest bar", lamp: "lamp", casing: "casing", line_set: "line set", jug: "jug", front_panel: "front panel", guard_post: "guard post", tyre: "tyre", cross_brace: "cross brace", guard_rail: "guard rail", oven_handle_post: "oven handle post", fruit_bowl: "fruit bowl", hood: "hood", ramp: "ramp", ramp_end: "ramp end", soil: "soil", carton_on_belt: "carton on belt", mast: "mast", fork: "fork", fork_heel: "fork heel", headlight: "headlight", enclosure: "enclosure", top_cabinet: "top cabinet", door_frame: "door frame", door_window: "door window", door_handle: "door handle", hmi_arm: "hmi arm", hmi_pod: "hmi pod", hmi_screen: "hmi screen", estop: "estop", tower_pole: "tower pole", cable_duct: "cable duct", penthouse: "penthouse", sensor_post: "sensor post", sensor_lens: "sensor lens", chimney: "chimney", chimney_cap: "chimney cap", chimney_pot: "chimney pot", hob: "hob", oven_window: "oven window", oven_door: "oven door", oven_handle: "oven handle", flue: "flue", hood_filter: "hood filter", low_ceiling: "low ceiling", kick: "kick", inner_top: "inner top", bell: "bell", chassis: "chassis", counterweight: "counterweight", seat_back: "seat back", steering_column: "steering column", steering_wheel: "steering wheel", beacon: "beacon", carriage: "carriage", side_frame: "side frame", drum: "drum", bed: "bed", belt: "belt", drive_motor: "drive motor" });
  const partZh = (t) => PART_ZH[t] || (/^floor_/.test(t) ? "floor" : /^ext\d+$/.test(t) ? "exterior wall segment" : /^(door|win)_\d+$/.test(t) ? "" : t);
  function partName(cat, it, elem, tag) {                                              // what the picked box is: leaf / frame / pane of a door or window, else the part name from the tag
    if (cat && (cat.cat === "structure" || cat.cat === "trim")) return ""; const win = it && /^window/.test(it.t), t = partZh(tag);
    if (cat && cat.cat === "opening") return { frame: win ? "window frame" : "door frame", glass: "window glass", door: "door leaf", fixture: "hardware (handle / hinge)", trim: "trim", treat: "curtain / blinds" }[elem] || t || ELEM_ZH[elem] || "";
    return t || ELEM_ZH[elem] || "";
  }
  const catName = (c) => (c.name ? c.name.charAt(0).toUpperCase() + c.name.slice(1) : c.zh);   // catalogue names are English (catalog.py `name`); `zh` is the old Chinese label
  const FENCE_ZH = { picket: "Wooden picket fence", privacy: "Privacy board fence", chain: "Chain-link fence" };
  const OBJ_ZH = { shed: "Shed", container: "Shipping container", bins: "Bins (two)", mailbox: "Mailbox", hoop: "Basketball hoop", tank: "Storage tank", chimney: "Chimney", playground: "Playground equipment" };
  const VEH_ZH = { sedan: "Sedan", hatchback: "Hatchback", suv: "SUV", van: "Van", box_truck: "Box truck", taxi: "Taxi", police: "Police car", pickup: "Pickup", ambulance: "Ambulance", fire_truck: "Fire truck", truck: "Truck", bus: "Bus" };
  /* typical kerb mass by vehicle type (public vehicle data, mid-range of the class; NOT project data: the scene only carries the outer dimensions) */
  const VEH_KG = { sedan: 1500, hatchback: 1300, suv: 1800, van: 2400, box_truck: 5000, taxi: 1500, police: 1900, pickup: 2100, ambulance: 3200, fire_truck: 12000 };
  const SPECIES_ZH = { maple: "Maple", locust: "Locust", oak: "Oak", pear: "Pear", birch: "Birch", linden: "Linden", poplar: "Poplar", spruce: "Spruce", pine: "Pine" };
  const KIND_TREE_ZH = { round: "Round-crown broadleaf tree", tall: "Tall broadleaf tree", conifer: "Conifer" };
  const EMB = { human: ["🚶", "person", "Person"], dog: ["🐕", "dog", "Quadruped robot"], rover: ["🤖", "wheeled", "Wheeled robot"], uav: ["🚁", "UAV", "UAV"] };
  const ROLE_ZH = { walk: "Walking", stand: "Standing", wave: "Waving (asking for help)", lie: "Lying (on the ground)", self: "You" };

  /* ================================================================ catalogue + per-scene caches ================================================================ */
  let CAT = null, catP = null;
  const loadCat = () => catP || (catP = ES.loadJSON(`${ES.DATA_DIR}/catalog.json`).then((j) => (CAT = j)).catch(() => (CAT = false)));
  let PEOPLE = null, peopleP = null;
  const loadPeople = () => peopleP || (peopleP = fetch(`${ES.ASSET_DIR || "assets"}/humans/people.json`).then((r) => (r.ok ? r.json() : null)).then((j) => (PEOPLE = j)).catch(() => (PEOPLE = false)));
  const S = { scene: null, A: null, bim: null, ordB: [], ordJ: [], ordOK: false, bld: {}, trees: [], elemName: {}, obb: new Map() };
  function ensureScene() {
    const V = VV(); if (!V || !V.scene || !V.A) return false; if (S.scene === V.scene) return true;
    const A = V.A, sc = A.scene, W = A.W, bim = A.bim || null, col = V.col; S.scene = V.scene; S.A = A; S.bim = bim; S.bld = {}; S.obb = new Map(); S.ordB = []; S.ordJ = []; S.elemName = {};
    if (bim) for (const k in bim.elements) S.elemName[bim.elements[k]] = k;
    if (bim && col) for (const [bid, B] of Object.entries(bim.buildings)) {          // same filter as ES.ray build(): box ordinal -> (building, index in the BIM json)
      const finfo = col.byBuilding && col.byBuilding[bid]; if (!finfo) continue;
      const dmg = W.damage && W.damage[bid], flo = (sc.buildings[finfo.bi] || {}).floors || 1, keep = dmg && dmg.state === "partial" ? Math.max(1, Math.floor(0.7 * flo)) : 99; if (dmg && dmg.state === "collapsed") continue;
      for (let i = 0; i < B.boxes.length; i++) { const r = B.boxes[i], fl = r[15]; if (r[16] >= keep) continue; if (!(fl & FL.PHYS) && !(fl & FL.VIS)) continue; S.ordB.push(bid); S.ordJ.push(i); }
    }
    S.ordOK = !!ES.ray && S.ordB.length === ES.ray.state().boxes;
    S.trees = []; if (!A.occ || A.occ.trees !== false) (sc.trees || []).forEach((t, i) => { const k = ES.TREE[t[2]] || ES.TREE.round, s = t[3], rz = (k.h - k.lo) * 0.5 * s; S.trees.push({ i, x: t[0], y: t[1], cz: 0.14 + k.lo * s + rz, rx: k.r * s, rz }); });
    return true;
  }
  const bldIx = (bid) => S.bld[bid] || (S.bld[bid] = (() => { const B = S.bim.buildings[bid], byId = new Map(); for (const it of B.items || []) byId.set(it.id, it); return { items: B.items || [], byId }; })());
  function itemOf(bid, j) {
    const it = bldIx(bid).items; let lo = 0, hi = it.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (it[m].b[0] <= j) { k = m; lo = m + 1; } else hi = m - 1; }
    while (k >= 0 && j >= it[k].b[1]) k--; return k >= 0 && j < it[k].b[1] ? it[k] : null;
  }
  /* index of the picked box in the BIM json: the ordinal map, verified by tag + element; otherwise a search by tag / element and containment of the hit point */
  function jsonIndex(hit, desc) {
    const B = S.bim.buildings[desc.bid], ok = (j) => j >= 0 && j < B.boxes.length && B.tags[j] === desc.tag && S.elemName[B.boxes[j][14]] === desc.elem;
    if (S.ordOK && S.ordB[desc.box] === desc.bid && ok(S.ordJ[desc.box])) return S.ordJ[desc.box];
    let best = -1, bd = 1e9;
    for (let j = 0; j < B.boxes.length; j++) {
      if (!ok(j)) continue; const r = B.boxes[j], p = boxPose(desc.bid, B, j, r), c = Math.cos(p[6]), s = Math.sin(p[6]), cr = Math.cos(p[7]), sr = Math.sin(p[7]), dx = hit.x - p[0], dy = hit.y - p[1], dz = hit.z - p[2];
      const lx = c * dx + s * dy, ly = -s * cr * dx + c * cr * dy + sr * dz, lz = s * sr * dx - c * sr * dy + cr * dz, d = Math.max(Math.abs(lx) - p[3], Math.abs(ly) - p[4], Math.abs(lz) - p[5]);
      if (d < bd) { bd = d; best = j; }
    }
    return bd < 0.03 ? best : -1;
  }
  /* current pose of box j: [cx, cy, cz, hx, hy, hz, yaw, roll]; door leaves / sashes follow V.col.doors[bid/tag].open exactly like ES.ray */
  function boxPose(bid, B, j, r) {
    let cx = r[0], cy = r[1], cz = r[2], yaw = r[6]; const mov = B.mov[j];
    if (mov) { const V = VV(), d = V && V.col && V.col.doors[bid + "/" + B.tags[j]], o = d ? d.open : mov.open || 0;
      if (mov.kind === "swing") { const a = mov.angle * o, ca = Math.cos(a), sa = Math.sin(a), dx = cx - mov.pivot[0], dy = cy - mov.pivot[1]; cx = mov.pivot[0] + ca * dx - sa * dy; cy = mov.pivot[1] + sa * dx + ca * dy; yaw += a; } else if (mov.kind === "slide_up") cz += mov.lift * o; }
    return [cx, cy, cz, r[3] / 2, r[4] / 2, r[5] / 2, yaw, r[7]];
  }
  const rot9 = (yaw, roll) => { const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll); return [cy, -sy * cr, sy * sr, sy, cy * cr, -cy * sr, 0, sr, cr]; };
  function corners(o) {
    const R = rot9(o[6], o[7]), out = [];
    for (let i = 0; i < 8; i++) { const lx = (i & 1 ? 1 : -1) * o[3], ly = (i & 2 ? 1 : -1) * o[4], lz = (i & 4 ? 1 : -1) * o[5]; out.push([o[0] + R[0] * lx + R[1] * ly + R[2] * lz, o[1] + R[3] * lx + R[4] * ly + R[5] * lz, o[2] + R[6] * lx + R[7] * ly + R[8] * lz]); }
    return out;
  }
  /* tight oriented box of an item (its static boxes, in the item's own heading) */
  function itemObb(bid, B, it) {
    const key = bid + "/" + it.id; if (S.obb.has(key)) return S.obb.get(key);
    let use = []; for (let j = it.b[0]; j < it.b[1]; j++) if (!B.mov[j]) use.push(j); if (!use.length) for (let j = it.b[0]; j < it.b[1]; j++) use.push(j); if (!use.length) { S.obb.set(key, null); return null; }
    const yaw = it.yaw != null ? it.yaw : B.boxes[use[0]][6], c = Math.cos(yaw), s = Math.sin(yaw), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const j of use) { const r = B.boxes[j]; for (const q of corners([r[0], r[1], r[2], r[3] / 2, r[4] / 2, r[5] / 2, r[6], r[7]])) { const u = c * q[0] + s * q[1], v = -s * q[0] + c * q[1]; lo[0] = Math.min(lo[0], u); hi[0] = Math.max(hi[0], u); lo[1] = Math.min(lo[1], v); hi[1] = Math.max(hi[1], v); lo[2] = Math.min(lo[2], q[2]); hi[2] = Math.max(hi[2], q[2]); } }
    const uc = (lo[0] + hi[0]) / 2, vc = (lo[1] + hi[1]) / 2, o = [c * uc - s * vc, s * uc + c * vc, (lo[2] + hi[2]) / 2, (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2, yaw, 0];
    S.obb.set(key, o); return o;
  }
  const FRONT_CATS = new Set(["furniture", "appliance", "fixture", "equipment"]);
  const frontArrow = (x, y, z, fx, fy, len) => ({ t: "arrow", a: [x, y, z], b: [x + fx * len, y + fy * len, z], strong: true, text: "front" });
  const PART_MODE = new Set(["structure", "trim", "circulation"]);                 // categories where the picked piece (a wall run, a slab, a tread) is what the owner means; for the rest the whole item is outlined
  const MASS_FROM_BOXES = new Set(["wall_ext", "wall_partition", "guard_rail", "floor_slab", "ceiling_slab", "parapet", "chimney", "penthouse", "entry_stoop", "entry_ramp", "entry_apron", "stair_flight", "roof_membrane"]);   // = catalog.py NOMINAL_MASS_FROM_BOXES

  /* ================================================================ picking ================================================================ */
  const maskAll = () => ES.ray.LAYER.ALL | ES.ray.LAYER.DETAIL | ES.ray.LAYER.TREAT;
  function crownHit(o, d, tmax) {                      // deterministic first entry into a tree crown (ES.ray crowns are stochastic media; for picking a crown counts as solid)
    let best = null;
    for (const t of S.trees) {
      const rr = Math.max(t.rx, t.rz), px = t.x - o[0], py = t.y - o[1], pz = t.cz - o[2], tc = px * d[0] + py * d[1] + pz * d[2]; if (tc < -rr || tc > tmax + rr) continue; if (px * px + py * py + pz * pz - tc * tc > rr * rr) continue;
      const ex = -px / t.rx, ey = -py / t.rx, ez = -pz / t.rz, fx = d[0] / t.rx, fy = d[1] / t.rx, fz = d[2] / t.rz, a = fx * fx + fy * fy + fz * fz, b = ex * fx + ey * fy + ez * fz, c = ex * ex + ey * ey + ez * ez - 1, disc = b * b - a * c; if (disc <= 0) continue;
      const tt = (-b - Math.sqrt(disc)) / a; if (tt > 1e-3 && tt < tmax && (!best || tt < best.t)) best = { t: tt, i: t.i, x: o[0] + d[0] * tt, y: o[1] + d[1] * tt, z: o[2] + d[2] * tt };
    }
    return best;
  }
  /* pick(o, d, opt) -> target | null.  o = eye (lab ENU), d = unit direction. opt: {maxT = 400, ignore: body uid} */
  function pick(o, d, opt) {
    if (!ES.ray || !ensureScene()) return null; opt = opt || {};
    const W = WK(), ign = opt.ignore !== undefined ? opt.ignore : W && W.view === "chase" ? undefined : "walk", maxT = opt.maxT || 400;
    const hit = ES.ray.cast(o[0], o[1], o[2], d[0], d[1], d[2], maxT, { mask: maskAll(), ignore: ign }), cr = crownHit(o, d, hit ? hit.t : maxT);
    if (cr && (!hit || cr.t < hit.t)) return treeTarget(cr.i, Object.assign({ t: cr.t, mat: ES.ray.WM ? ES.ray.WM.foliage : 0 }, cr), true, o);
    if (!hit) return null; const T = targetFromHit(hit, o); if (T) T.o = o; return T;
  }
  function targetFromHit(hit, o) {
    if (hit.kind === "ground") return groundTarget(hit);
    const desc = ES.ray.describe(hit.id); if (!desc) return null;
    if (desc.kind === "body") return agentTarget(desc.uid, hit);
    if (desc.kind === "bim") return bimTarget(hit, desc);
    const A = S.A, sc = A.scene;
    switch (desc.kind) {
      case "vehicle": return vehicleTarget(desc.i, hit);
      case "tree": return treeTarget(desc.i, hit, false, o);
      case "lamp": return lampTarget(desc.i, hit);
      case "fence": return fenceTarget(desc, hit);
      case "object": return objectTarget(desc.i, hit);
      case "roof": return roofTarget(desc, hit);
      case "prism": case "rubble": return prismTarget(desc, hit);
    }
    return null;
  }

  /* ================================================================ BIM objects ================================================================ */
  function bimTarget(hit, desc) {
    const bim = S.bim; if (!bim) return null; const bid = desc.bid, B = bim.buildings[bid]; if (!B) return null;
    const j = jsonIndex(hit, desc); if (j < 0) return null;
    const r = B.boxes[j], it = itemOf(bid, j), cat = CAT && it ? CAT.types[it.t] || null : null, pose = boxPose(bid, B, j, r);
    // face that was hit: normal in the box frame
    const c = Math.cos(pose[6]), s = Math.sin(pose[6]), cr = Math.cos(pose[7]), sr = Math.sin(pose[7]), nx = hit.nx, ny = hit.ny, nz = hit.nz;
    const ln = [c * nx + s * ny, -s * cr * nx + c * cr * ny + sr * nz, s * sr * nx - c * sr * ny + cr * nz]; let ax = 0; if (Math.abs(ln[1]) > Math.abs(ln[ax])) ax = 1; if (Math.abs(ln[2]) > Math.abs(ln[ax])) ax = 2;
    const face = ax * 2 + (ln[ax] >= 0 ? 0 : 1), partMode = !it || !cat || PART_MODE.has(cat.cat) || !itemObb(bid, B, it);
    const T = { kind: "bim", key: `bim:${bid}:${j}:${face}`, hit, bid, B, j, r, it, cat, pose, face, partMode, catLoaded: !!CAT, name: cat ? catName(cat) : ELEM_ZH[S.elemName[r[14]]] || S.elemName[r[14]], icon: iconOf(cat, S.elemName[r[14]]) };
    T.dist = hit.t; T.center = () => { const p = boxPose(bid, B, j, r); return [p[0], p[1], p[2]]; };
    T.shapes = () => {
      const own = { t: "obb", o: boxPose(bid, B, j, r), strong: partMode, label: partMode }; if (partMode) return [own]; const q = itemObb(bid, B, it), out = [{ t: "obb", o: q, strong: true, label: true }, own];
      if (it.yaw != null && cat && FRONT_CATS.has(cat.cat)) out.push(frontArrow(q[0], q[1], q[2], -Math.sin(it.yaw), Math.cos(it.yaw), q[4] + 0.3));          // item yaw = heading of its back-to-front axis (local +y): beds, shelves, wardrobes have their back to a wall in 100 % of the placements (checked on the five scenes)
      return out;
    };
    T.card = () => bimCard(T);
    return T;
  }
  const doorOf = (T) => { const V = VV(); return V && V.col && V.col.doors[T.bid + "/" + T.B.tags[T.j]] || null; };
  function matchLight(B, it) {                                                          // the lights[] record of a luminaire / lamp item: same storey, within 0.3 m in plan
    let best = null, bd = 0.3; if (!it || !it.p) return null;
    (B.lights || []).forEach((L, k) => { if (L.storey !== (it.storey != null ? it.storey : L.storey)) return; const d = Math.hypot(L.pos[0] - it.p[0], L.pos[1] - it.p[1]); if (d < bd) { bd = d; best = { L, k }; } });
    return best;
  }
  const row = (k, v, tip, cls) => ({ k, v, tip, cls });
  const sec = (h, rows) => ({ h, rows: rows.filter(Boolean) });
  const surfAxis = (n) => (Math.abs(n[2]) >= Math.abs(n[0]) && Math.abs(n[2]) >= Math.abs(n[1]) ? (n[2] > 0 ? "facing up" : "facing down") : Math.abs(n[0]) >= Math.abs(n[1]) ? (n[0] > 0 ? "facing east" : "facing west") : n[1] > 0 ? "facing north" : "facing south");
  function faceNormals(p) { const R = rot9(p[6], p[7]); return [[R[0], R[3], R[6]], [-R[0], -R[3], -R[6]], [R[1], R[4], R[7]], [-R[1], -R[4], -R[7]], [R[2], R[5], R[8]], [-R[2], -R[5], -R[8]]]; }

  function bimCard(T) {
    const { bid, B, j, r, it, cat, hit, face } = T, bim = S.bim, mats = bim.materials, RAY = ES.ray, pose = boxPose(bid, B, j, r), elem = S.elemName[r[14]], flags = r[15], sx = r[3], sy = r[4], sz = r[5];
    const rooms = B.rooms || [], room = rooms.find((q) => q.id === r[17]) || null, storey = r[16];
    const roomTxt = room ? `${ROOM_ZH[room.fn] || room.name}${room.area ? ` ${f1(room.area, 0)} m²` : ""}` : "outdoors / no room";
    const name = cat ? catName(cat) : ELEM_ZH[elem] || elem, part = partName(cat, it, elem, B.tags[j]);
    T.name = name; const sub = `${bid} ${BKIND_ZH[B.kind] || B.kind} (${B.label}) · floor ${storey + 1} · ${roomTxt}`;
    // ---- shape and mass
    const dims = it && it.sz ? it.sz : null, V = sx * sy * sz, thick = Math.min(sx, sy, sz), solid = !!(flags & FL.PHYS), detail = !!(flags & FL.DETAIL);
    const rowsShape = [];
    if (dims) rowsShape.push(row("Whole-item size", `${f1(dims[0], 2)} × ${f1(dims[1], 2)} × ${f1(dims[2], 2)} m`, "width × depth × height (catalogue items[].sz, above ground)"));
    rowsShape.push(row(dims ? "This piece" : "Size", `${f1(sx, 2)} × ${f1(sy, 2)} × ${f1(sz, 2)} m`, "The box that was hit: local size sx × sy × sz of BIM boxes[] (z up); thickness = the thinnest edge " + f1(thick, 3) + " m"));
    if (it && it.m > 0) {
      let tipM = "Catalogue mass items[].m: furniture = nominal catalogue mass × size ratio (catalog.py annotate); building parts = volume × equivalent density";
      if (MASS_FROM_BOXES.has(it.t) && !detail) {
        let vs = 0; for (let k = it.b[0]; k < it.b[1]; k++) { const q = B.boxes[k]; if (!(q[15] & FL.DETAIL) || it.t === "stair_flight") vs += q[3] * q[4] * q[5]; }
        const rho = vs > 0 ? it.m / vs : 0, mp = V * rho;
        rowsShape.push(row("Mass", `This piece ≈ ${big(mp)} kg · whole item ${big(it.m)} kg`, `${tipM}; this piece = volume ${f1(V, 3)} m³ × equivalent density ${big(rho)} kg/m³ (whole item ${big(it.m)} kg ÷ whole-item volume ${f1(vs, 2)} m³ = catalogue assembly density, not the material density)`));
      } else rowsShape.push(row("Mass", `${big(it.m)} kg${it.loose ? " · can be pushed / carried" : ""}`, tipM));
    } else if (solid) rowsShape.push(row("Mass", `This piece ≈ ${big(V * (RAY.matInfo(core(r)) || {}).rho)} kg`, `volume ${f1(V, 3)} m³ × material density (an estimate when the catalogue has no mass)`));
    // ---- materials of the six faces + hit face
    const fn = faceNormals(pose), names = [0, 1, 2, 3, 4, 5].map((k) => (mats[r[8 + k]] || {}).name || "none"), chips = [0, 1, 2, 3, 4, 5].map((k) => ({ lab: surfAxis(fn[k]).slice(1), mat: names[k], rgb: (mats[r[8 + k]] || {}).rgb, hit: k === face }));
    const hitMat = RAY.matInfo(hit.mat) || {}, hitName = hitMat.name || names[face], bm = mats[hit.mat] || {};
    const rowsMat = [row("Face hit", `Face ${surfAxis(fn[face])} · ${E(matZh(hitName))}`, `The face this ray hit (${surfAxis(fn[face])}), material ${hitName}; face material = m+x m-x m+y m-y m+z m-z of BIM boxes[]`)];
    const physRows = [];
    // ---- physics of the solid block (a DETAIL part rides on the item's solid block: take that one)
    const ph = boxPhysics(T), cm = ph ? ph.core : core(r), cmName = (mats[cm] || {}).name || "none";
    if (ph) {
      const pr = ph.r, tl = ph.tl, rf = ph.rf, thick = ph.thick, rhoBack = Number.isFinite(tl) && tl > 0.01 && tl < 59.99 && !ph.glassy ? Math.pow(10, (tl + 47) / 20) / (thick * 500) : NaN, via = ph.j !== j ? `; a detail piece was hit, counted as the solid block it sits on (${partZh(B.tags[ph.j]) || ELEM_ZH[S.elemName[pr[14]]] || "Solid block"})` : "";
      physRows.push(row("Density ρ", `${big((mats[cm] || {}).rho)} kg/m³ · ${E(matZh(ph.eff))}`, `Material table rho (bim/materials.py); core material of the solid block = ${cmName}${ph.eff !== cmName ? `; floors / ceilings are replaced by ${ph.eff} according to the building type` : ""} (the physics engine uses the +x face material as core)${via}`));
      physRows.push(row("Sound insulation TL", `${f1(tl, 1)} dB(500 Hz)${ph.glassy ? " · double glazing 6/12/6 mm" : thick < 0.5 ? ` · thickness ${f1(thick, 2)} m` : ""}`, `Field-incidence mass law TL = 20·log10(ρ·t·f) − 47 dB, capped at 60 dB; t = thinnest edge ${f1(thick, 3)} m, f = 500 Hz, ρ is the acoustic equivalent density${Number.isFinite(rhoBack) ? `(back-calculated ≈ ${big(rhoBack)} kg/m³)` : ""}; glass is treated as 2×6 mm with the coincidence dip subtracted. ES.ray.soundTlFromCrossings = bim/physics.py sound_tl_db${via}`));
      physRows.push(row("RF loss", `${f1(rf, 1)} dB(3.5 GHz)`, `ITU-R P.2040 multilayer slab transfer matrix, normal incidence, TE polarisation, capped at 45 dB per box; glass = 6/12/6 mm double glazing, plasterboard partition = board / air / board. ES.ray.rfLossFromCrossings = bim/physics.py rf_loss_db${via}`));
    } else physRows.push(row("Ray / acoustics", detail ? "Detail piece: used for appearance and LiDAR only, not for RF or acoustics" : "Not a solid block", "A box with the DETAIL flag has no PHYS: crossings in bim/physics.py skip it"));
    const tmat = mats[r[10]] || mats[cm] || {}; physRows.push(row("Visible light", `Transmission ${f1(tmat.trans, 2)}${tmat.trans > 0 ? "" : "(opaque)"}`, `Material table trans, taken from the +y face material ${tmat.name || "—"} (same as light_transmission in physics.py); glass 0.85, curtain 0.25, blinds 0.12`));
    physRows.push(row("LiDAR", `905 nm reflectivity ${f1(hitMat.refl, 2)}${hitMat.spec ? ` + specular ${f1(hitMat.spec, 2)}` : ""}${hitMat.nir ? ` · transmission ${f1(hitMat.nir, 2)}` : ""}`, `Row of the hit face material ${hitName} in ES.ray.REFL: [diffuse reflectance, specular lobe peak, near-IR transmission]; the table comes from scripts/esworld/sensors/lidar.py REFL_NAMED`));
    const mu = (CAT && CAT.materials[hitName]) || null, muT = cat && cat.mu_static; physRows.push(row("Friction μ", mu ? `static ${f1(muT != null ? muT : mu.mu_static, 2)} / kinetic ${f1(muT != null ? muT * 0.8 : mu.mu_kinetic, 2)}` : "—", "catalog.json: dry static friction coefficient by material family (catalog.py MU), kinetic = 0.8 × static; a type's own mu_static is used when it has one", "lo"));
    if (bm.alpha != null) physRows.push(row("Absorption α", `${f1(bm.alpha, 2)}(500 Hz)`, "Material table alpha: random-incidence absorption coefficient of the exposed face at 500 Hz (room acoustics)", "lo"));
    // ---- function / state
    const fnR = [], stR = [];
    if (cat) fnRows(cat, it).forEach(([k, v]) => fnR.push(row(k, E(v), `Catalogue catalog.json types["${it.t}"].functions (docs/bim-catalog.md); the values are nominal for the type`)));
    const dr = doorOf(T), mov = B.mov[j];
    if (dr && it) {
      const o = dr.open, isWin = /^win/.test(it.id) || cat && cat.cat === "opening" && /window/.test(it.t), ang = dr.mov && dr.mov.kind === "swing" ? ` · opening angle ${f1(Math.abs(o * dr.mov.angle) * R2D, 0)}°` : "";
      stR.push(row(isWin ? "window sash" : "door", `${o < 0.05 ? "closed" : o > 0.95 ? "fully open" : "half open"} · opening ${f1(o * 100, 0)}%${ang}`, `V.col.doors["${bid}/${B.tags[j]}"].open (0 closed … 1 fully open); the F key toggles the nearest door or window`, o > 0.5 ? "ok" : ""));
      stR.push(row("Lock", "not locked (the model has no lock state)", "BIM door / window records have no locked field: anyone can simply open it"));
    } else if (cat && /^window/.test(it.t)) { const w = (B.windows || []).find((q) => q.id === it.id); stR.push(row("window sash", `fixed window · ${w ? `glass ${w.glass === "double" ? "double glazing 6/12/6" : w.glass}` : ""}`, "Catalogue: fixed / frosted / ribbon / storefront / clerestory / picture windows cannot be opened")); }
    if (cat && cat.cat === "light" || cat && cat.emits && cat.emits.light) {
      const m = matchLight(B, it); if (m) { const on = ES.interior && ES.interior.lightOn ? ES.interior.lightOn(bid, m.k, m.L) : !!m.L.on; stR.push(row("Light", `${on ? "on" : "closed"} · ${big(m.L.lm)} lm · ${big(m.L.cct)} K`, `lights[] record lm / cct (BIM) + ES.interior.lightOn (room switch via the G key, power cut); ${cat.emits && cat.emits.light && cat.emits.light.lm ? `catalogue typical luminous flux ${big(cat.emits.light.lm)} lm` : ""}`, on ? "ok" : "")); }
      else if (cat.emits && cat.emits.light && cat.emits.light.lm) stR.push(row("Light", `${big(cat.emits.light.lm)} lm${cat.emits.light.cct ? ` · ${big(cat.emits.light.cct)} K` : ""} (catalogue)`, "catalogue emits.light"));
    }
    if (it && /tv_unit/.test(it.t)) { let on = false; for (let k = it.b[0]; k < it.b[1]; k++) if (B.tags[k] === "screen" && (mats[B.boxes[k][8 + 4]] || {}).name === "screen_on") on = true; stR.push(row("TV", on ? "on (screen glowing)" : "closed", "material of the screen box: screen_on = on, screen = off", on ? "ok" : "")); }
    if (cat && cat.emits) {
      const em = cat.emits; if (em.sound) fnR.push(row("Sound", `${em.sound.spl_1m_db} dB(1 m)· ${E(SND_ZH[em.sound.kind] || em.sound.kind)}${em.sound.freq_hz ? ` ${em.sound.freq_hz} Hz` : ""}${em.sound.when ? `  · ${E(WHEN_ZH[em.sound.when] || em.sound.when)} when running` : ""}`, "catalogue emits.sound: sound pressure level at 1 m, for the acoustics / microphone models"));
      if (em.heat) fnR.push(row("Heat", `${big(em.heat.w)} W${em.heat.when ? `  · ${E(WHEN_ZH[em.heat.when] || em.heat.when)} when running` : ""}`, "catalogue emits.heat"));
      if (em.rf) fnR.push(row("Radio", `${E(em.rf.band)} · ${em.rf.tx_dbm} dBm`, "catalogue emits.rf"));
    }
    if (!fnR.length && !stR.length) fnR.push(row("Function", elem === "wall_ext" || elem === "wall_int" || elem === "column" ? "Enclosure / load-bearing structure, no active function" : "—"));
    const trav = travRows(T);
    const html6 = `<div class="faces lo" title="Materials of the six faces of this box (in its current orientation; the face that was hit is highlighted)">${chips.map((c) => `<span class="fc${c.hit ? " hit" : ""}" title="${E(c.lab)} face: ${E(c.mat)}"><i style="background:${c.rgb ? `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})` : "#444"}"></i>${E(c.lab)} ${E(matZh(c.mat))}</span>`).join("")}</div>`;
    const blind = glassBehind(T);
    return { icon: iconOf(cat, elem), title: name, part, sub, dist: hit.t, cols: [[sec("Size and mass", rowsShape), Object.assign(sec("Materials (six faces)", rowsMat), { html: html6 }), sec("Physical quantities (of the piece that was hit)", physRows)], [sec("Function and state", fnR.concat(stR)), blind ? sec("Through the glass", [blind]) : null, sec("Who can pass (person · dog · wheeled · UAV)", trav)]]};
  }
  /* sound / RF loss of the solid block under the hit (the picked box when it is PHYS, else the item's nearest PHYS box within 0.2 m): numbers from ES.ray with a one-box crossing at normal incidence */
  function boxPhysics(T) {
    const { bid, B, j, it } = T, RAY = ES.ray, mats = S.bim.materials; let pj = -1;
    if (B.boxes[j][15] & FL.PHYS) pj = j;
    else if (it) { let bd = 0.2; const h = T.hit; for (let k = it.b[0]; k < it.b[1]; k++) { const q = B.boxes[k]; if (!(q[15] & FL.PHYS) || (q[15] & FL.DETAIL)) continue; const p = boxPose(bid, B, k, q), c = Math.cos(p[6]), s = Math.sin(p[6]), cr = Math.cos(p[7]), sr = Math.sin(p[7]), dx = h.x - p[0], dy = h.y - p[1], dz = h.z - p[2];
        const lx = c * dx + s * dy, ly = -s * cr * dx + c * cr * dy + sr * dz, lz = s * sr * dx - c * sr * dy + cr * dz, d = Math.hypot(Math.max(Math.abs(lx) - p[3], 0), Math.max(Math.abs(ly) - p[4], 0), Math.max(Math.abs(lz) - p[5], 0)); if (d < bd) { bd = d; pj = k; } } }
    if (pj < 0) return null; const r = B.boxes[pj], cm = core(r); if (!cm) return null; const thick = Math.min(r[3], r[4], r[5]), ord = ordOf(bid, pj), elem = S.elemName[r[14]], flags = r[15];
    const eff = elem === "slab" || elem === "ceiling" ? (B.kind === "house" || B.kind === "rowhouse" ? "wood_floor" : "concrete") : (mats[cm] || {}).name, glassy = !!(flags & FL.GLASS) || /glass/.test(eff || "");
    let tl = NaN, rf = NaN; if (ord >= 0) { const cross = { box: ord, core: cm, thick, cos: 1, treat: false, roof: false, glass: !!(flags & FL.GLASS) }; try { tl = RAY.soundTlFromCrossings([cross], 500); rf = RAY.rfLossFromCrossings([cross], 3.5e9, "TE"); } catch (e) { /* mismatch: blank */ } }
    return { j: pj, r, core: cm, thick, ord, eff, glassy, tl, rf };
  }
  const core = (r) => r[8] || r[10] || r[12] || r[9] || r[11] || r[13] || 0;                           // = ES.ray BCORE
  function ordOf(bid, j) { if (!S.ordOK) return -1; if (!S.ordIx) { S.ordIx = new Map(); S.ordFor = null; } if (S.ordFor !== S.scene) { S.ordIx = new Map(); for (let k = 0; k < S.ordB.length; k++) S.ordIx.set(S.ordB[k] + "/" + S.ordJ[k], k); S.ordFor = S.scene; } const v = S.ordIx.get(bid + "/" + j); return v === undefined ? -1 : v; }
  function iconOf(cat, elem) { const c = cat && cat.cat; if (c === "light") return "💡"; if (c === "opening") return cat.trav === "window" ? "🪟" : "🚪"; if (c === "furniture") return "🛋"; if (c === "appliance") return "🧊"; if (c === "fixture") return "🚽"; if (c === "equipment") return "⚙"; if (c === "circulation") return "🪜"; if (c === "decor") return "🪴"; if (c === "signage") return "🪧"; if (elem === "glass") return "🪟"; return "🧱"; }
  function glassBehind(T) {                                                           // looking through a pane: the first opaque thing behind it that is not part of the same window / door
    const { r, hit } = T; if (!(r[15] & FL.GLASS) || !T.o) return null; let d = [hit.x - T.o[0], hit.y - T.o[1], hit.z - T.o[2]]; const L = Math.hypot(d[0], d[1], d[2]) || 1; d = [d[0] / L, d[1] / L, d[2] / L];
    let o = T.o.slice(), run = 0;
    for (let n = 0; n < 5; n++) {
      const h2 = ES.ray.cast(o[0], o[1], o[2], d[0], d[1], d[2], 400 - run, { mask: maskAll(), glass: false, ignore: "walk" }); if (!h2) return row("What is seen", "sky / far away", "nothing behind the glass blocks the view");
      const t2 = targetFromHit(h2, o), same = t2 && t2.kind === "bim" && t2.bid === T.bid && t2.it && T.it && t2.it.id === T.it.id;
      if (t2 && !same) return row("What is seen", `${E(t2.name || "?")} · ${f1(run + h2.t, 1)} m`, "Treating the glass as transparent: the first opaque thing on this line of sight that is not this window itself (ES.ray.cast glass:false)");
      const adv = h2.t + 0.03; o = [o[0] + d[0] * adv, o[1] + d[1] * adv, o[2] + d[2] * adv]; run += adv;
    }
    return null;
  }
  const SND_ZH = { "compressor hum": "compressor hum", "extractor fan": "extractor fan", "speech/tv": "TV sound", "PC fan": "computer fan", "scanner beeps": "scanner beep", "electric drive / reverse beeper": "motor / reversing beeper", "spindle and pumps": "spindle and pump", "belt and rollers": "belt and rollers", "transformer hum": "transformer hum", fan: "fan", "compressor and fan": "compressor and fan" };
  const WHEN_ZH = { cooking: "cooking", serving: "trading", moving: "driving", running: "running", cooling: "cooling" };
  const FN_ST = { swing: "hinged", drawer: "drawer", slide_up: "flip-up", slide: "sliding" };
  function fnRows(cat, it) {
    const f = cat.functions || {}, out = [];
    if (f.sit) out.push(["seat", `${f.sit.capacity} people · seat height ${f1(f.sit.seat_h, 2)} m`]); if (f.sleep) out.push(["sleeping", `${f.sleep.capacity} people · mattress height ${f1(f.sleep.mattress_h, 2)} m`]);
    if (f.store) out.push(["storage", f.store.volume_l ? `${f.store.volume_l} L` : f.store.pallets ? `${f.store.pallets} pallet positions` : f.store.garments ? `${f.store.garments} garments` : f.store.letters ? `${f.store.letters} mailboxes` : "can store items"]);
    if (f.support) out.push(["work surface", `surface height ${f1(f.support.top_h, 2)} m`]); if (f.cook) out.push(["cooking", `${f.cook.hobs || ""} burners · ${big(f.cook.power_w)} W${f.cook.oven ? " · with oven" : ""}`]); if (f.cool) out.push(["cooling", `set to ${f.cool.setpoint_c} °C`]);
    if (f.wash) out.push(["washing", f.wash.flow_lpm ? `flow ${f.wash.flow_lpm} L/min` : f.wash.flush_l ? `flush ${f.wash.flush_l} L` : f.wash.volume_l ? `volume ${f.wash.volume_l} L` : f.wash.basins ? `${f.wash.basins} basins` : "sanitary facility"]);
    if (f.work) out.push(["office", "can work here"]); if (f.write) out.push(["writing", "can be written on"]); if (f.project) out.push(["projection", "can be projected on"]); if (f.display) out.push(["display", `${f.display.diag_in}-inch screen`]); if (f.sell) out.push(["sales", "displays / sells goods"]); if (f.convey) out.push(["conveying", `belt speed ${f.convey.speed_ms} m/s`]);
    if (f.process) out.push(["processing", `${f.process.power_kw} kW`]); if (f.drive) out.push(["driving", `${f.drive.speed_ms} m/s · lift ${f.drive.lift_kg} kg`]); if (f.vent) out.push(["ventilation", "flue"]); if (f.switch) out.push(["power distribution", "switchgear"]);
    if (f.openable) { const o = f.openable; out.push(["can open and close", `${FN_ST[o.kind] || o.kind}${o.doors ? ` · ${o.doors} leaves` : ""}${o.n ? ` · ${o.n} pieces` : ""}${o.leaves ? ` · ${o.leaves} leaves` : ""}${o.max_deg ? ` · max ${o.max_deg}°` : ""}`]); }
    if (f.switchable) out.push(["switch", "can be switched on / off (room switch)"]);
    return out;
  }

  /* ---- passability of the four embodiments: a port of catalog.py traverse() with the instance's own numbers (door width, window aperture, stair rise / tread) ---- */
  function travInfo(T, k) {
    const cat = T.cat, it = T.it, E_ = CAT && CAT.embodiments[k]; if (!cat || !E_) return null; const mode = cat.trav, top = cat.top != null ? cat.top : it && it.sz ? it.sz[2] : cat.dims[2], clear = cat.clear;
    switch (mode) {
      case "solid": return k === "uav" ? { m: "fly_over", top } : top <= E_.step ? { m: "step_over", top } : { m: "blocked", top, step: E_.step };
      case "under": return k === "uav" ? { m: "fly_over", top } : clear != null && clear >= E_.under && E_.under > 0 ? { m: "under", clear, need: E_.under } : { m: "blocked_under", clear, need: E_.under };
      case "flat": return { m: "free" };
      case "door": { const w = it && it.sz ? it.sz[0] : cat.dims[0], h = it && it.sz ? it.sz[2] : cat.dims[2], d = doorOf(T), open = d ? d.open : 0, always = /doorway|^open/.test(it ? it.t + " " + it.id : "");
        if (k === "human") return { m: "door_human", w, ok: w >= 0.7, open, always }; if (k === "uav") return { m: "door_uav", w, ok: w >= E_.min_aperture[0] + 0.15 && h >= E_.min_aperture[1], open, always };
        return { m: "door_held", w, ok: w >= 2 * E_.radius + 0.06, open, always, need: 2 * E_.radius + 0.06 }; }
      case "window": { const w = (T.B.windows || []).find((q) => q.id === (it && it.id)), ww = w ? w.w : it && it.w, wh = w ? w.z1 - w.z0 : it && it.h, d = doorOf(T), open = d ? d.open : 0; return k === "uav" ? { m: "window_uav", w: ww, h: wh, open, openable: !!d, need: E_.min_aperture } : { m: "blocked_glass" }; }
      case "stair": { const rise = it && it.rise != null ? it.rise : 0.18, tread = it && it.tread != null ? it.tread : 0.28; return k === "rover" ? { m: "blocked_stair" } : k === "uav" ? { m: "fly_stair" } : { m: rise <= E_.step ? "climb" : "blocked_step", rise, tread, step: E_.step, ok: rise <= E_.step && tread >= (k === "dog" ? 0.25 : 0.2) }; }
      case "ramp": return k === "uav" ? { m: "fly_over", top } : { m: "ramp", slope: 1 / 12, ok: k !== "rover" || 1 / 12 <= (E_.max_slope || 0.3) };
      case "wall": return k === "uav" ? { m: "blocked_wall_uav" } : { m: "blocked_wall" };
      case "surface": return { m: "surface", mu: cat.mu_static != null ? cat.mu_static : 0.6 };
    }
    return { m: "none" };
  }
  function travText(k, q, T) {
    const e = CAT.embodiments[k]; if (!q) return ["—", ""]; const loose = T.it && T.it.loose;
    switch (q.m) {
      case "step_over": return [`can step over / onto (height ${f1(q.top, 2)} ≤ ${f1(e.step, 2)} m)`, "ok"];
      case "blocked": return [k === "dog" ? `cannot climb (height ${f1(q.top, 2)} m > ${f1(q.step, 2)} m), does not jump onto furniture` : k === "rover" ? `cannot pass (height ${f1(q.top, 2)} m > ${f1(q.step, 2)} m)` : `blocks (height ${f1(q.top, 2)} m > ${f1(q.step, 2)} m)${loose ? "; loose piece, can be pushed aside" : ""}`, "no"];
      case "fly_over": return [`can fly over (top height ${f1(q.top, 2)} m)`, "ok"];
      case "under": return [`can walk underneath (clearance ${f1(q.clear, 2)} ≥ ${f1(q.need, 2)} m)`, "ok"];
      case "blocked_under": return [`cannot pass (under the top ${f1(q.clear, 2)} m < needed ${f1(q.need, 2)} m)${loose && k === "human" ? "; can be pushed aside" : ""}`, "no"];
      case "free": return ["can pass (floor covering ≤ 2 cm)", "ok"];
      case "door_human": return [q.always ? `doorway, walks straight through (clear width ${f1(q.w, 2)} m)` : `opens the door itself and passes (clear width ${f1(q.w, 2)} m${q.ok ? "" : ", too narrow"})${q.open > 0.5 ? "; it is open now" : ""}`, q.ok ? "ok" : "no"];
      case "door_held": return [q.always ? `doorway, ${q.ok ? "can pass" : "too narrow"} (clear width ${f1(q.w, 2)}, needs ${f1(q.need, 2)} m)` : q.open > 0.5 ? `door open, ${q.ok ? "can pass" : "too narrow"} (clear width ${f1(q.w, 2)}, needs ${f1(q.need, 2)} m)` : `cannot open doors; passes only when the door is open (clear width ${f1(q.w, 2)} ${q.ok ? "≥" : "<"} ${f1(q.need, 2)} m)`, q.always ? (q.ok ? "ok" : "no") : q.open > 0.5 && q.ok ? "ok" : "warn"];
      case "door_uav": return [q.always ? `doorway, can fly in (clear width ${f1(q.w, 2)} m)` : q.open > 0.5 ? `door open, ${q.ok ? "can fly in" : "opening too small"} (clear width ${f1(q.w, 2)} m)` : `cannot enter through a closed door, only when it is open (clear width ${f1(q.w, 2)} m)`, q.always || (q.open > 0.5 && q.ok) ? "ok" : "warn"];
      case "blocked_glass": return ["cannot pass (window glass)", "no"];
      case "window_uav": { const ok = q.open > 0.3 && q.w >= q.need[0] && q.h >= q.need[1]; return [q.openable ? `can enter only when the sash is open (opening ${f1(q.w, 2)} × ${f1(q.h, 2)} ≥ ${q.need[0]} × ${q.need[1]} m); now ${q.open > 0.05 ? "opening " + f1(q.open * 100, 0) + "%" : "closed"}` : "fixed window, cannot fly in", ok ? "ok" : "warn"]; }
      case "climb": return [`can ${k === "dog" ? "climb" : "go up"} (step ${f1(q.rise, 3)} ≤ ${f1(q.step, 2)} m, tread ${f1(q.tread, 2)} m${q.ok ? "" : ", rather narrow"})`, q.ok ? "ok" : "warn"];
      case "blocked_step": return [`cannot go up (step ${f1(q.rise, 3)} m > ${f1(q.step, 2)} m)`, "no"];
      case "blocked_stair": return ["cannot go up (wheels cannot take steps; use a ramp / lift)", "no"];
      case "fly_stair": return ["can fly over the stairwell (well width ≥ 0.8 m)", "ok"];
      case "ramp": return [`can drive (slope 1:12${k === "rover" ? q.ok ? ", within the wheeled limit" : ", beyond the wheeled limit" : ""})`, q.ok ? "ok" : "no"];
      case "blocked_wall": return ["cannot pass (wall / solid structure)", "no"];
      case "blocked_wall_uav": return ["cannot pass; can only enter through an open door or window", "no"];
      case "surface": return [`can stand / walk (friction μ ${f1(q.mu, 2)})`, "ok"];
      case "none": return ["not an obstacle (luminaire / trim / decoration)", "ok"];
    }
    return ["—", ""];
  }
  function travRows(T) {
    if (!CAT) return [row("Note", "the catalogue has not loaded yet", "")];
    const out = [];
    for (const k of ["human", "dog", "rover", "uav"]) {
      let q = null; if (T.cat) q = travInfo(T, k); else q = fallbackTrav(T, k);
      const [txt, cls] = travText(k, q, T), e = CAT.embodiments[k];
      out.push(row(EMB[k][0] + " " + EMB[k][1], E(txt), `${EMB[k][2]}: step limit ${f1(e.step, 2)} m · clearance needed under a table ${f1(e.under, 2)} m · radius ${f1(e.radius, 2)} m · ${e.opens_doors ? "can open doors" : "cannot open doors"} (catalog.json embodiments; rule = catalog.py traverse())`, cls));
    }
    return out;
  }
  function fallbackTrav(T, k) {                                                       // no catalogue entry: by element class and the box's own height
    const el = S.elemName[T.r[14]], e = CAT.embodiments[k], top = T.r[2] + T.r[5] / 2 - (T.B.meta ? T.B.meta.z0 : 0);
    if (/wall|column|parapet|chimney|rail/.test(el)) return { m: k === "uav" ? "blocked_wall_uav" : "blocked_wall" }; if (/slab|ceiling|roof/.test(el)) return { m: "surface", mu: 0.6 }; if (/stair|step|ramp/.test(el)) return k === "uav" ? { m: "fly_stair" } : { m: "climb", rise: 0.18, tread: 0.28, step: e.step, ok: true };
    if (/light|trim|treat/.test(el)) return { m: "none" }; return k === "uav" ? { m: "fly_over", top } : top <= e.step ? { m: "step_over", top } : { m: "blocked", top, step: e.step };
  }

  /* ================================================================ roofs, outdoor objects ================================================================ */
  function roofTarget(desc, hit) {
    const BLD = ES.ray.buildings()[desc.bld], bid = BLD && BLD.id, B = bid && S.bim && S.bim.buildings[bid]; if (!B) return null;
    let bestK = -1, bd = 0.05; (B.polys || []).forEach((p, k) => { const v = p.v; if (v.length < 3) return; const a = v[0], b = v[1], c = v[2], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], nl = Math.hypot(n[0], n[1], n[2]) || 1, dist = Math.abs(((hit.x - a[0]) * n[0] + (hit.y - a[1]) * n[1] + (hit.z - a[2]) * n[2]) / nl); if (dist < bd && ES.pip(v.map((q) => [q[0], q[1]]), hit.x, hit.y)) { bd = dist; bestK = k; } });
    const it = bestK >= 0 ? (B.items || []).find((q) => q.pl && bestK >= q.pl[0] && bestK < q.pl[1]) : null, cat = CAT && it ? CAT.types[it.t] : null, poly = bestK >= 0 ? B.polys[bestK] : null;
    const T = { kind: "roof", key: `roof:${bid}:${bestK}`, hit, name: cat ? catName(cat) : "Roof", icon: "🏠", bid, B, it, cat }; T.dist = hit.t; T.center = () => [hit.x, hit.y, hit.z];
    T.shapes = () => (poly ? [{ t: "poly", pts: poly.v, strong: true, label: true }] : []);
    T.card = () => {
      const mi = ES.ray.matInfo(hit.mat) || {}, slope = Math.acos(Math.min(1, Math.abs(hit.nz))) * R2D, nm = mi.name || "roof_shingle"; let rf = NaN;
      try { rf = ES.ray.rfLossFromCrossings([{ roof: true, mat: hit.mat, matName: nm, cos: Math.max(Math.abs(hit.nz), 0.05), treat: false }], 3.5e9, "TE"); } catch (e) { /* roofs without assembly */ }
      return { icon: "🏠", title: T.name, sub: `${bid} ${BKIND_ZH[B.kind] || B.kind} (${B.label}) · roof`, chips: `<span class="ichip">${E(cat ? CAT_ZH[cat.cat] : "Building structure")}</span>`, dist: hit.t, cols: [[sec("Roof surface", [row("Slope", `${f1(slope, 0)}°${slope < 3 ? "(flat roof)" : ""}`, "Angle between the surface normal at the hit point and the vertical"), row("Material", E(matZh(nm)), `Material of the roof polygon ${nm}`), it && it.m ? row("Mass", `Whole roof ${big(it.m)} kg`, "Catalogue items[].m: polygon area × 0.05 m × assembly density") : null, row("RF loss", `${f1(rf, 1)} dB(3.5 GHz)`, "The roof is a polygon without thickness: counted as the typical roof assembly of ES.ray (asphalt shingle = 40 mm timber board; tile = 30 mm concrete; metal 1 mm; membrane = 60 mm concrete), ITU-R P.2040, used only when GNSS passes through a roof")])], [sec("Physical quantities", [row("LiDAR", `905 nm reflectivity ${f1(mi.refl, 2)}${mi.spec ? ` + specular ${f1(mi.spec, 2)}` : ""}`, "Row of ES.ray.REFL (REFL_NAMED)"), row("Friction μ", cat && cat.mu_static != null ? f1(cat.mu_static, 2) : "—", "mu_static of the catalog.json type")]), sec("Who can pass", ["human", "dog", "rover", "uav"].map((k) => row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? "can fly over (the roof is no obstacle)" : "cannot get onto the roof (no access)", "The roof has no entrance / stairs: ground robots and people cannot reach it", k === "uav" ? "ok" : "no")))]], foot: "Roof polygon: T_TRI of ES.ray (shared by GNSS / LiDAR)" };
    };
    return T;
  }
  function prismTarget(desc, hit) {
    const b = S.A.scene.buildings[desc.i]; if (!b) return null; const T = { kind: "prism", key: `prism:${desc.i}`, hit, name: desc.kind === "rubble" ? "Collapsed building (rubble pile)" : "Building (outer shape only, no interior)", icon: "🏚" }; T.dist = hit.t; T.center = () => [hit.x, hit.y, hit.z];
    T.shapes = () => [{ t: "poly", pts: (b.fp || []).map((p) => [p[0], p[1], 0.14]).concat([]), strong: true, label: true, flat: true }];
    T.card = () => { const mi = ES.ray.matInfo(hit.mat) || {}, dmg = S.A.W.damage && S.A.W.damage[b.id], h = desc.kind === "rubble" ? Math.min(2.2, 0.18 * b.h) : dmg && dmg.state === "partial" ? 0.7 * b.h : b.h; return { icon: T.icon, title: T.name, sub: `${b.id || ""} ${BKIND_ZH[b.kind] || b.kind || ""}`, chips: "", dist: hit.t, cols: [[sec("Outer shape", [row("Height", `${f1(h, 1)} m${h < b.h - 0.05 ? `(was ${f1(b.h, 1)} m)` : ""}`, "Scene JSON buildings[].h; collapsed = min(2.2 m, 0.18 h), partly collapsed = 0.7 h (the same rule in World / ES.ray)"), row("Floors", `${b.floors || "—"}`, "Scene JSON buildings[].floors"), row("Note", desc.kind === "rubble" ? "After the collapse only a rubble pile of ≤ 2.2 m remains" : "The BIM has no interior for this building: treated as a solid prism", "")])], [sec("Physical quantities", [row("LiDAR", `905 nm reflectivity ${f1(mi.refl, 2)}`, "ES.ray.REFL building_generic / rubble"), row("Passage", "person / quadruped / wheeled / UAV: none can enter", "", "no")])]], foot: "" }; };
    return T;
  }
  function vehicleTarget(i, hit) {
    const A = S.A, v = (A.W.vehicles || [])[i]; if (!v) return null; const T = { kind: "veh", key: `veh:${i}`, hit, v, i, name: VEH_ZH[v.vtype] || VEH_ZH[v.kind] || v.vtype, icon: "🚗" }; T.dist = hit.t;
    const z0 = () => A.W.groundZ(v.xy[0], v.xy[1]); T.center = () => [v.xy[0], v.xy[1], z0() + v.dims[2] / 2];
    T.shapes = () => [{ t: "obb", o: [v.xy[0], v.xy[1], z0() + v.dims[2] / 2, v.dims[0] / 2, v.dims[1] / 2, v.dims[2] / 2, ES.rad(v.yaw), 0], strong: true, label: true }, frontArrow(v.xy[0], v.xy[1], z0() + v.dims[2] * 0.55, Math.cos(ES.rad(v.yaw)), Math.sin(ES.rad(v.yaw)), v.dims[0] / 2 + 0.6)];
    T.card = () => {
      const [L, Wd, H] = v.dims, kg = VEH_KG[v.vtype] || VEH_KG[v.kind], mi = ES.ray.matInfo(hit.mat) || {}, glass = ES.ray.matInfo(ES.ray.WM.car_glass) || {}, paint = ES.ray.matInfo(ES.ray.WM.car_paint) || {}, g = (V) => V && V.vehGroups && V.vehGroups[i], rig = g(VV()) && g(VV()).children[0] && g(VV()).children[0].userData.rig, night = ES.actors ? ES.actors.isNight() : false;
      return { icon: "🚗", title: T.name, sub: `Parked vehicle ${v.id} · heading ${compass(ES.rad(v.yaw))[0]}°${compass(ES.rad(v.yaw))[1]}`, chips: `<span class="ichip">Vehicle</span><span class="ichip">${E(v.vtype)}</span>`, dist: hit.t,
        cols: [[sec("Shape and mass", [row("Outer dimensions", `${f1(L, 2)} × ${f1(Wd, 2)} × ${f1(H, 2)} m`, "Scene JSON vehicles[].dims (length × width × height), also the physical collision box"), row("Mass class", `${kg ? `≈ ${big(kg / 1000)} t (typical kerb mass)` : "—"}`, "Typical kerb mass of this class of vehicle from public model data (mid-range), not project data: the scene only gives the outer dimensions"), row("Volume", `${f1(L * Wd * H, 1)} m³ (outer envelope)`, "length × width × height")]),
          sec("Material and physical quantities", [row("Body", `${E(matZh("car_paint"))} · radar ${f1(paint.refl, 2)} + specular ${f1(paint.spec, 2)}`, "ES.ray.REFL car_paint = [diffuse 0.35, specular lobe 0.30]"), row("car window", `${E(matZh("car_glass"))} · radar ${f1(glass.refl, 2)} + specular ${f1(glass.spec, 2)}`, "ES.ray.REFL car_glass"), row("Ray shape", "body box + cabin box", "ES.ray splits body and cabin into two boxes per vehicle type (VEH table in raycast.js)")])],
          [sec("State", [row("Engine", "off (parked)", "A parked vehicle has no driving state"), row("Doors", "all closed", "The vehicle model's doors cannot be opened"), row("Light", rig && rig.dynamic ? "emergency lights flashing (on duty)" : night ? "off (parked vehicles keep their lights off)" : "off", "vehicles.js: only the light bars of police cars / ambulances / fire trucks flash; parked cars show no head or tail lights")]),
            sec("Who can pass", ["human", "dog", "rover", "uav"].map((k) => { const e = CAT ? CAT.embodiments[k] : { step: 0 }; return row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? `can fly over (roof height ${f1(H, 2)} m)` : `cannot pass (height ${f1(H, 2)} m > step limit ${f1(e.step, 2)} m)`, "Shape height compared with each identity's step limit", k === "uav" ? "ok" : "no"); }))]], foot: "The shape comes from the scene data; the mass class is a typical value (see the note)" };
    };
    return T;
  }
  function treeTarget(i, hit, crown, o) {
    const A = S.A, t = A.scene.trees[i]; if (!t) return null; const k = ES.TREE[t[2]] || ES.TREE.round, s = t[3], V = VV(), vt = V && V.trees && V.trees[i], sp = vt && vt.choice ? vt.choice.species : null;
    const T = { kind: "tree", key: `tree:${i}`, hit, name: SPECIES_ZH[sp] || KIND_TREE_ZH[t[2]] || "Tree", icon: "🌳" }; T.dist = hit.t; const rz = (k.h - k.lo) * 0.5 * s, cz = 0.14 + k.lo * s + rz, tr = 0.13 * s, zt = 0.14 + (k.lo + 0.45 * (k.h - k.lo)) * s;
    T.center = () => [t[0], t[1], cz]; T.shapes = () => [{ t: "cyl", c: [t[0], t[1]], r: tr, z0: 0.14, z1: zt, strong: false }, { t: "ell", c: [t[0], t[1], cz], rx: k.r * s, rz, strong: true, label: true }];
    T.card = () => {
      const den = k.den, bark = ES.ray.matInfo(ES.ray.WM.bark) || {}, leaf = ES.ray.matInfo(ES.ray.WM.foliage) || {};
      return { icon: "🌳", title: T.name, sub: `${KIND_TREE_ZH[t[2]]} · scene tree #${i}${t[4] ? " · " + ({ street: "street tree", park: "park tree" }[t[4]] || t[4]) : ""}`, chips: `<span class="ichip">Vegetation</span>${sp ? `<span class="ichip">${E(sp)}</span>` : ""}`, dist: hit.t,
        cols: [[sec("Form", [row("Tree height", `${f1(k.h * s, 1)} m`, `type height ${k.h} m × scale ${f1(s, 2)} (ES.TREE.${t[2]}.h × the scene tree's scale)`), row("Trunk (collision column)", `radius ${f1(tr, 2)} m · height 0.14 – ${f1(zt, 1)} m`, "ES.ray trunk cylinder: radius 0.13 × scale, up to 45% above the crown base; people and dogs are stopped by it"), row("Crown", `radius ${f1(k.r * s, 1)} m · from ${f1(k.lo * s, 1)} m above ground · top ${f1(k.h * s, 1)} m`, "ES.TREE: crown radius r, crown base lo, top h, all × scale (ellipsoid)"), row("Leaf density", `${f1(den, 2)} → light attenuation ${f1(0.5 * den, 2)} /m`, "ES.ray crown = Beer-Lambert medium, attenuation coefficient = 0.5 × den (per metre); GNSS / radio use the path length inside the crown")]),
          sec("Physical quantities", [row("Bark", `LiDAR reflectivity ${f1(bark.refl, 2)}`, "ES.ray.REFL bark"), row("Leaves", `LiDAR reflectivity ${f1(leaf.refl, 2)}`, "ES.ray.REFL foliage"), row("Collision", "The trunk is a solid column; the crown does not stop people / dogs / UAVs, it only attenuates signals and blocks the view", "view3d.js: in World the trunk occupies hB (up to the crown base), the crown only records cLo / cHi / cDen")])],
          [sec("Who can pass", ["human", "dog", "rover", "uav"].map((kk) => row(EMB[kk][0] + " " + EMB[kk][1], kk === "uav" ? `Go round the trunk (radius ${f1(tr, 2)} m); the canopy can be passed through` : `cannot pass (trunk radius ${f1(tr, 2)} m, go round it)`, "The trunk is a solid column", kk === "uav" ? "warn" : "no")))]], foot: crown ? "The crown ellipsoid was hit (picking treats the crown as a solid)" : "" };
    };
    return T;
  }
  function lampTarget(i, hit) {
    const l = S.A.scene.lamps[i]; if (!l) return null; const T = { kind: "lamp", key: `lamp:${i}`, hit, name: "Street lamp", icon: "💡" }; T.dist = hit.t; const hx = l[0] + Math.cos(l[2]) * 1.6, hy = l[1] + Math.sin(l[2]) * 1.6;
    T.center = () => [l[0], l[1], 3.5]; T.shapes = () => [{ t: "cyl", c: [l[0], l[1]], r: 0.085, z0: 0.14, z1: 7.14, strong: true, label: true }, { t: "obb", o: [(l[0] + hx) / 2, (l[1] + hy) / 2, 7.0, 0.85, 0.04, 0.04, l[2], 0], strong: true }, { t: "obb", o: [hx, hy, 6.95, 0.35, 0.15, 0.06, l[2], 0], strong: true }];
    T.card = () => { const night = ES.actors ? ES.actors.isNight() : false, mi = ES.ray.matInfo(ES.ray.WM.pole_metal) || {};
      return { icon: "💡", title: "Street lamp", sub: `Scene lamp #${i} · arm heading ${compass(l[2])[0]}°${compass(l[2])[1]}`, chips: `<span class="ichip">Street furniture</span>`, dist: hit.t, cols: [[sec("Outer shape", [row("Lamp pole", "height 7.0 m · pole radius 0.085 m", "ES.ray lamp-pole cylinder 0.14 … 7.14 m"), row("Arm / luminaire head", "arm length 1.7 m · head 0.7 × 0.3 m, height 6.95 m", "ES.ray: arm box 1.7 × 0.08 × 0.08 m, head box 0.7 × 0.3 × 0.12 m"), row("Material", `${E(matZh("pole_metal"))} · LiDAR ${f1(mi.refl, 2)} + specular ${f1(mi.spec, 2)}`, "ES.ray.REFL pole_metal")])], [sec("Function and state", [row("Light", `${night ? "on (night)" : "off (day)"} · 6,000 lm`, "Lighting model in telemetry.js: each street lamp 6,000 lm at night; off by day (follows the day / night look)", night ? "ok" : "")]), sec("Who can pass", ["human", "dog", "rover", "uav"].map((kk) => row(EMB[kk][0] + " " + EMB[kk][1], kk === "uav" ? "Go round the pole / arm" : "cannot pass (the lamp pole is a solid column, go round it)", "", kk === "uav" ? "warn" : "no")))]], foot: "" }; };
    return T;
  }
  function fenceTarget(desc, hit) {
    const o = S.A.scene.objects[desc.i]; if (!o) return null; const ln = o.lines[desc.line] || o.lines[0]; let bk = 0, bd = 1e9;
    for (let k = 0; k + 1 < ln.length; k++) { const a = ln[k], b = ln[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((hit.x - a[0]) * dx + (hit.y - a[1]) * dy) / L2)), d = Math.hypot(a[0] + t * dx - hit.x, a[1] + t * dy - hit.y); if (d < bd) { bd = d; bk = k; } }
    const a = ln[bk], b = ln[bk + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const T = { kind: "fence", key: `fence:${desc.i}:${desc.line}:${bk}`, hit, name: FENCE_ZH[o.style] || "Fence", icon: "🚧" }; T.dist = hit.t; T.center = () => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.14 + o.h / 2];
    T.shapes = () => [{ t: "poly", pts: [[a[0], a[1], 0.14], [b[0], b[1], 0.14], [b[0], b[1], 0.14 + o.h], [a[0], a[1], 0.14 + o.h]], strong: true, label: true }];
    T.card = () => {
      const mi = ES.ray.matInfo(hit.mat) || {}, st = o.style, see = st === "privacy" ? "opaque (continuous boards)" : st === "picket" ? "semi-transparent: gaps between the slats, you can see through" : "almost transparent: the wire mesh hides only a small part";
      const cov = st === "picket" ? "slats cover about 63% (0.094 m board / 0.15 m pitch) + 2 rails + posts" : st === "privacy" ? "100% (continuous boards + rails)" : "wire coverage depends on distance: close up ≈ 5% (0.004 + 0.0075·d)/0.177 × 2, capped at 85%";
      return { icon: "🚧", title: T.name, sub: `Fence #${desc.i} · this section ${f1(L, 1)} m`, chips: `<span class="ichip">Fence</span>`, dist: hit.t, cols: [[sec("Outer shape", [row("Height", `${f1(o.h, 1)} m`, "Scene JSON objects[].h"), row("Length of this section", `${f1(L, 1)} m · ${Math.max(1, Math.round(L / 2.4))} post sections in all`, "post spacing about 2.4 m (ES.ray fence primitive)"), row("Style", E(FENCE_ZH[st]), "Scene JSON objects[].style")]), sec("Physical quantities", [row("See-through", E(see), "ES.ray fenceHit: the position of the slats / wires decides whether a ray is blocked"), row("Occlusion detail", E(cov), "Geometric constants of fenceHit in raycast.js"), row("Material", `${E(matZh(mi.name))} · LiDAR ${f1(mi.refl, 2)}${mi.spec ? ` + specular ${f1(mi.spec, 2)}` : ""}`, "ES.ray.REFL " + (mi.name || ""))])],
        [sec("Who can pass", ["human", "dog", "rover", "uav"].map((k) => row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? `can fly over (height ${f1(o.h, 1)} m)` : `cannot pass (fence height ${f1(o.h, 1)} m; only through a gate / gap)`, "view3d.js rasterBlocked: the fence occupies the hT / hB grids of World", k === "uav" ? "ok" : "no")))]], foot: "" };
    };
    return T;
  }
  function objectTarget(i, hit) {
    const o = S.A.scene.objects[i]; if (!o) return null; const W = S.A.W, nm = o.name || o.type, T = { kind: "obj", key: `obj:${i}`, hit, name: OBJ_ZH[nm] || nm, icon: { shed: "🛖", container: "📦", tank: "🛢", chimney: "🏭", mailbox: "📬", bins: "🗑", hoop: "🏀", playground: "🛝" }[nm] || "📦" }; T.dist = hit.t; const gz = W.groundZ(o.xy[0], o.xy[1]);
    const mdl = o.type === "box" ? o.size : o.type === "cyl" ? [2 * o.r, 2 * o.r, o.h] : [0.1, 0.1, o.h]; T.center = () => [o.xy[0], o.xy[1], gz + mdl[2] / 2];
    T.shapes = () => (o.type === "box" ? [{ t: "obb", o: [o.xy[0], o.xy[1], 0.14 + o.size[2] / 2, o.size[0] / 2, o.size[1] / 2, o.size[2] / 2, o.yaw || 0, 0], strong: true, label: true }] : [{ t: "cyl", c: [o.xy[0], o.xy[1]], r: o.type === "cyl" ? o.r : 0.05, z0: o.type === "cyl" ? 0 : 0.14, z1: o.type === "cyl" ? o.h : 0.14 + o.h, strong: true, label: true }]);
    T.card = () => {
      const mi = ES.ray.matInfo(hit.mat) || {}, top = o.type === "box" ? o.size[2] : o.h;
      return { icon: T.icon, title: T.name, sub: `Scene object #${i} · ${o.type === "box" ? "Box" : o.type === "cyl" ? "Cylinder" : "Pole"}`, chips: `<span class="ichip">Scene object</span>`, dist: hit.t,
        cols: [[sec("Outer shape", [row("Size", o.type === "box" ? `${f1(o.size[0], 2)} × ${f1(o.size[1], 2)} × ${f1(o.size[2], 2)} m` : o.type === "cyl" ? `diameter ${f1(2 * o.r, 2)} m · height ${f1(o.h, 1)} m` : `pole height ${f1(o.h, 1)} m`, "Scene JSON objects[]"), o.yaw != null ? row("Heading", `${compass(o.yaw)[0]}°${compass(o.yaw)[1]}`, "Scene JSON objects[].yaw") : null]), sec("Physical quantities", [row("Material", `${E(matZh(mi.name))} · LiDAR ${f1(mi.refl, 2)}${mi.spec ? ` + specular ${f1(mi.spec, 2)}` : ""}`, "ES.ray.REFL " + (mi.name || "")), row("Mass", "The scene gives no mass", "The scene JSON only contains geometry")])],
          [sec("Who can pass", ["human", "dog", "rover", "uav"].map((k) => { const e = CAT ? CAT.embodiments[k] : { step: 0 }; return row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? `fly over (height ${f1(top, 1)} m)` : top <= e.step ? `can step over (height ${f1(top, 2)} m)` : `cannot pass (height ${f1(top, 1)} m > ${f1(e.step, 2)} m)`, "Compared by height with the step limits", k === "uav" || top <= e.step ? "ok" : "no"); }))]], foot: "" };
    };
    return T;
  }
  function groundTarget(hit) {
    const W = S.A.W, cls = hit.cls, mi = ES.ray.matInfo(hit.mat) || {}, nm = mi.name, id = W.ij(hit.x, hit.y), rub = id >= 0 ? W.rub[id] : 0;
    const T = { kind: "ground", key: `ground:${nm}`, hit, name: ({ asphalt: "Asphalt road", road_paint: "Road marking (reflective paint)", sidewalk: "Sidewalk (concrete)", grass: "Grass", gravel: "Gravel ground", soil: "Soil", water: "Water surface" })[nm] || "Ground", icon: nm === "water" ? "🌊" : nm === "asphalt" || nm === "road_paint" ? "🛣" : nm === "grass" ? "🌿" : "▦" }; T.dist = hit.t; T.center = () => [hit.x, hit.y, hit.z];
    T.shapes = () => [{ t: "ring", c: [hit.x, hit.y, hit.z], r: 0.5, strong: true }];
    T.card = () => {
      const cn = { 1: "Road", 2: "Sidewalk / paving", 13: "Grass / soil", 11: "Water surface" }[cls] || "Ground", mu = nm === "sidewalk" && CAT ? (CAT.materials.concrete || {}).mu_static : null, water = nm === "water";
      return { icon: T.icon, title: T.name, sub: `${cn} · height z = ${f1(hit.z, 3)} m`, chips: `<span class="ichip">Ground</span>${rub > 0.05 ? `<span class="ichip warn">Rubble ${f1(rub, 2)} m</span>` : ""}`, dist: hit.t,
        cols: [[sec("Surface", [row("Class", E(cn), "ES.ray ground-grid class: road / sidewalk / grass / water (rasterised scene polygons)"), row("Height", `${f1(hit.z, 3)} m`, "A.W.gz: road 0.012, grass 0.14, park 0.15, sidewalk 0.16, path 0.164"), row("Slope", "Flat (the grid ground has no slope)", "A.W height field: the same kind of ground has the same height"), rub > 0.05 ? row("Rubble", `height ${f1(rub, 2)} m`, "Rubble height A.W.rub of the post-quake variant", "warn") : null]),
          sec("Physical quantities", [row("LiDAR", `905 nm reflectivity ${f1(mi.refl, 2)}${mi.spec ? ` + specular ${f1(mi.spec, 2)}` : ""}`, "ES.ray.REFL " + nm + (nm === "road_paint" ? "(markings are retro-reflective paint)" : "")), row("Friction μ", mu != null ? `${f1(mu, 2)} (static friction of concrete)` : "not defined in the model", "Outdoor ground only has the sidewalk (concrete) matched to a μ in the catalogue; asphalt / grass / gravel have no friction data in the model")])],
          [sec("Who can walk", ["human", "dog", "rover", "uav"].map((k) => row(EMB[k][0] + " " + EMB[k][1], water ? (k === "uav" ? "can fly over water" : "cannot enter the water") : k === "uav" ? "can fly over" : rub > 0.25 ? `rubble height ${f1(rub, 2)} m, ${k === "dog" ? "the dog can only walk over rubble ≤ 0.5 m" : "depends on the height"}` : "can walk", "view3d.js rasterBlocked: grid cells occupied by water / rubble / solids are not walkable", water && k !== "uav" ? "no" : "ok")))]], foot: "" };
    };
    return T;
  }

  /* ================================================================ agents: live episode, placed entities, my own body ================================================================ */
  const MASS = { dog: [15.2, "Unitree Go2 MJCF total mass 15.206 kg (scripts/esworld/dynamics/robots.py load_go2_spec)"], uav: [1.325, "Skydio X2 MJCF mass 1.325 kg (load_x2_spec)"], rover: [40, "catalog.json embodiments.rover.mass_kg"] };
  function agentInfo(uid) {
    const V = VV(), A = S.A;
    if (uid === "walk") { const W = WK(); return { uid, live: false, self: true, kind: W.body === "human" ? "human" : W.body, name: "You", pos: () => ({ x: W.x, y: W.y, z: W.body === "uav" ? W.z : W.zf, yaw: W.yaw, speed: W.speed || 0 }), body: W.body }; }
    if (uid.startsWith("live:")) { const id = uid.slice(5), it = V && V.live && V.live.userData.items.find((q) => q.id === id); if (!it) return null; const k = it.kind === "dog" ? "dog" : it.kind === "uav" ? "uav" : it.kind === "rover" ? "rover" : it.kind === "t:lying" ? "lying" : "human";
      return { uid, live: true, it, id, kind: k, role: it.a && it.a.role, pos: () => { const m = it.model, st = it.st; return { x: m.position.x, y: -m.position.z, z: m.position.y, yaw: m.rotation.y, speed: st ? st.speed : 0, st }; }, rigKey: it.model.userData.rig && it.model.userData.rig.key }; }
    if (uid.startsWith("ent:")) { const id = uid.slice(4), e = (A.ents || []).find((q) => String(q.id) === id); if (!e) return null; const k = e.kind === "t:person" ? "person" : e.kind === "t:lying" ? "lying" : e.kind === "t:vehicle" ? "vehicle" : e.kind === "human" ? "human" : e.kind;
      return { uid, live: false, ent: e, id, kind: k, pos: () => ({ x: e.x, y: e.y, z: e.kind === "uav" ? e.z : e.zf != null ? e.zf : ES.view3d.walk.surfZ(e.x, e.y), yaw: e.yaw || 0, speed: 0 }) }; }
    return null;
  }
  const AG_ICON = { dog: "🐕", uav: "🚁", rover: "🤖", human: "🚶", person: "🚶", lying: "🧍", cp: "📡", vehicle: "🚗" };
  function agentNames(g) {
    const kind = g.kind, me = WK(); let name, model;
    if (g.self) { name = "You (" + ES.controls.IDENT[me.body].name + ")"; model = ES.controls.IDENT[me.body].spec; }
    else if (kind === "dog") { name = g.live ? "Quadruped robot (episode)" : (g.ent && g.ent.name) || "Quadruped robot"; model = "Unitree Go2"; }
    else if (kind === "uav") { name = g.live ? "UAV (episode)" : (g.ent && g.ent.name) || "UAV"; model = "Skydio X2 class"; }
    else if (kind === "rover") { name = g.live ? "Delivery robot (episode)" : (g.ent && g.ent.name) || "Delivery robot"; model = "Wheeled delivery robot"; }
    else if (kind === "cp") { name = (g.ent && g.ent.name) || "Command post"; model = "Mobile command vehicle (box truck + mast)"; }
    else if (kind === "vehicle") { name = (g.ent && g.ent.name) || "Moving vehicle (target)"; model = "Hatchback target"; }
    else { const resp = g.live ? g.id === "human_0" : kind === "human"; name = g.live ? (g.id === "human_0" ? "Responder (episode)" : g.role === "wave" ? "Resident waving for help from a window" : kind === "lying" ? "Person on the ground" : "Civilian (episode)") : (g.ent && g.ent.name) || (kind === "lying" ? "Person on the ground" : "Standing person"); model = resp ? "Responder (Rocketbox helmet + hi-vis vest)" : "Civilian (Rocketbox person)"; }
    return { name, model };
  }
  function agentTarget(uid, hit) {
    const g = agentInfo(uid); if (!g) return null; const T = { kind: "agent", key: "agent:" + uid, hit, g, uid, name: agentNames(g).name, icon: AG_ICON[g.kind] || "🤖" }; T.dist = hit.t;
    T.center = () => { const p = g.pos(), B = ES.ray.BODY[bodyKind(g)] || {}; return [p.x, p.y, p.z + (B.h ? B.h / 2 : B.lift || 0.3)]; };
    T.shapes = () => { const p = g.pos(), bk = bodyKind(g), B = ES.ray.BODY[bk]; if (!B) return []; if (B.t === 1) return [{ t: "cyl", c: [p.x, p.y], r: B.r, z0: p.z, z1: p.z + B.h, strong: true, label: true }, frontArrow(p.x, p.y, p.z + B.h * 0.6, Math.cos(p.yaw), Math.sin(p.yaw), B.r + 0.4)];
      const dm = g.kind === "cp" ? S.A.scene.cp_dims || [7, 2.5, 3.3] : g.kind === "vehicle" ? [4.2, 1.8, 1.5] : null, hx = dm ? dm[0] / 2 : B.hx, hy = dm ? dm[1] / 2 : B.hy, hz = dm ? dm[2] / 2 : B.hz, cz = bk === "uav" ? p.z : p.z + (dm ? dm[2] / 2 : B.lift);
      return [{ t: "obb", o: [p.x, p.y, cz, hx, hy, hz, p.yaw, 0], strong: true, label: true }, frontArrow(p.x, p.y, cz, Math.cos(p.yaw), Math.sin(p.yaw), hx + 0.35)]; };
    T.card = () => agentCard(T);
    return T;
  }
  const bodyKind = (g) => (g.kind === "human" || g.kind === "person" ? "person" : g.kind === "lying" ? "lying" : g.kind);
  function linkTo(g) {                                                           // radio link between my device and that device (same code path as the HUD cards: ES.phys.link over shared radio technologies)
    const P = ES.phys, W = S.A.W, me = WK(); if (!P || !W || !ES.RADIOS || !P.radioGroupPairs) return null; const kind = g.kind === "person" || g.kind === "lying" ? null : g.kind === "walk" ? null : g.kind, dv = kind && ES.DEVICES[kind]; if (!dv || !dv.radios) return null;
    const mine = ES.DEVICES[me.body === "uav" ? "uav" : me.body === "dog" ? "dog" : "human"], p = g.pos(), meNode = { x: me.x, y: me.y, z: me.body === "uav" ? me.z : me.zf + (me.body === "dog" ? 0.45 : 1.4), radios: mine.radios, kind: me.body }, dn = { x: p.x, y: p.y, z: kind === "uav" ? p.z : p.z + (dv.antH || 1), radios: dv.radios, kind };
    let best = null; for (const [ka, kb] of P.radioGroupPairs(meNode.radios, dn.radios)) { const ab = P.link(W, meNode, dn, ES.RADIOS[ka], ES.RADIOS[kb], null), ba = P.link(W, dn, meNode, ES.RADIOS[kb], ES.RADIOS[ka], null), good = Math.min(ab.good, ba.good); if (!best || good > best.good) best = { good, tech: ka === kb ? ka : ka + "↔" + kb, los: ab.los }; }
    return best;
  }
  const OTHER_SENS = { dog: "4-microphone array · IMU · GNSS", uav: "barometer · IMU · GNSS · microphone", human: "binaural microphones · phone radio (5G / Wi-Fi / Bluetooth)", rover: "microphone", cp: "microphone · 5G base station · Wi-Fi · 900 MHz mesh" };       // = the non-camera, non-LiDAR part of ES.DEVICES[kind].sensors (agents_cfg.DEVICES)
  const MOVE_ZH = { dog: ["walking", "standing"], uav: ["flying", "hovering"], rover: ["driving", "stopped"] };
  function agentCard(T) {
    const g = T.g, p = g.pos(), me = WK(), RAY = ES.ray, bk = bodyKind(g), B = RAY.BODY[bk] || {}, kind = g.kind, { name, model } = agentNames(g), icon = AG_ICON[kind] || "🤖"; T.name = name;
    const eye = [me.x, me.y, ES.view3d.walk.V.cam.position.y], dist = Math.hypot(p.x - eye[0], p.y - eye[1], p.z - eye[2]), spd = p.speed || 0, [hd, hn] = compass(p.yaw);
    const civ = (kind === "human" && g.live && g.id !== "human_0") || kind === "person" || kind === "lying" || kind === "vehicle";            // civilians and targets carry no device
    const dev = civ ? null : ES.DEVICES[kind], H = ES.hud || {}, CAMS = civ ? null : (H.CAMS || {})[kind], LID = civ ? null : (H.LIDARS || {})[kind], MM = ES.lidar && ES.lidar.MODELS && LID ? ES.lidar.MODELS[LID.model] : null;
    const camTxt = CAMS ? CAMS.map((c) => `${c.zh} ${c.hfov}° ${c.res[0]}×${c.res[1]} ${c.fps} fps`).join(" · ") : "", lidTxt = LID ? `${LID.zh} · ${MM ? MM.h_fov : LID.hfov}° × ${MM ? MM.v_max - MM.v_min : LID.vmax - LID.vmin}° · ≤ ${MM ? MM.max_range : LID.range} m · ${MM ? MM.rate_hz : LID.rate} Hz` : "";
    let size, mass = null;
    if (kind === "cp") { const d = S.A.scene.cp_dims || [7, 2.5, 3.3]; size = `${f1(d[0], 1)} × ${f1(d[1], 1)} × ${f1(d[2], 1)} m`; } else if (kind === "vehicle") size = "4.2 × 1.8 × 1.5 m"; else if (B.t === 1) size = `height ${f1(B.h, 2)} m · collision capsule radius ${f1(B.r, 2)} m`; else size = `${f1(2 * B.hx, 2)} × ${f1(2 * B.hy, 2)} × ${f1(2 * B.hz, 2)} m`;
    if (kind === "human" || kind === "person" || kind === "lying") {      // roster height; mass scales with height^2 from the young adult (1.71 m, 72 kg) of dynamics/human.py
      const key = g.rigKey || (g.self ? "resp_m" : null), pe = PEOPLE && key && PEOPLE.people && PEOPLE.people[key], h = pe ? pe.height : 1.7; mass = [72 * Math.pow(h / 1.71, 2), `A person of ${f1(h, 2)} m: mass = 72 kg × (height / 1.71 m)² (dynamics/human.py young group 1.71 m / 72 kg; traffic/pedestrians.py uses the same scaling)`]; if (pe && B.t === 1) size = `height ${f1(h, 2)} m (${key}) · collision capsule radius ${f1(B.r, 2)} m`;
    } else if (MASS[kind]) mass = MASS[kind];
    const sensRows = civ ? [row("Equipment", "no sensors", "civilians / targets carry no equipment")] : [camTxt ? row("Camera", E(camTxt), "ES.hud.CAMS (mirrors agents_cfg.DEVICES)") : null, lidTxt ? row("LiDAR", E(lidTxt), "ES.lidar.MODELS (lidar_models.json, same source as agents_cfg)") : null, OTHER_SENS[kind] ? row("Other", E(OTHER_SENS[kind]), "the part of ES.DEVICES[kind].sensors other than cameras / LiDAR") : null];
    const mv = MOVE_ZH[kind], act = kind === "lying" ? "lying (on the ground)" : g.live && g.role && ROLE_ZH[g.role] && !mv ? ROLE_ZH[g.role] : mv ? mv[spd > 0.25 ? 0 : 1] : spd > 0.25 ? "walking" : kind === "cp" ? "parked" : "standing";
    const st = [row("Action", E(act), g.live ? "episode data agents[].role + path speed" : g.self ? "You" : "A placed entity is static"), row("Speed", `${f1(spd, 2)} m/s`, g.live ? "finite difference of the replayed path (ES.actors.track)" : g.self ? "your own speed WALK.speed" : "A placed entity does not move"), row("Heading", `${hd}° ${hn}`, "yaw (counter-clockwise from +x) → compass bearing")];
    if (kind === "uav") st.push(row("Height above ground", `${f1(p.z - S.A.W.groundZ(p.x, p.y), 1)} m`, "body height − ground height"));
    if (g.self) { const W = WK(), pct = Math.round(100 * (W.batt != null ? W.batt : 1)); st.push(row("Battery", `${pct}%`, "view3d.js battery model (UAV hover 108 W, dog 25-60 W …)", pct < 15 ? "warn" : "")); }
    else if (dev && dev.battery_wh) st.push(row(kind === "human" ? "phone battery" : "battery", `${dev.battery_wh} Wh`, "capacity from ES.DEVICES (agents_cfg.DEVICES); the episode data has no remaining charge"));
    if (!g.self) {
      const head = [p.x, p.y, p.z + (kind === "uav" ? 0 : B.t === 1 ? B.h * 0.9 : (B.lift || 0.4) + (B.hz || 0.2))], los = !RAY.blocked([eye[0], eye[1], eye[2]], head);
      st.push(row("Line of sight", los ? "visible (not occluded)" : "occluded", "ES.ray.blocked: from my eyes to its head, glass treated as transparent", los ? "ok" : "warn")); st.push(row("Distance to me", `${f1(dist, 1)} m`, "3D distance (my eyes to its centre)"));
      const lk = dev && dev.radios ? linkTo(g) : null; if (lk) st.push(row("Link (to me)", lk.good > 0 ? `${lk.good >= 10 ? Math.round(lk.good) : f1(lk.good, 1)} Mb/s · ${E(lk.tech)} · ${lk.los ? "line of sight" : "obstructed"}` : "no link", "ES.phys.link: the best of the radio standards both sides share (same algorithm as the HUD nearby-device cards)", lk.good > 0 ? "ok" : "warn"));
    }
    const rr = B.r || Math.max(B.hx || 0, B.hy || 0), coll = [row("Collision", kind === "uav" ? `body ${f1(2 * B.hx, 2)} m; in the air, go round / fly over` : `collision radius ${f1(rr, 2)} m, it moves: go round it when it blocks you; if it walks into you, you are pushed aside`, "view3d.js: moving entities are solid (liveHit / pushedByLive)", "warn")];
    return { icon, title: name, sub: model, chips: `<span class="ichip">${g.self ? "me" : g.live ? "in episode" : "placed by me"}</span><span class="ichip">${E(kind)}</span>`, dist,
      cols: [[sec("Shape and mass", [row("Size", E(size), "ES.ray physical shape (the same one used by LiDAR and collision)"), mass ? row("Mass", `${big(mass[0])} kg`, mass[1]) : null]), sec("Sensors", sensRows), g.self ? null : sec("Collision", coll)], [sec("Current state", st)]], foot: g.live ? "Episode agent: position / speed come from the replay of live_<scene>.json" : g.self ? "" : "An entity you placed (editable in the top view)" };
  }

  /* ================================================================ drawing ================================================================ */
  const fx = { cv: null, g: null, w: 0, h: 0, dpr: 1 };
  function projector(V, w, h) {
    const cam = V.cam; cam.updateMatrixWorld(true); const e = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements, near = cam.near;
    return { near, bb: [1e9, 1e9, -1e9, -1e9], cp: [cam.position.x, -cam.position.z, cam.position.y],
      v(x, y, z) { const X = x, Y = z, Z = -y; return [e[0] * X + e[4] * Y + e[8] * Z + e[12], e[1] * X + e[5] * Y + e[9] * Z + e[13], e[2] * X + e[6] * Y + e[10] * Z + e[14]]; },
      s(q) { const iw = -1 / q[2], x = ((p[0] * q[0] + p[8] * q[2]) * iw * 0.5 + 0.5) * w, y = (1 - ((p[5] * q[1] + p[9] * q[2]) * iw * 0.5 + 0.5)) * h; if (x < this.bb[0]) this.bb[0] = x; if (y < this.bb[1]) this.bb[1] = y; if (x > this.bb[2]) this.bb[2] = x; if (y > this.bb[3]) this.bb[3] = y; return [x, y]; } };
  }
  function clipSeg(P, a, b) {                                                           // view-space segment clipped to z <= -near; null when behind the camera
    const n = -P.near * 1.5; if (a[2] > n && b[2] > n) return null; if (a[2] > n) { const t = (n - a[2]) / (b[2] - a[2]); a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, n]; } else if (b[2] > n) { const t = (n - b[2]) / (a[2] - b[2]); b = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, n]; } return [P.s(a), P.s(b)];
  }
  function clipPoly(P, poly) {                                                          // Sutherland-Hodgman against the near plane
    const n = -P.near * 1.5, out = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], ia = a[2] <= n, ib = b[2] <= n; if (ia) out.push(a); if (ia !== ib) { const t = (n - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, n]); } } return out;
  }
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]], FACES = [[1, 3, 7, 5], [0, 2, 6, 4], [2, 3, 7, 6], [0, 1, 5, 4], [4, 5, 7, 6], [0, 1, 3, 2]];
  function pathSegs(g, P, segs) { for (const [a, b] of segs) { const s = clipSeg(P, a, b); if (s) { g.moveTo(s[0][0], s[0][1]); g.lineTo(s[1][0], s[1][1]); } } }
  function shapeSegs(P, sh) {                                                           // -> {segs (view space pairs), fills (view-space polygons)} for one shape
    const segs = [], fills = [], V = (q) => P.v(q[0], q[1], q[2]);
    if (sh.t === "obb") { const cs = corners(sh.o), vs = cs.map(V); for (const [i, j] of EDGES) segs.push([vs[i], vs[j]]);
      if (sh.strong) { const R = rot9(sh.o[6], sh.o[7]), nrm = [[R[0], R[3], R[6]], [-R[0], -R[3], -R[6]], [R[1], R[4], R[7]], [-R[1], -R[4], -R[7]], [R[2], R[5], R[8]], [-R[2], -R[5], -R[8]]], hh = [sh.o[3], sh.o[3], sh.o[4], sh.o[4], sh.o[5], sh.o[5]];
        for (let f = 0; f < 6; f++) { const c = [sh.o[0] + nrm[f][0] * hh[f], sh.o[1] + nrm[f][1] * hh[f], sh.o[2] + nrm[f][2] * hh[f]]; if ((P.cp[0] - c[0]) * nrm[f][0] + (P.cp[1] - c[1]) * nrm[f][1] + (P.cp[2] - c[2]) * nrm[f][2] > 0) fills.push(FACES[f].map((i) => vs[i])); } } }
    else if (sh.t === "cyl") { const N = 20, z0 = sh.z0, z1 = sh.z1, ring = (z) => { const o = []; for (let i = 0; i < N; i++) { const a = (i / N) * 6.2832; o.push(V([sh.c[0] + sh.r * Math.cos(a), sh.c[1] + sh.r * Math.sin(a), z])); } return o; }, a = ring(z0), b = ring(z1);
      for (let i = 0; i < N; i++) { segs.push([a[i], a[(i + 1) % N]]); segs.push([b[i], b[(i + 1) % N]]); } for (let i = 0; i < N; i += N / 4) segs.push([a[i], b[i]]); }
    else if (sh.t === "ell") { const N = 28, c = sh.c, ring = (f) => { const o = []; for (let i = 0; i < N; i++) { const a = (i / N) * 6.2832, ca = Math.cos(a), sa = Math.sin(a); o.push(V(f(ca, sa))); } return o; };
      for (const r of [ring((ca, sa) => [c[0] + sh.rx * ca, c[1] + sh.rx * sa, c[2]]), ring((ca, sa) => [c[0] + sh.rx * ca, c[1], c[2] + sh.rz * sa]), ring((ca, sa) => [c[0], c[1] + sh.rx * ca, c[2] + sh.rz * sa])]) for (let i = 0; i < N; i++) segs.push([r[i], r[(i + 1) % N]]); }
    else if (sh.t === "poly") { const vs = sh.pts.map(V); for (let i = 0; i < vs.length; i++) segs.push([vs[i], vs[(i + 1) % vs.length]]); if (sh.strong && !sh.flat) fills.push(vs); }
    else if (sh.t === "ring") { const N = 24, o = []; for (let i = 0; i < N; i++) { const a = (i / N) * 6.2832; o.push(V([sh.c[0] + sh.r * Math.cos(a), sh.c[1] + sh.r * Math.sin(a), sh.c[2] + 0.02])); } for (let i = 0; i < N; i++) segs.push([o[i], o[(i + 1) % N]]);
      for (const [dx, dy] of [[0.2, 0], [0, 0.2]]) segs.push([V([sh.c[0] - dx, sh.c[1] - dy, sh.c[2] + 0.02]), V([sh.c[0] + dx, sh.c[1] + dy, sh.c[2] + 0.02])]); }
    return { segs, fills };
  }
  function drawArrow(g, P, sh, rgb) {                                                   // front arrow: from the middle of the object out through its front, tip labelled 前
    const a = P.v(sh.a[0], sh.a[1], sh.a[2]), b = P.v(sh.b[0], sh.b[1], sh.b[2]), sg = clipSeg(P, a, b); if (!sg) return; const [p0, p1] = sg, dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy); if (L < 3) return;
    const ux = dx / L, uy = dy / L, hl = Math.min(11, L * 0.5), cw = [Math.cos(0.45), Math.sin(0.45)], tip = b[2] <= -P.near * 1.5;
    g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]);
    if (tip) for (const sgn of [1, -1]) { g.moveTo(p1[0], p1[1]); g.lineTo(p1[0] - hl * (ux * cw[0] - sgn * uy * cw[1]), p1[1] - hl * (uy * cw[0] + sgn * ux * cw[1])); }
    g.strokeStyle = "rgba(0,0,0,0.65)"; g.lineWidth = 5; g.stroke(); g.strokeStyle = `rgb(${rgb})`; g.lineWidth = 2.4; g.stroke();
    if (tip && sh.text) { g.font = "700 13px 'PingFang SC','Source Sans 3',sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; const tx = p1[0] + ux * 12, ty = p1[1] + uy * 12; g.lineWidth = 3.5; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(sh.text, tx, ty); g.fillStyle = `rgb(${rgb})`; g.fillText(sh.text, tx, ty); g.textAlign = "start"; }
  }
  const COL = { live: "255,210,74", pin: "125,211,252" };
  function drawHighlight(g, P, T, pinned, w, h) {
    const rgb = pinned ? COL.pin : COL.live; let label = null; P.bb = [1e9, 1e9, -1e9, -1e9]; const shapes = T.shapes().slice().sort((a, b) => (a.strong ? 1 : 0) - (b.strong ? 1 : 0));          // thin outlines first: the strong outline stays on top where the two nearly coincide
    for (const sh of shapes) {
      if (sh.t === "arrow") { drawArrow(g, P, sh, rgb); continue; }
      const { segs, fills } = shapeSegs(P, sh); g.lineJoin = "round"; g.lineCap = "round";
      if (fills.length) { g.beginPath(); for (const poly of fills) { const c = clipPoly(P, poly); if (c.length < 3) continue; c.forEach((q, i) => { const s = P.s(q); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }); g.closePath(); } g.fillStyle = `rgba(${rgb},0.10)`; g.fill(); }
      g.beginPath(); pathSegs(g, P, segs); if (sh.strong) { g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 4.4; g.stroke(); g.strokeStyle = `rgb(${rgb})`; g.lineWidth = 2; g.stroke(); } else { g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 2.6; g.stroke(); g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 1; g.stroke(); }
      if (sh.label) label = true;
    }
    if (P.bb[2] > P.bb[0] && label) {                                                   // name tag at the top-left of what is drawn
      const text = `${T.name}${T.dist != null ? " · " + f1(distTo(T, P), 1) + " m" : ""}`; g.font = "600 12px 'Source Sans 3','PingFang SC',sans-serif"; const tw = g.measureText(text).width + 12, x = Math.max(4, Math.min(w - tw - 4, P.bb[0])), y = Math.max(18, Math.min(h - 8, P.bb[1] - 6));
      g.fillStyle = "rgba(10,16,20,0.82)"; g.beginPath(); g.roundRect ? g.roundRect(x, y - 15, tw, 19, 9) : g.rect(x, y - 15, tw, 19); g.fill(); g.strokeStyle = `rgb(${rgb})`; g.lineWidth = 1; g.stroke(); g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(text, x + 6, y - 5);
      if (pinned) { g.fillStyle = `rgb(${rgb})`; g.beginPath(); g.arc(x - 1, y - 5, 3.2, 0, 6.3); g.fill(); }
    }
  }
  const distTo = (T, P) => { const c = T.center(); return Math.hypot(c[0] - P.cp[0], c[1] - P.cp[1], c[2] - P.cp[2]); };
  function drawCross(g, w, h, hot) {
    const x = w / 2, y = h / 2, c = hot ? "rgb(255,210,74)" : "rgba(255,255,255,0.85)"; g.lineCap = "round";
    for (const [a, b, c2, d] of [[x - 15, y, x - 5, y], [x + 5, y, x + 15, y], [x, y - 15, x, y - 5], [x, y + 5, x, y + 15]]) { g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 4; g.stroke(); g.strokeStyle = c; g.lineWidth = 1.8; g.stroke(); }
    g.beginPath(); g.arc(x, y, 1.8, 0, 6.3); g.fillStyle = c; g.fill();
  }

  /* ================================================================ HUD: card, chip, key ================================================================ */
  const st = { on: false, pin: null, cur: null, keyCur: "", lastSeen: 0, html: "", err: 0, hint: null, tCard: 0, pickMs: 0, nPick: 0, o: null, d: null, frameMs: 0, frameMax: 0, nFrames: 0 };
  let dom = null;
  function ensureDom() {
    if (dom) return dom; const hud = $("#fphud"); if (!hud) return null;
    const cv = document.createElement("canvas"); cv.id = "fp-insp-fx"; hud.insertBefore(cv, hud.firstChild);
    const card = document.createElement("section"); card.id = "fp-insp"; card.className = "fp-panel insp"; card.hidden = true; hud.appendChild(card);
    const box = $(".fp-acts"); let chip = $("#fp-inspect"); if (box && !chip) { chip = document.createElement("button"); chip.type = "button"; chip.className = "btn chip-insp"; chip.id = "fp-inspect"; chip.textContent = "🔍 Inspect (I)"; chip.title = "I key: inspect mode. What the crosshair points at is highlighted, and the card shows its material, mass, sound-insulation / RF / LiDAR values and whether each identity can pass; right-click any object to pin it"; chip.addEventListener("click", () => { chip.blur(); toggle(); }); box.insertBefore(chip, box.querySelector("label")); }
    const cvs = $("#v3d"); if (cvs && !cvs._inspCtx) { cvs._inspCtx = 1; cvs.addEventListener("contextmenu", onContext); }
    fx.cv = cv; fx.g = cv.getContext("2d"); dom = { cv, card, chip }; return dom;
  }
  const HINT_ON = "Inspect mode: aim the crosshair at an object to see its properties · right-click any object to pin / unpin · press I to leave";
  function setHint(on) { const h = $("#fp-hint"); if (!h) return; if (on) { if (st.hint === null) st.hint = h.textContent; h.textContent = HINT_ON; } else if (st.hint !== null) { h.textContent = st.hint; st.hint = null; } }
  function toggle(on) {
    const want = on === undefined ? !st.on : !!on; if (want === st.on) return st.on; if (!ensureDom()) return false;
    st.on = want; if (!want) { st.pin = null; st.cur = null; st.keyCur = ""; clearFx(); dom.card.hidden = true; const c = $("#v3d"); if (c) c.style.cursor = "grab"; } else { loadCat(); loadPeople(); const c = $("#v3d"); if (c) c.style.cursor = "crosshair"; }
    if (dom.chip) { dom.chip.classList.toggle("on", st.on); dom.chip.setAttribute("aria-pressed", st.on); } setHint(st.on); toast(st.on ? "Inspect mode: the object under the crosshair is highlighted and described (right-click to pin)" : "Inspect mode off"); return st.on;
  }
  const toast = (m) => { const t = $("#fp-toast"); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1600); };
  function clearFx() { if (fx.g) fx.g.clearRect(0, 0, fx.cv.width, fx.cv.height); }
  function sizeFx() {
    const hud = $("#fphud"), w = hud.clientWidth, h = hud.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1); if (w !== fx.w || h !== fx.h || dpr !== fx.dpr) { fx.w = w; fx.h = h; fx.dpr = dpr; fx.cv.width = Math.round(w * dpr); fx.cv.height = Math.round(h * dpr); }
    fx.g.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0); return [w, h];
  }
  function cardHtml(c) {
    const rowH = (r) => `<div class="ir${r.cls ? " " + r.cls : ""}"${r.tip ? ` title="${E(r.tip)}"` : ""}><span class="k">${E(r.k)}</span><span class="v">${r.v}</span></div>`;
    const secH = (s) => (s && (s.rows.length || s.html) ? `<div class="isec"><h5>${E(s.h)}</h5>${s.rows.map(rowH).join("")}${s.html || ""}</div>` : "");
    return `<header class="ih"><span class="ico">${c.icon}</span><div class="tt"><b>${E(c.title)}${c.part ? `<span class="part">${E(c.part)}</span>` : ""}${c.chips || ""}</b><small>${E(c.sub)}</small></div><div class="dd"><span>${f1(c.dist, 1)} m</span>${st.pin ? `<em class="pinned">Pinned</em>` : ""}</div></header><div class="ib">${c.cols.flat().map(secH).join("")}</div>${st.pin ? `<footer class="if">Right-click again (or press I) to unpin</footer>` : ""}`;
  }
  function showCard(T, force) {
    if (!dom) return; const now = performance.now(); if (!force && st.shown && st.shown.key === T.key && now - st.tCard < 250) { st.shown = T; return; }
    let spec; try { spec = T.card(); } catch (e) { if (st.err++ < 5) console.error("inspector card", e); return; }
    if (T.o && T.hit && Number.isFinite(T.hit.x) && T.kind !== "agent") spec.dist = Math.hypot(T.hit.x - T.o[0], T.hit.y - T.o[1], T.hit.z - T.o[2]);       // distance eye -> hit point (also while pinned and walking around)
    st.shown = T; st.tCard = now; const html = cardHtml(spec); if (html !== st.html) { st.html = html; dom.card.innerHTML = html; } dom.card.hidden = false; st.spec = spec;
  }
  function onContext(e) {
    e.preventDefault(); const V = VV(); if (!V || !ES.ray) return; if (!ensureDom()) return; if (!st.on) toggle(true); ensureScene();
    const r = e.currentTarget.getBoundingClientRect(), nd = [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1], v = new THREE.Vector3(nd[0], nd[1], 0.5).unproject(V.cam), p = V.cam.position, d = [v.x - p.x, -(v.z - p.z), v.y - p.y], L = Math.hypot(d[0], d[1], d[2]) || 1;
    const o = [p.x, -p.z, p.y], T = pick(o, [d[0] / L, d[1] / L, d[2] / L]); if (st.pin && (!T || T.key === st.pin.key)) { st.pin = null; toast("Unpinned"); return; } if (!T) { toast("Nothing under the crosshair"); return; }
    st.pin = T; st.html = ""; showCard(T, true); toast("Pinned: " + (T.name || ""));
  }
  function centreRay(V) {
    const cam = V.cam; cam.updateMatrixWorld(true); const p = cam.position, q = cam.getWorldDirection(centreRay.v || (centreRay.v = new THREE.Vector3()));
    return [[p.x, -p.z, p.y], [q.x, -q.z, q.y]];
  }
  function frame(dt, now, WALK, V) {
    if (!st.on || !dom || !WALK.active) return; const tf0 = performance.now();
    try {
      if (!ensureScene()) return; const [w, h] = sizeFx(), g = fx.g; g.clearRect(0, 0, w, h);
      const P = projector(V, w, h); let T = st.pin;
      if (T) T.o = centreRay(V)[0];
      else {
        const [o, d] = centreRay(V), t0 = performance.now(); T = pick(o, d); st.pickMs += performance.now() - t0; st.nPick++; st.o = o; st.d = d;
        if (T && st.cur && st.cur.key === T.key && st.cur.catLoaded === T.catLoaded) { st.cur.hit = T.hit; st.cur.dist = T.dist; st.cur.o = T.o; T = st.cur; }       // same object as last frame: keep the cached target (and its card)
        if (T) { st.lastSeen = now; st.cur = T; } else if (st.cur && now - st.lastSeen > 450) st.cur = null;
      }
      const shown = T || (st.cur && now - st.lastSeen <= 450 ? st.cur : null);
      if (shown) { drawHighlight(g, P, shown, !!st.pin, w, h); showCard(shown, false); } else if (!dom.card.hidden) { dom.card.hidden = true; st.shown = null; st.html = ""; }
      drawCross(g, w, h, !!shown && !st.pin);
    } catch (e) { if (st.err++ < 5) console.error("inspector frame", e); }
    const ms = performance.now() - tf0; st.frameMs += (ms - st.frameMs) * 0.05; st.frameMax = Math.max(st.frameMax * 0.995, ms); st.nFrames++;
  }
  function registerKeys() {
    if (registerKeys.done || !ES.controls) return; registerKeys.done = true;
    ES.controls.add({ bodies: "all", group: "Action", keys: ["I"], codes: ["KeyI"], desc: "Inspect · right-click to pin", fn: (code, down) => { if (down) toggle(); } });
  }
  registerKeys();
  ES.bus.on("ready", () => { registerKeys(); loadCat(); });
  ES.bus.on("walk:enter", () => { ensureDom(); loadCat(); loadPeople(); if (dom && dom.chip) dom.chip.classList.toggle("on", st.on); });
  ES.bus.on("walk:exit", () => { if (st.on) toggle(false); st.hint = null; });
  ES.bus.on("walk:frame", frame);
  ES.bus.on("fpbody", () => { if (st.on) { st.hint = null; setHint(true); } });
  ES.bus.on("scene:built", () => { S.scene = null; st.pin = null; st.cur = null; st.shown = null; st.html = ""; });

  /* ================================================================ API (also used by the tests) ================================================================ */
  /* viewTo(center, opt): find an eye position around `center` from which pick() returns the same object; opt {key | match(T) -> bool, radii, z} */
  function viewTo(center, match, opt) {
    opt = opt || {}; const radii = opt.radii || [1.6, 2.4, 3.4, 5, 7, 10, 14], zs = opt.zs || [1.4, 1.0, 0.6, 2.2, 3.5, 1.8];
    for (const R of radii) for (const dz of zs) for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.2832, o = [center[0] + R * Math.cos(a), center[1] + R * Math.sin(a), (opt.absZ != null ? opt.absZ : center[2]) + (opt.absZ != null ? 0 : dz - 0.7)], d = [center[0] - o[0], center[1] - o[1], center[2] - o[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, dd = [d[0] / L, d[1] / L, d[2] / L], T = pick(o, dd, { ignore: null }); if (T && match(T)) return { o, d: dd, T }; }
    return null;
  }
  Object.assign(INS, {
    toggle, pick, state: st, ensureScene, viewTo, boxPhysics, frame, physOf: (bid, j) => { ensureScene(); const B = S.bim.buildings[bid], r = B.boxes[j], p = boxPose(bid, B, j, r); return boxPhysics({ bid, B, j, it: itemOf(bid, j), hit: { x: p[0], y: p[1], z: p[2] } }); }, scene: S, loadCat, catalog: () => CAT, targetCard: (T) => T.card(), cardHtml, centreRay, items: (type) => { ensureScene(); const out = []; if (S.bim) for (const [bid, B] of Object.entries(S.bim.buildings)) for (const it of B.items || []) if (it.t === type) out.push({ bid, it, B }); return out; },
    itemCenter: (bid, it) => { const B = S.bim.buildings[bid], q = itemObb(bid, B, it); return q ? [q[0], q[1], q[2]] : it.p ? [it.p[0], it.p[1], it.p[2] + 0.5] : null; },
    debug: () => ({ on: st.on, pinned: st.pin && st.pin.key, cur: st.cur && st.cur.key, shown: st.shown && st.shown.key, name: st.shown && st.shown.name, pickMsAvg: st.nPick ? st.pickMs / st.nPick : 0, picks: st.nPick, errors: st.err, ordOK: S.ordOK, cat: !!CAT, frameMs: st.frameMs, frameMax: st.frameMax, frames: st.nFrames }),
  });
})();
