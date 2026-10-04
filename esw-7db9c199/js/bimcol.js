/* Collision against the building model (oriented boxes): the same geometry that is rendered, so what you see is what stops you.
   Bodies are vertical capsules: radius r, feet at zf, head at zf + height; they step up onto surfaces <= stepUp (stairs, kerbs, thresholds).
   Walkable surfaces: boxes flagged WALK (floor slabs, steps, ramps, stoops). Solid: boxes flagged PHYS or NAV (walls, glass, furniture, door leaves, rails ...).
   Door leaves are dynamic (they swing with their open fraction). */
(function () {
  const ES = (window.ES = window.ES || {});
  const FL = { PHYS: 1, VIS: 2, NAV: 4, GLASS: 8, MOVABLE: 16, WALK: 32, DETAIL: 64 };
  const CELL = 2.0;

  class Col {
    constructor() { this.b = []; this.grid = new Map(); this.doors = {}; this.foot = []; this.byBuilding = {}; }
    /* add one building (BIM json) */
    addBuilding(B, bi, maxStorey = 99) {
      const info = { id: B.id, bi, poly: B.meta.footprint, z0: B.meta.z0, zTop: B.meta.z_top, roofRise: B.meta.roof_rise || 0, storeys: B.storeys, rooms: B.rooms, doors: {}, lo: B.bounds[0], hi: B.bounds[1] };
      this.foot.push(info); this.byBuilding[B.id] = info;
      B.boxes.forEach((r, i) => {
        const fl = r[15]; if (!(fl & (FL.PHYS | FL.NAV | FL.WALK)) || r[16] >= maxStorey) return;
        const mov = B.mov[i], box = this._prep(r, info);
        if (mov) { box.mv = mov; box.tag = B.tags[i]; const d = (info.doors[box.tag] = info.doors[box.tag] || { open: mov.open || 0, mov, boxes: [], kind: mov.kind, bid: B.id, tag: box.tag }); d.boxes.push(box); box.door = d; this.doors[B.id + "/" + box.tag] = d; (this.dyn = this.dyn || []).push(box); return; }
        this._index(box);
      });
      for (const d of Object.values(info.doors)) this.setDoor(d, d.open);
    }
    _prep(r, info) {
      const [cx, cy, cz, sx, sy, sz, yaw, roll] = r, c = Math.cos(yaw), s = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll), hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const ext = (Math.abs(sr) * hy + Math.abs(cr) * hz);                  // vertical half extent of the rolled box
      const box = { cx, cy, cz, hx, hy, hz, c, s, roll, cr, sr, flags: r[15], elem: r[14], storey: r[16], info, zmin: cz - ext, zmax: cz + ext, rad: Math.hypot(hx, hy) };
      box.base = { cx, cy, yaw, c, s }; return box;
    }
    _index(box) {
      const x0 = Math.floor((box.cx - box.rad) / CELL), x1 = Math.floor((box.cx + box.rad) / CELL), y0 = Math.floor((box.cy - box.rad) / CELL), y1 = Math.floor((box.cy + box.rad) / CELL);
      const id = this.b.length; this.b.push(box);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = i * 100003 + j; const a = this.grid.get(k); if (a) a.push(id); else this.grid.set(k, [id]); }
    }
    /* door leaves are kept apart (this.dyn) and transformed by the door's open fraction */
    setDoor(d, open) {
      d.open = open;
      for (const b of d.boxes) {
        const m = b.mv, B0 = b.base;
        if (m.kind === "swing") {
          const a = m.angle * open, ca = Math.cos(a), sa = Math.sin(a), dx = B0.cx - m.pivot[0], dy = B0.cy - m.pivot[1];
          b.cx = m.pivot[0] + ca * dx - sa * dy; b.cy = m.pivot[1] + sa * dx + ca * dy; const yaw = Math.atan2(B0.s, B0.c) + a; b.c = Math.cos(yaw); b.s = Math.sin(yaw);
        } else if (m.kind === "slide_up") { b.cx = B0.cx; b.cy = B0.cy; b.c = B0.c; b.s = B0.s; const lift = m.lift * open; b.zmin = (b.cz - b.hz) + lift; b.zmax = (b.cz + b.hz) + lift; b.lift = lift; }
      }
    }
    _near(x, y, r) {
      const out = new Set(), x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const a = this.grid.get(i * 100003 + j); if (a) for (const id of a) out.add(id); }
      return out;
    }
    /* building whose footprint contains (x, y) (+ margin) */
    buildingAt(x, y, margin = 0) {
      for (const f of this.foot) {
        if (x < f.lo[0] - margin || x > f.hi[0] + margin || y < f.lo[1] - margin || y > f.hi[1] + margin) continue;
        if (pip(f.poly, x, y) || (margin > 0 && distPoly(f.poly, x, y) < margin)) return f;
      }
      return null;
    }
    /* highest walkable surface at (x, y) not above zRef + stepUp; null when none */
    floorAt(x, y, zRef, stepUp) {
      let best = null;
      const test = (b) => {
        if (!(b.flags & FL.WALK)) return;
        const dx = x - b.cx, dy = y - b.cy, lx = b.c * dx + b.s * dy, ly = -b.s * dx + b.c * dy;
        if (Math.abs(lx) > b.hx || Math.abs(ly) > b.hy) return;
        const top = b.cz + ly * b.sr + b.hz * b.cr;
        if (top <= zRef + stepUp && (best === null || top > best)) best = top;
      };
      for (const id of this._near(x, y, 0.05)) test(this.b[id]);
      return best;
    }
    /* push the capsule (x, y, r, feet zf, height h) out of every solid it overlaps; returns {x, y, hit, doorHit} */
    resolve(x, y, r, zf, h, stepUp, opts = {}) {
      let hit = false, doorHit = null; const zlo = zf + stepUp, zhi = zf + h;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        const test = (b) => {
          if (!(b.flags & (FL.PHYS | FL.NAV)) && !(b.flags & FL.WALK)) return;
          if (b.zmax <= zlo || b.zmin >= zhi) return;
          const dx = x - b.cx, dy = y - b.cy; if (dx * dx + dy * dy > (b.rad + r) * (b.rad + r)) return;
          let lx = b.c * dx + b.s * dy, ly = -b.s * dx + b.c * dy;
          const px = Math.max(-b.hx, Math.min(b.hx, lx)), py = Math.max(-b.hy, Math.min(b.hy, ly));
          let ex = lx - px, ey = ly - py, d2 = ex * ex + ey * ey;
          if (d2 >= r * r) return;
          let nx, ny, pen;
          if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = ex / d; ny = ey / d; pen = r - d; }
          else {                                                   // centre inside the rectangle: leave by the nearest face
            const ox = b.hx - Math.abs(lx), oy = b.hy - Math.abs(ly);
            if (ox < oy) { nx = Math.sign(lx) || 1; ny = 0; pen = ox + r; } else { nx = 0; ny = Math.sign(ly) || 1; pen = oy + r; }
          }
          x += (b.c * nx - b.s * ny) * pen; y += (b.s * nx + b.c * ny) * pen; moved = true; hit = true; if (b.door) doorHit = b.door;
        };
        for (const id of this._near(x, y, r + 0.2)) test(this.b[id]);
        if (this.dyn) for (const b of this.dyn) test(b);
        if (!moved) break;
      }
      return { x, y, hit, doorHit };
    }
    /* does the capsule (x, y, r, z range) overlap any solid? (no push-out; used for flying bodies and for "may I stand here") */
    collides(x, y, r, zlo, zhi) {
      const test = (b) => {
        if (!(b.flags & (FL.PHYS | FL.NAV | FL.WALK)) || b.zmax <= zlo || b.zmin >= zhi) return false;
        const dx = x - b.cx, dy = y - b.cy; if (dx * dx + dy * dy > (b.rad + r) * (b.rad + r)) return false;
        const lx = b.c * dx + b.s * dy, ly = -b.s * dx + b.c * dy, ex = lx - Math.max(-b.hx, Math.min(b.hx, lx)), ey = ly - Math.max(-b.hy, Math.min(b.hy, ly));
        return ex * ex + ey * ey < r * r;
      };
      for (const id of this._near(x, y, r + 0.2)) if (test(this.b[id])) return true;
      if (this.dyn) for (const b of this.dyn) if (test(b)) return true;
      return false;
    }
    /* nearest door within `reach` m of a point (xy), any storey: {door, key, dist} */
    nearestDoor(x, y, z, reach = 1.8) {
      let best = null;
      for (const [key, d] of Object.entries(this.doors)) {
        const b = d.boxes[0]; const px = d.mov.kind === "swing" ? d.mov.pivot[0] : b.base.cx, py = d.mov.kind === "swing" ? d.mov.pivot[1] : b.base.cy;
        const dist = Math.hypot(px - x, py - y) - (d.mov.kind === "swing" ? 0.3 : 0); if (Math.abs(b.cz - z) > 2.2 || dist > reach) continue; if (!best || dist < best.dist) best = { door: d, key, dist };
      }
      return best;
    }
    /* room (record) containing (x, y) at feet height z */
    roomAt(x, y, z) {
      const f = this.buildingAt(x, y, 0); if (!f) return null;
      for (const r of f.rooms) { if (z < r.z0 - 0.5 || z > r.z1 + 0.5) continue; if (r.fn === "void") continue; if (pip(r.poly, x, y)) return { room: r, b: f }; }
      return { room: null, b: f };
    }
  }
  function pip(poly, x, y) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function distPoly(poly, x, y) { let m = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); m = Math.min(m, Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y)); } return m; }
  ES.BimCol = Col; ES.pip = pip;
})();
