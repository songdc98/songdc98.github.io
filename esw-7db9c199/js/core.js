/* ES-World lab: namespace, small math helpers, colour maps, data loading. Plain script (no modules) so it can be inlined for single-file hosting. */
(function () {
  const ES = (window.ES = window.ES || {});
  ES.VERSION = "0.1";
  ES.DATA_DIR = "sim";                                   // the hosted copy renames it ("data/" is blocked by a global gitignore rule)
  ES.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  ES.lerp = (a, b, t) => a + (b - a) * t;
  ES.deg = (r) => (r * 180) / Math.PI;
  ES.rad = (d) => (d * Math.PI) / 180;
  ES.wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  ES.dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  ES.fmt = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : "—");

  /* sequential colour maps (viridis-like, colour-blind safe) as 256-entry RGB tables */
  function table(stops) {
    const out = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
    }
    return out;
  }
  ES.cmap = {
    viridis: table([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]),
    magma: table([[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]]),
    cool: table([[240, 249, 232], [186, 228, 188], [123, 204, 196], [67, 162, 202], [8, 104, 172]]),
    yellow: table([[255, 214, 10], [255, 214, 10]]),
    rdylgn: table([[165, 0, 38], [244, 109, 67], [254, 224, 139], [166, 217, 106], [26, 152, 80]]),
  };

  ES.loadJSON = async (url) => {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  };

  /* tiny pub/sub */
  ES.bus = (() => { const h = {}; return { on: (e, f) => ((h[e] = h[e] || []).push(f)), emit: (e, ...a) => (h[e] || []).forEach((f) => f(...a)) }; })();
})();
