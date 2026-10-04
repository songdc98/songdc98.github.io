/* People: Rocketbox avatars (scripts/export_human_assets.py -> assets/humans/<key>.glb: skinned mesh + baked clips) driven by the actor state (docs section 0).
   Kinds: "human" = emergency responder (helmet camera; the identity "人", live human_0), "person" = civilian, "lying" = a person on the floor.
   Clips (in place, 60 fps): idle, wave, lie, fall, walk_<v> / run_<v> gait cycles with a planted stance foot. The page plays the gait cycles at the phase rate  v / stride  (the stance foot then stands still on the
   ground: foot lock) and blends the two neighbouring cycles by speed; idle / gait / wave / lie are cross-faded. Head follows st.head (own body), the body leans into turns. */
(function () {
  const ES = (window.ES = window.ES || {});
  const SKU_URL = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/SkeletonUtils.js";
  let skuP = null;
  const loadSKU = () => (window.THREE && THREE.SkeletonUtils ? Promise.resolve() : skuP || (skuP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = SKU_URL; s.onload = res; s.onerror = () => rej(new Error("SkeletonUtils 加载失败")); document.head.appendChild(s); })));
  const RESP = ["resp_m", "resp_f"], CIV = ["civ_m1", "civ_f1", "civ_m2", "civ_f2", "civ_m3", "civ_f3"];
  const TPL = {};                                                  // key -> prepared template {scene, clips, info, gait: [{name, v, stride}], dur}
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x), s3 = (w) => { w = clamp(w, 0, 1); return w * w * (3 - 2 * w); };
  const MAT = {};                                                  // shared tuned materials per template material

  /* ---- templates ---- */
  function prep(key) {
    if (TPL[key]) return TPL[key];
    const name = "humans/" + key, scene = ES.models.READY[name], g = ES.models.GLTF[name];
    if (scene === undefined) ES.models.load(name);
    if (!window.THREE || !THREE.SkeletonUtils) { loadSKU().then(() => ES.bus.emit("models", "skeleton")).catch((e) => console.warn(e)); return null; }
    if (!scene || !g) return null;
    let info = {}; scene.traverse((o) => { if (o.userData && o.userData.es_info) info = JSON.parse(o.userData.es_info); });
    const clips = {}; for (const c of g.animations) clips[c.name] = c;
    const gait = Object.entries(info.clips || {}).filter(([, m]) => m.kind === "gait").map(([n, m]) => ({ name: n, v: m.speed, stride: m.stride, dur: clips[n] ? clips[n].duration : m.duration, mode: m.mode })).sort((a, b) => a.v - b.v);
    scene.traverse((o) => {
      if (!o.isMesh) return; o.frustumCulled = true; o.castShadow = /body|helmet/.test(o.material.name); o.receiveShadow = true;          // head / hair cards are small: the body silhouette carries the shadow (one shadow draw instead of three)
      const m = o.material, id = key + ":" + m.name; if (!MAT[id]) { const n = m.clone(); n.envMapIntensity = 0.55; n.roughness = Math.max(m.roughness, /body|head/.test(m.name) ? 0.52 : 0.78); n.metalness = 0;
        if (/opacity/.test(m.name)) { n.alphaTest = 0.45; n.transparent = false; n.side = THREE.DoubleSide; n.roughness = 0.62; } if (n.normalMap) n.normalScale.set(0.8, 0.8); MAT[id] = n; } o.material = MAT[id];
    });
    {                                                    // frustum culling: glTF skin vertices are in the bind space (metres) while the node carries the armature's cm scale: give every shared geometry a sphere that covers the person in any clip
      scene.updateMatrixWorld(true); const c = new THREE.Vector3(0, 0.85, 0);
      scene.traverse((o) => { if (!o.isSkinnedMesh) return; const M = o.matrixWorld, sc = new THREE.Vector3().setFromMatrixScale(M).x || 0.01; o.geometry.boundingSphere = new THREE.Sphere(c.clone().applyMatrix4(M.clone().invert()), 1.5 / sc); });
    }
    return (TPL[key] = { key, scene, clips, info, gait, height: info.height, role: info.role });
  }
  const variantFor = (kind, o) => {
    if (o.variant) return o.variant;
    if (kind === "human") return o.self ? "resp_m" : o.id === "human_0" || o.id === undefined ? "resp_m" : RESP[(o.seed >>> 0) % RESP.length];
    const m = /(\d+)$/.exec(String(o.id)), n = m ? +m[1] : o.seed >>> 0; return CIV[n % CIV.length];
  };

  /* ---- rig ---- */
  function makeRig(kind, o) {
    const key = variantFor(kind, o), T = prep(key); if (!T) return null;
    const root = new THREE.Group(), model = THREE.SkeletonUtils.clone(T.scene); root.add(model);
    { let sk = null; model.traverse((o) => { if (!o.isSkinnedMesh) return; if (!sk) sk = o.skeleton; else { o.skeleton.dispose && o.skeleton.dispose(); o.skeleton = sk; } }); }          // the clone made one skeleton per primitive: share one (bone matrices + bone texture are updated once per person)
    const mixer = new THREE.AnimationMixer(model), act = {}; let dur = {};
    for (const [n, c] of Object.entries(T.clips)) { const a = mixer.clipAction(c); a.enabled = false; a.weight = 0; a.setLoop(n === "fall" ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = true; a.play(); act[n] = a; dur[n] = c.duration; }
    const neck = model.getObjectByName("Bip01_Neck"), head = model.getObjectByName("Bip01_Head");
    model.updateMatrixWorld(true);
    const nP = neck && neck.parent ? neck.parent.getWorldQuaternion(new THREE.Quaternion()) : null, hP = head && head.parent ? head.parent.getWorldQuaternion(new THREE.Quaternion()) : null, nPi = nP && nP.clone().invert(), hPi = hP && hP.clone().invert();
    const seed = (o.seed >>> 0) || 1, phase0 = ((seed * 0.6180339) % 1), off = ((seed * 0.7548776) % 1) * 4;
    const W = { idle: kind === "lying" ? 0 : 1, gait: 0, wave: 0, lie: kind === "lying" ? 1 : 0, fall: 0 }, rig = { kind: "human", key, root, model, mixer, act, height: T.height || 1.7, role: T.role, phase: phase0, dur, tpl: T, weights: W, debug: {} };
    let hy = 0, hp = 0, lean = 0; const headRest = head ? head.quaternion.clone() : null;          // the head bone has no animation track: its rest rotation is restored every frame before the gaze is applied
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), ax = new THREE.Vector3();
    function apply(wts, times) {            // wts: clip -> weight (sum 1); times: clip -> seconds
      for (const n in act) { const w = wts[n] || 0, a = act[n]; if (w > 1e-3) { a.enabled = true; a.weight = w; a.time = times[n]; } else a.enabled = false; }
      mixer.update(0);
    }
    function gaitWeights(v, out) {          // two neighbouring cycles by speed; returns the blended stride
      const G = T.gait; let s = 0; if (!G.length) return 1;
      if (v <= G[0].v) { out[G[0].name] = 1; return G[0].stride; } if (v >= G[G.length - 1].v) { const L = G[G.length - 1]; out[L.name] = 1; return L.stride; }
      let k = 0; while (k + 1 < G.length - 1 && v >= G[k + 1].v) k++; const f = (v - G[k].v) / (G[k + 1].v - G[k].v), w = f;
      out[G[k].name] = 1 - w; out[G[k + 1].name] = w; return (1 - w) * G[k].stride + w * G[k + 1].stride;
    }
    const camP = () => { const W = ES.view3d && ES.view3d.walk; return W && W.V && W.V.cam ? W.V.cam.position : null; };
    let frame = 0, acc = 0, shadowOn = true;
    rig.update = (dt, st) => {
      acc += dt; const cp = camP(), gpos = root.parent ? root.parent.position : root.position;                 // level of detail by distance: shadows within 40 m, animation at 60 / 30 / 15 Hz (< 25 m / < 60 m / farther); the own avatar always at full rate
      if (ES.humans.lod !== false && cp && !st.self && st.role !== "self") { const d = Math.hypot(cp.x - gpos.x, cp.z - gpos.z), so = d < 40; if (so !== shadowOn) { shadowOn = so; model.traverse((o) => { if (o.isMesh && /body|helmet/.test(o.material.name)) o.castShadow = so; }); } frame++; if (d > 60 ? frame % 4 : d > 25 ? frame % 2 : 0) return; }
      dt = acc; acc = 0; dt = clamp(dt, 0, 0.1); const role = st.role || "stand", v = st.speed || 0, sp = role === "lie" || role === "wave" ? 0 : v;
      const tgt = { idle: 0, gait: 0, wave: 0, lie: 0, fall: 0 };
      if (role === "lie") tgt.lie = 1; else if (role === "wave" && v < 0.2) tgt.wave = 1; else { const g = s3((sp - 0.1) / 0.18); tgt.gait = g; tgt.idle = 1 - g; }
      const k = 1 - Math.exp(-dt / 0.14); let sum = 0; for (const c in W) { W[c] += (tgt[c] - W[c]) * k; sum += W[c]; } if (sum > 1e-4) for (const c in W) W[c] /= sum;
      const wts = {}, times = {}, tt = st.t + off;
      if (W.gait > 1e-3) { const gw = {}, stride = gaitWeights(sp, gw); rig.phase = st.gaitPhase != null ? ((st.gaitPhase % 1) + 1) % 1 : (rig.phase + dt * sp / Math.max(stride, 0.2)) % 1; for (const n in gw) { wts[n] = gw[n] * W.gait; times[n] = rig.phase * dur[n]; } }
      if (W.idle > 1e-3) { wts.idle = W.idle; times.idle = tt % dur.idle; } if (W.wave > 1e-3) { wts.wave = W.wave; times.wave = tt % dur.wave; } if (W.lie > 1e-3) { wts.lie = W.lie; times.lie = tt % dur.lie; }
      apply(wts, times);
      // lean into turns (about the feet), head follows the gaze (own body)
      const ln = clamp(-0.5 * (st.yawRate || 0) * sp / 9.81, -0.12, 0.12); lean += (ln - lean) * k; model.rotation.x = lean;
      const gy = st.head ? clamp(st.head[0] || 0, -1.0, 1.0) : 0, gp = st.head ? clamp(st.head[1] || 0, -0.55, 0.6) : 0; hy += (gy - hy) * k; hp += (gp - hp) * k;
      if (headRest) head.quaternion.copy(headRest);
      if (Math.abs(hy) + Math.abs(hp) > 1e-3 && neck && head) {
        for (const [b, P, Pi, wgt] of [[neck, nP, nPi, 0.4], [head, hP, hPi, 0.6]]) { qa.setFromAxisAngle(ax.set(0, 1, 0), hy * wgt); qb.setFromAxisAngle(ax.set(0, 0, 1), hp * wgt); qa.multiply(qb);   // model frame: yaw about up, pitch about z (nose up +)
          qb.copy(Pi).multiply(qa).multiply(P).multiply(b.quaternion); b.quaternion.copy(qb); }
      }
    };
    /* debug / sheets: force one clip at a time (seconds) or a gait phase */
    rig.pose = (clip, time) => { const w = {}, t = {}; w[clip] = 1; t[clip] = time; apply(w, t); };
    rig.poseGait = (v, phase) => { const gw = {}, stride = gaitWeights(v, gw), t = {}; for (const n in gw) t[n] = phase * dur[n]; apply(gw, t); rig.stride = stride; };
    rig.pose(kind === "lying" ? "lie" : "idle", off % (kind === "lying" ? dur.lie : dur.idle));                    // static start pose (placed instances are never updated)
    root.userData.rig = rig; return rig;
  }
  ES.actors.register("human", (o) => makeRig("human", o));
  ES.actors.register("person", (o) => makeRig("person", o));
  ES.actors.register("lying", (o) => makeRig("lying", o));
  /* world-space bounds of skinned meshes (three r128's Box3.setFromObject ignores the skeleton: the glTF vertices are in the skin's bind space): CPU-skins every `step`-th vertex with the current bone matrices */
  function bounds(root, step = 3) {
    const box = new THREE.Box3(), _v = new THREE.Vector3(); root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return; o.skeleton.update(); const n = o.geometry.attributes.position.count;
      for (let i = 0; i < n; i += step) { o.boneTransform(i, _v); box.expandByPoint(_v.applyMatrix4(o.matrixWorld)); }
    });
    return box;
  }
  /* gait cycles per second of a walking / running person at speed v (= v / stride of the baked cycles; stride is the same for every avatar: it only depends on the speed) */
  const GV = [0.4, 0.7, 1.0, 1.4, 1.8, 2.3, 3.0, 4.0], GS = [0.5229, 0.8046, 1.0256, 1.2556, 1.4229, 1.6140, 2.0, 2.5];
  function cycleRate(v) { if (v < 0.03) return 0; let s = GS[0]; if (v >= GV[GV.length - 1]) s = GS[GS.length - 1]; else if (v > GV[0]) { let k = 0; while (k + 1 < GV.length - 1 && v >= GV[k + 1]) k++; s = GS[k] + (GS[k + 1] - GS[k]) * (v - GV[k]) / (GV[k + 1] - GV[k]); } return v / s; }
  ES.humans = { lod: true, bounds, cycleRate, make: makeRig, RESP, CIV, prep, TPL, keys: [...RESP, ...CIV], load: () => Promise.all([loadSKU(), ...[...RESP, ...CIV].map((k) => ES.models.load("humans/" + k))]).then(() => ES.bus.emit("models", "humans")) };
})();
