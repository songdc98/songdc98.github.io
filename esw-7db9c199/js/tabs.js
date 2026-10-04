/* Replay, gallery and reference tabs. */
(function () {
  const ES = window.ES, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const fmt = ES.fmt;
  const SC = ["suburb", "courtyard", "mainstreet", "campus", "industrial"];
  const NAMES = { suburb: "郊区住宅街", courtyard: "公寓庭院", mainstreet: "商业街", campus: "校园", industrial: "工厂区" };
  const AGN = { dog_0: "机械狗", uav_0: "无人机", rover_0: "配送机器人", human_0: "应急人员", human_1: "行人 1", human_2: "居民(站立)", human_3: "求助者(挥手)", human_4: "倒地者", cp: "指挥站" };
  const videoOf = (s) => (s === "suburb" ? "media/episode.mp4" : `media/ep_${s}.mp4`);
  const exists = async (u) => { try { const r = await fetch(u, { method: "HEAD" }); return r.ok; } catch (e) { return false; } };

  /* ====================== replay ====================== */
  const RP = { scene: "suburb", t: 22, playing: false, speed: 1, last: 0, ep: null, W: null, sc: null, video: null, hasVideo: false };
  async function replayInit() {
    const root = $("#replay-root");
    root.innerHTML = `<div class="row"><h3>回合回放</h3><div class="seg" id="rp-scenes" style="max-width:640px">${SC.map((s) => `<button data-s="${s}" aria-pressed="${s === RP.scene}">${NAMES[s]}</button>`).join("")}</div></div>
      <div class="split"><div><div class="replaymap"><canvas id="rp-map"></canvas></div>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="rp-play">▶ 播放</button><input type="range" id="rp-t" min="0" max="100" step="0.2" value="22" style="flex:1;min-width:140px"><span class="mono" id="rp-time">22.0 s</span>
          <select id="rp-speed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option></select></div>
        <div class="note" id="rp-note" style="margin-top:6px"></div></div>
      <div class="sec"><figure id="rp-fig"><video id="rp-video" controls muted playsinline preload="auto"></video><figcaption id="rp-vcap"></figcaption></figure>
        <div class="card" id="rp-info"></div><div id="rp-audio"></div></div></div>`;
    $$("#rp-scenes button").forEach((b) => b.addEventListener("click", () => replayScene(b.dataset.s)));
    $("#rp-play").addEventListener("click", () => { RP.playing = !RP.playing; RP.last = performance.now(); $("#rp-play").textContent = RP.playing ? "❚❚ 暂停" : "▶ 播放"; const v = $("#rp-video"); if (RP.hasVideo) { if (RP.playing && inWin(RP.t)) { seekVideo(true); v.play().catch(() => {}); } else v.pause(); } });
    $("#rp-t").addEventListener("input", (e) => { RP.t = +e.target.value; seekVideo(true); rpDraw(); });
    $("#rp-speed").addEventListener("change", (e) => { RP.speed = +e.target.value; const v = $("#rp-video"); v.playbackRate = RP.speed; });
    RP.map = new ES.MapView($("#rp-map"), { entities: () => [], selected: () => null, tool: () => null, select() {}, place() {}, changed() {}, cursor() {}, remove() {} });
    requestAnimationFrame(rpTick); await replayScene(RP.scene);
  }
  const win = () => (RP.ep ? RP.ep.window : [22, 34]); const inWin = (t) => t >= win()[0] && t <= win()[1];
  async function replayScene(s) {
    RP.scene = s; $$("#rp-scenes button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === s));
    const [sc, ep] = await Promise.all([ES.loadJSON(`data/scene_${s}.json`), ES.loadJSON(`data/episode_${s}.json`)]); RP.sc = sc; RP.ep = ep; RP.W = new ES.World(sc, "day"); RP.map.setScene(sc, RP.W);
    const T = Math.max(...Object.values(ep.agents).map((a) => (a.n - 1) * ep.dt)); const sl = $("#rp-t"); sl.max = Math.min(T, 300); RP.t = ep.window[0]; sl.value = RP.t;
    const v = $("#rp-video"); RP.hasVideo = await exists(videoOf(s)); v.style.display = RP.hasVideo ? "block" : "none"; if (RP.hasVideo) { v.src = videoOf(s); v.playbackRate = RP.speed; }
    $("#rp-vcap").textContent = RP.hasVideo ? `六路相机(总览、狗跟拍、无人机跟拍、无人机云台、狗机载、头盔),${ep.window[0]}–${ep.window[1]} s,5 fps。` : "这个场景的渲染视频还在生成中;左侧地图回放来自同一份回合轨迹。";
    $("#rp-note").textContent = `轨迹来自动力学模型(0.2 s 采样)。通信记录覆盖 ${ep.window[0] - 2}–${ep.window[1] + 4} s;视频覆盖 ${ep.window[0]}–${ep.window[1]} s。`;
    rpInfo(); rpAudio(); seekVideo(true); rpDraw();
  }
  function seekVideo(force) {
    const v = $("#rp-video"); if (!RP.hasVideo || !v) return;
    if (inWin(RP.t)) { const want = RP.t - win()[0]; if (v.readyState < 1) { v.addEventListener("loadedmetadata", () => { v.currentTime = RP.t - win()[0]; }, { once: true }); v.load(); } else if (force || Math.abs(v.currentTime - want) > 0.4) v.currentTime = want; } else v.pause();
  }
  function rpTick(now) {
    requestAnimationFrame(rpTick); if (!$("#tab-replay").classList.contains("active") || !RP.ep) { RP.last = now; return; }
    if (RP.playing) { const dt = (now - RP.last) / 1000 * RP.speed; RP.last = now; const v = $("#rp-video");
      if (RP.hasVideo && inWin(RP.t) && !v.paused && v.readyState > 1) RP.t = win()[0] + v.currentTime; else RP.t += dt;
      if (RP.hasVideo && RP.playing && inWin(RP.t) && v.paused) v.play().catch(() => {}); if (RP.hasVideo && !inWin(RP.t) && !v.paused) v.pause();
      if (RP.t > +$("#rp-t").max) RP.t = win()[0]; if (RP.t < win()[0] && RP.hasVideo) { /* free-run before the window */ }
      $("#rp-t").value = RP.t; rpDraw(); }
    RP.last = now;
  }
  const idxAt = (a, ep, t) => Math.max(0, Math.min(a.n - 1, Math.round((t - a.t0) / ep.dt)));
  function rpDraw() {
    if (!RP.ep) return; const ep = RP.ep, t = RP.t; $("#rp-time").textContent = fmt(t, 1) + " s" + (inWin(t) ? " · 视频" : "");
    const ov = [], ents = []; let k = 0;
    for (const [id, a] of Object.entries(ep.agents)) {
      const i = idxAt(a, ep, t), p = a.pos[i], kind = a.type === "uav" ? "uav" : a.type === "ugv" ? "dog" : a.type === "ugv_wheel" ? "rover" : "human";
      const trail = []; for (let j = Math.max(0, i - 100); j <= i; j += 5) trail.push([a.pos[j][0], a.pos[j][1]]);
      ov.push({ type: "line", pts: trail, color: ES.DEVICES[kind].color, width: 1.5, dash: [] });
      ents.push({ id: k++, kind, x: p[0], y: p[1], z: p[2], yaw: a.yaw[i], name: AGN[id] || id });
      if (kind === "uav" && a.gimbal) { const g = a.gimbal[i]; ov.push({ type: "poly", pts: ES.phys.footprint({ x: p[0], y: p[1], z: p[2], yaw: g[0], pitch: -g[1], hfov: 84, aspect: 16 / 9, range: 150 }), stroke: ES.DEVICES.uav.color, fill: "rgba(204,121,167,.15)", width: 1.2, dash: [] }); }
    }
    const cp = ep.cp; ents.push({ id: k++, kind: "cp", x: cp[0], y: cp[1], z: 6, yaw: 0, name: "指挥站" });
    const links = ep.phys && ep.phys.links; if (links) { const keys = Object.keys(links).map(Number).sort((a, b) => a - b), kk = keys.filter((x) => x <= t).pop(); if (kk !== undefined && t <= keys[keys.length - 1] + 2) {
      const pos = (id) => { if (id === "cp") return [cp[0], cp[1]]; const a = ep.agents[id]; if (!a) return null; const q = a.pos[idxAt(a, ep, kk)]; return [q[0], q[1]]; };
      for (const [s, d, rate, ok] of links[String(kk.toFixed ? kk.toFixed(1) : kk)] || links[kk] || []) { const a = pos(s), b = pos(d); if (a && b && ok) ov.unshift({ type: "line", pts: [a, b], color: "rgba(35,164,85,.55)", width: 1.4, dash: [] }); else if (a && b) ov.unshift({ type: "line", pts: [a, b], color: "rgba(213,94,0,.4)", width: 1, dash: [3, 5] }); } } }
    RP.map.h.entities = () => ents; RP.map.overlays = ov; RP.map.draw();
  }
  function rpInfo() {
    const ph = (RP.ep.phys || {}), d = ph.delivery, a = ph.audit || ph.agent_audit; const el = $("#rp-info");
    el.innerHTML = `<h3>${NAMES[RP.scene]} · 这一回合的物理记录</h3><dl class="kv">${d ? `<dt>消息投递</dt><dd>${d.delivered} / ${d.n} 送达</dd><dt>中位时延</dt><dd>${d.median_delay_ms} ms</dd>${Object.entries(d.by_kind).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.n} 条 · 中位 ${v.median_ms} ms</dd>`).join("")}` : ""}${a ? `<dt>穿模审计(地面智能体)</dt><dd>${Object.values(a).every((v) => !Object.values(v).some(Boolean)) ? '<span class="ok">全部 0 次</span>' : '<span class="warn">有穿模</span>'}</dd>` : ""}</dl>`;
  }
  function rpAudio() {
    const el = $("#rp-audio"), au = RP.ep.phys && RP.ep.phys.audio; if (!au || RP.scene !== "suburb") { el.innerHTML = au ? `<div class="note">音频已随数据集导出(data/datasets/scene_${RP.scene}/audio);网页只内置了郊区场景的试听。</div>` : ""; return; }
    const nm = { dog_0: "机械狗 · 4 麦阵列(混为单声道)", uav_0: "无人机 · 1 麦", human_0: "应急人员 · 双耳" };
    el.innerHTML = `<h4>各智能体听到的声音(同一时刻,不同耳朵)</h4>` + Object.entries(au).map(([k, v]) => `<div class="audio"><div class="row" style="justify-content:space-between"><b>${nm[k] || k}</b><span class="mono">${fmt(v.spl_db, 1)} dB</span></div><div class="muted" style="font-size:.84rem">${v.audible.length ? "听得见:" + v.audible.map((x) => esc(x)).join("、") : "只听到自己的噪声"}</div><audio controls preload="none" src="media/${k}.wav"></audio></div>`).join("") + `<div class="note">每段音频单独归一化,不代表实际响度;声压级见数字。</div>`;
  }

  /* ====================== gallery ====================== */
  const G = { scene: "suburb", look: "day_cloud", variant: "day" };
  function galleryInit() {
    const root = $("#gallery-root");
    root.innerHTML = `<h3>画廊与画质</h3>
      <div class="row"><div class="seg" id="g-scenes" style="max-width:640px">${SC.map((s) => `<button data-s="${s}" aria-pressed="${s === G.scene}">${NAMES[s]}</button>`).join("")}</div>
      <div class="seg" id="g-look" style="max-width:360px"><button data-l="day_cloud" aria-pressed="true">白天</button><button data-l="night" aria-pressed="false">夜晚</button><button data-l="quake" aria-pressed="false">震后</button></div></div>
      <div class="grid2" id="g-imgs"></div>
      <div id="g-looks"></div>
      <h3>画质:之前与现在</h3><figure><img src="img/before_after.jpg" alt="旧版与现版渲染对比" loading="lazy"><figcaption>同类相机、不同回合。左:旧管线 640×360、32 采样;右:现管线 1280×720、128 采样 + 引导降噪。云天空、透射玻璃与室内、4K 贴图、树木细节层级和草地接缝都在这一轮修过。</figcaption></figure>
      <h3>一帧里的所有模态</h3><figure><img src="img/sensors.jpg" alt="RGB、深度、语义、实例" loading="lazy"><figcaption>每行一台机载相机,列依次为 RGB、深度(米)、语义(路面/人行道/草地/建筑/植被/车辆/人/家具…)、实例。深度单独一遍渲染,不含大气雾。</figcaption></figure>`;
    $$("#g-scenes button").forEach((b) => b.addEventListener("click", () => { G.scene = b.dataset.s; galleryDraw(); })); $$("#g-look button").forEach((b) => b.addEventListener("click", () => { G.look = b.dataset.l; galleryDraw(); }));
    galleryDraw();
  }
  function galleryDraw() {
    $$("#g-scenes button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === G.scene)); $$("#g-look button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.l === G.look));
    const quake = G.look === "quake", v = quake ? "quake" : "day", look = quake ? "day_cloud" : G.look, views = [["aerial", "航拍斜视"], ["street", "街景"], ["topdown", "俯视"]]; if (G.scene === "suburb") views.push(["yard", "院子"]);
    $("#g-imgs").innerHTML = views.map(([k, n]) => `<figure><img src="img/${G.scene}_${v}_${look}_${k}.jpg" alt="${NAMES[G.scene]} ${n}" loading="lazy" onerror="this.closest('figure').style.display='none'"><figcaption>${NAMES[G.scene]} · ${n}${quake ? " · 震后" : look === "night" ? " · 夜晚" : ""}</figcaption></figure>`).join("");
    $("#g-looks").innerHTML = G.scene === "suburb" && !quake ? `<h3>同一条街,五种光照</h3><div class="grid3">${[["day_cloud", "多云白天"], ["overcast", "阴天"], ["sunset", "日落"], ["dawn", "清晨"], ["night", "夜晚"]].map(([l, n]) => `<figure><img src="img/suburb_day_${l}_street.jpg" alt="${n}" loading="lazy"><figcaption>${n}</figcaption></figure>`).join("")}</div>` : "";
  }

  /* ====================== reference ====================== */
  function refInit() {
    const D = ES.DEVICES, rows = Object.entries(D).map(([k, d]) => `<tr><td><b>${d.label}</b></td><td>${d.sensors}</td><td class="mono">${d.tops} TOPS · ${d.tier}(${d.modes} 模式)</td><td>${d.radios.map((r) => ES.RADIOS[r].label).join("<br>")}</td></tr>`).join("");
    $("#ref-root").innerHTML = `<h3>参考</h3>
      <div class="note">这个页面里所有交互计算都在你的浏览器里完成,使用的是 Python 完整物理引擎的"紧凑版"。精度对照见实验台右下角"这些数字有多可信?"。</div>
      <h3>设备与 嵌套模型 档位</h3><div class="tw"><table class="big"><tr><th>设备</th><th>传感器</th><th>算力 / 档位</th><th>无线电</th></tr>${rows}</table></div>
      <p class="muted" style="font-size:.85rem">算力为公开资料级的近似值;嵌套模型 档位指嵌套模型只保留前 2、8 或 32 个模式。</p>
      <h3>物理模块与验证</h3><div class="tw"><table class="big"><tr><th>模块</th><th>做了什么</th><th>验证</th></tr>
        <tr><td>声学</td><td>几何扩散、ISO 9613-1 空气吸收、屋顶与屋角绕射、墙体透射、多普勒、逐路径传播;53 种声源</td><td class="mono">26 项对解析解 · 271 测试 全过</td></tr>
        <tr><td>无线电 + GNSS</td><td>15 种制式,Friis/双径、刀口与 Deygout、绕角最短路径、穿墙(P.2040)、阴影与小尺度衰落、多跳与重传;GNSS 星座几何</td><td class="mono">82 项 · 21 测试 全过</td></tr>
        <tr><td>动力学</td><td>四旋翼、四足、人体、轮式;栅格 A* 与 3D 体素规划</td><td class="mono">26 测试;Go2 与 MuJoCo 交叉验证:可行,需调参</td></tr>
        <tr><td>视觉</td><td>Cycles 路径追踪,RGB/深度/语义/实例,4K 贴图,叶片卡片树</td><td>深度对几何解析解:预测 4.6 m,实测 4.66 m</td></tr>
        <tr><td>灾害</td><td>火蔓延(Rothermel)、溃坝(Ritter)、烟羽(高斯)</td><td class="mono">37 项 · 31 测试 全过</td></tr>
        <tr><td>交通</td><td>IDM、信号灯、行人</td><td class="mono warn">16 项中 2 项超容差(如实记录)</td></tr></table></div>
      <h3>在你的电脑上跑完整引擎</h3><pre class="code">cd sim_env
tools/venv/bin/python scripts/serve_lab.py          # 浏览器打开 http://127.0.0.1:8765</pre>
      <p class="muted" style="font-size:.88rem">本机服务启动后,这个页面右上角会显示\"本机引擎已连接\",实验台多出两个按钮:\"用完整引擎重算\"(Python 声学/无线电/几何)与\"Blender 渲染此视角\"(路径追踪出一张真实图像)。</p>
      <h3>已知限制</h3><ul class="muted" style="font-size:.9rem"><li>网页版是简化模型:声场不含地面干涉与风;无线电不含阴影与小尺度衰落;树冠按半透明圆盘处理。</li><li>室内不可进入;语义掩膜对树略偏胖;地形与远景树只铺到 ±1.7 km。</li><li>交通模块有 2 项验证超容差;Skydio X2 续航模型偏短(13 min 对 35 min)。</li></ul>`;
  }
  ES.fidelityHTML = (f) => `<table class="big" style="min-width:0;font-size:.8rem"><tr><th>项目</th><th>样本</th><th>差异</th></tr>${(f.cases || []).map((c) => `<tr><td>${esc(c.name)}</td><td class="mono">${c.n}</td><td class="mono">${esc(c.result)}</td></tr>`).join("")}</table><div class="note">${esc(f.note || "")}</div>`;

  ES.tabs = { replayInit, galleryInit, refInit, RP };
})();
