/* Vehicles: lamp rig of every car / truck / bus (head, tail, brake, indicators, emergency light bars), the delivery rover with its lamps, the driving target vehicle.
   The vehicle GLBs (scripts/export_glb_assets.py) carry the lamps as separate meshes with role-named materials: head, tail, turnL, turnR, amber, siren_a (red), siren_b (blue), siren_w (white), taxi_sign.
   models.js vehicleFrom() calls ES.vehicles.attach(group, vtype): the lamp materials become per-vehicle clones whose emissive state follows the rig:
     night + moving  -> headlamps and tail lamps on;  st.af < -0.6 or st.brake -> brake lamps;  st.yawRate > 0.15 / < -0.15 -> left / right indicator (1.5 Hz);  st.vf < -0.1 -> reverse lamp (white tail);
     police / ambulance / fire truck: the light bar flashes (alternating double flashes) at night, faintly by day (they are on duty even when parked);  taxi: the roof sign is lit at night.
   Rig: group.userData.rig = {dynamic, update(dt, st), set(state)}; view3d.js tickParked() calls update() for the dynamic ones (emergency vehicles) every frame. Parked vehicles keep their exported pose. */
(function () {
  const ES = (window.ES = window.ES || {});
  const V = (ES.vehicles = ES.vehicles || {});
  const EMERG = { police: 1, ambulance: 1, fire_truck: 1 };
  const LAMP = { head: [0xfff2d0, 2.8], tail: [0xff1008, 1.0], turnL: [0xff9a10, 2.6], turnR: [0xff9a10, 2.6], amber: [0xff9a10, 2.2], siren_a: [0xff1a10, 3.6], siren_b: [0x1a3cff, 3.8], siren_w: [0xffffff, 2.8], taxi_sign: [0xffe9a0, 1.6] };
  const lin = (c) => new THREE.Color(c).convertSRGBToLinear();
  /* the exported bodies carry no lamp geometry (only light bars / taxi sign): head, tail and indicator lenses are placed on the real body surface by ray casting at the lamp height of each type
     (cached per type, group space) and shaded as clear plastic by day, emissive at night */
  const HGT = { sedan: [0.66, 0.80], hatchback: [0.64, 0.82], suv: [0.82, 0.95], pickup: [0.86, 0.90], van: [0.78, 1.0], box_truck: [0.9, 0.95], bus: [0.82, 1.15], ambulance: [0.85, 1.05], fire_truck: [0.95, 1.1], police: [0.66, 0.80], taxi: [0.66, 0.80] };
  const LAYOUT = {}, GEO = {};
  function layout(g, vtype) {
    if (LAYOUT[vtype]) return LAYOUT[vtype]; const body = g.getObjectByName(vtype + "body") || g.getObjectByName(vtype + ":body"); if (!body) return (LAYOUT[vtype] = []);
    g.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(body), pb = new THREE.Box3().setFromObject(body.children[0] || body), L = bb.max.x - bb.min.x, W = pb.max.z - pb.min.z, rc = new THREE.Raycaster(), out = [], [hy, ty] = HGT[vtype] || [0.7, 0.85], zf = 0.36 * W, X = new THREE.Vector3(1, 0, 0);
    const hit = (x0, y, z, dir) => { rc.set(new THREE.Vector3(x0, y, z), dir); rc.far = L + 1; const r = rc.intersectObject(body, true)[0]; return r ? { p: r.point.clone(), n: r.face.normal.clone().transformDirection(r.object.matrixWorld).normalize() } : null; };
    for (const s of [-1, 1]) for (const [kind, front, y, dz, w, h] of [["head", 1, hy, 0, 0.30, 0.085], ["turn", 1, hy - 0.07, 0.22, 0.10, 0.05], ["tail", 0, ty, 0, 0.24, 0.09], ["turn", 0, ty - 0.1, 0.2, 0.09, 0.05]]) {
      const x0 = front ? bb.max.x + 0.4 : bb.min.x - 0.4, r = hit(x0, y, s * (zf + dz), front ? X.clone().negate() : X); if (r) out.push({ kind, front, side: s, p: r.p, n: r.n, w, h });
    }
    return (LAYOUT[vtype] = out);
  }
  const quad = (w, h) => GEO[w + "x" + h] || (GEO[w + "x" + h] = new THREE.PlaneGeometry(w, h));
  const lensMat = (c, rough = 0.12) => new THREE.MeshStandardMaterial({ color: lin(c), roughness: rough, metalness: 0.0, emissive: new THREE.Color(0x000000), envMapIntensity: 1.2 });
  /* clone this vehicle's lamp materials (per-instance emissive state) and build the controller */
  V.attach = function (g, vtype) {
    const mats = {}; g.traverse((o) => { if (!o.isMesh || !o.material) return; const n = o.material.name; if (!LAMP[n]) return; if (!mats[n]) { const m = o.material.clone(); m.emissive = lin(LAMP[n][0]); m.emissiveIntensity = 0; mats[n] = m; } o.material = mats[n]; });
    const parts = {}, mq = new THREE.Matrix4(), qa = new THREE.Quaternion();                    // lenses on the body surface, merged into one mesh per lamp type (4 draws per vehicle)
    for (const L of layout(g, vtype)) {
      const name = L.kind === "head" ? "head" : L.kind === "tail" ? "tail" : L.side < 0 ? "turnL" : "turnR";
      if (!mats[name]) { const m = lensMat(name === "head" ? 0xe8eef2 : name === "tail" ? 0xc41818 : 0xd08a20); m.name = name; m.emissive = lin(LAMP[name][0]); m.emissiveIntensity = 0; mats[name] = m; }
      qa.setFromUnitVectors(new THREE.Vector3(0, 0, 1), L.n); mq.compose(L.p.clone().addScaledVector(L.n, 0.006), qa, new THREE.Vector3(1, 1, 1)); const q = quad(L.w, L.h).clone().applyMatrix4(mq), P = (parts[name] = parts[name] || { pos: [], nor: [], idx: [] }), b = P.pos.length / 3;
      P.pos.push(...q.attributes.position.array); P.nor.push(...q.attributes.normal.array); for (const k of q.index.array) P.idx.push(b + k);
    }
    for (const [name, P] of Object.entries(parts)) { const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute(P.pos, 3)); bg.setAttribute("normal", new THREE.Float32BufferAttribute(P.nor, 3)); bg.setIndex(P.idx); const m = new THREE.Mesh(bg, mats[name]); m.userData.lens = true; g.add(m); }
    const emerg = !!EMERG[vtype], wheels = [], rad = 0.33, ph = Math.random(), S = { head: false, brake: false, turn: 0, reverse: false, hazard: false, siren: emerg };
    const lamp = (n, on, k = 1) => { const m = mats[n]; if (m) m.emissiveIntensity = on ? LAMP[n][1] * k : 0; };
    const apply = (t, night) => {
      lamp("head", S.head); const tailBase = S.head ? 0.55 : 0; const tm = mats.tail; if (tm) tm.emissiveIntensity = S.brake ? LAMP.tail[1] * 2.0 : tailBase * LAMP.tail[1];
      const blink = Math.floor(t * 3) % 2 === 0; lamp("turnL", (S.turn < 0 || S.hazard) && blink); lamp("turnR", (S.turn > 0 || S.hazard) && blink); lamp("amber", (S.turn !== 0 || S.hazard) && blink, 0.6);
      if (emerg) {
        const k = night ? 1 : 0.28, u = (t * 2.3 + ph) % 1, A = S.siren && (u < 0.1 || (u > 0.17 && u < 0.27)), B = S.siren && ((u > 0.5 && u < 0.6) || (u > 0.67 && u < 0.77));
        lamp("siren_a", A, k); if (vtype === "police") lamp("siren_b", B, k); else lamp("siren_b", A, k); lamp("siren_w", vtype === "police" ? (A || B) && night : B, k * 0.9);
      }
      lamp("taxi_sign", vtype === "taxi" && night);
    };
    const rig = { dynamic: emerg, root: g, state: S, kind: "vehicle", vtype,
      set(o) { Object.assign(S, o); apply(performance.now() / 1000, ES.actors.isNight()); },
      update(dt, st) {
        const night = !!st.night, moving = st.moving || (st.speed || 0) > 0.25;
        if (!emerg || st.vf !== undefined) { S.head = night && (moving || st.lamps === true); if (st.brake !== undefined || st.af !== undefined) S.brake = !!st.brake || (st.af || 0) < -0.6; S.turn = st.yawRate > 0.15 ? -1 : st.yawRate < -0.15 ? 1 : 0; S.reverse = (st.vf || 0) < -0.1; }
        if (moving && wheels.length) { rig.d = (rig.d || 0) + (st.vf || 0) * dt; const a = -rig.d / rad, steer = ES.clamp ? ES.clamp(Math.atan(2.7 * (st.yawRate || 0) / Math.max(Math.abs(st.vf || 0), 0.5)), -0.5, 0.5) : 0; wheels.forEach((w) => { w.rotation.z = a; if (/wheel0[LR]$/.test(w.name) && w.parent && /steer0/.test(w.parent.name || "")) w.parent.rotation.y = steer; }); }
        apply(st.t || performance.now() / 1000, night);
      } };
    g.traverse((o) => { if (/wheel\d[LRC]$/.test(o.name)) wheels.push(o); });                 // GLTFLoader strips the ':' of node names (sedan:wheel0L -> sedanwheel0L)
    g.userData.rig = rig; apply(performance.now() / 1000, ES.actors.isNight()); return rig;
  };

  /* placed "driving vehicle" target: a hatchback (the 4.28 x 1.8 m footprint of the target); lamps follow the night look */
  ES.actors.register("tvehicle", (o) => { const g = ES.models.vehicleSync("hatchback", ((o.seed >>> 0) % 5) + 1); if (!g) return null; const r = g.userData.rig; r.set({ head: ES.actors.isNight() }); return { root: g, update: (dt, st) => r.update(dt, st), kind: "vehicle", vehicle: r }; });

  /* delivery rover (sidewalk robot): baseline model of models.js + head / tail / indicator lamps, a LiDAR puck on the lid, skid-steer wheels */
  const roverBuild = () => {
    const base = ES.models.roverSync(); if (!base) return null; const inner = base.root.children[0], M = {}, lam = (c) => new THREE.MeshStandardMaterial({ color: lin(c), emissive: lin(c), emissiveIntensity: 0, roughness: 0.25 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); inner.add(m); return m; }, bx = (x, y, z) => new THREE.BoxGeometry(x, y, z);
    const head = lam(0xfff2d0), tail = lam(0xff1008), amb = lam(0xff9a10), dark = new THREE.MeshStandardMaterial({ color: lin(0x15171a), roughness: 0.4, metalness: 0.3 }), ring = new THREE.MeshBasicMaterial({ color: lin(0x39d0ff), toneMapped: false });
    for (const s of [-1, 1]) { add(bx(0.012, 0.04, 0.085), head, 0.335, 0.2, 0.15 * s); add(bx(0.012, 0.035, 0.07), tail, -0.335, 0.2, 0.15 * s); add(bx(0.012, 0.03, 0.03), amb, 0.332, 0.27, 0.235 * s); add(bx(0.012, 0.03, 0.03), amb, -0.332, 0.27, 0.235 * s); }
    add(new THREE.CylinderGeometry(0.052, 0.058, 0.07, 20), dark, -0.02, 0.405, 0); add(new THREE.CylinderGeometry(0.0525, 0.0525, 0.006, 20), ring, -0.02, 0.405, 0);          // Velodyne-puck class LiDAR on the lid (DEVICES: 0.45 m above the base)
    inner.traverse((o) => { o.castShadow = true; }); M.head = head; M.tail = tail; M.amb = amb; return { root: base.root, wheels: base.wheels, M };
  };
  ES.actors.register("rover", () => {
    const r = roverBuild(); if (!r) return null;
    return { kind: "rover", root: r.root, update(dt, st) {
      const night = !!st.night, vf = st.vf || 0, w = st.yawRate || 0, L = (vf - w * 0.26) / 0.1, R = (vf + w * 0.26) / 0.1;        // skid steer: left wheels = nodes wheel0-2, right = 3-5
      r.wheels.forEach((wh) => { wh.rotation.z -= (/wheel[012]$/.test(wh.name) ? L : R) * dt; });
      const brake = (st.af || 0) < -0.4, blink = Math.floor((st.t || 0) * 3) % 2 === 0;
      r.M.head.emissiveIntensity = night ? 2.4 : 0; r.M.tail.emissiveIntensity = brake ? 4 : night ? 0.9 : 0; r.M.amb.emissiveIntensity = Math.abs(w) > 0.25 && blink ? 2.4 : 0;
    } };
  });
})();
