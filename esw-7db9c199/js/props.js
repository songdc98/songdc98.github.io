/* Props (scene JSON objects + street furniture) as real geometry instead of primitives: street lamps (base, tapered pole, arm, luminaire with lens), fences (picket with pointed boards and rails, chain-link with posts / top rail /
   diamond mesh, privacy with boards and cap rail; instanced), wheelie bins, curbside mailbox, fire hydrants, bollards, stop signs, benches and street bins from the placement lists of scripts/export_props.py
   (assets/props/placements_<scene>.json = the lists the Blender renders use). Everything is procedural three.js geometry (no model files): small, shared materials, InstancedMesh for repeated parts.
   ES.props.build(scene, A, V) is called by view3d.js build(); it returns true when it handled fences + objects + lamps. Lamps keep the luminaire light position (hx, 6.7, -hy) in V.lamps and carry
   userData.lampLightPos on their group (the environment module lights them); footprints of the furniture that the World raster does not know are registered in V.propBlk (true footprint; propHit() in view3d.js
   adds the body radius). The old primitives remain in view3d.js as the fallback while this module is absent. */
(function () {
  const ES = (window.ES = window.ES || {});
  const P = (ES.props = ES.props || {});
  const lin = (c) => new THREE.Color(c).convertSRGBToLinear(), MC = {}, GC = {};
  const mat = (c, rough = 0.7, metal = 0, extra) => { const k = c + "|" + rough + "|" + metal + (extra ? JSON.stringify(extra) : ""); return MC[k] || (MC[k] = new THREE.MeshStandardMaterial(Object.assign({ color: lin(c), roughness: rough, metalness: metal, envMapIntensity: 0.6 }, extra))); };
  const geo = (k, f) => GC[k] || (GC[k] = f());
  const unitBox = () => geo("box", () => new THREE.BoxGeometry(1, 1, 1)), unitCyl = () => geo("cyl", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
  const picketGeo = () => geo("picket", () => { const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0.5, 0.88); s.lineTo(0, 1); s.lineTo(-0.5, 0.88); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g; });   // pointed board, unit width / height / depth
  let chainTex = null;
  const chainTexture = () => chainTex || (chainTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); g.strokeStyle = "rgba(170,178,184,.95)"; g.lineWidth = 1.6; for (let k = -64; k < 128; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; })());
  const signTexture = () => geo("stop", () => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); const oct = (r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g[i ? "lineTo" : "moveTo"](64 + r * Math.cos(a), 64 - r * Math.sin(a)); } g.closePath(); }; g.fillStyle = "#fff"; oct(64); g.fill(); g.fillStyle = "#b3120e"; oct(57); g.fill(); g.fillStyle = "#fff"; g.font = "bold 46px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("STOP", 64, 66); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; });

  /* instanced parts: add(kind, x, z0, zLab, yaw, y, sx, sy, sz, color?) collects, flush() creates one InstancedMesh per kind */
  function Inst(scn) {
    const L = {}, d = new THREE.Object3D();
    return {
      add(kind, geom, material, x, ybase, zthree, yaw, dy, sx, sy, sz, color) { (L[kind] = L[kind] || { geom, material, items: [] }).items.push([x, ybase + dy, zthree, yaw, sx, sy, sz, color]); },
      flush(shadow) {
        for (const [k, o] of Object.entries(L)) {
          const m = new THREE.InstancedMesh(o.geom, o.material, o.items.length), c = new THREE.Color();
          o.items.forEach((it, i) => { d.position.set(it[0], it[1], it[2]); d.rotation.set(0, it[3], 0); d.scale.set(it[4], it[5], it[6]); d.updateMatrix(); m.setMatrixAt(i, d.matrix); if (it[7] !== undefined) m.setColorAt(i, c.setHex(it[7]).convertSRGBToLinear()); });
          m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; m.castShadow = !!(shadow && shadow[k]); m.receiveShadow = true; m.userData.dyn = true; scn.add(m);
        }
      },
    };
  }

  function fences(scn, A) {
    const W = A.W, I = Inst(scn), chain = [], u = unitBox();
    for (const o of A.scene.objects) {
      if (o.type !== "fence") continue; const st = o.style, h = o.h;
      for (const ln of o.lines) for (let k = 0; k + 1 < ln.length; k++) {
        const a = ln[k], c = ln[k + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.2) continue; const yaw = Math.atan2(c[1] - a[1], c[0] - a[0]), ux = (c[0] - a[0]) / L, uy = (c[1] - a[1]) / L, n = Math.max(1, Math.round(L / 2.4));
        const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2, gz = W.groundZ(mx, my);
        for (let s = 0; s <= n; s++) { const px = a[0] + ((c[0] - a[0]) * s) / n, py = a[1] + ((c[1] - a[1]) * s) / n, g0 = W.groundZ(px, py);
          if (st === "chain") I.add("chainpost", unitCyl(), mat(0x8b949a, 0.45, 0.8), px, g0, -py, 0, (h + 0.08) / 2, 0.07, h + 0.08, 0.07);
          else if (st === "privacy") I.add("privpost", u, mat(0x5e4228, 0.85), px, g0, -py, yaw, (h + 0.1) / 2, 0.11, h + 0.1, 0.11);
          else { I.add("picketpost", u, mat(0xece8dc, 0.55), px, g0, -py, yaw, (h + 0.1) / 2, 0.1, h + 0.1, 0.1); I.add("postcap", u, mat(0xece8dc, 0.55), px, g0, -py, yaw, h + 0.1 + 0.025, 0.14, 0.05, 0.14); } }
        if (st === "picket") { const m = mat(0xf4f1e8, 0.5); for (const z of [0.22, h - 0.25]) I.add("picketrail", u, mat(0xe3dfd2, 0.6), mx, gz, -my, yaw, z, L, 0.07, 0.04); const nb = Math.floor(L / 0.13); for (let b = 0; b < nb; b++) { const t = (b + 0.5) * L / nb, px = a[0] + ux * t, py = a[1] + uy * t; I.add("picket", picketGeo(), m, px, W.groundZ(px, py), -py, yaw, 0, 0.085, h * 0.95, 0.025); } }
        else if (st === "privacy") { const tones = [0x7a5430, 0x946a3e, 0x85603a, 0x6f4c2c]; const nb = Math.floor(L / 0.14); for (let b = 0; b < nb; b++) { const t = (b + 0.5) * L / nb, px = a[0] + ux * t, py = a[1] + uy * t, hh = h - 0.02 * ((b * 7) % 3); I.add("board", u, mat(0xffffff, 0.85), px, W.groundZ(px, py), -py, yaw, hh / 2, 0.138, hh, 0.03, tones[(b * 5 + ((a[0] * 3) | 0)) % 4]); }
          I.add("privrail", u, mat(0x5e4228, 0.85), mx, gz, -my, yaw, 0.2, L, 0.07, 0.05); I.add("privrail", u, mat(0x5e4228, 0.85), mx, gz, -my, yaw, h * 0.62, L, 0.07, 0.05); I.add("cap", u, mat(0x5e4228, 0.85), mx, gz, -my, yaw, h + 0.03, L, 0.06, 0.11); }
        else { I.add("toprail", u, mat(0x8b949a, 0.45, 0.8), mx, gz, -my, yaw, h, L, 0.05, 0.05); I.add("botwire", u, mat(0x8b949a, 0.45, 0.8), mx, gz, -my, yaw, 0.06, L, 0.015, 0.015); chain.push([a, c, L, h, gz]); }
      }
    }
    I.flush({ board: true, privpost: true, cap: true });
    if (chain.length) {                                                                // diamond mesh: one merged strip geometry, alpha-tested
      const pos = [], uv = [], idx = []; chain.forEach(([a, c, L, h, gz], i) => { const b = i * 4; pos.push(a[0], gz + 0.06, -a[1], c[0], gz + 0.06, -c[1], c[0], gz + h, -c[1], a[0], gz + h, -a[1]); uv.push(0, 0, L / 0.9, 0, L / 0.9, h / 0.9, 0, h / 0.9); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); });
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: chainTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7, envMapIntensity: 0.6 })); m.userData.dyn = true; m.frustumCulled = false; scn.add(m);
    }
  }

  function lamp(l, z0, night) {
    const poleM = mat(0x2b3034, 0.5, 0.6), hx = Math.cos(l[2]) * 1.6, hy = Math.sin(l[2]) * 1.6;
    const grp = new THREE.Group(); grp.position.set(l[0], z0, -l[1]); grp.rotation.y = l[2];                      // local +x = arm direction
    const A2 = (geom, m, x, y, z, rz) => { const o = new THREE.Mesh(geom, m); o.position.set(x, y, z); if (rz) o.rotation.z = rz; o.castShadow = true; grp.add(o); return o; };
    A2(geo("lampbase", () => new THREE.CylinderGeometry(0.11, 0.2, 0.45, 12)), poleM, 0, 0.225, 0);
    A2(geo("lamppole", () => new THREE.CylinderGeometry(0.055, 0.09, 6.55, 12)), poleM, 0, 0.45 + 3.275, 0);
    A2(geo("lamparm", () => new THREE.CylinderGeometry(0.03, 0.05, 1.7, 8)), poleM, 0.78, 6.95, 0, Math.PI / 2 - 0.1);
    A2(geo("lampcol", () => new THREE.SphereGeometry(0.075, 10, 8)), poleM, 0, 7.0, 0);
    A2(geo("lamphouse", () => new THREE.BoxGeometry(0.78, 0.13, 0.32)), mat(0x3a3f44, 0.45, 0.5), 1.6, 6.95, 0);
    const lens = new THREE.Mesh(geo("lamplens", () => new THREE.BoxGeometry(0.68, 0.02, 0.26)), night ? new THREE.MeshBasicMaterial({ color: lin(0xffe2a8), toneMapped: false }) : mat(0xcfd6da, 0.1, 0.1)); lens.position.set(1.6, 6.875, 0); grp.add(lens);
    grp.userData.lampLightPos = [l[0] + hx, 6.7, -(l[1] + hy)]; grp.userData.dyn = true; return grp;
  }

  function bins(scn, o, z0) {                      // two wheelie bins (green, blue) side by side along the box's long side
    const g = new THREE.Group(); g.position.set(o.xy[0], z0, -o.xy[1]); g.rotation.y = o.yaw;
    [[0x2f7a4a, -0.4], [0x2f5fa3, 0.4]].forEach(([c, d]) => {
      const bin = new THREE.Group(), body = new THREE.Mesh(geo("binbody", () => { const b = new THREE.CylinderGeometry(0.44, 0.36, 0.9, 4, 1); b.rotateY(Math.PI / 4); b.scale(1, 1, 0.82); return b; }), mat(c, 0.6)); body.position.y = 0.55; body.castShadow = true; bin.add(body);
      const lid = new THREE.Mesh(geo("binlid", () => new THREE.BoxGeometry(0.66, 0.05, 0.62)), mat(0x1f2327, 0.5)); lid.position.set(0, 1.03, 0); bin.add(lid);
      const w = geo("binwheel", () => new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12)); for (const s of [-1, 1]) { const wh = new THREE.Mesh(w, mat(0x111214, 0.8)); wh.rotation.z = Math.PI / 2; wh.position.set(0.27 * s, 0.09, 0.28); bin.add(wh); }
      const h = new THREE.Mesh(geo("binhandle", () => new THREE.BoxGeometry(0.5, 0.03, 0.03)), mat(0x1f2327, 0.5)); h.position.set(0, 1.0, 0.33); bin.add(h);
      bin.position.set(0, 0, d); g.add(bin);
    });
    g.userData.dyn = true; return g;
  }
  function mailbox(o, z0, dir) {                  // wooden post + arched curbside mailbox with door and flag; the door faces the road (dir = lab direction of the front)
    const g = new THREE.Group(); g.position.set(o.xy[0], z0, -o.xy[1]); g.rotation.y = dir + Math.PI / 2; const add = (geom, m, x, y, z) => { const q = new THREE.Mesh(geom, m); q.position.set(x, y, z); q.castShadow = true; g.add(q); return q; }, blue = mat(0x2f5aa8, 0.4, 0.3);
    add(geo("mbpost", () => new THREE.BoxGeometry(0.09, 1.05, 0.09)), mat(0x6a4a2a, 0.8), 0, 0.525, 0);
    add(geo("mbbase", () => new THREE.BoxGeometry(0.2, 0.1, 0.5)), blue, 0, 1.1, 0);
    add(geo("mbarch", () => { const s2 = new THREE.Shape(); s2.moveTo(-0.1, 0); s2.lineTo(0.1, 0); s2.absarc(0, 0, 0.1, 0, Math.PI, false); s2.closePath(); const gg = new THREE.ExtrudeGeometry(s2, { depth: 0.5, bevelEnabled: false }); gg.translate(0, 0, -0.25); return gg; }), blue, 0, 1.15, 0);
    add(geo("mbdoor", () => new THREE.BoxGeometry(0.17, 0.17, 0.012)), mat(0x24467f, 0.4, 0.3), 0, 1.2, 0.253);
    add(geo("mbflag", () => new THREE.BoxGeometry(0.012, 0.13, 0.05)), mat(0xd0291f, 0.5), 0.112, 1.23, -0.12);
    g.userData.dyn = true; return g;
  }
  function hydrant(x, y, z0) {
    const g = new THREE.Group(), red = mat(0xc4201c, 0.4, 0.25), add = (geom, m, px, py, pz, rx, rz) => { const q = new THREE.Mesh(geom, m); q.position.set(px, py, pz); if (rx) q.rotation.x = rx; if (rz) q.rotation.z = rz; q.castShadow = true; g.add(q); return q; };
    add(geo("hybase", () => new THREE.CylinderGeometry(0.12, 0.14, 0.08, 14)), red, 0, 0.04, 0); add(geo("hybody", () => new THREE.CylinderGeometry(0.095, 0.105, 0.5, 14)), red, 0, 0.33, 0);
    add(geo("hytop", () => new THREE.SphereGeometry(0.105, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), red, 0, 0.58, 0); add(geo("hynut", () => new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8)), mat(0xd8d8d0, 0.4, 0.8), 0, 0.7, 0);
    for (const s of [-1, 1]) { add(geo("hynoz", () => new THREE.CylinderGeometry(0.045, 0.045, 0.12, 10)), red, 0.12 * s, 0.42, 0, 0, Math.PI / 2); add(geo("hycap", () => new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10)), mat(0xd8d8d0, 0.35, 0.8), 0.19 * s, 0.42, 0, 0, Math.PI / 2); }
    add(geo("hypump", () => new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12)), red, 0, 0.42, 0.12, Math.PI / 2); g.position.set(x, z0, -y); g.userData.dyn = true; return g;
  }
  function bollard(x, y, z0) { const g = new THREE.Group(), m = mat(0x30343a, 0.5, 0.4), a = new THREE.Mesh(geo("bolb", () => new THREE.CylinderGeometry(0.07, 0.075, 0.9, 12)), m); a.position.y = 0.45; a.castShadow = true; g.add(a); const t = new THREE.Mesh(geo("bolt", () => new THREE.SphereGeometry(0.07, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), m); t.position.y = 0.9; g.add(t); const r = new THREE.Mesh(geo("bolr", () => new THREE.CylinderGeometry(0.0765, 0.0765, 0.07, 12)), mat(0xe8e8e0, 0.4)); r.position.y = 0.78; g.add(r); g.position.set(x, z0, -y); g.userData.dyn = true; return g; }
  function stopSign(x, y, face, z0) {
    const g = new THREE.Group(); g.position.set(x, z0, -y); g.rotation.y = face; const pole = new THREE.Mesh(geo("spole", () => new THREE.CylinderGeometry(0.03, 0.03, 2.9, 8)), mat(0x9ea6ab, 0.45, 0.7)); pole.position.y = 1.45; pole.castShadow = true; g.add(pole);
    const oct = () => { const c = new THREE.CircleGeometry(0.4, 8, Math.PI / 8); c.rotateY(Math.PI / 2); return c; };
    const f = new THREE.Mesh(geo("soct", oct), new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.4, metalness: 0.1 })); f.position.set(0.045, 2.5, 0); g.add(f);          // front (+x = the way the sign looks)
    const b = new THREE.Mesh(geo("soct", oct), mat(0x8b9399, 0.5, 0.6, { side: THREE.BackSide })); b.position.set(0.04, 2.5, 0); g.add(b); g.userData.dyn = true; return g;      // back: bare grey metal
  }
  function bench(x, y, face, z0) { const g = new THREE.Group(), wood = mat(0x8a5a32, 0.8), iron = mat(0x25282b, 0.5, 0.6), add = (gm, m, px, py, pz) => { const q = new THREE.Mesh(gm, m); q.position.set(px, py, pz); q.castShadow = true; g.add(q); }, bx = (a, b, c) => new THREE.BoxGeometry(a, b, c);
    for (let k = 0; k < 4; k++) add(bx(1.6, 0.04, 0.09), wood, 0, 0.45, -0.17 + k * 0.11); for (let k = 0; k < 3; k++) add(bx(1.6, 0.09, 0.03), wood, 0, 0.62 + k * 0.12, -0.24 - k * 0.02);
    for (const s of [-0.7, 0.7]) { add(bx(0.05, 0.45, 0.5), iron, s, 0.225, 0); add(bx(0.05, 0.62, 0.05), iron, s, 0.55, -0.24); } g.position.set(x, z0, -y); g.rotation.y = face + Math.PI / 2; g.userData.dyn = true; return g; }
  function streetBin(x, y, z0) { const g = new THREE.Group(), a = new THREE.Mesh(geo("sbin", () => new THREE.CylinderGeometry(0.26, 0.22, 0.85, 14)), mat(0x35503f, 0.5, 0.5)); a.position.y = 0.45; a.castShadow = true; g.add(a); const l = new THREE.Mesh(geo("sbinl", () => new THREE.CylinderGeometry(0.28, 0.28, 0.05, 14)), mat(0x1c1f22, 0.5, 0.4)); l.position.y = 0.9; g.add(l); g.position.set(x, z0, -y); g.userData.dyn = true; return g; }

  /* single props for the contact sheets (scripts/web_sheet_props.py): origin on the ground, front along +x */
  P.make = { hydrant: () => hydrant(0, 0, 0), bollard: () => bollard(0, 0, 0), stopSign: () => stopSign(0, 0, 0, 0), bench: () => bench(0, 0, 0, 0), streetBin: () => streetBin(0, 0, 0), bins: () => bins(null, { xy: [0, 0], yaw: 0 }, 0), mailbox: () => mailbox({ xy: [0, 0] }, 0, 0), lamp: (night) => lamp([0, 0, 0], 0, !!night) };

  /* ---- the entry point ---- */
  P.build = function (scn, A, V) {
    if (!window.THREE || !A.scene || !A.W) return false;
    const sc = A.scene, W = A.W, night = ES.actors ? ES.actors.isNight() : A.look === "night", blk = V.propBlk, add = (o) => { o.userData.dyn = true; scn.add(o); return o; };
    if (A.occ.fences) fences(scn, A);
    for (const l of sc.lamps) { const g = lamp(l, W.groundZ(l[0], l[1]), night); scn.add(g); V.lamps.push(g.userData.lampLightPos); }
    const roads = sc.roads || [], toRoad = (x, y) => { let best = 1e9, bx = 0, by = 0; for (const r of roads) for (let k = 0; k + 1 < r.line.length; k++) { const a = r.line[k], b = r.line[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))), px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(px - x, py - y); if (d < best) { best = d; bx = px; by = py; } } return Math.atan2(by - y, bx - x); };
    const lcol = [0xc0504d, 0x4f81bd, 0x70a757];
    for (const o of sc.objects) {
      if (o.type === "box") {
        const z0 = W.groundZ(o.xy[0], o.xy[1]);
        if (o.name === "bins") { scn.add(bins(scn, o, z0)); continue; }
        const mm = new THREE.Mesh(unitBox(), mat(o.name === "container" ? lcol[Math.floor(o.xy[0] + o.xy[1]) % 3] : o.name === "shed" ? 0xb9926e : 0xd8a31a, o.name === "container" ? 0.45 : 0.85, o.name === "container" ? 0.5 : 0)); mm.scale.set(o.size[0], o.size[2], o.size[1]); mm.rotation.y = o.yaw; mm.position.set(o.xy[0], z0 + o.size[2] / 2, -o.xy[1]); mm.castShadow = mm.receiveShadow = true; add(mm);
        if (o.name === "shed") { const rf = new THREE.Mesh(unitBox(), mat(0x8a3a30, 0.8)); rf.scale.set(o.size[0] + 0.3, 0.12, o.size[1] + 0.3); rf.rotation.y = o.yaw; rf.position.set(o.xy[0], z0 + o.size[2] + 0.06, -o.xy[1]); add(rf); }
      } else if (o.type === "cyl") { const mm = new THREE.Mesh(unitCyl(), mat(o.name === "chimney" ? 0xd9d2c9 : 0xb7bdc2, 0.6, o.name === "chimney" ? 0 : 0.5)); mm.scale.set(2 * o.r, o.h, 2 * o.r); mm.position.set(o.xy[0], o.h / 2, -o.xy[1]); mm.castShadow = true; add(mm); }
      else if (o.type === "post") {
        const z0 = W.groundZ(o.xy[0], o.xy[1]);
        if (o.name === "mailbox") scn.add(mailbox(o, z0, toRoad(o.xy[0], o.xy[1])));
        else { const mm = new THREE.Mesh(unitCyl(), mat(0x33414a, 0.5, 0.6)); mm.scale.set(0.1, o.h, 0.1); mm.position.set(o.xy[0], z0 + o.h / 2, -o.xy[1]); mm.castShadow = true; add(mm); if (o.name === "hoop") { const bb = new THREE.Mesh(unitBox(), mat(0xe9eef0, 0.3, 0.1)); bb.scale.set(0.04, 1.05, 1.8); bb.position.set(o.xy[0] + 0.3, z0 + o.h - 0.4, -o.xy[1]); add(bb); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.012, 6, 18), mat(0xe0521a, 0.4, 0.5)); rim.rotation.x = Math.PI / 2; rim.position.set(o.xy[0] + 0.55, z0 + o.h - 0.55, -o.xy[1]); add(rim); } }
      }
    }
    // street furniture from the renders' placement lists (async): hydrants, bollards, stop signs, benches, street bins, yard mailboxes oriented like the lots
    const name = A.name; fetch(`${ES.ASSET_DIR || "assets"}/props/placements_${name}.json`).then((r) => (r.ok ? r.json() : null)).then((J) => {
      if (!J || V.scene !== scn && V.scene) return; const gz = (x, y) => W.groundZ(x, y);
      for (const h of J.hydrants || []) { scn.add(hydrant(h[0], h[1], gz(h[0], h[1]))); blk.push({ x: h[0], y: h[1], r: 0.15 }); }
      for (const b of J.bollards || []) { scn.add(bollard(b[0], b[1], gz(b[0], b[1]))); blk.push({ x: b[0], y: b[1], r: 0.08 }); }
      for (const s of J.stop_signs || []) { scn.add(stopSign(s[0], s[1], s[2], gz(s[0], s[1]))); blk.push({ x: s[0], y: s[1], r: 0.05 }); }
      for (const b of J.benches || []) { scn.add(bench(b[0], b[1], b[2], gz(b[0], b[1]))); blk.push({ x: b[0], y: b[1], hx: 0.85, hy: 0.28, yaw: b[2] + Math.PI / 2 }); }
      for (const b of J.bins || []) { scn.add(streetBin(b[0], b[1], gz(b[0], b[1]))); blk.push({ x: b[0], y: b[1], r: 0.26 }); }
      if (ES.bus) ES.bus.emit("props:placed", name);
    }).catch(() => {});
    return true;
  };
})();
