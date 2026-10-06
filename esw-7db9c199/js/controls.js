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
      name: "Human", title: "Human · 1.7 m", icon: "🚶", color: "#009e73",
      spec: "Height 1.7 m · eye height 1.6 m · walk 1.4 / run 3.8 m/s · steps ≤0.35 m · pushes doors open itself",
      sensors: "Helmet camera 90° · binaural microphones · phone radio",
      groups: [
        { title: "Move", items: [k(["W", "S"], ["KeyW", "KeyS"], "Forward / back"), k(["A", "D"], ["KeyA", "KeyD"], "Strafe left / right"), k(["Shift"], ["ShiftLeft"], "Hold to run")] },
        { title: "Turning and view", items: [k(["Q", "E"], ["KeyQ", "KeyE"], "Turn left / right"), k(["←", "→"], ["ArrowLeft", "ArrowRight"], "Same (arrow keys)"), k(["Drag"], [], "Drag the mouse to look around"), k(["Wheel"], [], "Scroll wheel zooms")] },
        { title: "Actions", items: [k(["F"], ["KeyF"], "Open / close door or window"), k(["Click"], [], "Click the ground to auto-walk"), k(["V"], ["KeyV"], "First person ⇄ chase view")] },
      ],
    },
    dog: {
      name: "Quadruped robot", title: "Quadruped · Go2", icon: "🐕", color: "#d55e00",
      spec: "Length 0.70 m · height 0.40 m · walk 1.0 / fast 2.6 m/s · steps ≤0.22 m · cannot climb furniture · cannot open doors",
      sensors: "Front / rear cameras 100° · LiDAR L1 360°×90° ≤30 m · 4 mics · IMU · GNSS",
      groups: [
        { title: "Move", items: [k(["W", "S"], ["KeyW", "KeyS"], "Forward / back"), k(["A", "D"], ["KeyA", "KeyD"], "Sidestep left / right"), k(["Shift"], ["ShiftLeft"], "Hold to trot")] },
        { title: "Turning and view", items: [k(["Q", "E"], ["KeyQ", "KeyE"], "Turn left / right"), k(["←", "→"], ["ArrowLeft", "ArrowRight"], "Same (arrow keys)"), k(["Drag"], [], "Drag the mouse to look around"), k(["Wheel"], [], "Scroll wheel zooms")] },
        { title: "Actions", items: [k(["F"], ["KeyF"], "Operator opens / closes nearest door"), k(["Click"], [], "Click the ground to auto-walk"), k(["V"], ["KeyV"], "First person ⇄ chase view")] },
      ],
    },
    uav: {
      name: "UAV", title: "UAV · X2", icon: "🚁", color: "#cc79a7",
      spec: "Body 0.25 m · cruise 7 / sport 16 m/s · endurance ~35 min · cannot enter through a closed window · lands automatically on low battery",
      sensors: "Gimbal camera 84° · front camera 110° · LiDAR 360°×59° ≤40 m · barometer · IMU · GNSS · microphone",
      groups: [
        { title: "Flight", items: [k(["W", "S"], ["KeyW", "KeyS"], "Forward / back"), k(["A", "D"], ["KeyA", "KeyD"], "Strafe left / right"), k(["Space", "C"], ["Space", "KeyC"], "Climb / descend"), k(["Shift"], ["ShiftLeft"], "Sport mode")] },
        { title: "Yaw and gimbal", items: [k(["Q", "E"], ["KeyQ", "KeyE"], "Yaw left / right"), k(["←", "→"], ["ArrowLeft", "ArrowRight"], "Same (arrow keys)"), k(["Drag"], [], "Drag the mouse: gimbal pitch / yaw"), k(["Wheel"], [], "Scroll wheel zooms")] },
        { title: "Actions", items: [k(["F"], ["KeyF"], "Open / close door or window"), k(["V"], ["KeyV"], "First person ⇄ chase view")] },
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
    /* add({bodies:["dog","uav"] | "all", group:"Sensors", keys:["1","2","3"], codes:["Digit1",...], desc:"View: colour / depth / semantic", fn(code, down, body)}) */
    add(o) {
      const bodies = o.bodies === "all" || !o.bodies ? ["all"] : o.bodies, item = { keys: o.keys, codes: o.codes || [], desc: o.desc };
      for (const b of bodies) extra[b].push({ group: o.group || "Other", item });
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
