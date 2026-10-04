/* The one table of identities (who you can be in the walk-through) and of the keys each identity uses. The key legend in the HUD is drawn from this table and the
   keyboard handler in view3d.js consults it, so what the screen says is what the keys do. Other modules add their keys with ES.controls.add(...).
   Movement keys are continuous (view3d.js keeps them in WALK.keys under the internal names below); registered action keys call fn(down) once per press. */
(function () {
  const ES = (window.ES = window.ES || {});
  /* physical key code -> internal movement name (WALK.keys[...]) */
  const MOVE = { KeyW: "w", ArrowUp: "up", KeyS: "s", ArrowDown: "down", KeyA: "a", KeyD: "d", KeyQ: "q", ArrowLeft: "left", KeyE: "e", ArrowRight: "right", Space: "space", KeyC: "c", ShiftLeft: "shift", ShiftRight: "shift" };
  const k = (labels, codes, desc, extra) => Object.assign({ keys: labels, codes, desc }, extra || {});
  const IDENT = {
    human: {
      name: "人", title: "人 · 1.7 m", icon: "🚶", color: "#009e73",
      spec: "身高 1.7 m · 眼高 1.6 m · 步行 1.4 / 奔跑 3.8 m/s · 台阶 ≤0.35 m · 自己推门",
      sensors: "头盔相机 90° · 双耳麦克风 · 手机无线",
      groups: [
        { title: "移动", items: [k(["W", "S"], ["KeyW", "KeyS"], "前进 / 后退"), k(["A", "D"], ["KeyA", "KeyD"], "向左 / 向右平移"), k(["Shift"], ["ShiftLeft"], "按住奔跑")] },
        { title: "转向与视野", items: [k(["Q", "E"], ["KeyQ", "KeyE"], "向左 / 向右转身"), k(["←", "→"], ["ArrowLeft", "ArrowRight"], "同上(方向键)"), k(["拖动鼠标"], [], "环顾四周(抬头 / 低头)"), k(["滚轮"], [], "视野缩放")] },
        { title: "动作", items: [k(["F"], ["KeyF"], "开 / 关最近的门或窗(撞到门会自动推开)"), k(["点地面"], [], "自动走到那里"), k(["V"], ["KeyV"], "第一人称 ⇄ 跟随视角")] },
      ],
    },
    dog: {
      name: "机械狗", title: "机械狗 · Go2 级", icon: "🐕", color: "#d55e00",
      spec: "体长 0.70 m · 体高 0.40 m · 行走 1.0 / 快走 2.6 m/s · 台阶 ≤0.22 m · 跳不上家具 · 不会开门",
      sensors: "前/后相机 100° · 激光雷达 L1 360°×90° ≤30 m · 4 麦 · IMU · GNSS",
      groups: [
        { title: "移动", items: [k(["W", "S"], ["KeyW", "KeyS"], "前进 / 后退"), k(["A", "D"], ["KeyA", "KeyD"], "向左 / 向右横移"), k(["Shift"], ["ShiftLeft"], "按住小跑(快走)")] },
        { title: "转向与视野", items: [k(["Q", "E"], ["KeyQ", "KeyE"], "向左 / 向右转向"), k(["←", "→"], ["ArrowLeft", "ArrowRight"], "同上(方向键)"), k(["拖动鼠标"], [], "低头 / 抬头 · 环顾"), k(["滚轮"], [], "视野缩放")] },
        { title: "动作", items: [k(["F"], ["KeyF"], "请操作员开 / 关最近的门(狗自己开不了门)"), k(["点地面"], [], "自动走到那里(绕开家具)"), k(["V"], ["KeyV"], "第一人称 ⇄ 跟随视角")] },
      ],
    },
    uav: {
      name: "无人机", title: "无人机 · X2 级", icon: "🚁", color: "#cc79a7",
      spec: "机身 0.25 m · 巡航 7 / 运动 16 m/s · 续航约 35 min · 窗关着进不去 · 电量低自动降落",
      sensors: "云台相机 84° · 前视相机 110° · 激光雷达 360°×59° ≤40 m · 气压计 · IMU · GNSS · 麦克风",
      groups: [
        { title: "飞行", items: [k(["W", "S"], ["KeyW", "KeyS"], "前进 / 后退"), k(["A", "D"], ["KeyA", "KeyD"], "向左 / 向右平移"), k(["Space", "C"], ["Space", "KeyC"], "上升 / 下降"), k(["Shift"], ["ShiftLeft"], "运动模式(更快)")] },
        { title: "偏航与云台", items: [k(["Q", "E"], ["KeyQ", "KeyE"], "向左 / 向右偏航"), k(["←", "→"], ["ArrowLeft", "ArrowRight"], "同上(方向键)"), k(["拖动鼠标"], [], "云台俯仰 / 偏航"), k(["滚轮"], [], "变焦(视野)")] },
        { title: "动作", items: [k(["F"], ["KeyF"], "开 / 关最近的门或窗(操作员远程)"), k(["V"], ["KeyV"], "第一人称(机载相机) ⇄ 跟随视角")] },
      ],
    },
  };
  const extra = { all: [], human: [], dog: [], uav: [] };             // keys registered by other modules: {group, item}
  const handlers = {};                                                  // key code -> [{bodies, fn}]
  const press = [];                                                     // listeners of key presses (HUD highlights)
  ES.controls = {
    MOVE, IDENT,
    /* groups for the legend: the identity's own plus the keys other modules registered for it */
    groupsFor(body) {
      const out = IDENT[body].groups.map((g) => ({ title: g.title, items: g.items.slice() }));
      for (const e of [...extra.all, ...(extra[body] || [])]) { let g = out.find((x) => x.title === e.group); if (!g) out.push((g = { title: e.group, items: [] })); g.items.push(e.item); }
      return out;
    },
    /* add({bodies:["dog","uav"] | "all", group:"传感器", keys:["1","2","3"], codes:["Digit1",...], desc:"画面:彩色 / 深度 / 语义", fn(code, down, body)}) */
    add(o) {
      const bodies = o.bodies === "all" || !o.bodies ? ["all"] : o.bodies, item = { keys: o.keys, codes: o.codes || [], desc: o.desc };
      for (const b of bodies) extra[b].push({ group: o.group || "其他", item });
      if (o.fn) for (const c of o.codes || []) (handlers[c] = handlers[c] || []).push({ bodies, fn: o.fn });
    },
    /* called by view3d.js for every key event; returns true when a registered handler took it */
    onKey(code, down, body) {
      for (const f of press) f(code, down);
      const hs = handlers[code]; if (!hs) return false; let took = false;
      for (const h of hs) if (h.bodies.includes("all") || h.bodies.includes(body)) { h.fn(code, down, body); took = true; }
      return took;
    },
    onPress(f) { press.push(f); },
  };
})();
