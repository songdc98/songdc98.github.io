/* hudpanels.js: the sensor panels of the first-person HUD (sensor-UI agent).
   MY DEVICE block (#fp-own): camera feed (rgb / depth / semantic, keys 1 2 3, Tab switches camera), LiDAR plot (key L), readouts, recorder.
   NEARBY cards (#fp-near-l / #fp-near-r): every other sensor-carrying device within 150 m (live-episode agents + user-placed entities), at most two per side, each with the picture
   ITS camera sees (rendered from ITS pose by ES.camfeed), a coarse LiDAR plot for dog / rover, LOS / radio link / what is in its view.
   Everything is driven from ES.bus "walk:frame"; the DOM is rewritten at 4-5 Hz, the feeds follow their own rates (ES.camfeed budget scheduler). Docs: web/docs/sensor-ui.md. */
(function () {
  const ES = (window.ES = window.ES || {}), H = (ES.hud = ES.hud || {});
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a)), R2D = 180 / Math.PI;
  const walkApi = () => ES.view3d && ES.view3d.walk, VV = () => walkApi() && walkApi().V, WK = () => walkApi() && walkApi().state;
  const fnum = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : "—");

  /* ------------------------------------------------------------------ device tables (mirror scripts/esworld/agents_cfg.py DEVICES) ------------------------------------------------------------------ */
  const KIND = {
    dog: { icon: "🐕", zh: "机械狗", model: "Unitree Go2", base: 0.3, color: "#d55e00" },
    uav: { icon: "🚁", zh: "无人机", model: "Skydio X2", base: 0, color: "#cc79a7" },
    rover: { icon: "🤖", zh: "配送机器人", model: "配送机器人", base: 0.19, color: "#e69f00" },
    human: { icon: "🚶", zh: "应急人员", model: "人员", base: 0, color: "#009e73" },
    cp: { icon: "📡", zh: "指挥站", model: "移动指挥车", base: 0, color: "#0072b2" },
  };
  /* camera mounts: off = [forward, left, up] from the body reference point (base height above the floor / the UAV centre), res = sensor resolution, far = depth max range */
  const CAMS = {
    dog: [{ key: "front", zh: "前相机", hfov: 100, res: [1280, 720], fps: 15, off: [0.385, 0, 0.06], yaw: 0, far: 30 }, { key: "rear", zh: "后相机", hfov: 100, res: [640, 480], fps: 10, off: [-0.2, 0, 0.08], yaw: Math.PI, far: 20 }],
    uav: [{ key: "gimbal", zh: "云台相机", hfov: 84, res: [1280, 720], fps: 15, off: [0.1, 0, -0.02], gimbal: true, far: 120 }, { key: "nav", zh: "前视相机", hfov: 110, res: [640, 480], fps: 15, off: [0.12, 0, 0], yaw: 0, far: 40 }],
    human: [{ key: "helmet", zh: "头盔相机", hfov: 90, res: [1280, 720], fps: 15, off: [0.09, 0, 0], head: true, far: 40, eye: 1.6 }],
    rover: [{ key: "front", zh: "前相机", hfov: 110, res: [1280, 720], fps: 15, off: [0.34, 0, 0.26], yaw: 0, far: 30 }],
    cp: [{ key: "mast", zh: "桅杆相机", hfov: 110, res: [1920, 1080], fps: 10, off: [0, 0, 6.0], mast: true, far: 150 }],
  };
  const LIDARS = {
    dog: { model: "unitree_l1", zh: "Unitree L1", hfov: 360, vmin: -7, vmax: 52, range: 30, rate: 10, pts: 17280, off: [0.28, 0, 0.12] },
    uav: { model: "livox_mid360", zh: "Livox Mid-360", hfov: 360, vmin: -7, vmax: 52, range: 70, rate: 10, pts: 30720, off: [0, 0, 0] },
    rover: { model: "velodyne_vlp16", zh: "Velodyne VLP-16", hfov: 360, vmin: -15, vmax: 15, range: 100, rate: 10, pts: 28800, off: [0, 0, 0.45] },
  };
  const SENSORS = { dog: "前 / 后相机 · L1 激光雷达 · IMU · GNSS", uav: "云台 / 前视相机 · 激光雷达载荷 · 气压计 · IMU · GNSS", human: "头盔相机 · 手机无线 · 双耳麦克风" };
  const MODALITY = [["rgb", "彩色", "Digit1"], ["depth", "深度", "Digit2"], ["sem", "语义", "Digit3"]];
  const MOD_ZH = { rgb: "彩色", depth: "深度", sem: "语义" };
  const LMODE = [["top", "俯视"], ["side", "侧视"], ["persp", "三维"]];
  const COLORBY = [["height", "高度"], ["range", "距离"], ["intensity", "强度"], ["class", "类别"]];
  const feedRes = (res, w) => [w, Math.round((w * res[1]) / res[0] / 2) * 2];

  const st = {
    active: false, body: "human", own: null, near: new Map(), side: new Map(), tNear: 0, tUi: 0, tSlow: 0, perf: { ema: 0, max: 0, n: 0 }, hid: null, flashes: [], err: 0, rec: null, devs: [], devT: 0, lid: { mode: "top", colorBy: "height" }, lastTele: null,
  };

  /* ------------------------------------------------------------------ geometry helpers ------------------------------------------------------------------ */
  const surf = (x, y) => (walkApi() ? walkApi().surfZ(x, y) : 0);
  /* pose of a camera mount on a device. base = {x, y, z (floor / altitude), yaw, pitch, roll (body), gimbal?: {yaw, pitch}} */
  function camPose(kind, cam, b) {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), o = cam.off, kb = KIND[kind].base, p = b.pitch || 0;
    const x = b.x + c * o[0] - s * o[1], y = b.y + s * o[0] + c * o[1]; let z;
    if (cam.eye) z = b.z + cam.eye; else if (cam.mast) z = b.z + o[2]; else z = b.z + kb + o[2] + Math.sin(p) * o[0];
    let yaw = b.yaw + (cam.yaw || 0), pitch = p, roll = cam.gimbal || cam.head || cam.mast ? 0 : -(b.roll || 0);
    if (cam.gimbal && b.gimbal) { yaw = b.gimbal.yaw; pitch = b.gimbal.pitch; } if (cam.mast && b.camYaw !== undefined) { yaw = b.camYaw; pitch = b.camPitch || 0; }
    if (cam.yaw === Math.PI) pitch = -p;                                                       // rear camera: the body's nose-up is its nose-down
    return { x, y, z, yaw, pitch, roll };
  }

  /* ------------------------------------------------------------------ my device ------------------------------------------------------------------ */
  const smooth = { dogPitch: 0, t: 0 };
  function myBase() {
    const s = WK(), b = s.body, wp = ES.lidar && ES.lidar.walkPose ? ES.lidar.walkPose(s, VV()) : null;     // body pose incl. the dog's pitch on stairs / ramps and the UAV's lean (sensors-core)
    if (b === "uav") return { kind: "uav", x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: wp ? wp.pitch : -((s.uav && s.uav.pitch) || 0), roll: wp ? wp.roll : 0, gimbal: { yaw: s.yaw, pitch: s.pitch } };
    if (b === "dog") { const t = performance.now(), k = 1 - Math.exp(-Math.min(0.1, (t - smooth.t) / 1000) / 0.12); smooth.t = t; smooth.dogPitch += ((wp ? wp.pitch : 0) - smooth.dogPitch) * k; return { kind: "dog", x: s.x, y: s.y, z: s.zv ?? s.zf, yaw: s.yaw, pitch: smooth.dogPitch, roll: 0 }; }
    return { kind: "human", x: s.x, y: s.y, z: s.zv ?? s.zf, yaw: s.yaw, pitch: s.pitch, roll: 0 };
  }
  const camsOf = (kind) => CAMS[kind] || [];
  function setupOwn(body) {
    const o = st.own || (st.own = { cam: 0, mod: "rgb", feed: null, scanner: null, rec: null, lt: 0, lastLid: null });
    o.body = body; o.cams = camsOf(body); o.cam = Math.min(o.cam, o.cams.length - 1); if (o.cam < 0) o.cam = 0;
    const spec = o.cams[o.cam], [w, h] = feedRes(spec.res, 320);
    if (!o.feed && ES.camfeed) o.feed = ES.camfeed.create({ id: "own", w, h, hfov: spec.hfov, modality: o.mod, fps: spec.fps, far: spec.far, device: body, hideObject: () => { const V = VV(); return V && V.self ? [V.self] : []; } });
    if (o.feed) o.feed.setSpec({ w, h, hfov: spec.hfov, fps: spec.fps, far: spec.far, device: body });
    o.scanner = null;                                                              // the walker's scanner is owned by ES.lidar (re-created on identity change); fetched every frame
    buildOwnUi();
  }
  function ownSpecText(body) {
    const K = KIND[body] || KIND.human, cs = camsOf(body), c = cs[Math.min(st.own.cam, cs.length - 1)] || cs[0];
    return `<b>${esc(K.model)}</b> · ${esc(c.zh)} ${c.hfov}° ${c.res[0]}×${c.res[1]} ${c.fps} fps${body === "human" ? " · 手机无线 · 双耳麦克风" : ""}`;
  }

  /* ------------------------------------------------------------------ LiDAR: ES.lidar (sensors-core) ------------------------------------------------------------------ */
  const LID = {
    ok: () => !!(ES.lidar && typeof ES.lidar.createScanner === "function" && typeof ES.lidar.draw === "function"),
    own: () => (LID.ok() && typeof ES.lidar.own === "function" ? ES.lidar.own() : null),
    /* coarse scanner of another device (live agent or placed entity), 2 Hz, 180 x 24 beams: enough for a 76 px plot */
    forDevice(getD) {
      if (!LID.ok()) return null; const d0 = getD(), L = LIDARS[d0.kind]; if (!L || d0.kind === "uav") return null;
      const pose = () => { const d = getD(), V = VV(); return ES.lidar.sensorPose(L.model, d.live ? ES.lidar.livePose(d.it, V) : ES.lidar.entityPose(d.e, V)); };
      try { return ES.lidar.createScanner({ model: L.model, getPose: pose, rate: 2, cfg: { n_h: 180, n_v: 24 }, ignore: d0.live ? "live:" + d0.it.id : "ent:" + d0.e.id, id: "nc-" + d0.id }); } catch (e) { console.warn("lidar scanner", e); return null; }
    },
    draw(canvas, sweep, opt) { if (LID.ok() && sweep) { try { return ES.lidar.draw(canvas, sweep, opt); } catch (e) { console.warn("lidar draw", e); } } const g = canvas.getContext("2d"); g.fillStyle = "#0d1114"; g.fillRect(0, 0, canvas.width, canvas.height); },
  };

  /* ------------------------------------------------------------------ own block: DOM ------------------------------------------------------------------ */
  const kbd = (t) => `<kbd>${t}</kbd>`;
  function buildOwnUi() {
    const box = $("#fp-own"); if (!box) return; const o = st.own, body = o.body, cs = o.cams, hasL = !!LIDARS[body];
    box.innerHTML = `<h4>我的设备<span id="fp-own-who">· ${esc((ES.controls && ES.controls.IDENT[body] ? ES.controls.IDENT[body].name : body))}</span></h4>
      <div class="own-spec" id="own-spec">${ownSpecText(body)}</div>
      <figure class="own-cam wait" id="own-cam"><div class="own-cam-box" id="own-cam-box"></div>
        <div class="ov tl"><div class="seg sm" id="own-mod">${MODALITY.map(([m, z, c]) => `<button data-m="${m}" aria-pressed="${m === o.mod}" title="按 ${c.slice(-1)} 键">${z}${kbd(c.slice(-1))}</button>`).join("")}</div></div>
        <div class="ov tr">${cs.length > 1 ? `<div class="seg sm" id="own-sel">${cs.map((c, i) => `<button data-i="${i}" aria-pressed="${i === o.cam}" title="Tab 键切换">${c.zh.replace("相机", "")}</button>`).join("")}${kbd("Tab")}</div>` : `<span class="cap-one">${esc(cs[0].zh)}</span>`}</div>
        <span class="cap-bl" id="own-cam-exp"></span><span class="cap-br" id="own-cam-verdict"></span><div class="cam-extra" id="own-cam-extra"></div></figure>
      ${hasL ? `<figure class="own-lidar" id="own-lid"><canvas id="fp-own-lidar" width="320" height="164"></canvas><span class="cap-bl" id="own-lid-pts"></span><span class="cap-br" id="own-lid-near"></span>
        <div class="ov tl"><div class="seg sm" id="own-lmode">${LMODE.map(([m, z]) => `<button data-m="${m}" aria-pressed="${m === st.lid.mode}">${z}</button>`).join("")}${kbd("L")}</div></div>
        <div class="ov tr"><label class="own-cb">着色<select id="own-cby">${COLORBY.map(([m, z]) => `<option value="${m}"${m === st.lid.colorBy ? " selected" : ""}>${z}</option>`).join("")}</select></label></div></figure>
        <div class="own-lspec" id="own-lspec"></div>` : `<div class="own-nolid">没有激光雷达:人员带的是头盔相机和手机</div>`}
      <div class="fp-tele own-grid" id="fp-tele"></div>
      <div class="own-rec" id="own-rec"><button class="btn rec" id="own-rec-btn" title="把我的设备采集的数据(相机画面、激光雷达每圈点云、位姿 / IMU 表)录成 zip">● 记录</button><select id="own-rec-sec" title="记录时长"><option value="5">5 s</option><option value="10" selected>10 s</option><option value="20">20 s</option><option value="30">30 s</option></select><span id="own-rec-msg" class="rec-msg"></span></div>`;
    $("#own-cam-box").appendChild(o.feed.canvas); o.feed.canvas.id = "fp-own-cam";
    $$("#own-mod button").forEach((b) => b.addEventListener("click", () => { b.blur(); setModality(b.dataset.m); }));
    $$("#own-sel button").forEach((b) => b.addEventListener("click", () => { b.blur(); setCamera(+b.dataset.i); }));
    $$("#own-lmode button").forEach((b) => b.addEventListener("click", () => { b.blur(); setLidarMode(b.dataset.m); }));
    const cb = $("#own-cby"); if (cb) cb.addEventListener("change", () => { st.lid.colorBy = cb.value; cb.blur(); });
    $("#own-rec-btn").addEventListener("click", (e) => { e.target.blur(); if (st.rec) stopRecording(); else startRecording(+$("#own-rec-sec").value); });
    uiNow = 0;
  }
  function setModality(m) {
    const o = st.own; if (!o || !o.feed) return; o.mod = m; o.feed.setModality(m); $$("#own-mod button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === m)); const ex = $("#own-cam-extra"); if (ex) ex.innerHTML = ""; uiNow = 0; toast(`相机画面:${MOD_ZH[m]}`);
  }
  function setCamera(i) {
    const o = st.own; if (!o || !o.cams.length) return; o.cam = ((i % o.cams.length) + o.cams.length) % o.cams.length; const spec = o.cams[o.cam], [w, h] = feedRes(spec.res, 320);
    o.feed.setSpec({ w, h, hfov: spec.hfov, fps: spec.fps, far: spec.far, device: o.body }); o.feed.hasImage = false; o.feed.last = -1e9; $$("#own-sel button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.i === o.cam));
    $("#own-spec").innerHTML = ownSpecText(o.body); uiNow = 0; if (o.cams.length > 1) toast(`相机:${spec.zh}`);
  }
  function setLidarMode(m) { st.lid.mode = m; $$("#own-lmode button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === m)); const mm = LMODE.find((x) => x[0] === m); toast(`激光雷达视图:${mm ? mm[1] : m}`); }
  const toast = (msg) => { const t = $("#fp-toast"); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1400); };
  let uiNow = 0;

  /* ------------------------------------------------------------------ readouts ------------------------------------------------------------------ */
  function sampleTele() {
    const s = WK(), V = VV(); let T = null;
    if (ES.telemetry && typeof ES.telemetry.sample === "function") { try { T = ES.telemetry.sample(s.body, s, V); } catch (e) { if (!st.errTele) { st.errTele = 1; console.warn("telemetry", e); } } }
    return T;
  }
  const readTele = () => st.lastTele || null;
  const compass = (yaw) => { const hd = (((90 - yaw * R2D) % 360) + 360) % 360, n = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][Math.round(hd / 45) % 8]; return [hd, n]; };
  function renderTele(now) {
    const el = $("#fp-tele"); if (!el) return; const s = WK(), T = readTele(now), body = s.body, o = st.own, fs = o.feed ? o.feed.stats : {}, [hd, cn] = compass(s.yaw), P = (T && T.pose) || {};
    const rows = [];
    const cell = (k, v, cls) => `<div class="tc${cls ? " " + cls : ""}"><span class="tk">${k}</span><span class="tv">${v}</span></div>`;
    const wide = (k, v, cls) => `<div class="tc wide${cls ? " " + cls : ""}"><span class="tk">${k}</span><span class="tv">${v}</span></div>`;
    const bld = ES.ray && ES.ray.buildingAt ? ES.ray.buildingAt(s.x, s.y, body === "uav" ? s.z : s.zf + 1) : null, floor = bld && body !== "uav" ? Math.max(1, Math.round((s.zf - (bld.z0 || 0)) / 3.2) + 1) : 0;
    const alt = body === "uav" ? s.z - (ES.app.W ? ES.app.W.groundZ(s.x, s.y) : 0) : 0;
    rows.push(cell("位置", `${fnum(s.x)}, ${fnum(s.y)} m`), cell("朝向", `${fnum(hd, 0)}° ${cn}`));
    rows.push(body === "uav" ? cell("高度", `${fnum(alt)} m ${(s.vz || 0) >= 0 ? "↑" : "↓"}${fnum(Math.abs(s.vz || 0))}`) : cell("所在", bld ? `室内 ${floor} 层 · ${fnum(s.zf, 1)} m` : "室外"), cell("速度", `${fnum(s.speed || 0, 2)} m/s`));
    const pct = Math.round(100 * (s.batt ?? 1)), pw = T && T.power;
    rows.push(cell("电量", `${pw && Number.isFinite(pw.pct) ? Math.round(pw.pct) : pct}%<i class="mbar"><b style="width:${pct}%;background:${pct < 15 ? "#f87171" : "#4ade80"}"></b></i>`, pct < 15 ? "warn" : ""));
    const lk = T && T.link, lnk = lk && Number.isFinite(lk.rate) ? `${lk.rate >= 10 ? Math.round(lk.rate) : fnum(lk.rate, 1)} Mb/s ${esc(lk.tech || "")}` : st.linkMine ? `${fnum(st.linkMine.good, st.linkMine.good < 10 ? 1 : 0)} Mb/s` : "—";
    rows.push(cell("链路", lnk, lk && lk.rate <= 0 ? "bad" : ""));
    const gn = T && T.gnss; rows.push(wide("GNSS", gn ? `${({ "3D": "3D 定位", "2D": "2D 定位", none: "无定位" })[gn.fix] || esc(gn.fix || "—")} · ${gn.sats ?? "—"} 星${Number.isFinite(gn.hdop) && gn.hdop < 90 ? " · HDOP " + fnum(gn.hdop, 1) : ""}${gn.indoor ? " · 室内" : ""}` : "—", gn && gn.fix === "none" ? "warn" : ""));
    const im = T && T.imu; rows.push(wide("IMU", im ? `加速度 ${fnum(im.accMag ?? im.acc_mag ?? (im.acc ? Math.hypot(...im.acc) : NaN), 2)} m/s² · 角速度 ${fnum((im.gyroMag ?? im.gyro_mag ?? (im.gyro ? Math.hypot(...im.gyro) : NaN)) * R2D, 0)}°/s` : "—"));
    if (body === "uav") { const bp = T && T.baro; rows.push(wide("气压", bp ? `${fnum(bp.pressure ?? bp.hpa, 1)} hPa · 气压高度 ${fnum(bp.alt ?? bp.altitude, 1)} m` : "—")); }
    if (fs && Number.isFinite(fs.ev)) { const v = fs.verdict; rows.push(wide("光照", `EV ${fnum(fs.ev, 1)} · ${fmtLux(fs.lux)} lx ${v ? `<b class="vd ${v.code}">${v.zh}</b>` : ""}`)); }
    else rows.push(wide("光照", "—"));
    const auOn = ES.audio && ES.audio.spl && ES.audio.state && ES.audio.state().on; if (auOn) { const dB = ES.audio.spl(); if (Number.isFinite(dB) && dB > 0) rows.push(wide("声音", `${fnum(dB, 0)} dB(A)<i class="mbar"><b style="width:${clamp(((dB - 20) / 70) * 100, 0, 100)}%;background:#7dd3fc"></b></i>`)); }
    el.innerHTML = rows.join("");
  }
  const fmtLux = (v) => (!Number.isFinite(v) ? "—" : v >= 10000 ? (v / 10000).toFixed(1) + " 万" : v >= 100 ? Math.round(v).toString() : v.toFixed(1));

  /* ------------------------------------------------------------------ own block: per-frame update ------------------------------------------------------------------ */
  function updateOwn(now, dt) {
    const o = st.own; if (!o || !o.feed) return; const body = o.body, b = myBase(), spec = o.cams[o.cam]; if (!spec) return;
    o.feed.setPose(camPose(body, spec, b));
    if (now - (st.tTele || 0) > 66) { st.tTele = now; st.lastTele = sampleTele(); }          // sensors-core asks for 10-20 Hz sampling (noise / history are per call)
    o.scanner = LIDARS[body] ? LID.own() : null; if (o.scanner) o.scanner.step(dt, 1.4);
    if (now - uiNow > 200) {
      uiNow = now; const fs = o.feed.stats, v = fs.verdict, ex = $("#own-cam-exp"), vd = $("#own-cam-verdict"), extra = $("#own-cam-extra");
      $("#own-cam").classList.toggle("wait", !o.feed.hasImage);
      if (o.mod === "rgb") { ex.textContent = Number.isFinite(fs.ev) ? `EV ${fnum(fs.ev, 1)} · ISO ${Math.round(fs.iso)} · 1/${Math.round(1 / fs.shutter)} s` + (fs.snrDb < 22 ? ` · SNR ${fnum(fs.snrDb, 0)} dB` : "") : ""; vd.textContent = v ? v.zh : ""; vd.className = "cap-br vd " + (v ? v.code : ""); vd.title = v ? v.detail : ""; if (extra.firstChild) extra.innerHTML = ""; }
      else if (o.mod === "depth") { ex.textContent = Number.isFinite(fs.centre) ? `中心 ${fnum(fs.centre, 2)} m · 最近 ${fnum(fs.nearest, 2)} m` : ""; vd.textContent = `有效 ${Math.round((fs.validFrac || 0) * 100)}%`; vd.className = "cap-br"; if (!extra.firstChild) extra.innerHTML = depthBar(spec.far); }
      else { const cl = fs.classes || {}, top = Object.entries(cl).sort((a, b2) => b2[1] - a[1]).slice(0, 4); ex.textContent = ""; vd.textContent = ""; vd.className = "cap-br"; extra.innerHTML = `<div class="semleg">${top.map(([n, f]) => { const i = ES.camfeed.SEM.id[n], c = ES.camfeed.SEM.rgb[i]; return `<span><i style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>${ES.camfeed.SEM.zh[i]} ${Math.round(f * 100)}%</span>`; }).join("")}</div>`; }
      renderTele(now);
      if (o.scanner) {
        const sw = o.scanner.last, L = LIDARS[body], M = (ES.lidar.MODELS && ES.lidar.MODELS[L.model]) || {}, stt = (sw && sw.stats) || {}, cap = $("#own-lspec"), near = stt.nearestM;
        if (cap) cap.innerHTML = `<b>${esc(L.zh)}</b> · ${M.h_fov || L.hfov}°×${(M.v_max ?? L.vmax) - (M.v_min ?? L.vmin)}° · ≤${M.max_range || L.range} m · ${M.rate_hz || L.rate} Hz · 每圈 <b>${stt.points != null ? stt.points : "—"}</b> 点 · 最近障碍 <b>${Number.isFinite(near) ? fnum(near, 1) + " m" : "—"}</b>`;
        o.sweep = sw; const lp = $("#own-lid-pts"), ln = $("#own-lid-near"); if (lp) lp.textContent = stt.points != null ? `${stt.points} 点` : ""; if (ln) ln.textContent = Number.isFinite(near) ? `最近 ${fnum(near, 1)} m` : "";
      }
    }
    if (st.rec) recTick(now);
    if (o.scanner && now - o.lt > 100) { o.lt = now; const cv = $("#fp-own-lidar"); const hh = window.innerHeight < 860 ? 124 : 164; if (cv && cv.height !== hh) cv.height = hh; if (cv) LID.draw(cv, o.scanner.last, { mode: st.lid.mode, colorBy: st.lid.colorBy, range: "auto", pointSize: st.lid.mode === "persp" ? 2 : 2 }); }
  }
  function depthBar(far) {
    const near = 0.3, ticks = [0.3, 1, 3, 10, 30, 100].filter((t) => t <= far), cmap = ES.camfeed.TURBO; let stops = []; for (let i = 0; i <= 16; i++) { const k = Math.round((i / 16) * 255) * 3; stops.push(`rgb(${cmap[k]},${cmap[k + 1]},${cmap[k + 2]}) ${(i / 16) * 100}%`); }
    return `<div class="dbar"><i style="background:linear-gradient(90deg,${stops.join(",")})"></i>${ticks.map((t) => `<span style="left:${(Math.log(t / near) / Math.log(far / near)) * 100}%">${t}</span>`).join("")}</div>`;
  }

  /* ------------------------------------------------------------------ devices of the world (everything except me that carries a sensor) ------------------------------------------------------------------ */
  function worldDevices(now) {
    const V = VV(), A = ES.app, out = [], hid = V && V.hide != null ? V.hide : null;
    if (V && V.live && V.live.userData && V.liveEp) for (const it of V.live.userData.items) {
      const k = it.kind === "dog" ? "dog" : it.kind === "uav" ? "uav" : it.kind === "rover" ? "rover" : it.id === "human_0" ? "human" : null; if (!k || !it.model) continue;
      out.push({ id: "live:" + it.id, name: ({ dog_0: "机械狗(回合)", uav_0: "无人机(回合)", rover_0: "机器人(回合)", human_0: "应急人员(回合)" })[it.id] || it.id, kind: k, live: true, it, model: it.model });
    }
    for (const e of (A && A.ents) || []) { if (e.id === hid || !KIND[e.kind]) continue; out.push({ id: "ent:" + e.id, name: e.name || KIND[e.kind].zh, kind: e.kind, live: false, e }); }
    return out;
  }
  function devBase(d, now) {                                  // {x, y, z, yaw, pitch, gimbal?}
    const V = VV();
    if (d.live) {
      const m = d.it.model, kind = d.kind, a = d.it.a, ep = V.liveEp, b = { x: m.position.x, y: -m.position.z, z: m.position.y, yaw: m.rotation.y, pitch: 0, roll: 0 };
      if ((kind === "dog" || kind === "uav") && ES.lidar && ES.lidar.livePose && (!d.tPose || now - d.tPose > 150)) { const lp = ES.lidar.livePose(d.it, V); d.pr = [lp.pitch, lp.roll]; d.tPose = now; } if (d.pr) { b.pitch = d.pr[0]; b.roll = d.pr[1]; }
      if (kind === "uav" && a.gimbal && ep) {
        const t = (now / 1000) * (V.liveSpeed || 1) + (V.liveOffset || 0), T = (a.n - 1) * ep.dt, tt = T > 0 ? t % T : 0, f = tt / ep.dt, i0 = Math.min(a.n - 2, Math.floor(f)), u = f - i0, g0 = a.gimbal[i0], g1 = a.gimbal[i0 + 1] || g0;
        b.gimbal = { yaw: g0[0] + wrapPi(g1[0] - g0[0]) * u, pitch: -(g0[1] + (g1[1] - g0[1]) * u) };           // episode: pitch > 0 looks DOWN; lab: + up
      } else if (kind === "uav") b.gimbal = { yaw: b.yaw, pitch: -0.35 };
      return b;
    }
    const e = d.e, z = e.kind === "uav" ? e.z : e.zf != null ? e.zf : surf(e.x, e.y);
    const b = { x: e.x, y: e.y, z, yaw: e.yaw || 0, pitch: 0 };
    if (e.kind === "uav") b.gimbal = { yaw: e.yaw || 0, pitch: e.pitch ?? -0.5 }; else if (e.kind === "cp") { b.camYaw = e.yaw || 0; b.camPitch = e.pitch ?? -0.17; } else if (e.kind === "human") b.pitch = e.pitch || 0; else b.pitch = 0;
    return b;
  }
  const devHfov = (d, cam) => (!d.live && d.e && d.e.hfov ? d.e.hfov : cam.hfov);                  // a placed entity keeps the field of view its properties panel sets
  /* targets that a camera can see: people, vehicles, robots (live, placed, parked vehicles, me) */
  function targets() {
    const V = VV(), A = ES.app, out = [], s = WK(), hid = V && V.hide != null ? V.hide : null;
    if (V && V.live && V.live.userData) for (const it of V.live.userData.items) { if (!it.model) continue; const k = it.kind === "uav" ? "uav" : it.kind === "dog" || it.kind === "rover" ? "robot" : "person"; out.push({ uid: "live:" + it.id, cls: k, x: it.model.position.x, y: -it.model.position.z, z: it.model.position.y + (k === "person" ? (it.kind === "t:lying" ? 0.25 : 1.0) : k === "uav" ? 0 : 0.3), ext: k === "person" ? 1.7 : 0.7 }); }
    for (const e of (A && A.ents) || []) { if (e.id === hid) continue; const k = e.kind === "uav" ? "uav" : e.kind === "dog" || e.kind === "rover" ? "robot" : e.kind === "t:vehicle" ? "vehicle" : e.kind === "human" || e.kind === "t:person" || e.kind === "t:lying" ? "person" : null; if (!k) continue; out.push({ uid: "ent:" + e.id, cls: k, x: e.x, y: e.y, z: (e.kind === "uav" ? e.z : e.zf != null ? e.zf : surf(e.x, e.y)) + (k === "person" ? (e.kind === "t:lying" ? 0.25 : 1.0) : k === "vehicle" ? 0.8 : 0.3), ext: k === "person" ? 1.7 : k === "vehicle" ? 4.2 : 0.7 }); }
    for (const v of (A && A.W && A.W.vehicles) || []) out.push({ uid: "veh:" + v.xy[0].toFixed(1) + v.xy[1].toFixed(1), cls: "vehicle", x: v.xy[0], y: v.xy[1], z: (A.W.groundZ(v.xy[0], v.xy[1]) || 0) + 0.8, ext: 4.2 });
    if (s) out.push({ uid: "walk", cls: s.body === "uav" ? "uav" : s.body === "dog" ? "robot" : "person", x: s.x, y: s.y, z: s.body === "uav" ? s.z : s.zf + (s.body === "dog" ? 0.3 : 1.0), ext: s.body === "human" ? 1.7 : 0.7, me: true });
    return out;
  }
  const losBlocked = (a, b) => { if (ES.ray && ES.ray.blocked) return ES.ray.blocked(a, b); const A = ES.app; return ES.phys && A && A.W ? ES.phys.los(A.W, a[0], a[1], a[2], b[0], b[1], b[2], 0.25) === 0 : false; };

  /* ------------------------------------------------------------------ nearby selection ------------------------------------------------------------------ */
  const RANGE = 150, MAX_SIDE = 2;
  function selectNearby(now) {
    const me = myBase(), meEye = [me.x, me.y, me.kind === "uav" ? me.z : me.z + (me.kind === "dog" ? 0.45 : 1.6)], devs = worldDevices(now), cands = [];
    for (const d of devs) {
      const b = devBase(d, now), dx = b.x - me.x, dy = b.y - me.y, dz = d.kind === "uav" || me.kind === "uav" ? b.z - me.z : 0, dist = Math.hypot(dx, dy, dz); if (dist > RANGE * (st.near.has(d.id) ? 1.1 : 1)) continue;
      const rel = wrapPi(Math.atan2(dy, dx) - me.yaw), lat = Math.sin(rel), prev = st.side.get(d.id), side = lat > 0.12 ? "l" : lat < -0.12 ? "r" : prev || (lat >= 0 ? "l" : "r");     // left half-plane of my heading -> left column, with hysteresis
      st.side.set(d.id, side); cands.push({ d, b, dist, rel, side });
    }
    const keep = new Set();
    for (const side of ["l", "r"]) {                                                            // at most two per side: the nearest, but a card on screen yields only to a device 18 % closer
      const list = cands.filter((c) => c.side === side).sort((a, b) => a.dist - b.dist), final = list.filter((c) => st.near.has(c.d.id) && st.near.get(c.d.id).side === side).slice(0, MAX_SIDE);
      for (const c of list) { if (final.includes(c)) continue; if (final.length < MAX_SIDE) final.push(c); else { const far = final.reduce((m, q) => (q.dist > m.dist ? q : m), final[0]); if (c.dist < far.dist * 0.82) final[final.indexOf(far)] = c; } }
      for (const c of final) keep.add(c.d.id);
    }
    const byId = new Map(cands.map((c) => [c.d.id, c]));
    for (const [id, card] of st.near) if (!keep.has(id)) { removeCard(card); st.near.delete(id); }
    for (const id of keep) { const c = byId.get(id); let card = st.near.get(id); if (!card) { card = makeCard(c.d, c.side); st.near.set(id, card); } card.cand = c; card.d = c.d; if (card.side !== c.side) { card.side = c.side; (c.side === "l" ? $("#fp-near-l") : $("#fp-near-r")).appendChild(card.el); } }
    for (const side of ["l", "r"]) {                                                            // stable order inside a column: by distance, swapped only when the gap exceeds 3 m
      const col = side === "l" ? $("#fp-near-l") : $("#fp-near-r"), cs = [...st.near.values()].filter((c) => c.side === side).sort((p, q) => p.order - q.order);
      if (cs.length === 2 && cs[0].cand && cs[1].cand && cs[0].cand.dist > cs[1].cand.dist + 3) { const t = cs[0].order; cs[0].order = cs[1].order; cs[1].order = t; }
      cs.forEach((c) => { c.el.style.order = c.order; }); col.dataset.n = cs.length;
    }
    const fr = $("#fp-right"), ow = $("#fp-own"), rightAvail = fr && ow ? fr.clientHeight - ow.offsetHeight - 8 : 999;        // compact cards (small thumbnail + two lines) when the space left for them is short
    for (const side of ["l", "r"]) { const col = side === "l" ? $("#fp-near-l") : $("#fp-near-r"), avail = side === "l" ? col.clientHeight : rightAvail; col.classList.toggle("mini", col.classList.contains("mini") ? avail < 175 : avail < 150); }
    st.cands = cands; st.me = me; st.meEye = meEye;
  }
  let cardSeq = 0;
  function makeCard(d, side) {
    const K = KIND[d.kind], cams = CAMS[d.kind], cam = cams[0], L = LIDARS[d.kind], hasLid = !!L && d.kind !== "uav", el = document.createElement("section");
    el.className = "nc fade"; el.dataset.id = d.id; el.style.setProperty("--kc", K.color); el.style.order = cardSeq;
    const [w, h] = feedRes(cam.res, 160);
    el.innerHTML = `<header><span class="ico">${K.icon}</span><b>${esc(d.name)}</b><small>${esc(K.model)} · ${esc(hasLid ? L.zh : cam.zh)}</small><span class="brg"><i class="arr">➤</i><span class="dist">—</span></span></header>
      <div class="nc-body${hasLid ? " haslid" : ""}"><figure class="nc-cam" style="--ar:${cam.res[0]} / ${cam.res[1]}"><div class="nc-cbox"></div><figcaption>${esc(cam.zh)} ${cam.hfov}°</figcaption></figure>${hasLid ? `<figure class="nc-lid"><canvas width="96" height="96"></canvas></figure>` : ""}
        <div class="nc-side"><span class="los chip">—</span><span class="seen">视野内 —</span>${hasLid ? `<span class="lidtxt">雷达 —</span><span class="near"></span>` : ""}</div></div>
      <div class="nc-foot"><span class="lnk">链路 —</span></div>`;
    (side === "l" ? $("#fp-near-l") : $("#fp-near-r")).appendChild(el); requestAnimationFrame(() => el.classList.remove("fade"));
    const card = { id: d.id, d, el, side, feed: null, order: cardSeq++, scanner: null, lt: 0, stat: {}, tStat: 0, flash: 0 };
    card.feed = ES.camfeed.create({ id: "nc-" + d.id, w, h, hfov: cam.hfov, modality: "rgb", fps: 5, far: cam.far, device: d.kind, ss: 1, hideObject: () => (card.d.live ? card.d.model : devModel(card.d)) });
    $(".nc-cbox", el).appendChild(card.feed.canvas);
    if (hasLid) card.scanner = LID.forDevice(() => card.d);
    el.addEventListener("click", () => flashDevice(card)); el.title = "点一下:在小地图上闪一下它的位置";
    return card;
  }
  function devModel(d) { const V = VV(); if (!V || !V.agents) return null; for (const g of V.agents.children) if (g.userData.eid === d.e.id) return g; return null; }
  function removeCard(card) { card.el.classList.add("fade"); if (card.feed) card.feed.dispose(); if (card.scanner && card.scanner.dispose) card.scanner.dispose(); setTimeout(() => card.el.remove(), 260); }

  /* per-frame: camera poses of the cards, thumbnails; 2 Hz: distance, LOS, link, counts */
  function updateCards(now, dt) {
    for (const card of st.near.values()) {
      const d = card.d, b = devBase(d, now), cams = CAMS[d.kind], cam = cams[0], pose = camPose(d.kind, cam, b);
      card.feed.setPose(pose); const hf = devHfov(d, cam); if (card.feed.hfov !== hf) card.feed.setSpec({ hfov: hf }); card.base = b;
      if (card.scanner) card.scanner.step(dt, 0.5);
    }
  }
  function updateCardText(now) {
    const me = st.me; if (!me) return; const A = ES.app, W = A && A.W, tg = targets(), P = ES.phys;
    const cp = ((A && A.ents) || []).find((e) => e.kind === "cp"), meNode = { x: me.x, y: me.y, z: me.kind === "uav" ? me.z : me.z + (me.kind === "dog" ? 0.45 : 1.4), radios: ES.DEVICES[me.kind === "uav" ? "uav" : me.kind === "dog" ? "dog" : "human"].radios, kind: me.kind };
    for (const card of st.near.values()) {
      const d = card.d, c = card.cand, b = card.base || c.b, K = KIND[d.kind], el = card.el; if (!c) continue;
      const rel = c.rel, dist = Math.hypot(b.x - me.x, b.y - me.y, d.kind === "uav" || me.kind === "uav" ? b.z - me.z : 0);
      $(".dist", el).textContent = dist >= 100 ? Math.round(dist) + " m" : dist.toFixed(dist < 10 ? 1 : 0) + " m"; $(".arr", el).style.transform = `rotate(${-rel * R2D - 90}deg)`;
      // LOS from my eye to its sensor head, link to me / command post
      const hd = [b.x, b.y, d.kind === "uav" ? b.z : b.z + (KIND[d.kind].base || 1) + (d.kind === "human" ? 1.4 : 0.1)], eye = st.meEye, los = !losBlocked(eye, hd);
      const lc = $(".los", el); lc.textContent = los ? "视距 ✓" : "遮挡 ✗"; lc.className = "los chip " + (los ? "ok" : "no");
      card.los = los;
      // what its camera sees: people / vehicles / machines in its frustum, behind no wall
      const cam = CAMS[d.kind][0], cp0 = card.feed.pose, hfov = card.feed.hfov, vf = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / (card.feed.w / card.feed.h))) * R2D;
      const cc = { x: cp0.x, y: cp0.y, z: cp0.z, yaw: cp0.yaw, pitch: cp0.pitch, hfov, aspect: card.feed.w / card.feed.h, res: cam.res, omni: false, range: 300 }, B = P.camBasis(cc), cnt = { person: 0, vehicle: 0, robot: 0, uav: 0 };
      for (const t of tg) { if (t.uid === c.d.id || t.uid === "live:" + (d.it && d.it.id) || t.uid === "ent:" + (d.e && d.e.id)) continue; const rng = Math.min(250, P.detectRange(cc, t.ext)), c2 = Object.assign({}, cc, { range: rng }); if (!P.inFrustum(c2, B, t.x, t.y, t.z)) continue; if (losBlocked([cp0.x, cp0.y, cp0.z], [t.x, t.y, t.z])) continue; cnt[t.cls]++; }
      card.stat.cnt = cnt; const parts = []; if (cnt.person) parts.push(`人 ${cnt.person}`); if (cnt.vehicle) parts.push(`车 ${cnt.vehicle}`); if (cnt.robot + cnt.uav) parts.push(`机器 ${cnt.robot + cnt.uav}`);
      $(".seen", el).innerHTML = "<i>视野内</i> " + (parts.length ? parts.join(" · ") : "无目标");
      // radio: to me, to the command post
      let lt = ""; if (W && P && ES.RADIOS) { const nodeD = { x: b.x, y: b.y, z: d.kind === "uav" ? b.z : b.z + (ES.DEVICES[d.kind].antH || 1), radios: ES.DEVICES[d.kind].radios }; const toMe = linkOf(nodeD, meNode), toCp = cp && !(d.e && d.e.id === cp.id) ? linkOf(nodeD, { x: cp.x, y: cp.y, z: (ES.DEVICES.cp.antH || 6) + surf(cp.x, cp.y), radios: ES.DEVICES.cp.radios }) : null; lt = `→我 ${fmtRate(toMe)}` + (toCp ? ` · →站 ${fmtRate(toCp)}` : ""); card.stat.toMe = toMe; card.stat.toCp = toCp; }
      $(".lnk", el).textContent = lt || "链路 —";
      if (card.scanner) { const sw = card.scanner.last, s2 = (sw && sw.stats) || {}, pts = s2.points ?? (sw && sw.n), near = s2.nearestM; $(".lidtxt", el).textContent = sw ? `雷达 ${pts} 点` : "雷达 …"; $(".near", el).textContent = sw ? `最近 ${Number.isFinite(near) ? near.toFixed(1) + " m" : "—"}` : ""; card.stat.pts = pts; card.stat.near = near; }
    }
    // my own link to the command post for the readout grid
    if (cp && P && ES.RADIOS) st.linkMine = linkOf(meNode, { x: cp.x, y: cp.y, z: (ES.DEVICES.cp.antH || 6) + surf(cp.x, cp.y), radios: ES.DEVICES.cp.radios });
  }
  function linkOf(A, B) {
    const P = ES.phys, W = ES.app.W; let best = null; if (!P || !W) return null;
    for (const [ka, kb] of P.radioGroupPairs(A.radios, B.radios)) { const ab = P.link(W, A, B, ES.RADIOS[ka], ES.RADIOS[kb], null), ba = P.link(W, B, A, ES.RADIOS[kb], ES.RADIOS[ka], null), good = Math.min(ab.good, ba.good); if (!best || good > best.good) best = { good, tech: ka === kb ? ka : ka + "↔" + kb, snr: Math.min(ab.snr, ba.snr), los: ab.los }; }
    return best;
  }
  const fmtRate = (l) => (!l ? "—" : l.good > 0 ? (l.good >= 10 ? Math.round(l.good) : l.good.toFixed(1)) + " Mb/s" : "断开");
  function drawCardLidars(now) {
    for (const card of st.near.values()) { if (!card.scanner || now - card.lt < 500) continue; card.lt = now; const cv = $(".nc-lid canvas", card.el); if (cv) LID.draw(cv, card.scanner.last, { mode: "top", colorBy: "height", range: "auto", rings: false, pointSize: 2 }); }
  }

  /* click a card: pulse that device on the mini-map (an overlay canvas on top of #fp-mini; also marks every card's device) */
  function flashDevice(card) { card.flash = performance.now(); st.flashes = st.flashes.filter((f) => f !== card).concat(card); }
  function drawMiniFx(now) {
    const mini = $("#fp-mini"); if (!mini) return; let fx = $("#fp-mini-fx"); if (!fx) { fx = document.createElement("canvas"); fx.id = "fp-mini-fx"; fx.width = fx.height = 360; mini.parentNode.insertBefore(fx, mini.nextSibling); }
    const g = fx.getContext("2d"), A = ES.app, S = A.scene.size; g.clearRect(0, 0, 360, 360); if (!A.scene) return;
    const f = (x, y) => [(x / S) * 360, (1 - y / S) * 360];
    for (const card of st.near.values()) {                                                    // small ring + camera wedge for each card's device
      const b = card.base; if (!b) continue; const [x, y] = f(b.x, b.y), K = KIND[card.d.kind]; g.strokeStyle = K.color; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 9, 0, 6.3); g.stroke();
      const p = card.feed.pose, hf = (card.feed.hfov * Math.PI) / 360; g.fillStyle = K.color + "55"; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 34, -(p.yaw + hf), -(p.yaw - hf)); g.closePath(); g.fill();
    }
    st.flashes = st.flashes.filter((c) => now - c.flash < 2200);
    for (const c of st.flashes) { const b = c.base; if (!b) continue; const [x, y] = f(b.x, b.y), t = (now - c.flash) / 2200, r = 10 + 46 * ((t * 3) % 1); g.strokeStyle = `rgba(255,255,255,${1 - t})`; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.stroke(); g.strokeStyle = `rgba(255,224,102,${1 - t})`; g.beginPath(); g.arc(x, y, 14, 0, 6.3); g.stroke(); }
  }

  /* ------------------------------------------------------------------ recorder (stretch): rgb/depth/sem frames + LiDAR sweeps + pose / IMU csv -> zip ------------------------------------------------------------------ */
  const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; let zipP = null;
  const loadZip = () => (window.JSZip ? Promise.resolve() : zipP || (zipP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = JSZIP_URL; s.onload = res; s.onerror = () => rej(new Error("JSZip 加载失败")); document.head.appendChild(s); })));
  function startRecording(sec) {
    const o = st.own; if (!o || !o.feed || st.rec) return; loadZip().catch(() => {});
    const A = ES.app, s = WK(); st.rec = { t0: performance.now(), dur: sec * 1000, frames: [], sweeps: [], csv: ["t_s,x_m,y_m,z_m,yaw_deg,pitch_deg,speed_mps,battery_pct,acc_mag,gyro_dps,cam_ev,cam_iso,cam_shutter_s,gnss_fix,link_mbps"], lastFrame: -1, lastSweep: null, lastRow: 0, busy: 0, body: s.body, cam: o.cams[o.cam], mod: o.mod, scene: A.name, look: A.look, done: false };
    const b = $("#own-rec-btn"); b.textContent = "■ 停止"; b.classList.add("on"); $("#own-rec-msg").textContent = "记录中…"; $("#own-rec-sec").disabled = true;
  }
  function recTick(now) {
    const r = st.rec; if (!r || r.done) return; const o = st.own, t = now - r.t0, s = WK(), T = readTele(now) || {};
    if (o.feed.stats.frameT !== undefined && o.feed.stats.frames !== r.lastFrame && o.feed.hasImage) { r.lastFrame = o.feed.stats.frames; const k = r.frames.length; r.busy++; const idx = k, mod = o.mod, f = o.feed;
      if (mod === "depth" && f.depth) r.frames.push({ t, name: `cam/${String(idx).padStart(5, "0")}.f32`, blob: new Blob([f.depth.slice().buffer]) }), r.busy--; else f.canvas.toBlob((bl) => { r.frames.push({ t, name: `cam/${String(idx).padStart(5, "0")}.png`, blob: bl }); r.busy--; }, "image/png"); }
    const o2 = o.scanner && o.scanner.last; if (o2 && o2.rev !== r.lastSweep) { r.lastSweep = o2.rev; const n = o2.n ?? (o2.xyz ? o2.xyz.length / 3 : 0), buf = new Float32Array(n * 5); for (let i = 0; i < n; i++) { buf[5 * i] = o2.xyz[3 * i]; buf[5 * i + 1] = o2.xyz[3 * i + 1]; buf[5 * i + 2] = o2.xyz[3 * i + 2]; buf[5 * i + 3] = o2.intensity ? o2.intensity[i] : 0; buf[5 * i + 4] = o2.cls ? o2.cls[i] : 0; } r.sweeps.push({ t, name: `lidar/${String(r.sweeps.length).padStart(5, "0")}.f32`, blob: new Blob([buf.buffer]), n }); }
    if (now - r.lastRow > 100) { r.lastRow = now; const fs = o.feed.stats, im = T.imu || {}, [hd] = compass(s.yaw); r.csv.push([(t / 1000).toFixed(3), s.x.toFixed(3), s.y.toFixed(3), (s.body === "uav" ? s.z : s.zf).toFixed(3), (hd).toFixed(1), (s.pitch * R2D).toFixed(1), (s.speed || 0).toFixed(3), Math.round(100 * (s.batt ?? 1)), fnum(im.accMag ?? NaN, 3), fnum((im.gyroMag ?? NaN) * R2D, 2), fnum(fs.ev, 2), fnum(fs.iso, 0), fnum(fs.shutter, 6), (T.gnss && T.gnss.fix) || "", st.linkMine ? st.linkMine.good.toFixed(1) : ""].join(",")); }
    $("#own-rec-msg").textContent = `记录中 ${Math.max(0, (r.dur - t) / 1000).toFixed(1)} s · ${r.frames.length} 帧 · ${r.sweeps.length} 圈`;
    if (t >= r.dur) finishRecording();
  }
  async function finishRecording() {
    const r = st.rec; if (!r || r.done) return; r.done = true; const msg = $("#own-rec-msg"); msg.textContent = "打包中…";
    try {
      await loadZip(); const t1 = performance.now(); while (r.busy > 0 && performance.now() - t1 < 3000) await new Promise((x) => setTimeout(x, 30));
      const z = new window.JSZip(), A = ES.app, tag = `${A.name}_${r.body}_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
      for (const f of r.frames) z.file(f.name, f.blob); for (const f of r.sweeps) z.file(f.name, f.blob); z.file("pose_imu.csv", r.csv.join("\n"));
      z.file("meta.json", JSON.stringify({ app: "es-world-lab", scene: r.scene, look: r.look, device: r.body, camera: r.cam, modality: r.mod, frames: r.frames.length, lidar_sweeps: r.sweeps.length, duration_s: r.dur / 1000, note: "cam/*.png = camera picture (rgb or semantic class colours); cam/*.f32 = metric depth, float32 little-endian, row-major top-down, NaN = no return; lidar/*.f32 = float32 [x, y, z, intensity, class] per point in the world-aligned frame centred on the sensor", t: new Date().toISOString() }, null, 1));
      const blob = await z.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `es-world_${tag}.zip`; a.textContent = `下载 zip(${(blob.size / 1048576).toFixed(1)} MB)`; a.className = "btn rec-dl";
      const box = $("#own-rec"); box.querySelectorAll(".rec-dl").forEach((x) => x.remove()); box.appendChild(a); msg.textContent = `${r.frames.length} 帧 · ${r.sweeps.length} 圈 · ${(blob.size / 1048576).toFixed(1)} MB`; st.recResult = { frames: r.frames.length, sweeps: r.sweeps.length, bytes: blob.size, rows: r.csv.length - 1, name: a.download, url };
    } catch (e) { msg.textContent = "打包失败:" + e.message; }
    resetRecUi(); st.rec = null;
  }
  function stopRecording() { const r = st.rec; if (!r) return; r.dur = performance.now() - r.t0 - 1; }
  function resetRecUi() { const b = $("#own-rec-btn"); if (b) { b.textContent = "● 记录"; b.classList.remove("on"); } const s = $("#own-rec-sec"); if (s) s.disabled = false; }

  /* ------------------------------------------------------------------ keys (legend rows come from ES.controls) ------------------------------------------------------------------ */
  function registerKeys() {
    const C = ES.controls; if (!C || registerKeys.done) return; registerKeys.done = true;
    C.add({ bodies: "all", group: "传感器", keys: ["1", "2", "3"], codes: ["Digit1", "Digit2", "Digit3"], desc: "相机画面:彩色 / 深度 / 语义", fn: (code, down) => { if (down && st.active) setModality({ Digit1: "rgb", Digit2: "depth", Digit3: "sem" }[code]); } });
    C.add({ bodies: ["dog", "uav"], group: "传感器", keys: ["Tab"], codes: ["Tab"], desc: "切换相机:前 ⇄ 后(狗)/ 云台 ⇄ 前视(无人机)", fn: (code, down) => { if (down && st.active) setCamera(st.own.cam + 1); } });
    C.add({ bodies: ["dog", "uav"], group: "传感器", keys: ["L"], codes: ["KeyL"], desc: "激光雷达视图:俯视 / 侧视 / 三维", fn: (code, down) => { if (down && st.active) { const i = LMODE.findIndex((m) => m[0] === st.lid.mode); setLidarMode(LMODE[(i + 1) % LMODE.length][0]); } } });
  }

  /* ------------------------------------------------------------------ lifecycle ------------------------------------------------------------------ */
  function enter() { st.active = true; st.near.forEach(removeCard); st.near.clear(); st.side.clear(); setupOwn(WK().body); uiNow = 0; st.tNear = 0; }
  function exit() {
    st.active = false; if (st.rec) { st.rec.done = true; st.rec = null; resetRecUi(); }
    st.near.forEach((c) => { if (c.feed) c.feed.dispose(); if (c.scanner && c.scanner.dispose) c.scanner.dispose(); c.el.remove(); }); st.near.clear(); st.side.clear();
    if (st.own) { if (st.own.feed) st.own.feed.dispose(); if (st.own.scanner && st.own.scanner.dispose) st.own.scanner.dispose(); st.own = null; }
    const fx = $("#fp-mini-fx"); if (fx) fx.getContext("2d").clearRect(0, 0, 360, 360);
  }
  function frame(dt, now) {
    if (!st.active || H.off) return; const t0 = performance.now();
    try {
      if (!st.own || !st.own.feed) setupOwn(WK().body);
      updateOwn(now, dt);
      if (now - st.tNear > 250) { st.tNear = now; selectNearby(now); }
      updateCards(now, dt);
      if (now - st.tSlow > 500) { st.tSlow = now; updateCardText(now); }
      ES.camfeed.pump(now);
      drawCardLidars(now); drawMiniFx(now);
    } catch (e) { if (st.err++ < 5) console.error("hud frame", e); }
    const ms = performance.now() - t0; st.perf.ema += (ms - st.perf.ema) * 0.05; st.perf.max = Math.max(st.perf.max * 0.995, ms); st.perf.n++;
  }
  ES.bus.on("walk:enter", () => { registerKeys(); enter(); });
  ES.bus.on("walk:exit", exit);
  ES.bus.on("walk:frame", (dt, now) => frame(dt, now));
  ES.bus.on("fpbody", (body) => { if (!st.active) return; st.body = body; if (st.own) { st.own.cam = 0; } setupOwn(body); st.near.forEach(removeCard); st.near.clear(); st.side.clear(); });
  ES.bus.on("ready", registerKeys);
  H.tele = () => {};                                                    // walkui.js still calls this at 5 Hz: the readouts are drawn by the frame hook
  H.setModality = setModality; H.setCamera = setCamera; H.setLidarMode = setLidarMode; H.startRecording = startRecording; H.stopRecording = stopRecording; H.flash = (id) => { const c = st.near.get(id); if (c) flashDevice(c); };
  H.RANGE = RANGE; H.MAX_SIDE = MAX_SIDE; H.state = st; H.KIND = KIND; H.CAMS = CAMS; H.LIDARS = LIDARS; H.devices = () => worldDevices(performance.now());
  H.debug = () => ({
    active: st.active, perfMs: st.perf.ema, perfMax: st.perf.max, own: st.own && { cam: st.own.cams[st.own.cam].key, mod: st.own.mod, stats: st.own.feed && st.own.feed.stats, pose: st.own.feed && st.own.feed.pose, scanner: !!st.own.scanner, lidarSweep: st.own.scanner && st.own.scanner.last ? { n: st.own.scanner.last.n, stats: st.own.scanner.last.stats } : null },
    near: [...st.near.values()].map((c) => ({ id: c.id, side: c.side, dist: c.cand && c.cand.dist, rel: c.cand && c.cand.rel, los: c.los, stat: c.stat, feedStats: c.feed.stats, frames: c.feed.stats.frames, pose: c.feed.pose })),
    cands: (st.cands || []).map((c) => ({ id: c.d.id, kind: c.d.kind, dist: c.dist, side: c.side })), rec: st.recResult || null,
  });
})();
