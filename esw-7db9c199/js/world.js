/* World: rasterises the exported scene JSON into height maps used by every browser-side physics model.
   Grid: res 0.5 m over [-20, S+20] m (ENU, x east, y north). Layers:
     hB   opaque solids (buildings, sheds, containers, tanks, parked vehicles, privacy fences, tree trunks up to the crown)   [m]
     hT   see-through obstacles (picket / chain-link fences, posts, lamp poles)                                              [m]
     cLo/cHi/cDen  tree canopy (z range and density)
     rub  rubble height (quake variant)      navBlk  other non-walkable cells (pools)     bid  building index + 1 */
(function () {
  const ES = window.ES;
  const TREE = { round: { h: 9.0, r: 3.4, lo: 2.6, den: 0.7 }, tall: { h: 12.0, r: 2.6, lo: 3.5, den: 0.7 }, conifer: { h: 11.0, r: 2.4, lo: 0.8, den: 0.85 } };
  ES.TREE = TREE;

  class World {
    constructor(scene, variant = "day", opts = {}) {
      this.scene = scene; this.variant = variant; this.S = scene.size; this.M = 20; this.res = 0.5;
      this.x0 = this.y0 = -this.M; this.N = Math.ceil((this.S + 2 * this.M) / this.res);
      this.opts = Object.assign({ fences: true, trees: true, vehicles: true, objects: true, parks: true }, opts);
      const n = this.N * this.N;
      this.hB = new Float32Array(n); this.hT = new Float32Array(n);
      this.cLo = new Float32Array(n); this.cHi = new Float32Array(n); this.cDen = new Float32Array(n);
      this.rub = new Float32Array(n); this.navBlk = new Uint8Array(n); this.bid = new Int16Array(n); this.gz = new Float32Array(n); this.park = new Float32Array(n);   // gz: height of the walkable surface (road 0.012, lawn 0.14, park 0.15, sidewalk 0.16, path 0.164); park: vegetation zone density (RF foliage, as in the Python engine)
      this.variantData = scene.variants[variant] || scene.variants.day;
      this.vehicles = this.variantData.vehicles; this.damage = this.variantData.damage || {};
      this._build();
    }
    /* ---- indexing ---- */
    ij(x, y) { const i = Math.floor((x - this.x0) / this.res), j = Math.floor((y - this.y0) / this.res); return i < 0 || j < 0 || i >= this.N || j >= this.N ? -1 : j * this.N + i; }
    xy(id) { const j = Math.floor(id / this.N), i = id - j * this.N; return [this.x0 + (i + 0.5) * this.res, this.y0 + (j + 0.5) * this.res]; }
    inside(x, y) { return x >= this.x0 && y >= this.y0 && x <= this.x0 + this.N * this.res && y <= this.y0 + this.N * this.res; }
    /* ---- fill primitives (callbacks receive the flat cell id) ---- */
    fillPoly(ring, cb) {
      let ymin = 1e9, ymax = -1e9;
      for (const p of ring) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
      const j0 = Math.max(0, Math.ceil((ymin - this.y0) / this.res - 0.5)), j1 = Math.min(this.N - 1, Math.floor((ymax - this.y0) / this.res - 0.5));
      const xs = [];
      for (let j = j0; j <= j1; j++) {
        const yc = this.y0 + (j + 0.5) * this.res; xs.length = 0;
        for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
          const a = ring[k], b = ring[m];
          if ((a[1] > yc) !== (b[1] > yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / this.res - 0.5)), i1 = Math.min(this.N - 1, Math.floor((xs[k + 1] - this.x0) / this.res - 0.5));
          for (let i = i0; i <= i1; i++) cb(j * this.N + i);
        }
      }
    }
    fillCircle(cx, cy, r, cb) {
      r = Math.max(r, 0.36);                                    // conservative: a 0.5 m cell centre is at most 0.354 m from any point of its cell
      const i0 = Math.max(0, Math.floor((cx - r - this.x0) / this.res)), i1 = Math.min(this.N - 1, Math.floor((cx + r - this.x0) / this.res));
      const j0 = Math.max(0, Math.floor((cy - r - this.y0) / this.res)), j1 = Math.min(this.N - 1, Math.floor((cy + r - this.y0) / this.res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.res - cx, y = this.y0 + (j + 0.5) * this.res - cy;
        if (x * x + y * y <= r * r) cb(j * this.N + i);
      }
    }
    fillSeg(a, b, r, cb) {
      r = Math.max(r, 0.36);
      const minx = Math.min(a[0], b[0]) - r, maxx = Math.max(a[0], b[0]) + r, miny = Math.min(a[1], b[1]) - r, maxy = Math.max(a[1], b[1]) + r;
      const i0 = Math.max(0, Math.floor((minx - this.x0) / this.res)), i1 = Math.min(this.N - 1, Math.floor((maxx - this.x0) / this.res));
      const j0 = Math.max(0, Math.floor((miny - this.y0) / this.res)), j1 = Math.min(this.N - 1, Math.floor((maxy - this.y0) / this.res));
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.res, y = this.y0 + (j + 0.5) * this.res;
        const t = ES.clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1), ex = a[0] + t * dx - x, ey = a[1] + t * dy - y;
        if (ex * ex + ey * ey <= r * r) cb(j * this.N + i);
      }
    }
    boxRing(cx, cy, sx, sy, yaw) {
      const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hy = sy / 2;
      return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]);
    }
    /* ---- build ---- */
    _build() {
      const sc = this.scene, mx = (a, id, v) => { if (v > a[id]) a[id] = v; };
      const hB = this.hB, hT = this.hT;
      sc.buildings.forEach((b, bi) => {
        const dmg = this.damage[b.id]; let h = b.h;
        if (dmg && dmg.state === "collapsed") h = Math.min(2.2, 0.18 * b.h);
        else if (dmg && dmg.state === "partial") h = 0.7 * b.h;
        const rings = b.parts && b.parts.length ? b.parts : [b.fp];
        for (const ring of rings) this.fillPoly(ring, (id) => { mx(hB, id, h); this.bid[id] = bi + 1; });
        if (dmg && dmg.state === "collapsed") for (const ring of rings) this.fillPoly(ring, (id) => { mx(this.rub, id, 1.2); });
      });
      for (const sp of this.variantData.spills || []) this.fillPoly(sp.ring, (id) => { if (hB[id] < 0.05) mx(this.rub, id, 0.35); });
      if (this.opts.objects) for (const o of sc.objects) {
        if (o.type === "fence") {
          if (!this.opts.fences) continue;
          const opaque = o.style === "privacy";
          for (const ln of o.lines) for (let k = 0; k + 1 < ln.length; k++) this.fillSeg(ln[k], ln[k + 1], 0.2, (id) => mx(opaque ? hB : hT, id, o.h));
        } else if (o.type === "box") this.fillPoly(this.boxRing(o.xy[0], o.xy[1], o.size[0], o.size[1], o.yaw), (id) => mx(hB, id, o.size[2]));
        else if (o.type === "cyl") this.fillCircle(o.xy[0], o.xy[1], o.r, (id) => mx(hB, id, o.h));
        else if (o.type === "post") this.fillCircle(o.xy[0], o.xy[1], 0.2, (id) => mx(hT, id, o.h));
        else if (o.type === "pool") this.fillPoly(o.ring, (id) => { this.navBlk[id] = 1; });
      }
      const setz = (ring, z) => this.fillPoly(ring, (id) => { this.gz[id] = z; });
      for (const b of sc.blocks) setz(b.ring, 0.14);
      for (const pk of sc.parks) setz(pk, 0.15);
      for (const p of sc.plazas) setz(p, 0.15);
      for (const p of sc.road_poly) setz(p.ring, 0.012);
      for (const p of sc.sidewalk_poly) setz(p.ring, 0.16);
      for (const p of sc.path_poly) setz(p.ring, 0.164);
      if (this.opts.parks) for (const pk of sc.parks) this.fillPoly(pk, (id) => { this.park[id] = 0.5; });
      for (const l of sc.lamps) this.fillCircle(l[0], l[1], 0.2, (id) => mx(hT, id, 7.0));
      if (this.opts.vehicles) for (const v of this.vehicles) this.fillPoly(this.boxRing(v.xy[0], v.xy[1], v.dims[0], v.dims[1], ES.rad(v.yaw)), (id) => mx(hB, id, v.dims[2]));
      if (this.opts.trees) for (const t of sc.trees) {
        const k = TREE[t[2]] || TREE.round, s = t[3];
        this.fillCircle(t[0], t[1], 0.3 * s + 0.15, (id) => mx(hB, id, k.lo * s));
        this.fillCircle(t[0], t[1], k.r * s, (id) => {
          this.cLo[id] = this.cHi[id] === 0 ? k.lo * s : Math.min(this.cLo[id], k.lo * s);
          this.cHi[id] = Math.max(this.cHi[id], k.h * s); this.cDen[id] = Math.max(this.cDen[id], k.den);
        });
      }
    }
    /* clamp a requested position into the grid; true when over a building / solid object cell at the given height */
    groundZ(x, y) { const id = this.ij(x, y); return id >= 0 ? this.gz[id] : 0; }
    solidAt(x, y, z = 0.5) { const id = this.ij(x, y); return id >= 0 && this.hB[id] > z; }
    buildingAt(x, y) { const id = this.ij(x, y); return id >= 0 && this.bid[id] ? this.scene.buildings[this.bid[id] - 1] : null; }
  }
  ES.World = World;
})();
