/* MapView: vector top-down map of the scene (cached base layer) + overlays (heat maps, masks, paths, markers) + entity interaction. */
(function () {
  const ES = window.ES;
  const BCOL = { house: "#c19a74", cottage: "#c19a74", apartment: "#b56d63", rowhouse: "#c9856a", commercial: "#8d9bb0", campus: "#b88c7a", warehouse: "#9aa0a6", factory: "#8c8f93", office: "#7f93a8", civic: "#a89a86" };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  class MapView {
    constructor(canvas, hooks) {
      this.cv = canvas; this.ctx = canvas.getContext("2d"); this.h = hooks; this.scene = null; this.W = null;
      this.view = { s: 4, ox: 0, oy: 0 }; this.base = document.createElement("canvas"); this.baseKey = ""; this.overlays = []; this.hover = null; this.drag = null;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      new ResizeObserver(() => { this.resize(); }).observe(canvas.parentElement);
      canvas.addEventListener("pointerdown", (e) => this.down(e)); canvas.addEventListener("pointermove", (e) => this.move(e));
      canvas.addEventListener("pointerup", (e) => this.up(e)); canvas.addEventListener("pointerleave", () => { this.h.cursor && this.h.cursor(null); });
      canvas.addEventListener("dblclick", (e) => { const [px, py] = this.local(e), [wx, wy] = this.s2w(px, py); this.h.dblclick && this.h.dblclick(wx, wy); });
      canvas.addEventListener("wheel", (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
      window.addEventListener("keydown", (e) => { if ((e.key === "Delete" || e.key === "Backspace") && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && this.h.remove) { e.preventDefault(); this.h.remove(); } });
    }
    setScene(scene, W) { this.scene = scene; this.W = W; this.baseKey = ""; this.fit(); }
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect(); this.cw = Math.max(50, r.width); this.ch = Math.max(50, r.height);
      this.cv.width = Math.round(this.cw * this.dpr); this.cv.height = Math.round(this.ch * this.dpr); this.baseKey = ""; if (this.scene && !this.userMoved) this.fit(); else this.draw();
    }
    fit() {
      if (!this.scene) return; if (!this.cw) { const r = this.cv.parentElement.getBoundingClientRect(); this.cw = r.width || 600; this.ch = r.height || 600; }
      this.userMoved = false; const S = this.scene.size, m = 6, s = Math.min(this.cw, this.ch) / (S + 2 * m);
      this.view = { s, ox: (this.cw - S * s) / 2, oy: (this.ch + S * s) / 2 }; this._fitted = true; this.baseKey = ""; this.draw();
    }
    w2s(x, y) { return [this.view.ox + x * this.view.s, this.view.oy - y * this.view.s]; }
    s2w(px, py) { return [(px - this.view.ox) / this.view.s, (this.view.oy - py) / this.view.s]; }
    zoomAt(px, py, k) { this.userMoved = true; const [wx, wy] = this.s2w(px, py), s = ES.clamp(this.view.s * k, 1.2, 40); this.view.s = s; this.view.ox = px - wx * s; this.view.oy = py + wy * s; this.baseKey = ""; this.draw(); }
    zoom(k) { this.zoomAt(this.cw / 2, this.ch / 2, k); }
    /* ---------------- drawing ---------------- */
    ring(ctx, ring, close = true) { ring.forEach((p, i) => { const [x, y] = this.w2s(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (close) ctx.closePath(); }
    polyFill(ctx, ring, fill, holes) { ctx.beginPath(); this.ring(ctx, ring); (holes || []).forEach((h) => this.ring(ctx, h)); ctx.fillStyle = fill; ctx.fill("evenodd"); }
    drawBase() {
      const sc = this.scene, key = [sc.name, this.W.variant, this.view.s.toFixed(3), this.view.ox.toFixed(1), this.view.oy.toFixed(1), this.cw, this.ch, document.documentElement.dataset.theme || "", matchMedia("(prefers-color-scheme: dark)").matches, JSON.stringify(this.W.opts)].join("|");
      if (key === this.baseKey) return; this.baseKey = key;
      const b = this.base; b.width = this.cv.width; b.height = this.cv.height; const ctx = b.getContext("2d"); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const S = this.view.s, ground = css("--map-ground"), road = css("--map-road"), side = css("--map-side"), park = css("--map-park");
      ctx.fillStyle = ground; ctx.fillRect(0, 0, this.cw, this.ch);
      // region frame
      for (const bk of sc.blocks) this.polyFill(ctx, bk.ring, bk.ground === "paved" ? side : bk.ground === "gravel" ? "#b9a98a" : ground);
      for (const p of sc.parks) this.polyFill(ctx, p, park);
      for (const p of sc.plazas) this.polyFill(ctx, p, side);
      for (const p of sc.ponds) this.polyFill(ctx, p, "#6fa8d6");
      for (const p of sc.sidewalk_poly) this.polyFill(ctx, p.ring, side, p.holes);
      for (const p of sc.road_poly) this.polyFill(ctx, p.ring, road, p.holes);
      for (const p of sc.path_poly) this.polyFill(ctx, p.ring, side, p.holes);
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = Math.max(1, 0.14 * S); ctx.setLineDash([2.5 * S, 3.5 * S]);
      for (const c of sc.centrelines) if (c.dashed) { ctx.beginPath(); this.ring(ctx, c.line, false); ctx.stroke(); }
      ctx.setLineDash([]); ctx.fillStyle = "rgba(255,255,255,.8)";
      for (const z of sc.crosswalks) { const n = Math.floor(z.w / 0.9), px = -z.d[1], py = z.d[0]; for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * 0.9; const a = this.w2s(z.c[0] + px * off - z.d[0] * z.len / 2, z.c[1] + py * off - z.d[1] * z.len / 2), c = this.w2s(z.c[0] + px * off + z.d[0] * z.len / 2, z.c[1] + py * off + z.d[1] * z.len / 2); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = Math.max(1, 0.45 * S); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); } }
      for (const l of sc.lots) { ctx.beginPath(); this.ring(ctx, l.ring); ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]); }
      for (const o of sc.objects) {
        if (o.type === "pave") this.polyFill(ctx, o.ring, o.surface === "concrete" ? "#b9b6ac" : "#7d8387");
        else if (o.type === "walkway") { const a = this.w2s(...o.from), c = this.w2s(...o.to); ctx.strokeStyle = "#cfcbbd"; ctx.lineWidth = o.w * S; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
        else if (o.type === "pool") this.polyFill(ctx, o.ring, "#52b6e8");
      }
      // buildings (damage-aware)
      for (const bd of sc.buildings) {
        const dmg = this.W.damage[bd.id]; const col = BCOL[bd.kind] || "#b09a86";
        for (const ring of (bd.parts && bd.parts.length ? bd.parts : [bd.fp])) {
          ctx.beginPath(); this.ring(ctx, ring);
          ctx.fillStyle = dmg && dmg.state === "collapsed" ? "#7a5c44" : col; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.stroke();
          if (dmg && dmg.state === "partial") { ctx.save(); ctx.clip(); ctx.strokeStyle = "rgba(60,30,10,.55)"; ctx.lineWidth = 2; const [x, y] = this.w2s(ring[0][0], ring[0][1]); for (let k = -40; k < 40; k++) { ctx.beginPath(); ctx.moveTo(x + k * 7, y - 300); ctx.lineTo(x + k * 7 + 300, y); ctx.stroke(); } ctx.restore(); }
        }
      }
      for (const sp of this.W.variantData.spills || []) { ctx.beginPath(); this.ring(ctx, sp.ring); ctx.fillStyle = "rgba(122,92,68,.45)"; ctx.fill(); }
      for (const o of sc.objects) {
        if (o.type === "fence" && this.W.opts.fences) { ctx.strokeStyle = o.style === "privacy" ? "#6b4a2a" : o.style === "chain" ? "#6f777c" : "#f4f1e8"; ctx.lineWidth = Math.max(1, 0.28 * S); for (const ln of o.lines) { ctx.beginPath(); this.ring(ctx, ln, false); ctx.stroke(); } if (o.style === "picket") { ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 0.6; for (const ln of o.lines) { ctx.beginPath(); this.ring(ctx, ln, false); ctx.stroke(); } } }
        else if (o.type === "box") { ctx.beginPath(); this.ring(ctx, this.W.boxRing(o.xy[0], o.xy[1], o.size[0], o.size[1], o.yaw)); ctx.fillStyle = o.name === "container" ? "#c0504d" : o.name === "shed" ? "#b34a3c" : o.name === "bins" ? "#3d8f5e" : "#d8a31a"; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 0.8; ctx.stroke(); }
        else if (o.type === "cyl") { const [x, y] = this.w2s(...o.xy); ctx.beginPath(); ctx.arc(x, y, o.r * S, 0, 6.3); ctx.fillStyle = o.name === "chimney" ? "#d6d0c8" : "#aeb4b8"; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.stroke(); }
        else if (o.type === "post") { const [x, y] = this.w2s(...o.xy); ctx.fillStyle = "#33414a"; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
      }
      if (this.W.opts.vehicles) for (const v of this.W.vehicles) { ctx.beginPath(); this.ring(ctx, this.W.boxRing(v.xy[0], v.xy[1], v.dims[0], v.dims[1], ES.rad(v.yaw))); ctx.fillStyle = "#4d6f9a"; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 0.8; ctx.stroke(); }
      for (const l of sc.lamps) { const [x, y] = this.w2s(l[0], l[1]); ctx.fillStyle = "#e8c35a"; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, 0.25 * S), 0, 6.3); ctx.fill(); }
      if (this.W.opts.trees) for (const t of sc.trees) { const k = ES.TREE[t[2]] || ES.TREE.round, [x, y] = this.w2s(t[0], t[1]); ctx.beginPath(); ctx.arc(x, y, k.r * t[3] * S * 0.75, 0, 6.3); ctx.fillStyle = "rgba(38,110,52,.55)"; ctx.fill(); ctx.fillStyle = "#5b3a1e"; ctx.beginPath(); ctx.arc(x, y, Math.max(1, 0.3 * t[3] * S), 0, 6.3); ctx.fill(); }
      for (const f of this.W.variantData.fires || []) { const [x, y] = this.w2s(...f.xy); ctx.beginPath(); ctx.arc(x, y, f.r * S, 0, 6.3); ctx.fillStyle = "rgba(255,120,20,.45)"; ctx.fill(); ctx.strokeStyle = "#e0521b"; ctx.lineWidth = 1.5; ctx.stroke(); }
      // region boundary
      ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.setLineDash([6, 4]); ctx.lineWidth = 1; const a = this.w2s(0, 0), c = this.w2s(sc.size, sc.size); ctx.strokeRect(a[0], c[1], c[0] - a[0], a[1] - c[1]); ctx.setLineDash([]);
      // scale bar
      const L = [5, 10, 20, 50].find((v) => v * S > 60) || 50, bx = 12, by = this.ch - 14; ctx.fillStyle = css("--ink"); ctx.fillRect(bx, by, L * S, 3); ctx.font = "11px 'JetBrains Mono',monospace"; ctx.fillText(L + " m", bx, by - 4);
    }
    heatCanvas(h) {
      const N = h.N, cv = document.createElement("canvas"); cv.width = N; cv.height = N; const x = cv.getContext("2d"), im = x.createImageData(N, N), cm = ES.cmap[h.cmap || "viridis"];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const v = h.grid[j * N + i], o = ((N - 1 - j) * N + i) * 4;
        if (v === undefined || Number.isNaN(v) || v === Infinity || (h.hideBelow !== undefined && v < h.hideBelow)) { im.data[o + 3] = 0; continue; }
        const t = ES.clamp(Math.round(((v - h.vmin) / (h.vmax - h.vmin)) * 255), 0, 255);
        im.data[o] = cm[t * 3]; im.data[o + 1] = cm[t * 3 + 1]; im.data[o + 2] = cm[t * 3 + 2]; im.data[o + 3] = Math.round(255 * (h.alpha ?? 0.6));
      }
      x.putImageData(im, 0, 0); return cv;
    }
    draw() {
      if (!this.scene || !this.cw) return; this.drawBase();
      const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cv.width, this.cv.height); ctx.drawImage(this.base, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      for (const o of this.overlays) this.drawOverlay(ctx, o);
      this.drawEntities(ctx);
    }
    drawOverlay(ctx, o) {
      if (o.type === "heat") {
        if (!o._cv) o._cv = this.heatCanvas(o); const [x0, y0] = this.w2s(o.x0, o.y0 + o.N * o.res), w = o.N * o.res * this.view.s;
        ctx.imageSmoothingEnabled = !!o.smooth; ctx.drawImage(o._cv, x0, y0, w, w);
      } else if (o.type === "poly") { ctx.beginPath(); this.ring(ctx, o.pts); if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); } if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.width || 1.5; ctx.setLineDash(o.dash || []); ctx.stroke(); ctx.setLineDash([]); } }
      else if (o.type === "line") { ctx.beginPath(); this.ring(ctx, o.pts, false); ctx.strokeStyle = o.color; ctx.lineWidth = o.width || 2; ctx.setLineDash(o.dash || []); ctx.stroke(); ctx.setLineDash([]); }
      else if (o.type === "points") { for (const p of o.pts) { const [x, y] = this.w2s(p[0], p[1]); ctx.fillStyle = p[2] || o.color || "#000"; ctx.beginPath(); ctx.arc(x, y, p[3] || o.r || 1.6, 0, 6.3); ctx.fill(); } }
      else if (o.type === "marker") { const [x, y] = this.w2s(o.x, o.y); ctx.strokeStyle = o.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, o.r || 9, 0, 6.3); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke(); if (o.text) { ctx.font = "600 11px 'Source Sans 3',sans-serif"; ctx.fillStyle = o.color; ctx.fillText(o.text, x + 12, y + 4); } }
      else if (o.type === "text") { const [x, y] = this.w2s(o.x, o.y); ctx.font = (o.font || "600 11px 'Source Sans 3',sans-serif"); ctx.fillStyle = o.color || "#000"; ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 3; ctx.strokeText(o.text, x + (o.dx || 0), y + (o.dy || 0)); ctx.fillText(o.text, x + (o.dx || 0), y + (o.dy || 0)); }
    }
    entityStyle(e) { return e.kind === "sound" ? { color: "#b8860b", glyph: "♪" } : e.kind.startsWith("t:") ? { color: ES.TARGETS[e.kind.slice(2)].color, glyph: e.kind === "t:lying" ? "▬" : e.kind === "t:vehicle" ? "▣" : "●" } : { color: ES.DEVICES[e.kind].color, glyph: { uav: "✚", dog: "D", human: "H", rover: "R", cp: "▲" }[e.kind] }; }
    drawEntities(ctx) {
      for (const e of this.h.entities()) {
        const st = this.entityStyle(e), [x, y] = this.w2s(e.x, e.y), sel = e.id === this.h.selected();
        if (e.yaw !== undefined && e.kind !== "sound" && !e.kind.startsWith("t:")) {            // heading arrow + handle
          const L = 26, hx = x + Math.cos(e.yaw) * L, hy = y - Math.sin(e.yaw) * L; ctx.strokeStyle = st.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke();
          if (sel) { ctx.fillStyle = "#fff"; ctx.strokeStyle = st.color; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 6.3); ctx.fill(); ctx.stroke(); }
        }
        ctx.beginPath(); ctx.arc(x, y, e.kind === "uav" ? 9 : 8, 0, 6.3); ctx.fillStyle = st.color; ctx.fill(); ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeStyle = sel ? "#ffffff" : "rgba(0,0,0,.55)"; ctx.stroke();
        if (sel) { ctx.beginPath(); ctx.arc(x, y, 12.5, 0, 6.3); ctx.strokeStyle = st.color; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.fillStyle = "#fff"; ctx.font = "700 10px 'Source Sans 3',sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(st.glyph, x, y + 0.5); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        if (e.name) { ctx.font = "600 11px 'Source Sans 3',sans-serif"; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 3; ctx.strokeText(e.name, x + 11, y - 9); ctx.fillStyle = "#111"; ctx.fillText(e.name, x + 11, y - 9); }
      }
    }
    /* ---------------- interaction ---------------- */
    pick(px, py) {
      let best = null, bd = 15;
      for (const e of this.h.entities()) { const [x, y] = this.w2s(e.x, e.y), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = e; } }
      return best;
    }
    handleHit(px, py) {
      const e = this.h.entities().find((q) => q.id === this.h.selected()); if (!e || e.yaw === undefined || e.kind === "sound" || e.kind.startsWith("t:")) return null;
      const [x, y] = this.w2s(e.x, e.y), hx = x + Math.cos(e.yaw) * 26, hy = y - Math.sin(e.yaw) * 26; return Math.hypot(hx - px, hy - py) < 10 ? e : null;
    }
    local(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    down(e) {
      this.cv.setPointerCapture(e.pointerId); const [px, py] = this.local(e), tool = this.h.tool();
      const hh = this.handleHit(px, py); if (hh) { this.drag = { kind: "heading", e: hh }; return; }
      const hit = this.pick(px, py);
      if (hit && (!tool || tool === "select")) { this.h.select(hit.id); this.drag = { kind: "move", e: hit, moved: false }; return; }
      this.drag = { kind: tool && tool !== "select" ? "place" : "pan", px, py, ox: this.view.ox, oy: this.view.oy, moved: false };
    }
    move(e) {
      const [px, py] = this.local(e), [wx, wy] = this.s2w(px, py); this.h.cursor && this.h.cursor([wx, wy]);
      const d = this.drag; if (!d) return;
      if (d.kind === "heading") { d.e.yaw = Math.atan2(wy - d.e.y, wx - d.e.x); this.h.changed(d.e, "heading"); }
      else if (d.kind === "move") { d.moved = true; d.e.x = ES.clamp(wx, -15, this.scene.size + 15); d.e.y = ES.clamp(wy, -15, this.scene.size + 15); this.h.changed(d.e, "move"); }
      else if (d.kind === "pan") { if (Math.hypot(px - d.px, py - d.py) > 3) d.moved = true; if (d.moved) { this.userMoved = true; this.view.ox = d.ox + (px - d.px); this.view.oy = d.oy + (py - d.py); this.baseKey = ""; this.draw(); } }
    }
    up(e) {
      const d = this.drag; this.drag = null; if (!d) return; const [px, py] = this.local(e), [wx, wy] = this.s2w(px, py);
      if (d.kind === "place" && Math.hypot(px - d.px, py - d.py) < 5) this.h.place(wx, wy);
      else if (d.kind === "pan" && !d.moved) this.h.select(null);
      else if (d.kind === "move" || d.kind === "heading") this.h.changed(d.e, "done");
    }
  }
  ES.MapView = MapView;
})();
