/* ES-World lab: state, placement, experiments and results. */
(function () {
  const ES = window.ES, P = ES.phys, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const A = (ES.app = { index: null, name: null, scene: null, variant: "day", look: "day", W: null, ents: [], sel: null, tool: null, exp: "view", par: { hide: "snr", cov: "rate", heat: "spl", route: { agent: null, goal: null, iso: false }, relay: null }, episodes: {}, nid: 1, api: null, timing: "" });
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const fmt = ES.fmt;
  const CAMS = ["uav", "dog", "human", "rover", "cp"];
  const EXPS = {
    view: ["视野", "相机能看见什么:视锥 + 遮挡(建筑、围栏、树冠、停放车辆)。目标只有在视锥内、没被挡、且大到足够多像素时才算\"看得见\"。"],
    sound: ["声场", "声源经几何扩散、空气吸收、绕过屋角和屋顶、穿墙泄漏传到各处;接收者要盖过环境噪声和自身噪声(旋翼、步态)才听得见。"],
    rf: ["通信", "从选中的节点发射,链路预算 = 发射功率 − 路径损耗(自由空间、绕射、穿墙)− 噪声;速率取自各制式的调制编码表。"],
    route: ["路径", "同一起终点,人、狗、机器人、无人机各自怎么走:栅格 A* + 障碍膨胀 + 拉直;无人机沿直线并检查净空。"],
    lidar: ["雷达", "从选中智能体的位置发射多线激光:射线对建筑、围栏、车辆、树干求交,含测距噪声。"],
    fusion: ["综合", "谁看见了谁、谁听见了谁、观察者能不能把信息送回指挥站,以及要多久。"],
  };
  const mk = (kind, x, y, extra = {}) => {
    const d = ES.DEVICES[kind], t = kind.startsWith("t:") ? ES.TARGETS[kind.slice(2)] : null;
    const e = Object.assign({ id: A.nid++, kind, x, y, z: d ? d.z : t ? t.z : 1.6 }, extra);
    if (d) { e.yaw = extra.yaw ?? 0; if (d.cam) { e.hfov = extra.hfov ?? d.cam.hfov; e.pitch = extra.pitch ?? ES.rad(d.cam.pitch); } }
    if (kind === "sound") { e.sound = extra.sound || "speech_shout"; e.z = extra.z ?? 1.5; }
    const same = A.ents.filter((q) => q.kind === kind).length + 1;
    e.name = extra.name || (d ? d.short : t ? t.short : kind === "sound" ? ES.SOUNDS[e.sound].label : kind) + same;
    return e;
  };
  const byId = (id) => A.ents.find((e) => e.id === id);
  const camOf = (e) => { const d = ES.DEVICES[e.kind]; const c = { x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch ?? 0, hfov: e.hfov ?? d.cam.hfov, aspect: d.cam.res[0] / d.cam.res[1], res: d.cam.res, omni: !!A.par.omni, range: 250 }; return c; };

  /* ================= scene loading ================= */
  async function loadScene(name, variant) {
    A.name = name; A.variant = variant || (A.variant === "quake" && ES.sceneHas(name, "quake") ? "quake" : "day");
    if (!A.scenes) A.scenes = {};
    if (!A.scenes[name]) A.scenes[name] = await ES.loadJSON(`data/scene_${name}.json`);
    A.scene = A.scenes[name]; rebuildWorld();
    if (!A.episodes[name]) A.episodes[name] = ES.loadJSON(`data/episode_${name}.json`).catch(() => null);
    $$("#scenes .scene").forEach((b) => b.setAttribute("aria-pressed", b.dataset.name === name));
    $("#scenedesc").textContent = A.scene.desc + `(${A.scene.size} m 见方,${A.scene.buildings.length} 栋建筑,${A.scene.trees.length} 棵树)`;
    $$("#seg-variant button").forEach((b) => { const ok = A.scene.variants[b.dataset.v]; b.disabled = !ok; b.style.opacity = ok ? 1 : 0.4; b.setAttribute("aria-pressed", b.dataset.v === A.variant); });
  }
  ES.sceneHas = (n, v) => !!(A.scenes && A.scenes[n] && A.scenes[n].variants[v]) || (A.index && A.index.scenes.find((s) => s.name === n && s.variants.includes(v)));
  function rebuildWorld() {
    const o = A.occ || { fences: true, trees: true, vehicles: true };
    A.W = new ES.World(A.scene, A.variant, { fences: o.fences, trees: o.trees, vehicles: o.vehicles }); A.geoCache = {};
    A.map.setScene(A.scene, A.W); recompute();
  }
  ES.sceneChanged = () => { A.ents = []; A.sel = null; defaultConfig(); renderEnts(); };

  /* ================= placement ================= */
  const TOOLS = [["uav", "无人机"], ["dog", "机械狗"], ["human", "人员"], ["rover", "机器人"], ["cp", "指挥站"], ["sound", "声源"], ["t:person", "站立者"], ["t:lying", "倒地者"], ["t:vehicle", "车辆目标"], ["select", "选择/移动"]];
  function buildTools() {
    $("#tools").innerHTML = TOOLS.map(([k, n]) => {
      const c = k === "sound" ? "#b8860b" : k === "select" ? "var(--muted)" : k.startsWith("t:") ? ES.TARGETS[k.slice(2)].color : ES.DEVICES[k].color;
      return `<button class="tool" data-tool="${k}" aria-pressed="false"><i style="background:${c}"></i>${n}</button>`;
    }).join("");
    $$("#tools .tool").forEach((b) => b.addEventListener("click", () => { A.tool = A.tool === b.dataset.tool ? null : b.dataset.tool; syncTool(); }));
  }
  function syncTool() {
    $$("#tools .tool").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === A.tool));
    $("#map").style.cursor = A.tool && A.tool !== "select" ? "crosshair" : "default";
    $("#hint").textContent = A.tool && A.tool !== "select" ? "点击地图放置:" + (TOOLS.find((t) => t[0] === A.tool) || [0, ""])[1] + "(再点一次工具取消)" : A.exp === "route" && !A.par.route.goal ? "路径实验:先选一个智能体,再点\"设终点\"后点地图。" : "拖动实体移动;拖动白色圆点改朝向。";
  }
  function place(x, y) {
    if (A.tool === "goal") { A.par.route.goal = [x, y]; A.tool = null; syncTool(); recompute(); return; }
    if (!A.tool || A.tool === "select") return;
    const e = mk(A.tool, x, y); if (e.kind === "sound") e.sound = $("#soundtype") ? $("#soundtype").value : "speech_shout";
    if (e.kind === "sound") e.name = ES.SOUNDS[e.sound].label + (A.ents.filter((q) => q.kind === "sound").length + 1);
    A.ents.push(e); A.sel = e.id; A.tool = null; syncTool(); renderEnts(); recompute();
  }
  function remove() { if (A.sel == null) return; A.ents = A.ents.filter((e) => e.id !== A.sel); A.sel = null; renderEnts(); recompute(); }
  async function defaultConfig() {
    const sc = A.scene, ep = await A.episodes[A.name]; A.ents = []; A.nid = 1;
    A.ents.push(mk("cp", sc.cp[0], sc.cp[1], { name: "指挥站", yaw: 0.2 }));
    if (ep) {
      const k = Math.min(Math.round(28 / ep.dt), ep.agents.dog_0.n - 1), a = ep.agents;
      const pos = (id) => { const g = a[id]; const i = Math.min(k, g.n - 1); return [g.pos[i][0], g.pos[i][1], g.pos[i][2], g.yaw[i]]; };
      if (a.dog_0) { const [x, y, , yaw] = pos("dog_0"); A.ents.push(mk("dog", x, y, { yaw, name: "机械狗" })); }
      if (a.uav_0) { const [x, y, z, yaw] = pos("uav_0"); const e = mk("uav", x, y, { yaw, z: Math.max(12, z), name: "无人机" }); const g = a.uav_0.gimbal ? a.uav_0.gimbal[Math.min(k, a.uav_0.n - 1)] : null; if (g) { e.yaw = g[0]; e.pitch = -g[1]; }  /* dataset gimbal pitch: + = down; the lab: + = up */ A.ents.push(e); }
      if (a.rover_0) { const [x, y, , yaw] = pos("rover_0"); A.ents.push(mk("rover", x, y, { yaw, name: "机器人" })); }
      if (A.variant === "day") {
        ["human_0", "human_1", "human_2", "human_3", "human_4"].forEach((id, i) => { if (!a[id]) return; const [x, y, , yaw] = pos(id), role = a[id].role || "stand";
          if (i === 0) A.ents.push(mk("human", x, y, { yaw, name: "应急人员" })); else A.ents.push(mk(role === "lie" ? "t:lying" : "t:person", x, y, { name: role === "wave" ? "挥手者" : role === "lie" ? "倒地者" : "居民" + i })); });
      }
    }
    if (A.variant !== "day") {                              // quake: put the UAV above the survivors, looking along the damaged strip
      const sv = (A.W.variantData.survivors || []); if (sv.length) { const u = A.ents.find((q) => q.kind === "uav"), cx = sv.reduce((a, s) => a + s.xy[0], 0) / sv.length, cy = sv.reduce((a, s) => a + s.xy[1], 0) / sv.length; if (u) { u.x = cx; u.y = Math.max(5, cy - 22); u.z = 34; u.yaw = Math.PI / 2; u.pitch = ES.rad(-62); } }
    }
    if (A.variant !== "day") { const v = A.W.variantData; (v.survivors || []).forEach((s, i) => A.ents.push(mk("t:lying", s.xy[0], s.xy[1], { name: "幸存者" + (i + 1), z: s.z + 0.2 }))); if (!A.ents.find((e) => e.kind === "human")) { const h = (ep && ep.agents.human_0) ? ep.agents.human_0.pos[Math.min(140, ep.agents.human_0.n - 1)] : [sc.cp[0] + 8, sc.cp[1] + 6]; A.ents.push(mk("human", h[0], h[1], { name: "应急人员" })); } }
    A.sel = null; renderEnts(); recompute();
  }

  /* ================= entity list & properties ================= */
  function renderEnts() {
    $("#ents").innerHTML = A.ents.map((e) => { const st = A.map.entityStyle(e); return `<div class="ent" role="option" data-id="${e.id}" aria-selected="${e.id === A.sel}"><i style="background:${st.color}"></i><span>${esc(e.name)}</span><span><small>${fmt(e.x, 0)},${fmt(e.y, 0)}${e.z > 2 && e.kind !== "cp" ? " ↑" + fmt(e.z, 0) : ""}</small><button data-del="${e.id}" aria-label="删除">×</button></span></div>`; }).join("") || `<div class="note">还没有放置任何实体。点\"载入示例配置\"或选择上面的工具。</div>`;
    $$("#ents .ent").forEach((el) => el.addEventListener("click", (ev) => { if (ev.target.dataset.del) { A.sel = +ev.target.dataset.del; remove(); } else { A.sel = +el.dataset.id; renderEnts(); A.map.draw(); updatePreview(); } }));
    renderProps();
  }
  function renderProps() {
    const el = $("#props"), e = byId(A.sel); if (!e) { el.hidden = true; return; } el.hidden = false;
    const d = ES.DEVICES[e.kind], rows = [];
    const slider = (key, label, min, max, step, val, unit) => `<label>${label}</label><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${fmt(val, step < 1 ? 1 : 0)}${unit}</output>`;
    if (e.yaw !== undefined) rows.push(slider("heading", "朝向", -180, 180, 1, Math.round(ES.deg(e.yaw ?? 0)), "°"));
    if (e.kind === "uav") rows.push(slider("z", "高度", 5, 120, 1, e.z, " m"));
    if (e.kind === "sound") rows.push(slider("z", "声源高度", 0.3, 20, 0.1, e.z, " m"));
    if (e.kind.startsWith("t:")) rows.push(slider("z", "离地高度", 0, 8, 0.1, e.z, " m"));
    if (d && d.cam) { rows.push(slider("hfov", "水平视角", 40, 140, 1, e.hfov, "°")); rows.push(slider("pitch", "俯仰", -90, 30, 1, Math.round(ES.deg(e.pitch)), "°")); }
    if (e.kind === "sound") rows.push(`<label>类型</label><select data-k="sound" style="grid-column:2/4">${Object.entries(ES.SOUNDS).map(([k, v]) => `<option value="${k}" ${k === e.sound ? "selected" : ""}>${v.label} · ${v.l1m} dB(A)@1 m</option>`).join("")}</select>`);
    el.innerHTML = `<div class="row" style="justify-content:space-between"><h3>${esc(e.name)}</h3><span class="pill muted">${d ? "嵌套模型 " + d.tier + "·" + d.modes + " 模式" : ""}</span></div>
      ${d ? `<div class="note">${d.label}<br>${d.sensors}</div>` : ""}
      ${(d && e.kind !== "uav" && A.W.solidAt(e.x, e.y, 1.0)) || (e.kind.startsWith("t:") && A.W.solidAt(e.x, e.y, e.z)) ? `<div class="note warn">这个位置在建筑或实体内部,结果可能不合理。</div>` : ""}
      <div class="prop">${rows.join("")}<label>位置</label><span class="mono" style="grid-column:2/4;font-size:.8rem">x ${fmt(e.x)} m · y ${fmt(e.y)} m</span></div>`;
    $$("[data-k]", el).forEach((inp) => inp.addEventListener("input", () => {
      const k = inp.dataset.k, v = inp.type === "range" ? +inp.value : inp.value;
      if (k === "heading") e.yaw = ES.rad(v); else if (k === "pitch") e.pitch = ES.rad(v); else if (k === "sound") { e.sound = v; e.name = ES.SOUNDS[v].label; } else e[k] = v;
      if (inp.type === "range") inp.nextElementSibling.textContent = fmt(+inp.value, 0) + (k === "z" ? " m" : "°"); recomputeSoon(); if (k === "sound") renderEnts();
    }));
  }
  const hooks = {
    entities: () => A.ents, selected: () => A.sel, tool: () => A.tool,
    select: (id) => { A.sel = id; renderEnts(); A.map.draw(); updatePreview(); }, place, remove,
    changed: (e, what) => { if (what === "done") { renderEnts(); updatePreview(); } recomputeSoon(); A.map.draw(); },
    cursor: (p) => { $("#cursor").textContent = p ? `x ${fmt(p[0])}  y ${fmt(p[1])} m` + (A.W && A.W.inside(p[0], p[1]) ? `  h ${fmt(A.W.hB[A.W.ij(p[0], p[1])], 1)} m` : "") : "—"; },
  };

  /* ================= experiments ================= */
  let tmr = null; const recomputeSoon = () => { clearTimeout(tmr); tmr = setTimeout(recompute, 60); };
  const T = (f) => { const t = performance.now(); const r = f(); A.timing = ((performance.now() - t)).toFixed(0) + " ms"; return r; };
  function setLegend(title, vmin, vmax, cmap, unit = "") {
    const lg = $("#legend"); if (!title) { lg.style.display = "none"; return; } lg.style.display = "block"; $("#legtitle").textContent = title;
    const c = $("#legbar").getContext("2d"), t = ES.cmap[cmap]; for (let i = 0; i < 180; i++) { const k = Math.round((i / 179) * 255); c.fillStyle = `rgb(${t[k * 3]},${t[k * 3 + 1]},${t[k * 3 + 2]})`; c.fillRect(i, 0, 1, 10); }
    $("#legticks").innerHTML = cmap === "yellow" ? `<span>看不见</span><span></span><span>看得见</span>` : `<span>${fmt(vmin, 0)}${unit}</span><span>${fmt((vmin + vmax) / 2, 0)}</span><span>${fmt(vmax, 0)}${unit}</span>`;
  }
  const ambient = () => (A.look === "night" ? P.AMBIENT.night : P.AMBIENT.day);
  const R = (h) => ($("#results").innerHTML = h);
  const targets = () => A.ents.filter((e) => e.kind.startsWith("t:"));
  const agents = () => A.ents.filter((e) => ES.DEVICES[e.kind]);
  const node = (e) => ({ id: e.id, name: e.name, x: e.x, y: e.y, z: e.kind === "uav" ? e.z : ES.DEVICES[e.kind].antH, radios: ES.DEVICES[e.kind].radios, kind: e.kind });

  function recompute() {
    if (!A.W) return;
    A.map.overlays = []; setLegend(null);
    try { ({ view: expView, sound: expSound, rf: expRF, route: expRoute, lidar: expLidar, fusion: expFusion })[A.exp](); } catch (err) { console.error(err); R(`<div class="note bad">计算出错:${esc(err.message)}</div>`); }
    A.map.draw(); drawPreviewSoon();
  }
  function expParams() {
    const el = $("#expparams"); let h = "";
    if (A.exp === "view") h = `<label class="row"><input type="checkbox" id="p-omni" ${A.par.omni ? "checked" : ""}> 忽略朝向(360° 全向,看纯遮挡)</label><label class="row">目标高度 <select id="p-zt"><option value="1.0">站立的人 1.0 m</option><option value="0.3">倒地的人 0.3 m</option><option value="1.5">车顶 1.5 m</option></select></label>`;
    else if (A.exp === "sound") h = `<div class="row"><select id="soundtype">${Object.entries(ES.SOUNDS).map(([k, v]) => `<option value="${k}" ${k === "speech_shout" ? "selected" : ""}>${v.label} · ${v.l1m} dB</option>`).join("")}</select><span class="muted" style="font-size:.8rem">选\"声源\"工具后点地图</span></div>
      <label class="row"><input type="checkbox" id="p-self" ${A.par.self !== false ? "checked" : ""}> 智能体自身发声(旋翼、步态)</label><div class="seg" id="seg-heat"><button data-v="spl" aria-pressed="${A.par.heat === "spl"}">声压级 dB(A)</button><button data-v="snr" aria-pressed="${A.par.heat === "snr"}">相对环境噪声</button></div>`;
    else if (A.exp === "rf") { const tx = byId(A.par.tx) || A.ents.find((e) => e.kind === "cp") || agents()[0]; A.par.tx = tx ? tx.id : null;
      h = `<div class="row"><label>发射节点 <select id="p-tx">${agents().map((e) => `<option value="${e.id}" ${tx && e.id === tx.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label><label>制式 <select id="p-radio">${tx ? ES.DEVICES[tx.kind].radios.map((k) => `<option value="${k}" ${A.par.radio === k ? "selected" : ""}>${ES.RADIOS[k].label}</option>`).join("") : ""}</select></label></div>
      <div class="seg" id="seg-cov"><button data-v="rate" aria-pressed="${A.par.cov === "rate"}">速率 Mbit/s</button><button data-v="snr" aria-pressed="${A.par.cov === "snr"}">信噪比 dB</button></div>
      <div class="row"><button class="btn" id="btn-relay">找最佳中继位置(无人机)</button></div>`; }
    else if (A.exp === "route") { const mv = agents().filter((e) => e.kind !== "cp"); if (!byId(A.par.route.agent)) A.par.route.agent = mv[0] ? mv[0].id : null;
      h = `<div class="row"><label>出发 <select id="p-ragent">${mv.map((e) => `<option value="${e.id}" ${e.id === A.par.route.agent ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label><button class="btn primary" id="btn-goal">设终点(点地图)</button></div><label class="row"><input type="checkbox" id="p-iso" ${A.par.route.iso ? "checked" : ""}> 显示可达时间场(等时圈)</label>`; }
    else if (A.exp === "lidar") { const L = agents().filter((e) => e.kind !== "cp"); if (!byId(A.par.lidar)) A.par.lidar = L[0] ? L[0].id : null;
      h = `<label class="row">传感器所在智能体 <select id="p-lagent">${L.map((e) => `<option value="${e.id}" ${e.id === A.par.lidar ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label><label class="row">量程 <input type="range" id="p-lr" min="10" max="60" value="${A.par.lrange || 30}"><output id="p-lro">${A.par.lrange || 30} m</output></label>`; }
    el.innerHTML = h;
    const on = (id, ev, f) => { const x = $(id); if (x) x.addEventListener(ev, f); };
    on("#p-omni", "change", (e) => { A.par.omni = e.target.checked; recompute(); }); on("#p-zt", "change", (e) => { A.par.zt = +e.target.value; recompute(); });
    if ($("#p-zt")) $("#p-zt").value = A.par.zt || 1.0;
    on("#p-self", "change", (e) => { A.par.self = e.target.checked; recompute(); });
    $$("#seg-heat button").forEach((b) => b.addEventListener("click", () => { A.par.heat = b.dataset.v; expParams(); recompute(); }));
    $$("#seg-cov button").forEach((b) => b.addEventListener("click", () => { A.par.cov = b.dataset.v; expParams(); recompute(); }));
    on("#p-tx", "change", (e) => { A.par.tx = +e.target.value; A.par.radio = null; expParams(); recompute(); }); on("#p-radio", "change", (e) => { A.par.radio = e.target.value; recompute(); });
    on("#btn-relay", "click", findRelay);
    on("#p-ragent", "change", (e) => { A.par.route.agent = +e.target.value; recompute(); }); on("#btn-goal", "click", () => { A.tool = "goal"; syncTool(); }); on("#p-iso", "change", (e) => { A.par.route.iso = e.target.checked; recompute(); });
    on("#p-lagent", "change", (e) => { A.par.lidar = +e.target.value; recompute(); }); on("#p-lr", "input", (e) => { A.par.lrange = +e.target.value; $("#p-lro").textContent = e.target.value + " m"; recomputeSoon(); });
  }

  /* ---- 1. view ---- */
  function viewData() {
    const cams = A.ents.filter((e) => CAMS.includes(e.kind)), zt = A.par.zt || 1.0, out = [];
    for (const e of cams) { const c = camOf(e); c.range = Math.min(250, P.detectRange(c, 1.7)); out.push({ e, c, B: P.camBasis(c) }); }
    return { cams: out, zt };
  }
  function seen(cc, t) { const tg = ES.TARGETS[t.kind.slice(2)], rng = Math.min(250, P.detectRange(cc.c, tg.ext)); const c2 = Object.assign({}, cc.c, { range: rng }); return P.visibleT(A.W, c2, cc.B, t.x, t.y, t.z); }
  function expView() {
    const { cams, zt } = viewData(); if (!cams.length) { R(`<div class="note">先放置一个带相机的智能体(无人机、机械狗、人员、机器人或指挥站)。</div>`); return; }
    const union = T(() => { let un = null; const stats = []; for (const cc of cams) { const vs = P.viewshed(A.W, cc.c, zt); stats.push(vs.frac); if (!un) un = { grid: vs.grid.slice(), N: vs.N, res: vs.res, x0: vs.x0, y0: vs.y0, free: vs.free }; else for (let i = 0; i < vs.grid.length; i++) if (vs.grid[i] > un.grid[i]) un.grid[i] = vs.grid[i];
        A.map.overlays.push({ type: "poly", pts: P.footprint(cc.c), stroke: cc.e.id === A.sel ? "#111" : ES.DEVICES[cc.e.kind].color, width: cc.e.id === A.sel ? 2.5 : 1.4, dash: [6, 4] }); } return { un, stats }; });
    const un = union.un; A.map.overlays.unshift({ type: "heat", grid: un.grid, N: un.N, res: un.res, x0: un.x0, y0: un.y0, vmin: 0, vmax: 1, cmap: "yellow", alpha: 0.5, hideBelow: 0.25 });
    let seenN = 0; for (let i = 0; i < un.grid.length; i++) if (un.grid[i] > 0.25) seenN++; const frac = seenN / un.free;
    const tg = targets(); let rows = "";
    for (const t of tg) { const who = cams.filter((cc) => seen(cc, t) > 0.25).map((cc) => cc.e.name); rows += `<tr><td>${esc(t.name)}</td><td>${who.length ? `<span class="ok">✓</span> ${esc(who.join("、"))}` : `<span class="bad">✗ 无人看见</span>`}</td></tr>`; }
    R(`<dl class="kv"><dt>相机数</dt><dd>${cams.length}</dd><dt>联合覆盖(地面可行走面积)</dt><dd>${fmt(100 * frac, 1)} %</dd>${cams.map((cc, i) => `<dt>${esc(cc.e.name)} 单独</dt><dd>${fmt(100 * union.stats[i], 1)} %  · 检出 ${fmt(cc.c.range, 0)} m</dd>`).join("")}</dl>
      ${tg.length ? `<table><tr><th>目标</th><th>谁看得见</th></tr>${rows}</table>` : `<div class="note">放置"站立者/倒地者/车辆"目标,可逐个检查谁能看见。</div>`}
      <div class="note">“检出距离”= 目标占满 14 个像素所允许的最远距离(相机分辨率与视角决定)。耗时 ${A.timing}。</div>`);
    setLegend("黄色 = 至少一台相机看得见(目标高 " + zt + " m)", 0, 1, "yellow");
  }

  /* ---- 2. sound ---- */
  function soundSources() {
    const s = A.ents.filter((e) => e.kind === "sound").map((e) => ({ id: e.id, name: e.name, x: e.x, y: e.y, z: e.z, l1m: ES.SOUNDS[e.sound].l1m, speech: /speech|shout/.test(e.sound) }));
    if (A.par.self !== false) for (const e of agents()) { if (e.kind === "uav") s.push({ id: "self" + e.id, name: e.name + " 旋翼", x: e.x, y: e.y, z: e.z, l1m: 77, self: e.id }); else if (e.kind === "dog") s.push({ id: "self" + e.id, name: e.name + " 步态", x: e.x, y: e.y, z: 0.3, l1m: 65, self: e.id }); else if (e.kind === "rover") s.push({ id: "self" + e.id, name: e.name + " 电机", x: e.x, y: e.y, z: 0.3, l1m: 55, self: e.id }); }
    for (const t of targets()) { const tg = ES.TARGETS[t.kind.slice(2)]; if (t.kind !== "t:person") s.push({ id: "tg" + t.id, name: t.name + " " + tg.snd.split("(")[0], x: t.x, y: t.y, z: t.z + 0.4, l1m: tg.spl, speech: t.kind === "t:lying", tgt: t.id }); }
    return s;
  }
  function expSound() {
    const src = soundSources(); if (!src.length) { R(`<div class="note">放置一个声源(选"声源"工具后点地图),或打开"智能体自身发声"。</div>`); return; }
    if (Object.keys(A.geoCache).length > 40) A.geoCache = { gm: A.geoCache.gm };               // bound the cache while a source is being dragged
    const amb = ambient(), hm = A.par.heat;
    const f = T(() => P.soundField(A.W, src, 1.6, 4)); const g = f.grid;
    if (hm === "snr") { for (let i = 0; i < g.length; i++) if (!Number.isNaN(g[i])) g[i] = g[i] - amb; }
    const vmin = hm === "snr" ? -20 : 20, vmax = hm === "snr" ? 50 : 100;
    A.map.overlays.push({ type: "heat", grid: g, N: f.N, res: f.res, x0: f.x0, y0: f.y0, vmin, vmax, cmap: "magma", alpha: 0.62, hideBelow: hm === "snr" ? -20 : 20, smooth: true });
    setLegend(hm === "snr" ? "声源 − 环境噪声 (dB)" : "A 计权声压级 (dB, 耳高 1.6 m)", vmin, vmax, "magma", "");
    for (const s of src) A.map.overlays.push({ type: "marker", x: s.x, y: s.y, color: "#b8860b", r: 7 });
    // receivers
    const rec = agents(); let rows = "";
    for (const r of rec) {
      const d = ES.DEVICES[r.kind], zr = r.kind === "uav" ? r.z : r.kind === "cp" ? 3 : r.kind === "dog" ? 0.3 : 1.6, floor = P.NOISE_FLOOR(r.kind, amb);
      const gm = A.geoCache.gm || (A.geoCache.gm = P.coarseMask(A.W, 2, 2.5)); const ls = [];
      for (const s of src) { if (s.self === r.id) continue; const F = (A.geoCache["s" + s.id + ":" + s.x.toFixed(1) + s.y.toFixed(1)] ||= P.geodesic(gm, s.x, s.y)); ls.push({ s, Lp: P.soundAt(A.W, s, r.x, r.y, zr, F).Lp }); }
      const best = ls.sort((a, b) => b.Lp - a.Lp)[0]; const heard = ls.filter((x) => x.Lp - floor >= 0);
      rows += `<tr><td>${esc(r.name)}</td><td class="mono">${fmt(floor, 0)}</td><td>${heard.length ? heard.slice(0, 3).map((x) => `<span class="ok">${esc(x.s.name)}</span> <span class="mono">${fmt(x.Lp, 0)}${x.s.speech && x.Lp - floor >= 10 ? " ✓听清" : ""}</span>`).join("<br>") : `<span class="bad">没听到</span>${best ? ` <span class="muted mono">最大 ${fmt(best.Lp, 0)}</span>` : ""}`}</td></tr>`;
    }
    R(`<dl class="kv"><dt>声源数</dt><dd>${src.length}</dd><dt>环境噪声</dt><dd>${amb} dB(A)(${A.look === "night" ? "夜间" : "白天"})</dd></dl>
      <table><tr><th>接收者</th><th>噪声底 dB</th><th>能听到</th></tr>${rows}</table>
      <div class="note">噪声底 = 环境噪声与自身噪声(无人机旋翼 92、机械狗步态 78 dB)的能量和。听见:声源高于噪声底;听清人声:高出 10 dB 以上。耗时 ${A.timing}。</div>`);
  }

  /* ---- 3. rf ---- */
  function netData() { const nodes = agents().map(node); return { nodes, links: nodes.length > 1 ? P.network(A.W, nodes) : [] }; }
  function expRF() {
    const tx = byId(A.par.tx); if (!tx || !ES.DEVICES[tx.kind]) { R(`<div class="note">放置一个指挥站或智能体作为发射节点。</div>`); return; }
    const rk = A.par.radio && ES.DEVICES[tx.kind].radios.includes(A.par.radio) ? A.par.radio : ES.DEVICES[tx.kind].radios[0]; A.par.radio = rk;
    const nd = node(tx), cov = T(() => P.coverage(A.W, nd, rk, 1.2, 4)), isRate = A.par.cov === "rate";
    const g = isRate ? cov.rate : cov.snr; if (isRate) { for (let i = 0; i < g.length; i++) if (Number.isNaN(cov.snr[i])) g[i] = NaN; }
    const vmax = isRate ? Math.max(1, Math.max(...cov.rate.filter((v) => !Number.isNaN(v))) * 0.9) : 40;
    A.map.overlays.push({ type: "heat", grid: g, N: cov.N, res: cov.res, x0: cov.x0, y0: cov.y0, vmin: isRate ? 0 : -10, vmax, cmap: "viridis", alpha: 0.55, smooth: true });
    setLegend((isRate ? "可达速率 Mbit/s" : "信噪比 dB") + " · " + ES.RADIOS[rk].label, isRate ? 0 : -10, vmax, "viridis");
    const net = netData(), cp = net.nodes.findIndex((n) => n.kind === "cp"); let rows = "", lrows = "";
    for (const l of net.links) { const a = net.nodes[l.a], b = net.nodes[l.b]; const col = l.rate >= 20 ? "#23a455" : l.rate >= 1 ? "#e69f00" : l.rate > 0 ? "#d55e00" : "#999";
      A.map.overlays.push({ type: "line", pts: [[a.x, a.y], [b.x, b.y]], color: col, width: l.rate > 0 ? 2.2 : 1, dash: l.rate > 0 ? [] : [3, 5] });
      lrows += `<tr><td>${esc(a.name)} ↔ ${esc(b.name)}</td><td class="mono">${l.tech}</td><td class="mono">${fmt(l.rate, l.rate < 10 ? 2 : 0)}<span class="muted"> / ${fmt(l.good, l.good < 10 ? 2 : 0)}</span></td><td class="mono">${fmt(l.snr, 0)}</td><td>${l.los ? "视距" : "遮挡"}</td></tr>`; }
    if (cp >= 0) for (let i = 0; i < net.nodes.length; i++) { if (i === cp) continue; const r2 = P.route(net.nodes, net.links, i, cp, ES.PAYLOADS.video.bytes), rS = P.route(net.nodes, net.links, i, cp, ES.PAYLOADS.state.bytes), rL = P.route(net.nodes, net.links, i, cp, ES.PAYLOADS.lidar.bytes);
      rows += `<tr><td>${esc(net.nodes[i].name)}</td><td>${r2 ? r2.path.map((k) => esc(net.nodes[k].name)).join(" → ") : '<span class="bad">不通</span>'}</td><td class="mono">${rS ? fmt(rS.latency_s * 1e3, 0) + " ms" : "—"}</td><td class="mono">${rL ? fmt(rL.latency_s * 1e3, 0) + " ms" : "—"}</td><td class="mono">${r2 ? fmt(r2.latency_s * 1e3, 0) + " ms" : "—"}</td></tr>`; }
    R(`<dl class="kv"><dt>发射</dt><dd>${esc(tx.name)} · ${esc(ES.RADIOS[rk].label)}</dd><dt>耗时</dt><dd>${A.timing}</dd></dl>
      ${lrows ? `<table><tr><th>链路</th><th>制式</th><th>PHY / 吞吐 Mbit/s</th><th>SNR</th><th></th></tr>${lrows}</table>` : `<div class="note">至少放置两个节点才有链路。</div>`}
      ${rows ? `<h4 style="margin-top:6px">送回指挥站(最宽路径,含多跳)</h4><table><tr><th>从</th><th>路径</th><th>2 KB</th><th>256 KB</th><th>1 MB</th></tr>${rows}</table>` : ""}
      ${A.par.relay ? `<div class="card"><b>最佳中继位置</b><br>${A.par.relay.txt}</div>` : ""}`);
  }
  function findRelay() {
    const cp = A.ents.find((e) => e.kind === "cp"), others = agents().filter((e) => e.kind !== "cp" && e.kind !== "uav"); if (!cp || !others.length) { A.par.relay = { txt: "需要一个指挥站和至少一台地面智能体。" }; recompute(); return; }
    const tgt = others[0], z = 28, best = { rate: -1 }, W = A.W; const base = (() => { const l = P.network(W, [node(cp), node(tgt)]); return l[0] ? l[0].rate : 0; })();
    const uavR = ES.DEVICES.uav.radios;
    for (let x = 6; x < W.S; x += 6) for (let y = 6; y < W.S; y += 6) {
      const u = { id: -1, name: "中继", x, y, z, radios: uavR, kind: "uav" }, nodes = [node(cp), node(tgt), u], links = P.network(W, nodes), r = P.route(nodes, links, 1, 0, 262144);
      if (r && r.rate > best.rate) { best.rate = r.rate; best.x = x; best.y = y; best.r = r; }
    }
    A.par.relay = { txt: best.rate > 0 ? `无人机悬停在 (${best.x}, ${best.y}),高 ${z} m:${esc(tgt.name)} → 指挥站瓶颈速率 <span class="mono">${fmt(best.rate, 1)} Mbit/s</span>(无中继时 ${fmt(base, 1)}),256 KB 激光雷达扫描 ${fmt(best.r.latency_s * 1e3, 0)} ms。 <button class="btn" id="btn-place-relay">放置到此处</button>` : "没有找到能改善连通的位置。" };
    recompute(); const b = $("#btn-place-relay"); if (b) b.addEventListener("click", () => { A.ents.push(mk("uav", best.x, best.y, { z, name: "中继无人机" })); A.sel = null; renderEnts(); recompute(); });
    if (best.rate > 0) A.map.overlays.push({ type: "marker", x: best.x, y: best.y, color: "#cc79a7", r: 11, text: "最佳中继" }), A.map.draw();
  }

  /* ---- 4. route ---- */
  function expRoute() {
    const ag = byId(A.par.route.agent), goal = A.par.route.goal; if (!ag) { R(`<div class="note">放置一个能移动的智能体(狗、人员、机器人或无人机)。</div>`); return; }
    const emb = { dog: "dog", human: "human", rover: "rover", uav: "uav" }[ag.kind]; const a = [ag.x, ag.y];
    if (A.par.route.iso && emb !== "uav") { const rc = T(() => P.reach(A.W, a, emb, 2)); if (rc) A.map.overlays.push({ type: "heat", grid: rc.grid, N: rc.N, res: rc.res, x0: rc.x0, y0: rc.y0, vmin: 0, vmax: 90, cmap: "viridis", alpha: 0.5, hideBelow: 0, smooth: false }), setLegend(`${ag.name} 到达时间 (s)`, 0, 90, "viridis"); }
    if (!goal) { R(`<div class="note">点\"设终点\",再点地图。会同时给出人、狗、机器人、无人机各自的路线。</div>`); return; }
    A.map.overlays.push({ type: "marker", x: goal[0], y: goal[1], color: "#111", r: 9, text: "终点" });
    const rows = []; const colors = { human: "#009e73", dog: "#d55e00", rover: "#e69f00", uav: "#cc79a7" };
    const rs = T(() => ["human", "dog", "rover", "uav"].map((k) => k === "uav" ? [k, P.routeUAV(A.W, a, goal, ag.kind === "uav" ? ag.z : 28)] : [k, P.route2d(A.W, a, goal, k)]));
    for (const [k, r] of rs) { const nm = { human: "人", dog: "机械狗", rover: "机器人", uav: "无人机" }[k];
      if (!r.ok) { rows.push(`<tr><td>${nm}</td><td colspan="3" class="bad">${esc(r.reason)}</td></tr>`); continue; }
      if (k === "uav") { A.map.overlays.push({ type: "line", pts: [a, goal], color: colors[k], width: 2, dash: [8, 5] }); rows.push(`<tr><td>${nm}</td><td class="mono">${fmt(r.length, 0)} m</td><td class="mono">${fmt(r.time, 0)} s</td><td>飞行高度 ${fmt(r.altitude, 0)} m${r.climbed ? ",需爬升越过 " + fmt(r.hmax, 0) + " m 的楼" : ",净空足够"}</td></tr>`); }
      else { A.map.overlays.push({ type: "line", pts: r.pts, color: colors[k], width: k === emb ? 3.2 : 1.8, dash: k === emb ? [] : [] }); const direct = ES.dist(a, goal); rows.push(`<tr><td>${nm}${k === emb ? " ★" : ""}</td><td class="mono">${fmt(r.length, 0)} m</td><td class="mono">${fmt(r.time, 0)} s</td><td>绕行系数 ${fmt(r.length / direct, 2)}</td></tr>`); } }
    R(`<table><tr><th>载体</th><th>路程</th><th>用时</th><th>说明</th></tr>${rows.join("")}</table><div class="note">★ 为选中的智能体。人 1.4 m/s,狗 1.0 m/s,机器人 1.4 m/s,无人机 5 m/s;障碍膨胀 0.35 m,围栏只能走门洞。耗时 ${A.timing}。</div>`);
  }

  /* ---- 5. lidar ---- */
  function expLidar() {
    const e = byId(A.par.lidar); if (!e) { R(`<div class="note">放置一个智能体。</div>`); return; }
    const range = A.par.lrange || 30, o = { x: e.x, y: e.y, z: e.kind === "uav" ? e.z : e.kind === "dog" ? 0.57 : e.kind === "rover" ? 0.7 : 1.6 };
    const pts = T(() => P.lidar(A.W, o, { range, azStep: 0.8 })); const col = { 0: "rgba(120,120,120,.5)", 1: "#d55e00", 2: "#0072b2" };
    A.map.overlays.push({ type: "points", pts: pts.filter((p) => p[4] !== 0 || p[3] < range * 0.6).map((p) => [p[0], p[1], col[p[4]], p[4] === 0 ? 0.9 : 1.7]) });
    A.map.overlays.push({ type: "poly", pts: Array.from({ length: 64 }, (_, k) => [o.x + range * Math.cos((2 * Math.PI * k) / 64), o.y + range * Math.sin((2 * Math.PI * k) / 64)]), stroke: "rgba(0,0,0,.35)", width: 1, dash: [3, 4] });
    const n = [0, 0, 0]; let nearest = 1e9; for (const p of pts) { n[p[4]]++; if (p[4] > 0) nearest = Math.min(nearest, Math.hypot(p[0] - o.x, p[1] - o.y)); }
    R(`<dl class="kv"><dt>传感器</dt><dd>${esc(e.name)} · 高 ${fmt(o.z, 2)} m</dd><dt>返回点数</dt><dd>${pts.length}</dd><dt>其中 地面 / 实体 / 围栏</dt><dd>${n[0]} / ${n[1]} / ${n[2]}</dd><dt>最近障碍</dt><dd>${isFinite(nearest) ? fmt(nearest, 1) + " m" : "—"}</dd><dt>量程 · 噪声</dt><dd>${range} m · σ≈2 cm</dd><dt>耗时</dt><dd>${A.timing}</dd></dl>
      <div class="note">橙色 = 建筑/车辆/树干等实体,蓝色 = 围栏与细杆,灰色 = 近处地面。6 圈仰角 −12°…+28°,方位步长 0.8°。</div>`);
  }

  /* ---- 6. fusion ---- */
  function expFusion() {
    const cp = A.ents.find((e) => e.kind === "cp"); const { cams } = viewData(), tg = targets(), src = soundSources().filter((s) => s.tgt), amb = ambient();
    if (!tg.length) { R(`<div class="note">放置几个目标(站立者、倒地者、车辆),再放置无人机、狗、人员和指挥站。</div>`); return; }
    const net = netData(), cpi = net.nodes.findIndex((n) => n.kind === "cp"); const gm = A.geoCache.gm || (A.geoCache.gm = P.coarseMask(A.W, 2, 2.5));
    let rows = "", known = 0; const t0 = performance.now();
    for (const t of tg) {
      const seers = cams.filter((cc) => seen(cc, t) > 0.25).map((cc) => cc.e), hearers = [];
      const s = src.find((q) => q.tgt === t.id);
      if (s) { const F = P.geodesic(gm, s.x, s.y); for (const r of agents()) { const zr = r.kind === "uav" ? r.z : r.kind === "dog" ? 0.3 : 1.6; if (P.soundAt(A.W, s, r.x, r.y, zr, F).Lp - P.NOISE_FLOOR(r.kind, amb) >= 0) hearers.push(r); } }
      const obs = [...new Set([...seers, ...hearers])]; let best = null;
      for (const o of obs) { const i = net.nodes.findIndex((n) => n.id === o.id); const r = cpi >= 0 && i >= 0 ? (i === cpi ? { latency_s: 0, rate: Infinity, path: [i], hops: 0 } : P.route(net.nodes, net.links, i, cpi, ES.PAYLOADS.lidar.bytes)) : null; if (r && (!best || r.latency_s < best.r.latency_s)) best = { o, r }; }
      const ok = !!best; if (ok) known++;
      A.map.overlays.push({ type: "marker", x: t.x, y: t.y, color: ok ? "#23a455" : obs.length ? "#e69f00" : "#d62728", r: 12 });
      rows += `<tr><td>${esc(t.name)}</td><td>${seers.length ? esc(seers.map((x) => x.name).join("、")) : "—"}</td><td>${hearers.length ? esc(hearers.map((x) => x.name).join("、")) : "—"}</td><td>${ok ? `<span class="ok">✓</span> 经 ${esc(best.o.name)} · ${fmt(best.r.latency_s * 1e3, 0)} ms` : obs.length ? '<span class="warn">发现了但传不回</span>' : '<span class="bad">没被发现</span>'}</td></tr>`;
    }
    for (const l of net.links) { const a = net.nodes[l.a], b = net.nodes[l.b]; if (l.rate > 0) A.map.overlays.push({ type: "line", pts: [[a.x, a.y], [b.x, b.y]], color: "rgba(35,164,85,.55)", width: 1.6 }); }
    R(`<dl class="kv"><dt>目标数</dt><dd>${tg.length}</dd><dt>指挥站最终掌握</dt><dd><b>${known} / ${tg.length}</b></dd><dt>耗时</dt><dd>${(performance.now() - t0).toFixed(0)} ms</dd></dl>
      <table><tr><th>目标</th><th>看见</th><th>听见</th><th>送达指挥站(256 KB)</th></tr>${rows}</table>
      <div class="note">圈:绿 = 已送达,橙 = 被发现但传不回,红 = 没人发现。尝试:把无人机移高、加一台狗、拖动中继,观察哪些目标变绿。</div>`);
  }

  /* ================= 3D / preview placeholder (filled by view3d.js) ================= */
  let pvTmr = null;
  function drawPreviewSoon() { clearTimeout(pvTmr); pvTmr = setTimeout(updatePreview, 150); }
  function updatePreview() { if (ES.view3d) ES.view3d.update(A); }

  /* ================= engine status / fidelity ================= */
  async function loadFidelity() {
    try { const f = await ES.loadJSON("data/fidelity.json"); A.fid = f; $("#fidelity").innerHTML = ES.fidelityHTML ? ES.fidelityHTML(f) : ""; } catch (e) { $("#fidelity").innerHTML = `<div class="note">与 Python 完整引擎的对照结果尚未生成。</div>`; }
  }

  /* ================= local engine (serve_lab.py) ================= */
  const payload = () => A.ents.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, hfov: e.hfov, sound: e.sound, name: e.name }));
  async function api(path, body) {
    const r = await fetch(ES.api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { let t = ""; try { t = (await r.json()).error; } catch (e) {} throw new Error(path + " " + r.status + " " + t); }
    return r;
  }
  async function engineRecompute() {
    const box = $("#engineout"); box.innerHTML = `<div class="note">完整引擎计算中…</div>`;
    const exp = A.exp, what = { view: ["view"], sound: ["sound"], rf: ["rf"], route: ["route"], fusion: ["view", "rf", "sound"], lidar: [] }[exp];
    if (!what.length) { box.innerHTML = `<div class="note">雷达实验没有对应的 Python 引擎对照(激光雷达用射线求交,同一份几何)。</div>`; return; }
    const ag = byId(A.par.route.agent);
    try {
      const r = await (await api("/api/experiment", { scene: A.name, variant: A.variant, look: A.look, entities: payload(), what, params: { self: A.par.self !== false, a: ag ? [ag.x, ag.y] : null, goal: A.par.route.goal } })).json();
      box.innerHTML = engineTable(r);
    } catch (e) { box.innerHTML = `<div class="note bad">本机引擎调用失败:${esc(e.message)}</div>`; }
  }
  function engineTable(r) {
    let h = `<h4>完整 Python 引擎(${r.seconds} s)</h4>`; const nm = (id) => { const e = byId(id); return e ? esc(e.name) : "#" + id; };
    if (r.view) {
      const { cams } = viewData(); const rows = r.view.targets.map((t) => { const e = byId(t.id), br = cams.filter((cc) => seen(cc, e) > 0.25).map((cc) => cc.e.id); const same = JSON.stringify(br.sort()) === JSON.stringify(t.seen_by.slice().sort());
        return `<tr><td>${nm(t.id)}</td><td>${br.length ? br.map(nm).join("、") : "—"}</td><td>${t.seen_by.length ? t.seen_by.map(nm).join("、") : "—"}</td><td>${same ? "✓" : "≠"}</td></tr>`; }).join("");
      h += `<table><tr><th>目标</th><th>网页模型</th><th>引擎(仅建筑遮挡)</th><th></th></tr>${rows}</table><table><tr><th>相机</th><th>引擎视野占比</th></tr>${r.view.cams.map((c) => `<tr><td>${nm(c.id)}</td><td class="mono">${fmt(100 * c.frac, 1)} %</td></tr>`).join("")}</table>`;
    }
    if (r.rf) {
      const net = netData(); const rows = r.rf.links.map((l) => { const ia = net.nodes.findIndex((n) => n.id === l.a), ib = net.nodes.findIndex((n) => n.id === l.b), b = net.links.find((q) => (q.a === ia && q.b === ib) || (q.a === ib && q.b === ia));
        return `<tr><td>${nm(l.a)} ↔ ${nm(l.b)}</td><td class="mono">${b ? fmt(b.rate, 1) + " / " + fmt(b.snr, 0) + " dB" : "—"}</td><td class="mono">${fmt(l.rate, 1)} / ${fmt(l.snr, 0)} dB</td></tr>`; }).join("");
      h += `<table><tr><th>链路</th><th>网页:PHY Mbit/s / SNR</th><th>引擎:PHY / SNR</th></tr>${rows}</table>`;
    }
    if (r.sound) {
      const src = soundSources(); const rows = r.sound.receivers.map((rc) => { const e = byId(rc.id), zr = e.kind === "uav" ? e.z : e.kind === "cp" ? 3 : e.kind === "dog" ? 0.3 : 1.6; const gm = A.geoCache.gm || (A.geoCache.gm = P.coarseMask(A.W, 2, 2.5));
        return rc.heard.map((hh) => { const s = src.find((q) => (q.self ? "self" + q.self : q.tgt ? "tg" + q.tgt : "s" + q.id) === hh.src); if (!s) return ""; const F = P.geodesic(gm, s.x, s.y), b = P.soundAt(A.W, s, e.x, e.y, zr, F).Lp; return `<tr><td>${nm(rc.id)}</td><td>${esc(s.name)}</td><td class="mono">${fmt(b, 1)}</td><td class="mono">${fmt(hh.lp, 1)}</td></tr>`; }).join(""); }).join("");
      h += `<table><tr><th>接收者</th><th>声源</th><th>网页 dB(A)</th><th>引擎 dB(A)</th></tr>${rows}</table>`;
    }
    if (r.route) { const g = A.par.route.goal, a0 = byId(A.par.route.agent); const rb = a0 && g ? ["human", "dog"].map((k) => P.route2d(A.W, [a0.x, a0.y], g, k)) : []; h += `<table><tr><th>载体</th><th>网页</th><th>引擎</th></tr>${["human", "dog"].map((k, i) => `<tr><td>${k === "human" ? "人" : "机械狗"}</td><td class="mono">${rb[i] && rb[i].ok ? fmt(rb[i].length, 1) + " m" : "—"}</td><td class="mono">${r.route[k].ok ? fmt(r.route[k].length, 1) + " m" : "不可达"}</td></tr>`).join("")}</table>`; }
    return h + `<div class="note">两列差异来自网页模型的简化(以及它多算的围栏、树冠遮挡);系统性对照见"这些数字有多可信?"。</div>`;
  }
  async function engineRender() {
    const e = byId(A.sel), d = e && ES.DEVICES[e.kind]; const out = $("#renderout");
    if (!d || !d.cam) { out.innerHTML = `<div class="note">先选中一个带相机的智能体(无人机、狗、人员、机器人或指挥站)。</div>`; return; }
    const q = $("#render-q").value; $("#btn-render").disabled = true; out.innerHTML = `<div class="note">Blender 渲染中…(这台机器首次渲染某个场景/光照需要先构建场景,约 30 s)</div>`;
    try {
      const z = e.kind === "uav" ? e.z : d.antH || d.z; const r = await api("/api/render", { scene: A.name, variant: A.variant, look: A.look === "night" ? "night" : "day_cloud", quality: q, hide_owner: e.id, camera: { x: e.x, y: e.y, z, yaw: e.yaw, pitch: e.pitch || 0, hfov: e.hfov }, entities: payload() });
      const blob = await r.blob(), url = URL.createObjectURL(blob);
      out.innerHTML = `<figure><img src="${url}" alt="Blender 渲染" style="width:100%;border:1px solid var(--line)"><figcaption class="mono" style="font-size:.78rem">${esc(e.name)} 视角 · ${q === "hd" ? "1920×1080" : "960×540"} · 路径追踪 · ${r.headers.get("X-Render-Seconds") || "?"} s</figcaption></figure>`;
    } catch (err) { out.innerHTML = `<div class="note bad">渲染失败:${esc(err.message)}</div>`; }
    $("#btn-render").disabled = false;
  }
  function exportSpec() {
    const spec = { app: "es-world-lab", version: 1, scene: A.name, variant: A.variant, look: A.look, experiment: A.exp, params: A.par, entities: payload(), occluders: A.occ };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 1)], { type: "application/json" })); a.download = `es-world-${A.name}-${A.exp}.json`; a.click();
  }
  ES.bus.on("engine", () => { $("#btn-engine").hidden = false; $("#btn-render").disabled = false; $("#btn-render").title = "用本机 Blender 渲染选中智能体的视角"; });

  /* ================= quick examples ================= */
  const PRESETS = [
    { n: "震后找幸存者", d: "郊区震后:无人机、狗、人员能看见、听见几个幸存者?谁能把消息送回指挥站?", scene: "suburb", variant: "quake", look: "day", exp: "fusion" },
    { n: "夜里谁听得见喊叫", d: "夜晚更安静:同一声源在白天和夜晚被谁听见?试着把声源挪到楼后面。", scene: "suburb", variant: "day", look: "night", exp: "sound", sound: [60, 62] },
    { n: "中继无人机放哪", d: "商业街里楼挡住了地面设备的通信:让无人机找最佳中继位置。", scene: "mainstreet", variant: "day", look: "day", exp: "rf" },
    { n: "同一条路,四种载体", d: "庭院里从 A 到 B:人、狗、机器人、无人机各自怎么走、要多久。", scene: "courtyard", variant: "day", look: "day", exp: "route", goal: [0.82, 0.3] },
    { n: "无人机飞多高", d: "校园里看地面目标:高度、俯仰角、视角怎样改变覆盖面积(拖动无人机、改高度滑块)。", scene: "campus", variant: "day", look: "day", exp: "view" },
  ];
  async function runPreset(pr) {
    A.look = pr.look; $$("#seg-time button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === pr.look));
    await loadScene(pr.scene, pr.variant); await defaultConfig();
    if (pr.sound) { const e = mk("sound", pr.sound[0], pr.sound[1], { sound: "speech_shout" }); e.name = "喊叫"; A.ents.push(e); }
    if (pr.goal) A.par.route.goal = [pr.goal[0] * A.scene.size, pr.goal[1] * A.scene.size];
    $$("#seg-exp button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.e === pr.exp)); A.exp = pr.exp; $("#expdesc").textContent = EXPS[A.exp][1]; expParams(); renderEnts(); syncTool(); recompute();
    $("#hint").textContent = pr.d;
  }

  /* ================= boot ================= */
  async function boot() {
    A.index = await ES.loadJSON("data/index.json");
    A.map = new ES.MapView($("#map"), hooks);
    $("#scenes").innerHTML = A.index.scenes.map((s) => `<button class="scene" data-name="${s.name}" aria-pressed="false" title="${esc(s.title)}"><img src="img/${s.name}_day_day_cloud_aerial.jpg" alt="${esc(s.title)}" loading="lazy"><span>${esc(s.title)}</span></button>`).join("");
    $$("#scenes .scene").forEach((b) => b.addEventListener("click", async () => { await loadScene(b.dataset.name, "day"); ES.sceneChanged(); }));
    A.occ = { fences: true, trees: true, vehicles: true };
    $("#occ").innerHTML = [["fences", "围栏"], ["trees", "树木"], ["vehicles", "停放车辆"]].map(([k, n]) => `<button class="chip" data-occ="${k}" aria-pressed="true">${n}</button>`).join("");
    $$("#occ .chip").forEach((c) => c.addEventListener("click", () => { A.occ[c.dataset.occ] = !A.occ[c.dataset.occ]; c.setAttribute("aria-pressed", A.occ[c.dataset.occ]); rebuildWorld(); }));
    $$("#seg-variant button").forEach((b) => b.addEventListener("click", async () => { if (b.disabled) return; await loadScene(A.name, b.dataset.v); ES.sceneChanged(); }));
    $$("#seg-time button").forEach((b) => b.addEventListener("click", () => { A.look = b.dataset.v; $$("#seg-time button").forEach((x) => x.setAttribute("aria-pressed", x === b)); recompute(); updatePreview(); }));
    $$("#seg-exp button").forEach((b) => b.addEventListener("click", () => { A.exp = b.dataset.e; $$("#seg-exp button").forEach((x) => x.setAttribute("aria-pressed", x === b)); $("#expdesc").textContent = EXPS[A.exp][1]; expParams(); syncTool(); recompute(); }));
    $("#presets").innerHTML = PRESETS.map((p, i) => `<button class="chip" data-p="${i}" title="${esc(p.d)}">${esc(p.n)}</button>`).join("");
    $$("#presets .chip").forEach((c) => c.addEventListener("click", () => runPreset(PRESETS[+c.dataset.p])));
    buildTools(); $("#btn-default").addEventListener("click", () => { defaultConfig(); }); $("#btn-clear").addEventListener("click", () => { A.ents = []; A.sel = null; A.par.relay = null; A.par.route.goal = null; renderEnts(); recompute(); });
    $("#btn-engine").addEventListener("click", engineRecompute); $("#btn-render").addEventListener("click", engineRender); $("#btn-export").addEventListener("click", exportSpec);
    $("#z-in").addEventListener("click", () => A.map.zoom(1.3)); $("#z-out").addEventListener("click", () => A.map.zoom(1 / 1.3)); $("#z-fit").addEventListener("click", () => A.map.fit());
    $("#expdesc").textContent = EXPS.view[1]; expParams();
    const q = new URLSearchParams(location.search), first = q.get("scene") && A.index.scenes.find((s) => s.name === q.get("scene")) ? q.get("scene") : "suburb";
    await loadScene(first, q.get("variant") || "day"); await defaultConfig(); syncTool(); loadFidelity();
    ES.bus.emit("ready", A);
  }
  ES.appBoot = boot; ES.recompute = recompute;
})();
