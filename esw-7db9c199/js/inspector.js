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
  const compass = (yaw) => { const hd = Math.round((((90 - yaw * R2D) % 360) + 360) % 360) % 360; return [hd, ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][Math.round(hd / 45) % 8]]; };

  /* ================================================================ Chinese names ================================================================ */
  const ELEM_ZH = { wall_ext: "外墙", wall_int: "内墙", slab: "楼板", ceiling: "天花板", roof: "屋顶", glass: "玻璃", frame: "框", door: "门扇", stair: "楼梯", furniture: "家具", column: "柱", step: "台阶", trim: "饰条", appliance: "电器", rack: "货架", machine: "机器", light: "灯具", treat: "窗帘 / 百叶", rail: "栏杆", parapet: "女儿墙", chimney: "烟囱", ramp: "坡道", fixture: "洁具 / 固定设施", pallet: "托盘", plant: "植物", deco: "装饰" };
  const CAT_ZH = { structure: "建筑结构", opening: "门窗洞口", furniture: "家具", appliance: "电器", fixture: "固定设施", light: "灯具", equipment: "设备", circulation: "通行构件", decor: "陈设", trim: "饰条", signage: "标识" };
  const BKIND_ZH = { house: "住宅", commercial: "商铺", apartment: "公寓楼", campus: "校舍", warehouse: "仓库", factory: "厂房", rowhouse: "联排住宅", office: "办公楼", civic: "公共建筑", cottage: "小屋" };
  const ROOM_ZH = { bedroom: "卧室", bath: "卫生间", living: "客厅", kitchen: "厨房", landing: "楼梯平台", office: "办公室", void: "楼梯井", classroom: "教室", core: "楼电梯核心筒", restroom: "公共卫生间", corridor: "走廊", stair: "楼梯间", lab: "实验室", meeting: "会议室", entry: "玄关", utility: "设备间", shop: "店面", storage: "库房", hall: "门厅", lobby: "大堂", dining: "餐厅", study: "书房", hall_big: "大厅", family: "家庭室", workshop: "车间", control: "控制室" };
  const MAT_ZH = { none: "无", brick: "砖", brick_brown: "棕色砖", concrete: "混凝土", concrete_light: "浅色混凝土", concrete_dark: "深色混凝土", polished_concrete: "磨光混凝土", stucco: "抹灰", stucco_white: "白色抹灰", stucco_peach: "桃色抹灰", siding: "外墙挂板", siding_blue: "蓝色挂板", siding_sage: "灰绿挂板", metal_panel: "金属墙板",
    curtain_glass: "幕墙玻璃", glass: "玻璃", glass_frosted: "磨砂玻璃", frame_white: "白色框料", frame_dark: "深色框料", gypsum: "石膏板", gypsum_accent: "彩色石膏板", wood_floor: "木地板", carpet: "地毯", tile: "瓷砖", ceiling: "吊顶板", door_wood: "木门板", door_metal: "钢门板",
    roof_shingle: "沥青瓦", roof_tile: "屋面瓦", roof_metal: "金属屋面", roof_membrane: "屋面防水膜", asphalt_shingle_dark: "深色沥青瓦", wood_furn: "家具木材", metal_furn: "家具钢", appliance: "电器面板", steel: "钢", rack_blue: "蓝色货架漆", rack_orange: "橙色货架漆", cardboard: "纸板", pallet: "托盘木",
    machine_green: "绿色机器漆", machine_yellow: "黄色机器漆", whiteboard: "白板", screen: "屏幕(关)", screen_on: "屏幕(亮)", ceramic: "陶瓷", countertop: "台面石材", curtain: "窗帘布", blinds: "百叶", stair_wood: "木楼梯", stair_concrete: "混凝土楼梯", rail: "栏杆钢", grating: "钢格栅",
    light: "灯具发光面", light_off: "灯具(关)", rubber: "橡胶", rubber_grey: "灰色橡胶", paper: "纸", plant: "植物", plant_dark: "深色植物", counter_wood: "木台面", lockers: "储物柜钢板", leather: "皮革", leather_black: "黑皮革", blanket: "毯子", cork: "软木", foam: "海绵", mirror: "镜子", porcelain: "瓷", tile_wall: "墙砖",
    tile_dark: "深色瓷砖", marble: "大理石", granite: "花岗岩", quartz: "石英石", terracotta: "赤陶", soil: "土壤", wicker: "藤编", floor_vinyl: "乙烯基地板", chrome_steel: "镀铬钢", brass_metal: "黄铜", dark_steel: "深色钢", black_metal: "黑色金属", stainless_steel: "不锈钢", galv_steel: "镀锌钢",
    alu_white_metal: "白色铝材", alu_brown_metal: "棕色铝材",
    asphalt: "柏油路面", road_paint: "道路标线", sidewalk: "人行道", grass: "草地", gravel: "碎石", water: "水面", bark: "树皮", foliage: "树叶", car_paint: "车漆", car_glass: "车窗玻璃", person: "人体(衣物)", fence_white: "白漆木栅", fence_wood: "木板围栏", fence_chain: "镀锌铁丝网", pole_metal: "钢杆", building_generic: "建筑外墙(简化)", rubble: "瓦砾", container: "集装箱钢板", shed: "棚屋木板", plastic: "塑料", uav_body: "无人机机身", dog_body: "机械狗机身", rover_body: "机器人外壳", cp_body: "指挥车车身" };
  function matZh(n) {
    if (MAT_ZH[n]) return MAT_ZH[n]; if (!n) return "—";
    const col = { white: "白", grey: "灰", blue: "蓝", green: "绿", red: "红", yellow: "黄", black: "黑", cream: "米色", peach: "桃色", purple: "紫", teal: "青", orange: "橙", pink: "粉", brown: "棕", oak: "橡木", walnut: "胡桃木" };
    let m = /^(plastic|paint|laminate|wood|pc|fabric|bedding|cloth|awning|emit)_?(\w*)$/.exec(n);
    if (m) { const fam = { plastic: "塑料", paint: "墙漆", laminate: "层压板", wood: "木材", pc: "包装印刷品", fabric: "织物", bedding: "床品", cloth: "衣料", awning: "遮阳篷布", emit: "发光面" }[m[1]], c = col[m[2]] || ""; return fam + (c ? "·" + c : ""); }
    return n;
  }
  const PART_ZH = { leg: "腿", handle: "把手", baseboard: "踢脚线", product: "商品", ext: "外墙段", label: "标签", books: "书", part: "隔墙段", top: "台面", carton: "纸箱", back: "靠背 / 背板", seat: "座面", light: "灯", book_rack: "书架", foot: "脚", pallet_stringer: "托盘纵梁", price_tag: "价签", board: "搁板", brace: "拉撑", step: "踏步", canopy: "雨篷", nosing: "踏步边", drawer: "抽屉", carcass: "柜体", vents: "通风口", frame: "框", plinth: "底座", beam: "横梁", knob: "旋钮", shelf: "搁板", armrest: "扶手", post: "立柱", pallet_deck: "托盘面", worktop: "工作台面", screen: "屏幕", pillow: "枕头", upright: "立柱", seat_cushion: "座垫", back_cushion: "靠垫", ceiling: "天花板", toe_kick: "踢脚板", pedestal: "台座", base: "底座", side: "侧板", side_panel: "侧板", mirror: "镜子", mirror_frame: "镜框", plant: "植物", monitor: "显示器", keyboard: "键盘", cistern: "水箱", bowl: "便盆", seat_lid: "马桶圈 / 盖", mattress: "床垫", headboard: "床头板", footboard: "床尾板", duvet: "被子", blanket: "毯子", pot: "花盆", slat: "板条", body: "机身", freezer_door: "冷冻室门", fridge_door: "冷藏室门", backsplash: "挡水板", wall_cabinet: "吊柜", tv: "电视", cabinet: "柜", console: "台", parapet: "女儿墙", tub_wall: "浴缸壁", tub_floor: "浴缸底", basin: "水盆", lamp_base: "灯座", lamp_shade: "灯罩", tray: "托盘", stoop: "入口台阶", gutter: "檐沟", plate: "牌", housing: "灯壳", pad: "基座", top_vent: "顶部通风口" };
  Object.assign(PART_ZH, { door: "门扇", basin_wall: "盆壁", price_rail: "价签条", textbook: "课本", bottle: "瓶子", support_bar: "支撑杆", base_bar: "底杆", wrap_band: "缠绕带", tap_spout: "龙头出水口", bin: "箱", arm: "扶手臂", arm_cap: "扶手端", cup: "杯", basin_floor: "盆底", tap_base: "龙头座", tap_neck: "龙头颈", drain: "排水口", beam_label: "横梁标签", lift: "举升", ornament: "摆件", awning: "遮阳篷", valance: "帷幔", lettering: "字牌", garment: "衣物", modesty_panel: "挡板", marker: "记号笔", stand_base: "支架底座", stand_neck: "支架杆", mouse: "鼠标", phone: "电话", cistern_lid: "水箱盖", flush_button: "冲水钮", hinge_block: "铰链块", soap: "肥皂", papers: "纸张", headboard_pad: "床头软垫", duvet_fold: "被褥折边", wrapped_load: "缠膜货物", crown: "顶冠", screen_trim: "屏幕边框", apron: "前裙板", magazine: "杂志", digit: "数字", door_gap: "门缝", tap_lever: "龙头手柄", dish_soap: "洗洁精", spine: "书脊", cap: "盖", lamp_stem: "灯杆", brace_low: "下拉撑", flask: "烧瓶", guard: "护罩", louvre: "百叶", cushion: "软垫", soap_dispenser: "皂液器", notepad: "便签本", leg_frame: "腿架", mug: "马克杯", top_edge: "顶边", neck: "颈", back_post: "靠背立柱", eraser: "板擦", foliage: "叶片", tub_basin: "浴缸盆", tap_body: "龙头体", shower_riser: "淋浴立管", shower_head: "花洒", shower_arm: "花洒臂", hazard_stripe: "警示条纹", vase: "花瓶", rod: "吊杆", screen_case: "屏幕外壳", notebook: "笔记本", downspout: "落水管", stretcher: "撑杆", fan_grille: "风扇格栅", reagent_shelf: "试剂架", sink: "水槽", tap: "水龙头", back_panel: "背板", seat_frame: "座椅框", glass: "玻璃", elbow: "弯头", laptop_base: "笔记本机身", laptop_lid: "笔记本屏", reflector: "反光片", handrail: "扶手", trestle: "支架", table_leg: "桌腿", hvac: "空调", flowers: "花", tower_lamp: "信号塔灯", membrane: "防水膜", rail: "栏杆", burner: "灶眼", burner_cap: "灶眼盖", guard_slat: "护栏板条", backrest_bar: "靠背横杆", lamp: "灯", casing: "外壳", line_set: "管线", jug: "水壶", front_panel: "前面板", guard_post: "护栏立柱", tyre: "轮胎", cross_brace: "交叉撑", guard_rail: "护栏", oven_handle_post: "烤箱把手柱", fruit_bowl: "果盘", hood: "抽油烟机罩", ramp: "坡道", ramp_end: "坡道端", soil: "土", carton_on_belt: "传送带上的纸箱", mast: "门架", fork: "货叉", fork_heel: "货叉根", headlight: "前灯", enclosure: "机罩", top_cabinet: "上柜", door_frame: "门框", door_window: "门窗", door_handle: "门把手", hmi_arm: "操作屏支臂", hmi_pod: "操作屏箱", hmi_screen: "操作屏", estop: "急停按钮", tower_pole: "信号塔杆", cable_duct: "线槽", penthouse: "屋顶设备间", sensor_post: "传感器立柱", sensor_lens: "传感器镜头", chimney: "烟囱", chimney_cap: "烟囱帽", chimney_pot: "烟囱管", hob: "灶台", oven_window: "烤箱窗", oven_door: "烤箱门", oven_handle: "烤箱把手", flue: "烟道", hood_filter: "油烟滤网", low_ceiling: "低吊顶", kick: "踢脚", inner_top: "内顶", bell: "铃", chassis: "底盘", counterweight: "配重", seat_back: "座椅靠背", steering_column: "转向柱", steering_wheel: "方向盘", beacon: "警示灯", carriage: "滑架", side_frame: "侧框", drum: "滚筒", bed: "床体", belt: "传送带", drive_motor: "驱动电机" });
  const partZh = (t) => PART_ZH[t] || (/^floor_/.test(t) ? "地板" : /^ext\d+$/.test(t) ? "外墙段" : /^(door|win)_\d+$/.test(t) ? "" : t);
  function partName(cat, it, elem, tag) {                                              // what the picked box is: leaf / frame / pane of a door or window, else the part name from the tag
    if (cat && (cat.cat === "structure" || cat.cat === "trim")) return ""; const win = it && /^window/.test(it.t), t = partZh(tag);
    if (cat && cat.cat === "opening") return { frame: win ? "窗框" : "门框", glass: "窗玻璃", door: "门扇", fixture: "五金(把手 / 合页)", trim: "饰条", treat: "窗帘 / 百叶" }[elem] || t || ELEM_ZH[elem] || "";
    return t || ELEM_ZH[elem] || "";
  }
  const FENCE_ZH = { picket: "木栅栏(尖桩)", privacy: "隐私木板围栏", chain: "铁丝网围栏" };
  const OBJ_ZH = { shed: "棚屋", container: "集装箱", bins: "垃圾桶(两只)", mailbox: "信箱", hoop: "篮球架", tank: "储罐", chimney: "烟囱", playground: "游乐设施" };
  const VEH_ZH = { sedan: "轿车", hatchback: "两厢车", suv: "SUV", van: "厢式面包车", box_truck: "厢式货车", taxi: "出租车", police: "警车", pickup: "皮卡", ambulance: "救护车", fire_truck: "消防车", truck: "货车", bus: "公交车" };
  /* typical kerb mass by vehicle type (public vehicle data, mid-range of the class; NOT project data: the scene only carries the outer dimensions) */
  const VEH_KG = { sedan: 1500, hatchback: 1300, suv: 1800, van: 2400, box_truck: 5000, taxi: 1500, police: 1900, pickup: 2100, ambulance: 3200, fire_truck: 12000 };
  const SPECIES_ZH = { maple: "枫树", locust: "刺槐", oak: "橡树", pear: "梨树", birch: "桦树", linden: "椴树", poplar: "杨树", spruce: "云杉", pine: "松树" };
  const KIND_TREE_ZH = { round: "圆冠阔叶树", tall: "高大阔叶树", conifer: "针叶树" };
  const EMB = { human: ["🚶", "人", "人"], dog: ["🐕", "机械狗", "机械狗"], rover: ["🤖", "轮式", "轮式机器人"], uav: ["🚁", "无人机", "无人机"] };
  const ROLE_ZH = { walk: "步行", stand: "站立", wave: "挥手示意(求助)", lie: "躺卧(倒地)", self: "你自己" };

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
  const frontArrow = (x, y, z, fx, fy, len) => ({ t: "arrow", a: [x, y, z], b: [x + fx * len, y + fy * len, z], strong: true, text: "前" });
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
    const T = { kind: "bim", key: `bim:${bid}:${j}:${face}`, hit, bid, B, j, r, it, cat, pose, face, partMode, catLoaded: !!CAT, name: cat ? cat.zh : ELEM_ZH[S.elemName[r[14]]] || S.elemName[r[14]], icon: iconOf(cat, S.elemName[r[14]]) };
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
  const surfAxis = (n) => (Math.abs(n[2]) >= Math.abs(n[0]) && Math.abs(n[2]) >= Math.abs(n[1]) ? (n[2] > 0 ? "朝上" : "朝下") : Math.abs(n[0]) >= Math.abs(n[1]) ? (n[0] > 0 ? "朝东" : "朝西") : n[1] > 0 ? "朝北" : "朝南");
  function faceNormals(p) { const R = rot9(p[6], p[7]); return [[R[0], R[3], R[6]], [-R[0], -R[3], -R[6]], [R[1], R[4], R[7]], [-R[1], -R[4], -R[7]], [R[2], R[5], R[8]], [-R[2], -R[5], -R[8]]]; }

  function bimCard(T) {
    const { bid, B, j, r, it, cat, hit, face } = T, bim = S.bim, mats = bim.materials, RAY = ES.ray, pose = boxPose(bid, B, j, r), elem = S.elemName[r[14]], flags = r[15], sx = r[3], sy = r[4], sz = r[5];
    const rooms = B.rooms || [], room = rooms.find((q) => q.id === r[17]) || null, storey = r[16];
    const roomTxt = room ? `${ROOM_ZH[room.fn] || room.name}${room.area ? ` ${f1(room.area, 0)} m²` : ""}` : "室外 / 无房间";
    const name = cat ? cat.zh : ELEM_ZH[elem] || elem, part = partName(cat, it, elem, B.tags[j]);
    T.name = name; const sub = `${bid} ${BKIND_ZH[B.kind] || B.kind}(${B.label}) · 第 ${storey + 1} 层 · ${roomTxt}`;
    // ---- shape and mass
    const dims = it && it.sz ? it.sz : null, V = sx * sy * sz, thick = Math.min(sx, sy, sz), solid = !!(flags & FL.PHYS), detail = !!(flags & FL.DETAIL);
    const rowsShape = [];
    if (dims) rowsShape.push(row("整件尺寸", `${f1(dims[0], 2)} × ${f1(dims[1], 2)} × ${f1(dims[2], 2)} m`, "宽 × 深 × 高(目录 items[].sz,地面以上)"));
    rowsShape.push(row(dims ? "这一块" : "尺寸", `${f1(sx, 2)} × ${f1(sy, 2)} × ${f1(sz, 2)} m`, "命中的这个盒子:BIM boxes[] 的局部尺寸 sx × sy × sz(z 向上);厚度 = 最薄边 " + f1(thick, 3) + " m"));
    if (it && it.m > 0) {
      let tipM = "目录质量 items[].m:家具 = 目录标称质量 × 尺寸比例(catalog.py annotate);建筑构件 = 体积 × 等效密度";
      if (MASS_FROM_BOXES.has(it.t) && !detail) {
        let vs = 0; for (let k = it.b[0]; k < it.b[1]; k++) { const q = B.boxes[k]; if (!(q[15] & FL.DETAIL) || it.t === "stair_flight") vs += q[3] * q[4] * q[5]; }
        const rho = vs > 0 ? it.m / vs : 0, mp = V * rho;
        rowsShape.push(row("质量", `这一块 ≈ ${big(mp)} kg · 整件 ${big(it.m)} kg`, `${tipM};这一块 = 体积 ${f1(V, 3)} m³ × 等效密度 ${big(rho)} kg/m³(整件 ${big(it.m)} kg ÷ 整件体积 ${f1(vs, 2)} m³ = 目录装配密度,不等于材料密度)`));
      } else rowsShape.push(row("质量", `${big(it.m)} kg${it.loose ? " · 可推动 / 搬动" : ""}`, tipM));
    } else if (solid) rowsShape.push(row("质量", `这一块 ≈ ${big(V * (RAY.matInfo(core(r)) || {}).rho)} kg`, `体积 ${f1(V, 3)} m³ × 材料密度(无目录质量时的估计)`));
    // ---- materials of the six faces + hit face
    const fn = faceNormals(pose), names = [0, 1, 2, 3, 4, 5].map((k) => (mats[r[8 + k]] || {}).name || "none"), chips = [0, 1, 2, 3, 4, 5].map((k) => ({ lab: surfAxis(fn[k]).slice(1), mat: names[k], rgb: (mats[r[8 + k]] || {}).rgb, hit: k === face }));
    const hitMat = RAY.matInfo(hit.mat) || {}, hitName = hitMat.name || names[face], bm = mats[hit.mat] || {};
    const rowsMat = [row("命中面", `${surfAxis(fn[face])}的面 · ${E(matZh(hitName))}`, `这条射线打到的面(${surfAxis(fn[face])}),材料 ${hitName};面材料 = BIM boxes[] 的 m+x m-x m+y m-y m+z m-z`)];
    const physRows = [];
    // ---- physics of the solid block (a DETAIL part rides on the item's solid block: take that one)
    const ph = boxPhysics(T), cm = ph ? ph.core : core(r), cmName = (mats[cm] || {}).name || "none";
    if (ph) {
      const pr = ph.r, tl = ph.tl, rf = ph.rf, thick = ph.thick, rhoBack = Number.isFinite(tl) && tl > 0.01 && tl < 59.99 && !ph.glassy ? Math.pow(10, (tl + 47) / 20) / (thick * 500) : NaN, via = ph.j !== j ? `;命中的是细节件,按它贴着的实心块(${partZh(B.tags[ph.j]) || ELEM_ZH[S.elemName[pr[14]]] || "实心块"})计` : "";
      physRows.push(row("密度 ρ", `${big((mats[cm] || {}).rho)} kg/m³ · ${E(matZh(ph.eff))}`, `材料表 rho(bim/materials.py);实心块的芯材 = ${cmName}${ph.eff !== cmName ? `,楼板 / 天花板按建筑类型换成 ${ph.eff}` : ""}(物理引擎用 +x 面材料作芯材)${via}`));
      physRows.push(row("隔声 TL", `${f1(tl, 1)} dB(500 Hz)${ph.glassy ? " · 双层 6/12/6 mm" : thick < 0.5 ? ` · 厚 ${f1(thick, 2)} m` : ""}`, `场入射质量定律 TL = 20·log10(ρ·t·f) − 47 dB,上限 60 dB;t = 最薄边 ${f1(thick, 3)} m,f = 500 Hz,ρ 取声学等效密度${Number.isFinite(rhoBack) ? `(反推 ≈ ${big(rhoBack)} kg/m³)` : ""};玻璃按 2×6 mm 并扣重合效应凹陷。ES.ray.soundTlFromCrossings = bim/physics.py sound_tl_db${via}`));
      physRows.push(row("射频损耗", `${f1(rf, 1)} dB(3.5 GHz)`, `ITU-R P.2040 多层平板传输矩阵,垂直入射、TE 极化,单块上限 45 dB;玻璃 = 6/12/6 mm 双层中空,石膏板隔墙 = 板/空气/板。ES.ray.rfLossFromCrossings = bim/physics.py rf_loss_db${via}`));
    } else physRows.push(row("射线 / 声学", detail ? "细节件:只参与外观和激光雷达,不参与射频、声学" : "不是实心块", "DETAIL 标志的盒子没有 PHYS:bim/physics.py 的 crossings 跳过它们"));
    const tmat = mats[r[10]] || mats[cm] || {}; physRows.push(row("可见光", `透射 ${f1(tmat.trans, 2)}${tmat.trans > 0 ? "" : "(不透光)"}`, `材料表 trans,取 +y 面材料 ${tmat.name || "—"}(与 physics.py light_transmission 相同);玻璃 0.85、窗帘 0.25、百叶 0.12`));
    physRows.push(row("激光雷达", `905 nm 反射率 ${f1(hitMat.refl, 2)}${hitMat.spec ? ` + 镜面 ${f1(hitMat.spec, 2)}` : ""}${hitMat.nir ? ` · 透射 ${f1(hitMat.nir, 2)}` : ""}`, `命中面材料 ${hitName} 在 ES.ray.REFL 的行:[漫反射率, 镜面瓣峰值, 近红外透射];表来自 scripts/esworld/sensors/lidar.py REFL_NAMED`));
    const mu = (CAT && CAT.materials[hitName]) || null, muT = cat && cat.mu_static; physRows.push(row("摩擦 μ", mu ? `静 ${f1(muT != null ? muT : mu.mu_static, 2)} / 动 ${f1(muT != null ? muT * 0.8 : mu.mu_kinetic, 2)}` : "—", "catalog.json:按材料族的干燥静摩擦系数(catalog.py MU),动摩擦 = 0.8 × 静摩擦;类型有自己的 mu_static 时用类型的", "lo"));
    if (bm.alpha != null) physRows.push(row("吸声 α", `${f1(bm.alpha, 2)}(500 Hz)`, "材料表 alpha:暴露面在 500 Hz 的随机入射吸声系数(房间声学)", "lo"));
    // ---- function / state
    const fnR = [], stR = [];
    if (cat) fnRows(cat, it).forEach(([k, v]) => fnR.push(row(k, E(v), `目录 catalog.json types["${it.t}"].functions(docs/bim-catalog.md);数值是类型的标称值`)));
    const dr = doorOf(T), mov = B.mov[j];
    if (dr && it) {
      const o = dr.open, isWin = /^win/.test(it.id) || cat && cat.cat === "opening" && /window/.test(it.t), ang = dr.mov && dr.mov.kind === "swing" ? ` · 开角 ${f1(Math.abs(o * dr.mov.angle) * R2D, 0)}°` : "";
      stR.push(row(isWin ? "窗扇" : "门", `${o < 0.05 ? "关着" : o > 0.95 ? "全开" : "半开"} · 开度 ${f1(o * 100, 0)}%${ang}`, `V.col.doors["${bid}/${B.tags[j]}"].open(0 关 … 1 全开);F 键开关最近的门窗`, o > 0.5 ? "ok" : ""));
      stR.push(row("锁", "未上锁(模型里没有门锁状态)", "BIM 的门 / 窗记录没有 locked 字段:任何人都可以直接开"));
    } else if (cat && /^window/.test(it.t)) { const w = (B.windows || []).find((q) => q.id === it.id); stR.push(row("窗扇", `固定窗 · ${w ? `玻璃 ${w.glass === "double" ? "双层中空 6/12/6" : w.glass}` : ""}`, "目录:fixed / frosted / ribbon / storefront / clerestory / picture 窗不可开")); }
    if (cat && cat.cat === "light" || cat && cat.emits && cat.emits.light) {
      const m = matchLight(B, it); if (m) { const on = ES.interior && ES.interior.lightOn ? ES.interior.lightOn(bid, m.k, m.L) : !!m.L.on; stR.push(row("灯", `${on ? "亮着" : "关着"} · ${big(m.L.lm)} lm · ${big(m.L.cct)} K`, `lights[] 记录 lm / cct(BIM)+ ES.interior.lightOn(房间开关 G 键、停电);${cat.emits && cat.emits.light && cat.emits.light.lm ? `目录典型光通量 ${big(cat.emits.light.lm)} lm` : ""}`, on ? "ok" : "")); }
      else if (cat.emits && cat.emits.light && cat.emits.light.lm) stR.push(row("灯", `${big(cat.emits.light.lm)} lm${cat.emits.light.cct ? ` · ${big(cat.emits.light.cct)} K` : ""}(目录)`, "目录 emits.light"));
    }
    if (it && /tv_unit/.test(it.t)) { let on = false; for (let k = it.b[0]; k < it.b[1]; k++) if (B.tags[k] === "screen" && (mats[B.boxes[k][8 + 4]] || {}).name === "screen_on") on = true; stR.push(row("电视", on ? "开着(屏幕发光)" : "关着", "屏幕盒子的材料:screen_on = 开,screen = 关", on ? "ok" : "")); }
    if (cat && cat.emits) {
      const em = cat.emits; if (em.sound) fnR.push(row("发声", `${em.sound.spl_1m_db} dB(1 m)· ${E(SND_ZH[em.sound.kind] || em.sound.kind)}${em.sound.freq_hz ? ` ${em.sound.freq_hz} Hz` : ""}${em.sound.when ? ` · ${E(WHEN_ZH[em.sound.when] || em.sound.when)}时` : ""}`, "目录 emits.sound:1 m 处声压级,供声学 / 麦克风模型"));
      if (em.heat) fnR.push(row("发热", `${big(em.heat.w)} W${em.heat.when ? ` · ${E(WHEN_ZH[em.heat.when] || em.heat.when)}时` : ""}`, "目录 emits.heat"));
      if (em.rf) fnR.push(row("无线电", `${E(em.rf.band)} · ${em.rf.tx_dbm} dBm`, "目录 emits.rf"));
    }
    if (!fnR.length && !stR.length) fnR.push(row("功能", elem === "wall_ext" || elem === "wall_int" || elem === "column" ? "围护 / 承重结构,无活动功能" : "—"));
    const trav = travRows(T);
    const html6 = `<div class="faces lo" title="这个盒子六个面的材料(按它现在的朝向,命中面高亮)">${chips.map((c) => `<span class="fc${c.hit ? " hit" : ""}" title="${E(c.lab)}面:${E(c.mat)}"><i style="background:${c.rgb ? `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})` : "#444"}"></i>${E(c.lab)} ${E(matZh(c.mat))}</span>`).join("")}</div>`;
    const blind = glassBehind(T);
    return { icon: iconOf(cat, elem), title: name, part, sub, dist: hit.t, cols: [[sec("尺寸与质量", rowsShape), Object.assign(sec("材料(六个面)", rowsMat), { html: html6 }), sec("物理量(命中的这一块)", physRows)], [sec("功能与状态", fnR.concat(stR)), blind ? sec("透过玻璃", [blind]) : null, sec("谁能过(人 · 机械狗 · 轮式 · 无人机)", trav)]]};
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
      const h2 = ES.ray.cast(o[0], o[1], o[2], d[0], d[1], d[2], 400 - run, { mask: maskAll(), glass: false, ignore: "walk" }); if (!h2) return row("看到的是", "天空 / 远处", "玻璃后面没有挡光的东西");
      const t2 = targetFromHit(h2, o), same = t2 && t2.kind === "bim" && t2.bid === T.bid && t2.it && T.it && t2.it.id === T.it.id;
      if (t2 && !same) return row("看到的是", `${E(t2.name || "?")} · ${f1(run + h2.t, 1)} m`, "把玻璃当作透明时,这条视线上第一个不透光、且不是这扇窗自己的东西(ES.ray.cast glass:false)");
      const adv = h2.t + 0.03; o = [o[0] + d[0] * adv, o[1] + d[1] * adv, o[2] + d[2] * adv]; run += adv;
    }
    return null;
  }
  const SND_ZH = { "compressor hum": "压缩机嗡鸣", "extractor fan": "抽油烟机风扇", "speech/tv": "电视声", "PC fan": "电脑风扇", "scanner beeps": "扫码蜂鸣", "electric drive / reverse beeper": "电机 / 倒车蜂鸣", "spindle and pumps": "主轴和泵", "belt and rollers": "皮带和滚筒", "transformer hum": "变压器嗡鸣", fan: "风扇", "compressor and fan": "压缩机和风扇" };
  const WHEN_ZH = { cooking: "烹饪", serving: "营业", moving: "行驶", running: "运转", cooling: "制冷" };
  const FN_ST = { swing: "平开", drawer: "抽屉", slide_up: "上翻", slide: "推拉" };
  function fnRows(cat, it) {
    const f = cat.functions || {}, out = [];
    if (f.sit) out.push(["可坐", `${f.sit.capacity} 人 · 座高 ${f1(f.sit.seat_h, 2)} m`]); if (f.sleep) out.push(["可睡", `${f.sleep.capacity} 人 · 床垫高 ${f1(f.sleep.mattress_h, 2)} m`]);
    if (f.store) out.push(["储物", f.store.volume_l ? `${f.store.volume_l} L` : f.store.pallets ? `${f.store.pallets} 个托盘位` : f.store.garments ? `${f.store.garments} 件衣物` : f.store.letters ? `${f.store.letters} 个信箱` : "可存放物品"]);
    if (f.support) out.push(["承物台面", `台面高 ${f1(f.support.top_h, 2)} m`]); if (f.cook) out.push(["烹饪", `${f.cook.hobs || ""} 灶眼 · ${big(f.cook.power_w)} W${f.cook.oven ? " · 带烤箱" : ""}`]); if (f.cool) out.push(["制冷", `设定 ${f.cool.setpoint_c} °C`]);
    if (f.wash) out.push(["盥洗", f.wash.flow_lpm ? `出水 ${f.wash.flow_lpm} L/min` : f.wash.flush_l ? `冲水 ${f.wash.flush_l} L` : f.wash.volume_l ? `容积 ${f.wash.volume_l} L` : f.wash.basins ? `${f.wash.basins} 个水盆` : "卫生设施"]);
    if (f.work) out.push(["办公", "可在这里工作"]); if (f.write) out.push(["书写", "可书写"]); if (f.project) out.push(["投影", "可投影"]); if (f.display) out.push(["显示", `${f.display.diag_in} 英寸屏幕`]); if (f.sell) out.push(["销售", "陈列 / 售卖商品"]); if (f.convey) out.push(["输送", `带速 ${f.convey.speed_ms} m/s`]);
    if (f.process) out.push(["加工", `${f.process.power_kw} kW`]); if (f.drive) out.push(["驾驶", `${f.drive.speed_ms} m/s · 举升 ${f.drive.lift_kg} kg`]); if (f.vent) out.push(["通风", "烟道"]); if (f.switch) out.push(["配电", "开关柜"]);
    if (f.openable) { const o = f.openable; out.push(["可开合", `${FN_ST[o.kind] || o.kind}${o.doors ? ` · ${o.doors} 扇` : ""}${o.n ? ` · ${o.n} 个` : ""}${o.leaves ? ` · ${o.leaves} 扇` : ""}${o.max_deg ? ` · 最大 ${o.max_deg}°` : ""}`]); }
    if (f.switchable) out.push(["开关", "可开 / 关(房间开关)"]);
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
      case "step_over": return [`可跨过 / 踩上去(高 ${f1(q.top, 2)} ≤ ${f1(e.step, 2)} m)`, "ok"];
      case "blocked": return [k === "dog" ? `爬不上(高 ${f1(q.top, 2)} m > ${f1(q.step, 2)} m),不会跳上家具` : k === "rover" ? `过不去(高 ${f1(q.top, 2)} m > ${f1(q.step, 2)} m)` : `挡住(高 ${f1(q.top, 2)} m > ${f1(q.step, 2)} m)${loose ? ";松散件,可推开" : ""}`, "no"];
      case "fly_over": return [`可飞越(顶高 ${f1(q.top, 2)} m)`, "ok"];
      case "under": return [`可从下面走过(净空 ${f1(q.clear, 2)} ≥ ${f1(q.need, 2)} m)`, "ok"];
      case "blocked_under": return [`过不去(台面下 ${f1(q.clear, 2)} m < 需要 ${f1(q.need, 2)} m)${loose && k === "human" ? ";可推开" : ""}`, "no"];
      case "free": return ["可通过(≤ 2 cm 地面覆盖物)", "ok"];
      case "door_human": return [q.always ? `门洞,直接走过(净宽 ${f1(q.w, 2)} m)` : `自己开门通过(净宽 ${f1(q.w, 2)} m${q.ok ? "" : ",太窄"})${q.open > 0.5 ? ";现在开着" : ""}`, q.ok ? "ok" : "no"];
      case "door_held": return [q.always ? `门洞,${q.ok ? "能过" : "太窄"}(净宽 ${f1(q.w, 2)},需 ${f1(q.need, 2)} m)` : q.open > 0.5 ? `门开着,${q.ok ? "能过" : "太窄"}(净宽 ${f1(q.w, 2)},需 ${f1(q.need, 2)} m)` : `不会开门,门开着才过得去(净宽 ${f1(q.w, 2)} ${q.ok ? "≥" : "<"} ${f1(q.need, 2)} m)`, q.always ? (q.ok ? "ok" : "no") : q.open > 0.5 && q.ok ? "ok" : "warn"];
      case "door_uav": return [q.always ? `门洞,飞得进去(净宽 ${f1(q.w, 2)} m)` : q.open > 0.5 ? `门开着,${q.ok ? "飞得进去" : "洞口太小"}(净宽 ${f1(q.w, 2)} m)` : `门关着进不去,开着才行(净宽 ${f1(q.w, 2)} m)`, q.always || (q.open > 0.5 && q.ok) ? "ok" : "warn"];
      case "blocked_glass": return ["过不去(窗玻璃)", "no"];
      case "window_uav": { const ok = q.open > 0.3 && q.w >= q.need[0] && q.h >= q.need[1]; return [q.openable ? `窗扇开着才进得去(洞口 ${f1(q.w, 2)} × ${f1(q.h, 2)} ≥ ${q.need[0]} × ${q.need[1]} m);现在${q.open > 0.05 ? "开度 " + f1(q.open * 100, 0) + "%" : "关着"}` : "固定窗,飞不进去", ok ? "ok" : "warn"]; }
      case "climb": return [`能${k === "dog" ? "爬" : "上"}(踏步 ${f1(q.rise, 3)} ≤ ${f1(q.step, 2)} m,踏面 ${f1(q.tread, 2)} m${q.ok ? "" : ",偏窄"})`, q.ok ? "ok" : "warn"];
      case "blocked_step": return [`上不去(踏步 ${f1(q.rise, 3)} m > ${f1(q.step, 2)} m)`, "no"];
      case "blocked_stair": return ["上不去(轮子过不了台阶,要走坡道 / 电梯)", "no"];
      case "fly_stair": return ["可飞过楼梯井(井宽 ≥ 0.8 m)", "ok"];
      case "ramp": return [`能走(坡度 1:12${k === "rover" ? q.ok ? ",在轮式上限内" : ",超过轮式上限" : ""})`, q.ok ? "ok" : "no"];
      case "blocked_wall": return ["过不去(墙 / 实体结构)", "no"];
      case "blocked_wall_uav": return ["过不去;只能从开着的门窗进", "no"];
      case "surface": return [`可站立 / 行走(摩擦 μ ${f1(q.mu, 2)})`, "ok"];
      case "none": return ["不是障碍(灯具 / 饰条 / 装饰)", "ok"];
    }
    return ["—", ""];
  }
  function travRows(T) {
    if (!CAT) return [row("提示", "目录还没加载", "")];
    const out = [];
    for (const k of ["human", "dog", "rover", "uav"]) {
      let q = null; if (T.cat) q = travInfo(T, k); else q = fallbackTrav(T, k);
      const [txt, cls] = travText(k, q, T), e = CAT.embodiments[k];
      out.push(row(EMB[k][0] + " " + EMB[k][1], E(txt), `${EMB[k][2]}:台阶上限 ${f1(e.step, 2)} m · 桌下需要净空 ${f1(e.under, 2)} m · 半径 ${f1(e.radius, 2)} m · ${e.opens_doors ? "会开门" : "不会开门"}(catalog.json embodiments;规则 = catalog.py traverse())`, cls));
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
    const T = { kind: "roof", key: `roof:${bid}:${bestK}`, hit, name: cat ? cat.zh : "屋顶", icon: "🏠", bid, B, it, cat }; T.dist = hit.t; T.center = () => [hit.x, hit.y, hit.z];
    T.shapes = () => (poly ? [{ t: "poly", pts: poly.v, strong: true, label: true }] : []);
    T.card = () => {
      const mi = ES.ray.matInfo(hit.mat) || {}, slope = Math.acos(Math.min(1, Math.abs(hit.nz))) * R2D, nm = mi.name || "roof_shingle"; let rf = NaN;
      try { rf = ES.ray.rfLossFromCrossings([{ roof: true, mat: hit.mat, matName: nm, cos: Math.max(Math.abs(hit.nz), 0.05), treat: false }], 3.5e9, "TE"); } catch (e) { /* roofs without assembly */ }
      return { icon: "🏠", title: T.name, sub: `${bid} ${BKIND_ZH[B.kind] || B.kind}(${B.label}) · 屋面`, chips: `<span class="ichip">${E(cat ? CAT_ZH[cat.cat] : "建筑结构")}</span>`, dist: hit.t, cols: [[sec("屋面", [row("坡度", `${f1(slope, 0)}°${slope < 3 ? "(平屋面)" : ""}`, "命中点的面法线与竖直方向的夹角"), row("材料", E(matZh(nm)), `屋面多边形的材料 ${nm}`), it && it.m ? row("质量", `整个屋面 ${big(it.m)} kg`, "目录 items[].m:多边形面积 × 0.05 m × 装配密度") : null, row("射频损耗", `${f1(rf, 1)} dB(3.5 GHz)`, "屋顶是无厚度多边形:按 ES.ray 的典型屋面装配计(沥青瓦 = 40 mm 木板;瓦 = 30 mm 混凝土;金属 1 mm;膜 = 60 mm 混凝土),ITU-R P.2040,仅 GNSS 穿屋顶时使用")])], [sec("物理量", [row("激光雷达", `905 nm 反射率 ${f1(mi.refl, 2)}${mi.spec ? ` + 镜面 ${f1(mi.spec, 2)}` : ""}`, "ES.ray.REFL 的行(REFL_NAMED)"), row("摩擦 μ", cat && cat.mu_static != null ? f1(cat.mu_static, 2) : "—", "catalog.json 类型的 mu_static")]), sec("谁能过", ["human", "dog", "rover", "uav"].map((k) => row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? "可飞越(屋面不是障碍)" : "不能上屋顶(没有通道)", "屋顶没有入口 / 楼梯:地面机器人和人到不了", k === "uav" ? "ok" : "no")))]], foot: "屋面多边形:ES.ray 的 T_TRI(GNSS / 激光雷达共用)" };
    };
    return T;
  }
  function prismTarget(desc, hit) {
    const b = S.A.scene.buildings[desc.i]; if (!b) return null; const T = { kind: "prism", key: `prism:${desc.i}`, hit, name: desc.kind === "rubble" ? "倒塌的建筑(瓦砾堆)" : "建筑(只有外形,没有内部)", icon: "🏚" }; T.dist = hit.t; T.center = () => [hit.x, hit.y, hit.z];
    T.shapes = () => [{ t: "poly", pts: (b.fp || []).map((p) => [p[0], p[1], 0.14]).concat([]), strong: true, label: true, flat: true }];
    T.card = () => { const mi = ES.ray.matInfo(hit.mat) || {}, dmg = S.A.W.damage && S.A.W.damage[b.id], h = desc.kind === "rubble" ? Math.min(2.2, 0.18 * b.h) : dmg && dmg.state === "partial" ? 0.7 * b.h : b.h; return { icon: T.icon, title: T.name, sub: `${b.id || ""} ${BKIND_ZH[b.kind] || b.kind || ""}`, chips: "", dist: hit.t, cols: [[sec("外形", [row("高度", `${f1(h, 1)} m${h < b.h - 0.05 ? `(原 ${f1(b.h, 1)} m)` : ""}`, "场景 JSON buildings[].h;倒塌 = min(2.2 m, 0.18 h),部分倒塌 = 0.7 h(World / ES.ray 的同一规则)"), row("层数", `${b.floors || "—"}`, "场景 JSON buildings[].floors"), row("说明", desc.kind === "rubble" ? "倒塌后只剩 ≤ 2.2 m 的瓦砾堆" : "BIM 没有这栋楼的内部:按实心棱柱体处理", "")])], [sec("物理量", [row("激光雷达", `905 nm 反射率 ${f1(mi.refl, 2)}`, "ES.ray.REFL building_generic / rubble"), row("通行", "人 / 机械狗 / 轮式 / 无人机:都进不去", "", "no")])]], foot: "" }; };
    return T;
  }
  function vehicleTarget(i, hit) {
    const A = S.A, v = (A.W.vehicles || [])[i]; if (!v) return null; const T = { kind: "veh", key: `veh:${i}`, hit, v, i, name: VEH_ZH[v.vtype] || VEH_ZH[v.kind] || v.vtype, icon: "🚗" }; T.dist = hit.t;
    const z0 = () => A.W.groundZ(v.xy[0], v.xy[1]); T.center = () => [v.xy[0], v.xy[1], z0() + v.dims[2] / 2];
    T.shapes = () => [{ t: "obb", o: [v.xy[0], v.xy[1], z0() + v.dims[2] / 2, v.dims[0] / 2, v.dims[1] / 2, v.dims[2] / 2, ES.rad(v.yaw), 0], strong: true, label: true }, frontArrow(v.xy[0], v.xy[1], z0() + v.dims[2] * 0.55, Math.cos(ES.rad(v.yaw)), Math.sin(ES.rad(v.yaw)), v.dims[0] / 2 + 0.6)];
    T.card = () => {
      const [L, Wd, H] = v.dims, kg = VEH_KG[v.vtype] || VEH_KG[v.kind], mi = ES.ray.matInfo(hit.mat) || {}, glass = ES.ray.matInfo(ES.ray.WM.car_glass) || {}, paint = ES.ray.matInfo(ES.ray.WM.car_paint) || {}, g = (V) => V && V.vehGroups && V.vehGroups[i], rig = g(VV()) && g(VV()).children[0] && g(VV()).children[0].userData.rig, night = ES.actors ? ES.actors.isNight() : false;
      return { icon: "🚗", title: T.name, sub: `停放车辆 ${v.id} · 朝向 ${compass(ES.rad(v.yaw))[0]}°${compass(ES.rad(v.yaw))[1]}`, chips: `<span class="ichip">车辆</span><span class="ichip">${E(v.vtype)}</span>`, dist: hit.t,
        cols: [[sec("外形与质量", [row("外形尺寸", `${f1(L, 2)} × ${f1(Wd, 2)} × ${f1(H, 2)} m`, "场景 JSON vehicles[].dims(长 × 宽 × 高),也是物理碰撞盒"), row("质量级别", `${kg ? `≈ ${big(kg / 1000)} t(典型整备质量)` : "—"}`, "公开车型资料里这一类车的典型整备质量(区间中值),不是项目数据:场景只给外形尺寸"), row("体积", `${f1(L * Wd * H, 1)} m³(外廓)`, "长 × 宽 × 高")]),
          sec("材料与物理量", [row("车身", `${E(matZh("car_paint"))} · 雷达 ${f1(paint.refl, 2)} + 镜面 ${f1(paint.spec, 2)}`, "ES.ray.REFL car_paint = [漫反射 0.35, 镜面瓣 0.30]"), row("车窗", `${E(matZh("car_glass"))} · 雷达 ${f1(glass.refl, 2)} + 镜面 ${f1(glass.spec, 2)}`, "ES.ray.REFL car_glass"), row("射线形状", "车身盒 + 座舱盒", "ES.ray 按车型把车身和座舱分成两个盒子(raycast.js VEH 表)")])],
          [sec("状态", [row("发动机", "熄火(停放)", "停放车辆没有行驶状态"), row("车门", "全部关闭", "车辆模型的门不能开"), row("灯", rig && rig.dynamic ? "警灯 / 顶灯在闪(值勤)" : night ? "关(停放车辆不开灯)" : "关", "vehicles.js:只有警车 / 救护车 / 消防车的灯条会闪;停放的车不亮前后灯")]),
            sec("谁能过", ["human", "dog", "rover", "uav"].map((k) => { const e = CAT ? CAT.embodiments[k] : { step: 0 }; return row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? `飞越(车顶高 ${f1(H, 2)} m)` : `过不去(高 ${f1(H, 2)} m > 台阶上限 ${f1(e.step, 2)} m)`, "按外形高度与各身份台阶上限比较", k === "uav" ? "ok" : "no"); }))]], foot: "外形来自场景数据;质量级别是典型值(见提示)" };
    };
    return T;
  }
  function treeTarget(i, hit, crown, o) {
    const A = S.A, t = A.scene.trees[i]; if (!t) return null; const k = ES.TREE[t[2]] || ES.TREE.round, s = t[3], V = VV(), vt = V && V.trees && V.trees[i], sp = vt && vt.choice ? vt.choice.species : null;
    const T = { kind: "tree", key: `tree:${i}`, hit, name: SPECIES_ZH[sp] || KIND_TREE_ZH[t[2]] || "树", icon: "🌳" }; T.dist = hit.t; const rz = (k.h - k.lo) * 0.5 * s, cz = 0.14 + k.lo * s + rz, tr = 0.13 * s, zt = 0.14 + (k.lo + 0.45 * (k.h - k.lo)) * s;
    T.center = () => [t[0], t[1], cz]; T.shapes = () => [{ t: "cyl", c: [t[0], t[1]], r: tr, z0: 0.14, z1: zt, strong: false }, { t: "ell", c: [t[0], t[1], cz], rx: k.r * s, rz, strong: true, label: true }];
    T.card = () => {
      const den = k.den, bark = ES.ray.matInfo(ES.ray.WM.bark) || {}, leaf = ES.ray.matInfo(ES.ray.WM.foliage) || {};
      return { icon: "🌳", title: T.name, sub: `${KIND_TREE_ZH[t[2]]} · 场景树 #${i}${t[4] ? " · " + ({ street: "行道树", park: "公园树" }[t[4]] || t[4]) : ""}`, chips: `<span class="ichip">植被</span>${sp ? `<span class="ichip">${E(sp)}</span>` : ""}`, dist: hit.t,
        cols: [[sec("形态", [row("树高", `${f1(k.h * s, 1)} m`, `类型高度 ${k.h} m × 缩放 ${f1(s, 2)}(ES.TREE.${t[2]}.h × 场景树的 scale)`), row("树干(碰撞柱)", `半径 ${f1(tr, 2)} m · 高 0.14 – ${f1(zt, 1)} m`, "ES.ray 的树干圆柱:半径 0.13 × scale,高到冠底以上 45% 处;人 / 狗被它挡住"), row("树冠", `半径 ${f1(k.r * s, 1)} m · 离地 ${f1(k.lo * s, 1)} m 起 · 顶 ${f1(k.h * s, 1)} m`, "ES.TREE:冠半径 r、冠底 lo、顶 h,均 × scale(椭球)"), row("叶密度", `${f1(den, 2)} → 光线衰减 ${f1(0.5 * den, 2)} /m`, "ES.ray 树冠 = Beer-Lambert 介质,衰减系数 = 0.5 × den(每米);GNSS / 射频按冠内路径长度计")]),
          sec("物理量", [row("树皮", `雷达反射率 ${f1(bark.refl, 2)}`, "ES.ray.REFL bark"), row("树叶", `雷达反射率 ${f1(leaf.refl, 2)}`, "ES.ray.REFL foliage"), row("碰撞", "树干是实心柱;树冠不挡人 / 狗 / 无人机,只衰减信号、遮挡视线", "view3d.js:World 里树干占 hB(到冠底),树冠只记 cLo / cHi / cDen")])],
          [sec("谁能过", ["human", "dog", "rover", "uav"].map((kk) => row(EMB[kk][0] + " " + EMB[kk][1], kk === "uav" ? `树干要绕开(半径 ${f1(tr, 2)} m);冠层可穿过` : `过不去(树干半径 ${f1(tr, 2)} m,要绕开)`, "树干是实心柱", kk === "uav" ? "warn" : "no")))]], foot: crown ? "命中的是树冠椭球(拾取时把树冠当实心体)" : "" };
    };
    return T;
  }
  function lampTarget(i, hit) {
    const l = S.A.scene.lamps[i]; if (!l) return null; const T = { kind: "lamp", key: `lamp:${i}`, hit, name: "路灯", icon: "💡" }; T.dist = hit.t; const hx = l[0] + Math.cos(l[2]) * 1.6, hy = l[1] + Math.sin(l[2]) * 1.6;
    T.center = () => [l[0], l[1], 3.5]; T.shapes = () => [{ t: "cyl", c: [l[0], l[1]], r: 0.085, z0: 0.14, z1: 7.14, strong: true, label: true }, { t: "obb", o: [(l[0] + hx) / 2, (l[1] + hy) / 2, 7.0, 0.85, 0.04, 0.04, l[2], 0], strong: true }, { t: "obb", o: [hx, hy, 6.95, 0.35, 0.15, 0.06, l[2], 0], strong: true }];
    T.card = () => { const night = ES.actors ? ES.actors.isNight() : false, mi = ES.ray.matInfo(ES.ray.WM.pole_metal) || {};
      return { icon: "💡", title: "路灯", sub: `场景路灯 #${i} · 臂朝向 ${compass(l[2])[0]}°${compass(l[2])[1]}`, chips: `<span class="ichip">街道设施</span>`, dist: hit.t, cols: [[sec("外形", [row("灯杆", "高 7.0 m · 杆半径 0.085 m", "ES.ray 灯杆圆柱 0.14 … 7.14 m"), row("灯臂 / 灯头", "臂长 1.7 m · 灯头 0.7 × 0.3 m,高 6.95 m", "ES.ray:臂盒 1.7 × 0.08 × 0.08 m,灯头盒 0.7 × 0.3 × 0.12 m"), row("材料", `${E(matZh("pole_metal"))} · 激光雷达 ${f1(mi.refl, 2)} + 镜面 ${f1(mi.spec, 2)}`, "ES.ray.REFL pole_metal")])], [sec("功能与状态", [row("灯", `${night ? "亮着(夜间)" : "关着(白天)"} · 6,000 lm`, "光照模型 telemetry.js:夜间每盏街灯 6,000 lm;白天不亮(随昼夜 look 切换)", night ? "ok" : "")]), sec("谁能过", ["human", "dog", "rover", "uav"].map((kk) => row(EMB[kk][0] + " " + EMB[kk][1], kk === "uav" ? "杆 / 灯臂要绕开" : "过不去(灯杆是实心柱,绕开)", "", kk === "uav" ? "warn" : "no")))]], foot: "" }; };
    return T;
  }
  function fenceTarget(desc, hit) {
    const o = S.A.scene.objects[desc.i]; if (!o) return null; const ln = o.lines[desc.line] || o.lines[0]; let bk = 0, bd = 1e9;
    for (let k = 0; k + 1 < ln.length; k++) { const a = ln[k], b = ln[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((hit.x - a[0]) * dx + (hit.y - a[1]) * dy) / L2)), d = Math.hypot(a[0] + t * dx - hit.x, a[1] + t * dy - hit.y); if (d < bd) { bd = d; bk = k; } }
    const a = ln[bk], b = ln[bk + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const T = { kind: "fence", key: `fence:${desc.i}:${desc.line}:${bk}`, hit, name: FENCE_ZH[o.style] || "围栏", icon: "🚧" }; T.dist = hit.t; T.center = () => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.14 + o.h / 2];
    T.shapes = () => [{ t: "poly", pts: [[a[0], a[1], 0.14], [b[0], b[1], 0.14], [b[0], b[1], 0.14 + o.h], [a[0], a[1], 0.14 + o.h]], strong: true, label: true }];
    T.card = () => {
      const mi = ES.ray.matInfo(hit.mat) || {}, st = o.style, see = st === "privacy" ? "不透(木板连续)" : st === "picket" ? "半透:板条之间有缝,能看到后面" : "基本透明:铁丝网只遮一小部分";
      const cov = st === "picket" ? "板条覆盖约 63%(0.094 m 板 / 0.15 m 间距)+ 2 根横档 + 立柱" : st === "privacy" ? "100%(木板连续 + 横档)" : "铁丝覆盖率随距离:近处 ≈ 5%(0.004 + 0.0075·d)/0.177 × 2,上限 85%";
      return { icon: "🚧", title: T.name, sub: `围栏 #${desc.i} · 本段 ${f1(L, 1)} m`, chips: `<span class="ichip">围栏</span>`, dist: hit.t, cols: [[sec("外形", [row("高度", `${f1(o.h, 1)} m`, "场景 JSON objects[].h"), row("本段长度", `${f1(L, 1)} m · 共 ${Math.max(1, Math.round(L / 2.4))} 个立柱段`, "立柱间距约 2.4 m(ES.ray fence 原语)"), row("样式", E(FENCE_ZH[st]), "场景 JSON objects[].style")]), sec("物理量", [row("透视", E(see), "ES.ray fenceHit:按板条 / 铁丝的位置决定射线是否被挡"), row("遮挡细节", E(cov), "raycast.js fenceHit 的几何常数"), row("材料", `${E(matZh(mi.name))} · 激光雷达 ${f1(mi.refl, 2)}${mi.spec ? ` + 镜面 ${f1(mi.spec, 2)}` : ""}`, "ES.ray.REFL " + (mi.name || ""))])],
        [sec("谁能过", ["human", "dog", "rover", "uav"].map((k) => row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? `可飞越(高 ${f1(o.h, 1)} m)` : `过不去(栏高 ${f1(o.h, 1)} m;只能走大门 / 缺口)`, "view3d.js rasterBlocked:围栏占 World 的 hT / hB 栅格", k === "uav" ? "ok" : "no")))]], foot: "" };
    };
    return T;
  }
  function objectTarget(i, hit) {
    const o = S.A.scene.objects[i]; if (!o) return null; const W = S.A.W, nm = o.name || o.type, T = { kind: "obj", key: `obj:${i}`, hit, name: OBJ_ZH[nm] || nm, icon: { shed: "🛖", container: "📦", tank: "🛢", chimney: "🏭", mailbox: "📬", bins: "🗑", hoop: "🏀", playground: "🛝" }[nm] || "📦" }; T.dist = hit.t; const gz = W.groundZ(o.xy[0], o.xy[1]);
    const mdl = o.type === "box" ? o.size : o.type === "cyl" ? [2 * o.r, 2 * o.r, o.h] : [0.1, 0.1, o.h]; T.center = () => [o.xy[0], o.xy[1], gz + mdl[2] / 2];
    T.shapes = () => (o.type === "box" ? [{ t: "obb", o: [o.xy[0], o.xy[1], 0.14 + o.size[2] / 2, o.size[0] / 2, o.size[1] / 2, o.size[2] / 2, o.yaw || 0, 0], strong: true, label: true }] : [{ t: "cyl", c: [o.xy[0], o.xy[1]], r: o.type === "cyl" ? o.r : 0.05, z0: o.type === "cyl" ? 0 : 0.14, z1: o.type === "cyl" ? o.h : 0.14 + o.h, strong: true, label: true }]);
    T.card = () => {
      const mi = ES.ray.matInfo(hit.mat) || {}, top = o.type === "box" ? o.size[2] : o.h;
      return { icon: T.icon, title: T.name, sub: `场景物体 #${i} · ${o.type === "box" ? "盒体" : o.type === "cyl" ? "圆柱" : "杆"}`, chips: `<span class="ichip">场景物体</span>`, dist: hit.t,
        cols: [[sec("外形", [row("尺寸", o.type === "box" ? `${f1(o.size[0], 2)} × ${f1(o.size[1], 2)} × ${f1(o.size[2], 2)} m` : o.type === "cyl" ? `直径 ${f1(2 * o.r, 2)} m · 高 ${f1(o.h, 1)} m` : `杆高 ${f1(o.h, 1)} m`, "场景 JSON objects[]"), o.yaw != null ? row("朝向", `${compass(o.yaw)[0]}°${compass(o.yaw)[1]}`, "场景 JSON objects[].yaw") : null]), sec("物理量", [row("材料", `${E(matZh(mi.name))} · 激光雷达 ${f1(mi.refl, 2)}${mi.spec ? ` + 镜面 ${f1(mi.spec, 2)}` : ""}`, "ES.ray.REFL " + (mi.name || "")), row("质量", "场景没有给质量", "scene JSON 只含几何")])],
          [sec("谁能过", ["human", "dog", "rover", "uav"].map((k) => { const e = CAT ? CAT.embodiments[k] : { step: 0 }; return row(EMB[k][0] + " " + EMB[k][1], k === "uav" ? `飞越(高 ${f1(top, 1)} m)` : top <= e.step ? `可跨过(高 ${f1(top, 2)} m)` : `过不去(高 ${f1(top, 1)} m > ${f1(e.step, 2)} m)`, "按高度与台阶上限比较", k === "uav" || top <= e.step ? "ok" : "no"); }))]], foot: "" };
    };
    return T;
  }
  function groundTarget(hit) {
    const W = S.A.W, cls = hit.cls, mi = ES.ray.matInfo(hit.mat) || {}, nm = mi.name, id = W.ij(hit.x, hit.y), rub = id >= 0 ? W.rub[id] : 0;
    const T = { kind: "ground", key: `ground:${nm}`, hit, name: ({ asphalt: "柏油路面", road_paint: "道路标线(反光漆)", sidewalk: "人行道(混凝土)", grass: "草地", gravel: "碎石地面", soil: "泥土", water: "水面" })[nm] || "地面", icon: nm === "water" ? "🌊" : nm === "asphalt" || nm === "road_paint" ? "🛣" : nm === "grass" ? "🌿" : "▦" }; T.dist = hit.t; T.center = () => [hit.x, hit.y, hit.z];
    T.shapes = () => [{ t: "ring", c: [hit.x, hit.y, hit.z], r: 0.5, strong: true }];
    T.card = () => {
      const cn = { 1: "道路", 2: "人行道 / 铺装", 13: "草地 / 土地", 11: "水面" }[cls] || "地面", mu = nm === "sidewalk" && CAT ? (CAT.materials.concrete || {}).mu_static : null, water = nm === "water";
      return { icon: T.icon, title: T.name, sub: `${cn} · 高度 z = ${f1(hit.z, 3)} m`, chips: `<span class="ichip">地面</span>${rub > 0.05 ? `<span class="ichip warn">瓦砾 ${f1(rub, 2)} m</span>` : ""}`, dist: hit.t,
        cols: [[sec("表面", [row("类别", E(cn), "ES.ray 地面栅格类别:道路 / 人行道 / 草地 / 水(场景多边形光栅化)"), row("高度", `${f1(hit.z, 3)} m`, "A.W.gz:道路 0.012、草地 0.14、公园 0.15、人行道 0.16、小径 0.164"), row("坡度", "平地(栅格地面无坡)", "A.W 高度场:同类地面等高"), rub > 0.05 ? row("瓦砾", `高 ${f1(rub, 2)} m`, "震后变体的瓦砾高度 A.W.rub", "warn") : null]),
          sec("物理量", [row("激光雷达", `905 nm 反射率 ${f1(mi.refl, 2)}${mi.spec ? ` + 镜面 ${f1(mi.spec, 2)}` : ""}`, "ES.ray.REFL " + nm + (nm === "road_paint" ? "(标线是逆反射漆)" : "")), row("摩擦 μ", mu != null ? `${f1(mu, 2)}(混凝土静摩擦)` : "模型未定义", "户外地面只有人行道(混凝土)对应目录里的 μ;柏油 / 草地 / 碎石模型里没有摩擦数据")])],
          [sec("谁能走", ["human", "dog", "rover", "uav"].map((k) => row(EMB[k][0] + " " + EMB[k][1], water ? (k === "uav" ? "可飞过水面" : "不能下水") : k === "uav" ? "可飞过" : rub > 0.25 ? `瓦砾高 ${f1(rub, 2)} m,${k === "dog" ? "狗只能走 ≤ 0.5 m 的瓦砾" : "要看高度"}` : "可以走", "view3d.js rasterBlocked:水 / 瓦砾 / 实体占用的栅格不可走", water && k !== "uav" ? "no" : "ok")))]], foot: "" };
    };
    return T;
  }

  /* ================================================================ agents: live episode, placed entities, my own body ================================================================ */
  const MASS = { dog: [15.2, "Unitree Go2 MJCF 总质量 15.206 kg(scripts/esworld/dynamics/robots.py load_go2_spec)"], uav: [1.325, "Skydio X2 MJCF 质量 1.325 kg(load_x2_spec)"], rover: [40, "catalog.json embodiments.rover.mass_kg"] };
  function agentInfo(uid) {
    const V = VV(), A = S.A;
    if (uid === "walk") { const W = WK(); return { uid, live: false, self: true, kind: W.body === "human" ? "human" : W.body, name: "你自己", pos: () => ({ x: W.x, y: W.y, z: W.body === "uav" ? W.z : W.zf, yaw: W.yaw, speed: W.speed || 0 }), body: W.body }; }
    if (uid.startsWith("live:")) { const id = uid.slice(5), it = V && V.live && V.live.userData.items.find((q) => q.id === id); if (!it) return null; const k = it.kind === "dog" ? "dog" : it.kind === "uav" ? "uav" : it.kind === "rover" ? "rover" : it.kind === "t:lying" ? "lying" : "human";
      return { uid, live: true, it, id, kind: k, role: it.a && it.a.role, pos: () => { const m = it.model, st = it.st; return { x: m.position.x, y: -m.position.z, z: m.position.y, yaw: m.rotation.y, speed: st ? st.speed : 0, st }; }, rigKey: it.model.userData.rig && it.model.userData.rig.key }; }
    if (uid.startsWith("ent:")) { const id = uid.slice(4), e = (A.ents || []).find((q) => String(q.id) === id); if (!e) return null; const k = e.kind === "t:person" ? "person" : e.kind === "t:lying" ? "lying" : e.kind === "t:vehicle" ? "vehicle" : e.kind === "human" ? "human" : e.kind;
      return { uid, live: false, ent: e, id, kind: k, pos: () => ({ x: e.x, y: e.y, z: e.kind === "uav" ? e.z : e.zf != null ? e.zf : ES.view3d.walk.surfZ(e.x, e.y), yaw: e.yaw || 0, speed: 0 }) }; }
    return null;
  }
  const AG_ICON = { dog: "🐕", uav: "🚁", rover: "🤖", human: "🚶", person: "🚶", lying: "🧍", cp: "📡", vehicle: "🚗" };
  function agentNames(g) {
    const kind = g.kind, me = WK(); let name, model;
    if (g.self) { name = "你自己(" + ES.controls.IDENT[me.body].name + ")"; model = ES.controls.IDENT[me.body].spec; }
    else if (kind === "dog") { name = g.live ? "机械狗(回合中)" : (g.ent && g.ent.name) || "机械狗"; model = "Unitree Go2"; }
    else if (kind === "uav") { name = g.live ? "无人机(回合中)" : (g.ent && g.ent.name) || "无人机"; model = "Skydio X2 级"; }
    else if (kind === "rover") { name = g.live ? "配送机器人(回合中)" : (g.ent && g.ent.name) || "配送机器人"; model = "轮式配送机器人"; }
    else if (kind === "cp") { name = (g.ent && g.ent.name) || "指挥站"; model = "移动指挥车(厢式货车 + 桅杆)"; }
    else if (kind === "vehicle") { name = (g.ent && g.ent.name) || "行驶的车辆(目标)"; model = "两厢车目标"; }
    else { const resp = g.live ? g.id === "human_0" : kind === "human"; name = g.live ? (g.id === "human_0" ? "应急人员(回合中)" : g.role === "wave" ? "窗口挥手求助的居民" : kind === "lying" ? "倒地的人" : "平民(回合中)") : (g.ent && g.ent.name) || (kind === "lying" ? "倒地的人" : "站立的人"); model = resp ? "应急人员(Rocketbox 头盔 + 反光背心)" : "平民(Rocketbox 人物)"; }
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
  const OTHER_SENS = { dog: "4 麦克风阵列 · IMU · GNSS", uav: "气压计 · IMU · GNSS · 麦克风", human: "双耳麦克风 · 手机无线(5G / Wi-Fi / 蓝牙)", rover: "麦克风", cp: "麦克风 · 5G 基站 · Wi-Fi · 900 MHz 自组网" };       // = the non-camera, non-LiDAR part of ES.DEVICES[kind].sensors (agents_cfg.DEVICES)
  const MOVE_ZH = { dog: ["行走", "站立"], uav: ["飞行", "悬停"], rover: ["行驶", "停着"] };
  function agentCard(T) {
    const g = T.g, p = g.pos(), me = WK(), RAY = ES.ray, bk = bodyKind(g), B = RAY.BODY[bk] || {}, kind = g.kind, { name, model } = agentNames(g), icon = AG_ICON[kind] || "🤖"; T.name = name;
    const eye = [me.x, me.y, ES.view3d.walk.V.cam.position.y], dist = Math.hypot(p.x - eye[0], p.y - eye[1], p.z - eye[2]), spd = p.speed || 0, [hd, hn] = compass(p.yaw);
    const civ = (kind === "human" && g.live && g.id !== "human_0") || kind === "person" || kind === "lying" || kind === "vehicle";            // civilians and targets carry no device
    const dev = civ ? null : ES.DEVICES[kind], H = ES.hud || {}, CAMS = civ ? null : (H.CAMS || {})[kind], LID = civ ? null : (H.LIDARS || {})[kind], MM = ES.lidar && ES.lidar.MODELS && LID ? ES.lidar.MODELS[LID.model] : null;
    const camTxt = CAMS ? CAMS.map((c) => `${c.zh} ${c.hfov}° ${c.res[0]}×${c.res[1]} ${c.fps} fps`).join(" · ") : "", lidTxt = LID ? `${LID.zh} · ${MM ? MM.h_fov : LID.hfov}° × ${MM ? MM.v_max - MM.v_min : LID.vmax - LID.vmin}° · ≤ ${MM ? MM.max_range : LID.range} m · ${MM ? MM.rate_hz : LID.rate} Hz` : "";
    let size, mass = null;
    if (kind === "cp") { const d = S.A.scene.cp_dims || [7, 2.5, 3.3]; size = `${f1(d[0], 1)} × ${f1(d[1], 1)} × ${f1(d[2], 1)} m`; } else if (kind === "vehicle") size = "4.2 × 1.8 × 1.5 m"; else if (B.t === 1) size = `身高 ${f1(B.h, 2)} m · 碰撞胶囊半径 ${f1(B.r, 2)} m`; else size = `${f1(2 * B.hx, 2)} × ${f1(2 * B.hy, 2)} × ${f1(2 * B.hz, 2)} m`;
    if (kind === "human" || kind === "person" || kind === "lying") {      // roster height; mass scales with height^2 from the young adult (1.71 m, 72 kg) of dynamics/human.py
      const key = g.rigKey || (g.self ? "resp_m" : null), pe = PEOPLE && key && PEOPLE.people && PEOPLE.people[key], h = pe ? pe.height : 1.7; mass = [72 * Math.pow(h / 1.71, 2), `${f1(h, 2)} m 的人:质量 = 72 kg × (身高 / 1.71 m)²(dynamics/human.py 青年组 1.71 m / 72 kg;traffic/pedestrians.py 同一缩放)`]; if (pe && B.t === 1) size = `身高 ${f1(h, 2)} m(${key}) · 碰撞胶囊半径 ${f1(B.r, 2)} m`;
    } else if (MASS[kind]) mass = MASS[kind];
    const sensRows = civ ? [row("装备", "无传感器", "平民 / 目标没有设备")] : [camTxt ? row("相机", E(camTxt), "ES.hud.CAMS(镜像 agents_cfg.DEVICES)") : null, lidTxt ? row("激光雷达", E(lidTxt), "ES.lidar.MODELS(lidar_models.json,与 agents_cfg 同源)") : null, OTHER_SENS[kind] ? row("其他", E(OTHER_SENS[kind]), "ES.DEVICES[kind].sensors 里除相机 / 激光雷达外的部分") : null];
    const mv = MOVE_ZH[kind], act = kind === "lying" ? "躺卧(倒地)" : g.live && g.role && ROLE_ZH[g.role] && !mv ? ROLE_ZH[g.role] : mv ? mv[spd > 0.25 ? 0 : 1] : spd > 0.25 ? "行走" : kind === "cp" ? "停放" : "站立";
    const st = [row("动作", E(act), g.live ? "回合数据 agents[].role + 路径速度" : g.self ? "你自己" : "放置的实体是静止的"), row("速度", `${f1(spd, 2)} m/s`, g.live ? "回放路径的有限差分(ES.actors.track)" : g.self ? "你自己的速度 WALK.speed" : "放置的实体不动"), row("航向", `${hd}° ${hn}`, "yaw(自 +x 逆时针)→ 罗盘方位")];
    if (kind === "uav") st.push(row("离地高度", `${f1(p.z - S.A.W.groundZ(p.x, p.y), 1)} m`, "机身高度 − 地面高度"));
    if (g.self) { const W = WK(), pct = Math.round(100 * (W.batt != null ? W.batt : 1)); st.push(row("电量", `${pct}%`, "view3d.js 电池模型(无人机悬停 108 W,狗 25-60 W …)", pct < 15 ? "warn" : "")); }
    else if (dev && dev.battery_wh) st.push(row(kind === "human" ? "手机电池" : "电池", `${dev.battery_wh} Wh`, "ES.DEVICES(agents_cfg.DEVICES)的容量;回合数据没有剩余电量"));
    if (!g.self) {
      const head = [p.x, p.y, p.z + (kind === "uav" ? 0 : B.t === 1 ? B.h * 0.9 : (B.lift || 0.4) + (B.hz || 0.2))], los = !RAY.blocked([eye[0], eye[1], eye[2]], head);
      st.push(row("视线", los ? "看得见(无遮挡)" : "被遮挡", "ES.ray.blocked:我的眼睛到它的头部,玻璃当透明", los ? "ok" : "warn")); st.push(row("到我的距离", `${f1(dist, 1)} m`, "三维距离(眼睛到它的中心)"));
      const lk = dev && dev.radios ? linkTo(g) : null; if (lk) st.push(row("链路(到我)", lk.good > 0 ? `${lk.good >= 10 ? Math.round(lk.good) : f1(lk.good, 1)} Mb/s · ${E(lk.tech)} · ${lk.los ? "视距" : "有遮挡"}` : "连不上", "ES.phys.link:双方共有的无线制式里取最好的(与 HUD 邻近设备卡片同一算法)", lk.good > 0 ? "ok" : "warn"));
    }
    const rr = B.r || Math.max(B.hx || 0, B.hy || 0), coll = [row("碰撞", kind === "uav" ? `机身 ${f1(2 * B.hx, 2)} m;在空中,绕开 / 飞越` : `碰撞半径 ${f1(rr, 2)} m,会动:挡路时要绕开;被它撞上你会被挤到一边`, "view3d.js:活动实体是实心体(liveHit / pushedByLive)", "warn")];
    return { icon, title: name, sub: model, chips: `<span class="ichip">${g.self ? "我" : g.live ? "回合内" : "我放置的"}</span><span class="ichip">${E(kind)}</span>`, dist,
      cols: [[sec("外形与质量", [row("尺寸", E(size), "ES.ray 物理形状(与激光雷达、碰撞同一套)"), mass ? row("质量", `${big(mass[0])} kg`, mass[1]) : null]), sec("传感器", sensRows), g.self ? null : sec("碰撞", coll)], [sec("现在的状态", st)]], foot: g.live ? "回合内的智能体:位置 / 速度来自 live_<场景>.json 的回放" : g.self ? "" : "你放置的实体(返回俯视图可编辑)" };
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
    const box = $(".fp-acts"); let chip = $("#fp-inspect"); if (box && !chip) { chip = document.createElement("button"); chip.type = "button"; chip.className = "btn chip-insp"; chip.id = "fp-inspect"; chip.textContent = "🔍 检查物体 (I)"; chip.title = "I 键:检查模式。准星指到的东西会高亮,卡片显示它的材料、质量、隔声 / 射频 / 激光雷达数值和各身份能不能通过;右键点任意物体可锁定"; chip.addEventListener("click", () => { chip.blur(); toggle(); }); box.insertBefore(chip, box.querySelector("label")); }
    const cvs = $("#v3d"); if (cvs && !cvs._inspCtx) { cvs._inspCtx = 1; cvs.addEventListener("contextmenu", onContext); }
    fx.cv = cv; fx.g = cv.getContext("2d"); dom = { cv, card, chip }; return dom;
  }
  const HINT_ON = "检查模式:准星对准物体看它的属性 · 右键点任意物体锁定 / 取消 · 按 I 退出";
  function setHint(on) { const h = $("#fp-hint"); if (!h) return; if (on) { if (st.hint === null) st.hint = h.textContent; h.textContent = HINT_ON; } else if (st.hint !== null) { h.textContent = st.hint; st.hint = null; } }
  function toggle(on) {
    const want = on === undefined ? !st.on : !!on; if (want === st.on) return st.on; if (!ensureDom()) return false;
    st.on = want; if (!want) { st.pin = null; st.cur = null; st.keyCur = ""; clearFx(); dom.card.hidden = true; const c = $("#v3d"); if (c) c.style.cursor = "grab"; } else { loadCat(); loadPeople(); const c = $("#v3d"); if (c) c.style.cursor = "crosshair"; }
    if (dom.chip) { dom.chip.classList.toggle("on", st.on); dom.chip.setAttribute("aria-pressed", st.on); } setHint(st.on); toast(st.on ? "检查模式:准星指到的物体会高亮并显示属性(右键锁定)" : "检查模式已关闭"); return st.on;
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
    return `<header class="ih"><span class="ico">${c.icon}</span><div class="tt"><b>${E(c.title)}${c.part ? `<span class="part">${E(c.part)}</span>` : ""}${c.chips || ""}</b><small>${E(c.sub)}</small></div><div class="dd"><span>${f1(c.dist, 1)} m</span>${st.pin ? `<em class="pinned">已锁定</em>` : ""}</div></header><div class="ib">${c.cols.flat().map(secH).join("")}</div>${st.pin ? `<footer class="if">右键再点一次(或按 I)取消锁定</footer>` : ""}`;
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
    const o = [p.x, -p.z, p.y], T = pick(o, [d[0] / L, d[1] / L, d[2] / L]); if (st.pin && (!T || T.key === st.pin.key)) { st.pin = null; toast("已取消锁定"); return; } if (!T) { toast("没有指到东西"); return; }
    st.pin = T; st.html = ""; showCard(T, true); toast("已锁定:" + (T.name || ""));
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
    ES.controls.add({ bodies: "all", group: "动作", keys: ["I"], codes: ["KeyI"], desc: "检查物体 · 右键锁定", fn: (code, down) => { if (down) toggle(); } });
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
