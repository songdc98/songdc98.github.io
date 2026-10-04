/* camfeed.js: off-screen sensor cameras that share the main WebGLRenderer (sensor-UI agent).
   ES.camfeed.create({id, w, h, hfov, modality:'rgb'|'depth'|'sem', fps, hideObject, near, far, cam:{fNumber,tMin,tMax,isoMin,isoMax}}) -> feed
   feed.setPose({x, y, z, yaw, pitch, roll})   lab ENU (z up, yaw CCW from +x, pitch up +)
   feed.update(nowMs)                           polls the async read-back and renders when due (global budget, see ES.camfeed.pump)
   feed.canvas  (2D canvas to put in the DOM)   feed.stats   feed.dispose()
   Design notes (details in docs/sensor-ui.md):
   * rgb: scene -> half-float target (display-referred: r128 bakes ACES + sRGB into every material program, so the render target keeps the SAME encoding as the main view, no recompile)
     -> "linearise" pass (inverse ACES + inverse sRGB = linear sensor signal S = radiance x exposure) -> mip chain -> ISP pass (lens softness, vignette, bloom/glare, sun glare,
     shot + read noise from the ISO the auto-exposure picked, ACES tone curve, sRGB) -> RGBA8 -> async PBO read-back (alpha carries log2 luminance for metering).
   * auto-exposure: metering of the log-average sensor signal on the previous frame (real cameras meter the frame they just took), exposure moves with a 0.2 s (darker) / 0.4 s (brighter)
     time constant, limited by f-number / shutter / ISO ranges; E = 144 t ISO / N^2 and EV100 = 13.83 - log2(E) (reflected-light meter, K = 12.5, 1 scene unit = 10^4 cd/m2).
   * depth / sem: the scene is drawn once with per-mesh material variants (flat class colour / packed linear depth, alpha-tested foliage and fences keep their cut-outs; window glass
     is see-through for depth at normal incidence and opaque at grazing angles, the way the Blender dataset's Z pass treats the Fresnel-mixed pane, and a flat 'building' class for sem). */
(function () {
  const ES = (window.ES = window.ES || {});
  const CF = (ES.camfeed = ES.camfeed || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), now0 = () => performance.now();

  /* ------------------------------------------------------------------ palette: scripts/esworld/classes.py (SEM, SEM_COLOR) ------------------------------------------------------------------ */
  const SEM_NAMES = ["sky", "road", "sidewalk", "building", "vegetation", "vehicle", "person", "uav", "ugv", "debris", "fire_smoke", "water", "furniture", "ground", "victim", "command_post"];
  const SEM_ZH = ["天空", "道路", "人行道", "建筑", "植被", "车辆", "人", "无人机", "机器人", "碎石", "烟火", "水", "家具", "地面", "受害者", "指挥站"];
  const SEM_RGB = [[200, 220, 240], [70, 70, 80], [160, 160, 150], [214, 156, 60], [60, 160, 70], [0, 114, 178], [213, 94, 0], [204, 121, 167], [240, 228, 66], [120, 80, 50], [230, 30, 30], [86, 180, 233], [110, 110, 130], [190, 175, 140], [255, 0, 120], [0, 0, 0]];
  const SEM_ID = {}; SEM_NAMES.forEach((n, i) => (SEM_ID[n] = i));
  CF.SEM = { names: SEM_NAMES, zh: SEM_ZH, rgb: SEM_RGB, id: SEM_ID };

  /* ------------------------------------------------------------------ photometry / camera constants ------------------------------------------------------------------ */
  const CAL = CF.CAL = {
    lumPerUnit: 1.0e4,      // legacy pipeline (ACES in the material programs): cd/m2 per scene radiance unit; diffuse white under the 2.8-unit sun ~ 25 000 cd/m2, a sunny street ~ EV100 15 (sunny-16 rule).
                            // HDR pipeline (env.js, linear radiance): ES.env.cdm2PerUnit (1 unit of radiance = luxPerUnit cd/m2) is used instead.
    K: 12.5,                // reflected-light meter constant (ISO 12232), EV100 = log2(L * 100 / K)
    sTarget: 0.26,          // metered (log-average, centre-weighted) sensor signal the auto-exposure aims at: ~ +0.5 EV over 18 % grey, like a phone ISP's pleasing exposure
    sClip: 4.0,             // sensor signal above which the ACES curve outputs >= 250/255 (blown highlights)
    sBlack: 0.004,          // below this the toe of the curve is at code ~1 (crushed shadows)
    fw100: 7000,            // full-well electrons at ISO 100 (1/2.3" class sensor)
    readE: 2.6,             // read noise [e-] (input referred at the base ISO, ~ constant afterwards)
    sFull: 3.0,             // sensor signal that corresponds to full well (shot-noise scaling)
    denoise: 0.62,          // fraction of the raw noise the ISP's spatial denoiser leaves
  };
  /* scene unit -> cd/m2, and the exposure constant C of E = C t ISO / N^2 (so that E = sTarget / L_u when the camera exposes a mean scene luminance L_u to the target: t ISO / N^2 = K / L_cd) */
  const lpu = () => { const R = G && G.R; return R && R.toneMapping === 0 && ES.env && ES.env.cdm2PerUnit > 0 ? ES.env.cdm2PerUnit : CAL.lumPerUnit; };
  const expC = () => (CAL.sTarget * lpu()) / CAL.K;
  CF.lpu = lpu;
  /* exposure triangle limits per device class (agents_cfg has no lens data: small-sensor robot / drone cameras) */
  const CAMLIM = { default: { fNumber: 2.2, tMin: 1 / 12000, tPref: 1 / 100, tMax: 1 / 30, isoMin: 100, isoMax: 6400 }, uav: { fNumber: 2.8, tMin: 1 / 16000, tPref: 1 / 100, tMax: 1 / 30, isoMin: 100, isoMax: 12800 } };
  const exposureOf = (lim, t, iso) => (expC() * t * iso) / (lim.fNumber * lim.fNumber);
  /* given a wanted exposure E, split it into shutter and ISO: shutter up to tPref (motion blur of a moving platform), then ISO up to isoMax, then the shutter up to tMax; reports the exposure actually available */
  function triangle(lim, Ew) {
    const k = (lim.fNumber * lim.fNumber) / expC(), tp = lim.tPref || lim.tMax;       // t * ISO = E * k
    let iso = lim.isoMin, t = (Ew * k) / iso;
    if (t < lim.tMin) { t = lim.tMin; }
    else if (t > tp) { t = tp; iso = clamp((Ew * k) / t, lim.isoMin, lim.isoMax); if ((Ew * k) / iso > t) t = Math.min(lim.tMax, (Ew * k) / iso); }
    return { t, iso, E: exposureOf(lim, t, iso), Emin: exposureOf(lim, lim.tMin, lim.isoMin), Emax: exposureOf(lim, lim.tMax, lim.isoMax) };
  }
  CF.triangle = triangle; CF.CAMLIM = CAMLIM;

  const vw = () => ES.view3d && ES.view3d.walk && ES.view3d.walk.V;
  const walkState = () => ES.view3d && ES.view3d.walk && ES.view3d.walk.state;

  /* ------------------------------------------------------------------ shaders ------------------------------------------------------------------ */
  const GLSL_COMMON = `
    vec3 srgb2lin(vec3 c){ return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045)))); }
    vec3 lin2srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    vec3 rrtFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 invRrt(vec3 o){ o = clamp(o, 0.0, 0.9997); vec3 A = 0.983729 * o - 1.0; vec3 B = 0.4329510 * o - 0.0245786; vec3 C = 0.238081 * o + 0.000090537;
      vec3 D = max(B * B - 4.0 * A * C, 0.0); return max((-B - sqrt(D)) / (2.0 * A), 0.0); }
    const mat3 ACES_IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 ACES_OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    vec3 acesFwd(vec3 s){ vec3 x = ACES_IN * (s / 0.6); x = rrtFit(x); x = ACES_OUT * x; return clamp(x, 0.0, 1.0); }
    float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  `;
  const VS_QUAD = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  /* pass 2: display-referred scene render -> linear sensor signal S = L * E (ss x ss box average done in linear light) */
  const FS_LIN = GLSL_COMMON + `
    uniform sampler2D tScene; uniform vec2 uTexel; uniform float uSS; uniform float uTone; uniform float uEnc; uniform float uE; uniform mat3 uInvIn; uniform mat3 uInvOut;
    varying vec2 vUv;
    vec3 decode(vec3 v){
      vec3 d = uEnc > 0.5 ? srgb2lin(v) : v;
      if (uTone > 3.5) { vec3 x = uInvIn * invRrt(uInvOut * d); return max(x, 0.0) * 0.6; }   // legacy: ACES baked into the scene programs, S = L * E_render
      return max(d, 0.0) * uE;                                                                  // HDR pipeline (env.js): linear radiance in, exposure applied here
    }
    void main(){
      vec3 acc = vec3(0.0); float n = 0.0;
      for (int j = 0; j < 4; j++) { for (int i = 0; i < 4; i++) {
        if (float(i) >= uSS || float(j) >= uSS) continue;
        vec2 o = (vec2(float(i), float(j)) + 0.5 - 0.5 * uSS) * uTexel;
        acc += decode(texture2D(tScene, vUv + o).rgb); n += 1.0; } }
      gl_FragColor = vec4(acc / max(n, 1.0), 1.0);
    }`;
  /* pass 3: ISP. input S (linear), output sRGB RGB; alpha = log2 luminance of the clean (noise free) signal for the CPU-side metering */
  const FS_ISP = GLSL_COMMON + `
    uniform sampler2D tLin; uniform vec2 uRes; uniform float uSeed; uniform float uShot; uniform float uRead; uniform float uVig; uniform float uSoft; uniform float uBloom; uniform float uKnee;
    uniform vec2 uSunUv; uniform float uSunAmp; uniform float uCA; uniform float uMaxLod; uniform vec2 uAspect; uniform float uGlow;
    varying vec2 vUv;
    vec3 tap(vec2 uv){ return texture2D(tLin, uv).rgb; }
    vec3 tapCA(vec2 uv){ vec2 d = (uv - 0.5) * uCA; return vec3(texture2D(tLin, uv + d).r, texture2D(tLin, uv).g, texture2D(tLin, uv - d).b); }
    vec3 gauss3(vec2 fc, float seed){
      vec2 q = fc + seed * vec2(17.13, 31.71);
      float u1 = max(hash12(q), 1e-4), u2 = hash12(q + 7.7), u3 = max(hash12(q + 13.1), 1e-4), u4 = hash12(q + 21.9), u5 = max(hash12(q + 3.3), 1e-4), u6 = hash12(q + 9.1);
      return vec3(sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2), sqrt(-2.0 * log(u3)) * cos(6.2831853 * u4), sqrt(-2.0 * log(u5)) * cos(6.2831853 * u6));
    }
    void main(){
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);                      // row 0 of the read-back = top of the picture
      vec2 px = 1.0 / uRes;
      vec3 S = tapCA(uv) * 0.38 + (tap(uv + vec2(px.x, 0.0) * uSoft) + tap(uv - vec2(px.x, 0.0) * uSoft) + tap(uv + vec2(0.0, px.y) * uSoft) + tap(uv - vec2(0.0, px.y) * uSoft)) * 0.155;
      // bloom: blurred excess over the knee (light spilling from blown-out windows, bright sky, lamps)
      vec3 b = vec3(0.0);
      for (int k = 0; k < 4; k++) { float lod = min(float(k) + 2.0, uMaxLod); vec3 v = textureLod(tLin, uv, lod).rgb; b += max(v - uKnee, 0.0) * (0.55 - 0.1 * float(k)); }
      S += uBloom * b;
      // vignette (cos^4 + mechanical)
      vec2 q = (uv - 0.5) * 2.0; float r2 = dot(q, q);
      S *= clamp(1.0 - uVig * r2 - 0.5 * uVig * r2 * r2, 0.0, 1.0);
      // sun glare: core + halo + veiling light around the (projected) sun, plus three ghosts along the axis through the image centre
      if (uSunAmp > 0.0) {
        vec2 d = (uv - uSunUv) * uAspect; float r = length(d);
        float g = exp(-pow(r / 0.014, 2.0)) * 14.0 + 1.3 * exp(-r / 0.075) + 0.11 / (1.0 + pow(r / 0.35, 2.0));
        vec2 cen = vec2(0.5); vec2 ax = (cen - uSunUv);
        float gh = 0.0; for (int i = 0; i < 3; i++) { float kk = float(i) * 0.55 + 0.35; vec2 gp = uSunUv + ax * kk * 1.6; float rr = length((uv - gp) * uAspect); float rad = 0.035 + 0.02 * float(i); gh += smoothstep(rad, rad * 0.55, rr) * (0.11 - 0.025 * float(i)) * (1.0 - 0.5 * smoothstep(0.2, 0.6, length(gp - cen))); }
        S += uSunAmp * (g + gh) * vec3(1.0, 0.96, 0.88) * uGlow;
      }
      float lm = luma(S);
      float code = clamp((log2(max(lm, 1e-6)) + 14.0) / 22.0, 0.0, 1.0);
      // sensor noise: variance = shot (a S) + read (b), per channel, partly luminance-correlated; the sensor clips at full well
      vec3 n = gauss3(gl_FragCoord.xy, uSeed); float nl = dot(n, vec3(0.3333)); n = 0.55 * vec3(nl * 1.7) + 0.85 * n;
      vec3 sg = sqrt(max(uShot * S + uRead, 0.0));
      vec3 Sn = max(S + sg * n, 0.0);
      vec3 rgb = lin2srgb(acesFwd(Sn));
      gl_FragColor = vec4(rgb, code);
    }`;
  /* depth / semantic pass: one program for both (uMode 0 = flat class colour, 1 = packed linear depth); alpha-cut foliage / fences through the original map's alpha, glass through Fresnel */
  const VS_DS = `varying vec2 vUv; varying float vDepth; varying vec3 vN; varying vec3 vV; uniform mat3 uvTransform;
    #include <skinning_pars_vertex>
    void main(){
      #include <skinbase_vertex>
      vec3 objectNormal = vec3( normal ); vec3 transformed = vec3( position );
      #include <skinnormal_vertex>
      #include <skinning_vertex>
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0); vDepth = -mv.z; vN = normalize(normalMatrix * objectNormal); vV = normalize(-mv.xyz);
      #ifdef USE_MAP
      vUv = (uvTransform * vec3(uv, 1.0)).xy;
      #else
      vUv = uv;
      #endif
      gl_Position = projectionMatrix * mv; }`;
  const FS_DS = `varying vec2 vUv; varying float vDepth; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uFar; uniform float uMode; uniform sampler2D map; uniform float uAlphaTest; uniform float uGlassT;
    vec4 packDepth(float u){ u = clamp(u, 0.0, 0.99999); vec3 enc = fract(u * vec3(1.0, 255.0, 65025.0)); enc -= enc.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0); return vec4(enc, 1.0); }
    void main(){
      #ifdef USE_MAP
      if (texture2D(map, vUv).a < uAlphaTest) discard;
      #endif
      #ifdef GLASS
      float cs = abs(dot(normalize(vN), normalize(vV))); float F = 0.04 + 0.96 * pow(1.0 - cs, 5.0); float opa = 1.0 - (1.0 - F) * uGlassT;
      if (uMode > 0.5 && opa < 0.5) discard;
      #endif
      gl_FragColor = uMode > 0.5 ? packDepth(vDepth / uFar) : vec4(uColor, 1.0);
    }`;

  /* ------------------------------------------------------------------ shared GL objects (created once the main renderer exists) ------------------------------------------------------------------ */
  let G = null;
  function mat3Inv(m) {            // m: row-major 3x3 -> inverse as THREE.Matrix3 (column-major elements)
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C, r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
    const M = new THREE.Matrix3(); M.set(...r); return M;
  }
  function ensureGL() {
    const V = vw(); if (!V || !V.renderer || !window.THREE) return null;
    if (G && G.R === V.renderer) { G.V = V; return G; }
    const R = V.renderer, gl = R.getContext(), T = THREE;
    G = { R, gl, V, webgl2: !!R.capabilities.isWebGL2, pool: new Map() };
    const quadGeo = new T.PlaneGeometry(2, 2), qs = new T.Scene(), qc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mk = (fs, uniforms, extra) => new T.ShaderMaterial(Object.assign({ vertexShader: VS_QUAD, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, transparent: false, toneMapped: false, fog: false }, extra || {}));
    // ACES matrices (rows of the GLSL column-major constructors) and their inverses
    const IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777], OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
    G.lin = mk(FS_LIN, { tScene: { value: null }, uTexel: { value: new T.Vector2(1, 1) }, uSS: { value: 2 }, uTone: { value: 4 }, uEnc: { value: 1 }, uE: { value: 1 }, uInvIn: { value: mat3Inv(IN) }, uInvOut: { value: mat3Inv(OUT) } });
    G.isp = mk(FS_ISP, { tLin: { value: null }, uRes: { value: new T.Vector2(320, 180) }, uSeed: { value: 0 }, uShot: { value: 0 }, uRead: { value: 0 }, uVig: { value: 0.3 }, uSoft: { value: 0.75 }, uBloom: { value: 0.35 }, uKnee: { value: 1.2 },
      uSunUv: { value: new T.Vector2(0.5, 0.5) }, uSunAmp: { value: 0 }, uCA: { value: 0.0016 }, uMaxLod: { value: 5 }, uAspect: { value: new T.Vector2(16 / 9, 1) }, uGlow: { value: 1 } });
    G.quad = new T.Mesh(quadGeo, G.lin); G.quad.frustumCulled = false; qs.add(G.quad); G.qs = qs; G.qc = qc;
    G.dsOf = new WeakMap(); G.farU = { value: 100 }; G.semCls = new WeakMap(); G.semKey = "";
    ES.bus.on("scene:built", () => { if (G) G.semCls = new WeakMap(); });
    return G;
  }

  /* render targets, pooled by size */
  function rtScene(g, w, h) { const k = "s" + w + "x" + h; let r = g.pool.get(k); if (!r) { r = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false }); r.texture.encoding = THREE.sRGBEncoding; g.pool.set(k, r); } return r; }
  function rtLin(g, w, h) { const k = "l" + w + "x" + h; let r = g.pool.get(k); if (!r) { r = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: true }); g.pool.set(k, r); } return r; }
  function rtByte(g, w, h, depth) { const k = (depth ? "d" : "o") + w + "x" + h; let r = g.pool.get(k); if (!r) { r = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: !!depth, stencilBuffer: false, generateMipmaps: false }); g.pool.set(k, r); } return r; }

  /* ------------------------------------------------------------------ async read-back (PIXEL_PACK_BUFFER + fence); synchronous fallback ------------------------------------------------------------------ */
  function pboSlots(g, f) {
    const gl = g.gl, size = f.w * f.h * 4;
    if (f.pbo && f.pbo.size === size) return f.pbo.slots;
    if (f.pbo) for (const s of f.pbo.slots) { if (s.buf) gl.deleteBuffer(s.buf); }
    const slots = [0, 1].map(() => { const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); return { buf: b, fence: null, meta: null }; });
    f.pbo = { size, slots, k: 0 }; f.cpu = new Uint8Array(size); return slots;
  }
  function submitRead(g, f, rt, meta) {
    const gl = g.gl, R = g.R;
    if (!g.webgl2 || f._sync) { const buf = (f.cpu = f.cpu && f.cpu.length === f.w * f.h * 4 ? f.cpu : new Uint8Array(f.w * f.h * 4)); R.readRenderTargetPixels(rt, 0, 0, f.w, f.h, buf); f.pending.push({ meta, sync: true }); return; }
    const slots = pboSlots(g, f), s = slots[f.pbo.k]; f.pbo.k ^= 1;
    if (s.fence) { gl.deleteSync(s.fence); s.fence = null; }                      // the older result was never consumed: drop it
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.buf); gl.readPixels(0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    s.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); s.meta = meta; gl.flush();
  }
  function pollRead(g, f) {
    const gl = g.gl; let got = false;
    while (f.pending.length) { const p = f.pending.shift(); process(f, f.cpu, p.meta); got = true; }
    if (!g.webgl2 || !f.pbo) return got;
    const ready = f.pbo.slots.filter((s) => s.fence).sort((a, b) => a.meta.seq - b.meta.seq);
    for (const s of ready) {
      const st = gl.clientWaitSync(s.fence, 0, 0); if (st === gl.TIMEOUT_EXPIRED || st === gl.WAIT_FAILED) continue;
      gl.deleteSync(s.fence); s.fence = null; gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.buf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, f.cpu); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      process(f, f.cpu, s.meta); got = true;
    }
    return got;
  }

  /* ------------------------------------------------------------------ geometry helpers: pose -> camera, hiding, sky, sun ------------------------------------------------------------------ */
  function poseToCamera(f) {
    const p = f.pose, c = f.cam, T = THREE, vfov = (2 * Math.atan(Math.tan((f.hfov * Math.PI) / 360) / (f.w / f.h)) * 180) / Math.PI;
    if (c.fov !== vfov || c.aspect !== f.w / f.h || c.near !== f.near || c.far !== f.far) { c.fov = vfov; c.aspect = f.w / f.h; c.near = f.near; c.far = f.far; c.updateProjectionMatrix(); }
    c.position.set(p.x, p.z, -p.y); f._eul = f._eul || new T.Euler(0, 0, 0, "YXZ"); f._eul.set(p.pitch || 0, p.yaw - Math.PI / 2, p.roll || 0, "YXZ"); c.quaternion.setFromEuler(f._eul); c.updateMatrixWorld(true);
  }
  function hideSet(f, V) {
    const out = [];
    let h = f.hideObject; if (typeof h === "function") h = h();
    for (const o of Array.isArray(h) ? h : h ? [h] : []) if (o && o.visible) out.push(o);
    if (V.agents) for (const grp of V.agents.children) grp.traverse((o) => { if (o.visible && (o.isSprite || (o.isMesh && o.material && o.material.isMeshBasicMaterial && o.material.transparent && o.geometry && o.geometry.type === "SphereGeometry"))) out.push(o); });   // HUD beacons and name labels are not physical objects
    return out;
  }
  /* sun: direction toward the sun in three.js world axes, intensity gate (no glare at night) */
  function sunDirThree() {
    const V = vw(), e = ES.env; let d = e && (e.sunDir || (e.sun && e.sun.dir));
    if (d && typeof d.x === "number") { const l = Math.hypot(d.x, d.y, d.z) || 1; return [d.x / l, d.y / l, d.z / l]; }
    if (V && V.sun) { const p = V.sun.position, t = V.sun.target ? V.sun.target.position : { x: 0, y: 0, z: 0 }, x = p.x - t.x, y = p.y - t.y, z = p.z - t.z, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }
    return null;
  }
  function sunStrength() { const V = vw(), e = ES.env; if (e && typeof e.sunIlluminanceLux === "number") return clamp(e.sunIlluminanceLux / 20000, 0, 1); return V && V.sun ? clamp((V.sun.intensity - 0.8) / 2.0, 0, 1) : 0; }
  /* sun relative to a camera pose: angle off the optical axis, projected image position (may lie outside 0..1), visibility 0..1 (occlusion by buildings / trunks / canopy) */
  function sunInfo(pose, hfov, aspect) {
    const sd = sunDirThree(), A = ES.app, st = sunStrength();
    if (!sd) return { angle: 180, uv: null, vis: 0, inFrame: false, dir: null, strength: 0 };
    const cp = Math.cos(pose.pitch || 0), fx = Math.cos(pose.yaw) * cp, fy = Math.sin(pose.yaw) * cp, fz = Math.sin(pose.pitch || 0);   // forward in lab ENU
    const sx = sd[0], sy = -sd[2], sz = sd[1];                                                                                            // sun direction in lab ENU
    const cosA = clamp(fx * sx + fy * sy + fz * sz, -1, 1), angle = (Math.acos(cosA) * 180) / Math.PI;
    // camera frame: right = (sin yaw, -cos yaw, 0), up = right x forward
    const rx = Math.sin(pose.yaw), ry = -Math.cos(pose.yaw), ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
    const xr = sx * rx + sy * ry, yu = sx * ux + sy * uy + sz * uz, zf = cosA, th = Math.tan((hfov * Math.PI) / 360), tv = th / aspect;
    let uv = null; if (zf > 0.08) uv = [0.5 + (0.5 * xr) / zf / th, 0.5 - (0.5 * yu) / zf / tv];
    let vis = 0;
    if (st > 0 && A && A.W) {
      const W = A.W, o = [pose.x, pose.y, pose.z];
      if (ES.ray && typeof ES.ray.blocked === "function") { const b = [o[0] + sx * 400, o[1] + sy * 400, o[2] + sz * 400]; vis = ES.ray.blocked(o, b) ? 0 : 1; if (vis && ES.ray.canopy) vis *= Math.exp(-ES.ray.canopy(o, b).tau); }   // glass does not block the sun, crowns attenuate it
      else if (ES.phys && ES.phys.los) vis = ES.phys.los(W, o[0], o[1], o[2], o[0] + sx * 300, o[1] + sy * 300, o[2] + sz * 300, 0.1);
      if (sz < 0.02) vis = 0;                                          // below the horizon
    }
    const half = Math.atan(Math.hypot(th, tv)) * 180 / Math.PI;
    return { angle, uv, vis: vis * (st > 0 ? 1 : 0), inFrame: !!uv && uv[0] > -0.15 && uv[0] < 1.15 && uv[1] > -0.15 && uv[1] < 1.15, dir: [sx, sy, sz], strength: st, halfDiag: half };
  }
  CF.sunInfo = sunInfo;

  /* ------------------------------------------------------------------ rgb: render, ISP, metering, auto-exposure ------------------------------------------------------------------ */
  function renderRGB(g, f, nowMs) {
    const R = g.R, V = g.V, w = f.w, h = f.h, ss = f.ss, tone = R.toneMapping, enc = R.outputEncoding, ae = f.ae, legacy = tone === 4;
    const sc = rtScene(g, w * ss, h * ss), lin = rtLin(g, w, h), out = rtByte(g, w, h, false); sc.texture.encoding = enc;                // same output encoding as the main view: the material programs are shared (no recompile)
    poseToCamera(f);
    const E = ae.E, sun = sunInfo(f.pose, f.hfov, w / h), tri = triangle(f.lim, E);
    const sv = { rt: R.getRenderTarget(), exp: R.toneMappingExposure, sa: R.shadowMap.autoUpdate, skyP: V.sky ? V.sky.position.clone() : null, starP: V.stars ? V.stars.position.clone() : null }, hid = hideSet(f, V);
    for (const o of hid) o.visible = false;
    try {
      if (V.sky) V.sky.position.copy(f.cam.position); if (V.stars) V.stars.position.copy(f.cam.position);
      R.shadowMap.autoUpdate = false; if (legacy) R.toneMappingExposure = E;
      R.setRenderTarget(sc); R.render(V.scene, f.cam);
      const lu = g.lin.uniforms; lu.tScene.value = sc.texture; lu.uTexel.value.set(1 / (w * ss), 1 / (h * ss)); lu.uSS.value = ss; lu.uTone.value = legacy ? 4 : 0; lu.uEnc.value = enc === THREE.sRGBEncoding ? 1 : 0; lu.uE.value = E;
      g.quad.material = g.lin; R.setRenderTarget(lin); R.render(g.qs, g.qc);
      // noise parameters from the ISO the camera picked: variance = a S + b (sensor signal units, S = 1 ~ mid-bright), full well shrinks with ISO
      const fwEff = (CAL.fw100 * 100) / tri.iso, a = (CAL.sFull / fwEff) * CAL.denoise * CAL.denoise, b = Math.pow((CAL.sFull * CAL.readE) / fwEff, 2) * CAL.denoise * CAL.denoise;
      const iu = g.isp.uniforms; iu.tLin.value = lin.texture; iu.uRes.value.set(w, h); iu.uAspect.value.set(w / h, 1); iu.uSeed.value = Math.random() * 977; iu.uShot.value = f.opt.noise === false ? 0 : a; iu.uRead.value = f.opt.noise === false ? 0 : b;
      iu.uVig.value = f.opt.vignette ?? 0.2; iu.uSoft.value = f.opt.soft ?? 0.75; iu.uBloom.value = f.opt.bloom ?? 0.35; iu.uMaxLod.value = Math.max(0, Math.floor(Math.log2(Math.min(w, h))) - 1);
      const glare = sun.vis > 0.02 && sun.uv && sun.angle < 100 && f.opt.glare !== false; iu.uSunAmp.value = glare ? sun.vis * sun.strength * E : 0;          // glare is light scattered inside the lens: it scales with the exposure like everything else if (sun.uv) iu.uSunUv.value.set(sun.uv[0], 1 - sun.uv[1]);
      g.quad.material = g.isp; R.setRenderTarget(out); R.render(g.qs, g.qc);
      submitRead(g, f, out, { seq: ++f.seq, t: nowMs, E, tri, sun, lpu: lpu(), hdr: !legacy, pose: Object.assign({}, f.pose), kind: "rgb" });
    } finally {
      for (const o of hid) o.visible = true;
      R.setRenderTarget(sv.rt); R.toneMappingExposure = sv.exp; R.shadowMap.autoUpdate = sv.sa; if (V.sky && sv.skyP) V.sky.position.copy(sv.skyP); if (V.stars && sv.starP) V.stars.position.copy(sv.starP);
    }
  }
  /* the metering grid: 32 x 18 samples of the alpha channel (log2 luminance of the clean sensor signal) */
  const MG = { nx: 32, ny: 18 };
  function meterGrid(cpu, w, h) {
    const n = MG.nx * MG.ny, lg = new Float32Array(n), wt = new Float32Array(n); let k = 0;
    for (let gy = 0; gy < MG.ny; gy++) for (let gx = 0; gx < MG.nx; gx++, k++) {
      const x = Math.min(w - 1, Math.floor(((gx + 0.5) * w) / MG.nx)), y = Math.min(h - 1, Math.floor(((gy + 0.5) * h) / MG.ny)), a = cpu[(y * w + x) * 4 + 3];
      lg[k] = (a / 255) * 22 - 14; const u = (gx + 0.5) / MG.nx - 0.5, v = (gy + 0.5) / MG.ny - 0.5, r2 = (u * u * 4 + v * v * 4) / 2; wt[k] = 0.25 + 0.75 * Math.exp(-r2 / 0.28);   // centre-weighted
    }
    return { lg, wt, n };
  }
  function processRGB(f, cpu, meta) {
    const w = f.w, h = f.h, m = meterGrid(cpu, w, h), ae = f.ae, lim = f.lim, tri = meta.tri;
    // statistics of the clean sensor signal S (not of the noisy picture)
    let sw = 0, sl = 0, sLin = 0, hiN = 0, loN = 0, cN = 0, cl = 0; const cw = [], all = [];
    for (let i = 0; i < m.n; i++) {
      const lg = m.lg[i], wt = m.wt[i], S = Math.pow(2, lg), gx = i % MG.nx, gy = (i / MG.nx) | 0, u = (gx + 0.5) / MG.nx - 0.5, v = (gy + 0.5) / MG.ny - 0.5;
      sw += wt; sl += wt * Math.min(lg, Math.log2(8)); sLin += wt * Math.min(S, 8); if (S >= CAL.sClip) hiN++; if (S <= CAL.sBlack) loN++; all.push(lg);
      if (u * u + v * v < 0.07) { cl += lg; cN++; }
    }
    const logMean = sl / sw, meanS = sLin / sw, centreLog = cl / Math.max(cN, 1); all.sort((a, b) => a - b);
    const p90 = all[Math.floor(0.9 * (m.n - 1))], p10 = all[Math.floor(0.1 * (m.n - 1))];
    // auto-exposure: error in stops, time constants 0.2 s (darker) / 0.4 s (brighter); the meter reports the frame rendered at meta.E
    const err = Math.log2(CAL.sTarget) - logMean, dt = Math.max(0.01, (meta.t - (ae.lastT || meta.t - 66)) / 1000); ae.lastT = meta.t;
    const Eideal = meta.E * Math.pow(2, clamp(err, -6, 6)), tau = Eideal < ae.E ? 0.2 : 0.4, k = 1 - Math.exp(-dt / tau), Enext = ae.E * Math.pow(Eideal / ae.E, k);
    ae.E = clamp(Enext, tri.Emin, tri.Emax);
    // photometry: scene luminance of the metered average (sensor signal / exposure), EV100 and an incident-light equivalent illuminance
    const Lu = Math.pow(2, logMean) / meta.E, Lcd = Lu * (meta.lpu || lpu()), ev = Math.log2((Lcd * 100) / CAL.K), lux = 2.5 * Math.pow(2, ev);
    // noise at the metered mean: SNR of S-bar
    const fwEff = (CAL.fw100 * 100) / tri.iso, a = (CAL.sFull / fwEff) * CAL.denoise * CAL.denoise, b = Math.pow((CAL.sFull * CAL.readE) / fwEff, 2) * CAL.denoise * CAL.denoise, sig = Math.sqrt(a * meanS + b), snr = 20 * Math.log10(Math.max(meanS, 1e-6) / Math.max(sig, 1e-9));
    const hi = hiN / m.n, lo = loN / m.n, sun = meta.sun, half = f.hfov / 2;
    const sunFront = sun.vis > 0.15 && sun.angle < half + 14, contrast = p90 - centreLog;
    const backlitImg = hi > 0.05 && contrast > 1.2 && centreLog < logMean - 0.4;
    const backlit = sunFront || backlitImg;
    const limited = ae.E >= tri.Emax * 0.97 ? "ceiling" : ae.E <= tri.Emin * 1.03 ? "floor" : null;
    const st = f.stats, sm = (o, n, kk) => (Number.isFinite(o) ? o + (n - o) * kk : n), ks = 1 - Math.exp(-dt / 0.35);
    st.modality = "rgb"; st.ev = sm(st.ev, ev, ks); st.lux = Math.pow(2, sm(Math.log2(st.lux || lux), Math.log2(lux), ks)); st.meanLum = meanS; st.logMean = logMean; st.clippedHigh = hi; st.clippedLow = lo;
    st.backlit = backlit; st.backlitScore = clamp(Math.max(sunFront ? 1 : 0, contrast / 5), 0, 1); st.sunAngleDeg = sun.angle; st.sunVisible = sun.vis; st.sunInFrame = sun.inFrame; st.snrDb = sm(st.snrDb, snr, ks);
    st.exposure = meta.E; st.iso = tri.iso; st.shutter = tri.t; st.fNumber = lim.fNumber; st.limited = limited; st.sceneLuma = Lu; st.contrastStops = contrast; st.p10 = p10; st.p90 = p90; st.frameT = meta.t; st.frames = (st.frames || 0) + 1; st.centreLog = centreLog;
    st.verdict = verdict(st);
    // picture -> canvas (alpha forced to opaque only after the metering above)
    const u32 = new Uint32Array(cpu.buffer, cpu.byteOffset, w * h); for (let i = 0; i < u32.length; i++) u32[i] |= 0xff000000;
    if (!f.img || f.img.width !== w || f.img.height !== h) f.img = f.ctx.createImageData(w, h);
    f.img.data.set(cpu); f.ctx.putImageData(f.img, 0, 0); f.shown = meta.t; f.hasImage = true;
  }
  function verdict(st) {
    const hi = st.clippedHigh, lowLight = st.limited === "ceiling" || st.iso >= 1600;
    if (st.backlit) return { code: "backlit", zh: "逆光", detail: st.sunVisible > 0.15 ? "太阳在视野内,前景欠曝" : "亮部过曝,主体偏暗" };
    if (hi > 0.28 || st.limited === "floor") return { code: "over", zh: "过曝", detail: hi > 0.28 ? "高光溢出 " + Math.round(hi * 100) + "%" : "已到最短曝光" };
    if (lowLight) return { code: "dim", zh: "偏暗", detail: "ISO " + Math.round(st.iso) + (st.limited === "ceiling" ? ",已到最大增益" : ",噪点增多") };
    return { code: "ok", zh: "光线正常", detail: "EV " + st.ev.toFixed(1) };
  }
  CF.verdict = verdict;

  /* ------------------------------------------------------------------ depth / semantic ------------------------------------------------------------------ */
  const TEX_KEYS = ["grass", "asphalt", "sidewalk", "concrete", "gravel", "water", "flatroof"];
  /* BIM materials that only furniture / equipment / soft furnishings use (the elements ES.ray labels 'furniture'); the Blender dataset merges the whole BIM into 'building' (3), ES.ray.CFG.bimFurnitureClass switches it */
  const FURN_MATS = new Set(["fabric", "fabric_b", "wood_furn", "metal_furn", "appliance", "rack_blue", "rack_orange", "cardboard", "pallet", "machine_green", "machine_yellow", "whiteboard", "screen", "bedding", "ceramic", "countertop", "counter_wood", "lockers", "plant", "paper", "curtain", "blinds", "light", "light_off", "rubber"]);
  function bimMatNames(g, V) {
    const A = ES.app, tab = A && A.bim && A.bim.materials; if (g.bimMatsFor === V.mats && g.bimMatsN) return g.bimMatsN;
    const m = new Map(); if (tab && V.mats) V.mats.forEach((mm, i) => { if (tab[i]) m.set(mm, tab[i].name); }); g.bimMatsFor = V.mats; g.bimMatsN = m; return m;
  }
  /* membership: group object -> class id, from what view3d.js / the other modules keep in V */
  function semContext(V) {
    const map = new Map(), A = ES.app, ents = (A && A.ents) || [];
    for (const bb of Object.values(V.bimB || {})) map.set(bb.group, SEM_ID.building);
    if (V.treeGroup) map.set(V.treeGroup, SEM_ID.vegetation);
    for (const g of V.vehGroups || []) map.set(g, SEM_ID.vehicle);
    if (V.live && V.live.userData && V.live.userData.items) for (const it of V.live.userData.items) map.set(it.model, it.kind === "uav" ? SEM_ID.uav : it.kind === "dog" || it.kind === "rover" ? SEM_ID.ugv : /lying/.test(it.kind) ? SEM_ID.victim : SEM_ID.person);
    if (V.agents) for (const grp of V.agents.children) { const e = ents.find((q) => q.id === grp.userData.eid); if (e) map.set(grp, entClass(e.kind)); }
    if (V.self) { const b = walkState() && walkState().body; map.set(V.self, b === "uav" ? SEM_ID.uav : b === "dog" ? SEM_ID.ugv : SEM_ID.person); }
    return map;
  }
  function entClass(kind) { return kind === "uav" ? SEM_ID.uav : kind === "dog" || kind === "rover" ? SEM_ID.ugv : kind === "human" || kind === "t:person" ? SEM_ID.person : kind === "t:lying" ? SEM_ID.victim : kind === "t:vehicle" ? SEM_ID.vehicle : kind === "cp" ? SEM_ID.command_post : SEM_ID.furniture; }
  /* surface classes from the material name the environment / pbr modules give (asphalt, sidewalk, paved, grass ...), then from the legacy procedural textures */
  const NAME_CLS = [[/asphalt|road|paint|marking|stripe|crosswalk|lane/i, SEM_ID.road], [/sidewalk|paved|plaza|concrete|curb|pavement|tile/i, SEM_ID.sidewalk], [/grass|lawn|gravel|dirt|soil|mud|sand|ground|terrain|rubble|path/i, SEM_ID.ground], [/water|pond|pool/i, SEM_ID.water]];
  function texClass(V, m) {
    const T = V.tex || {}; if (!m) return SEM_ID.furniture;
    if (m.name) for (const [re, c] of NAME_CLS) if (re.test(m.name)) return c;
    if (m.map) { const im = m.map.image; for (const k of TEX_KEYS) { const t = T[k]; if (t && (t === m.map || t.image === im)) return { grass: 13, asphalt: 1, sidewalk: 2, concrete: 2, gravel: 13, water: 11, flatroof: 3 }[k]; } }
    if (m.transparent && !m.map && m.opacity < 0.95 && !m.alphaTest) return SEM_ID.water;
    return -1;
  }
  function classOfMesh(g, V, mesh, ctx) {
    let c = g.semCls.get(mesh); if (c !== undefined) return c;
    c = -1; let inGround = false;
    for (let o = mesh; o && c < 0; o = o.parent) {
      const s = o.userData && o.userData.sem; if (s !== undefined && s !== null) { c = typeof s === "number" ? s : SEM_ID[s] ?? -1; if (c >= 0) break; }
      if (ctx.has(o)) { c = ctx.get(o); break; }
      const nm = o.name; if (nm === "es-masses") { c = SEM_ID.building; break; } if (nm === "es-farTrees") { c = SEM_ID.vegetation; break; } if (nm === "es-ground") inGround = true;       // env.js: far building masses, far trees, the ground group
    }
    if (c === SEM_ID.building && mesh.material && !Array.isArray(mesh.material)) { const nm = bimMatNames(g, V).get(mesh.material); if (nm && FURN_MATS.has(nm)) c = ES.ray && ES.ray.CFG && ES.ray.CFG.bimFurnitureClass != null ? ES.ray.CFG.bimFurnitureClass : SEM_ID.furniture; }
    if (c < 0) {
      const mm = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; c = SEM_ID.furniture;
      const tc = mm.map((m) => texClass(V, m)).filter((k) => k >= 0);
      if (tc.length) c = tc[0]; else if (inGround) c = SEM_ID.ground;
      else if (mesh.geometry && mesh.geometry.type === "PlaneGeometry" && mm[0] && mm[0].isMeshBasicMaterial && !mm[0].transparent && mesh.parent === V.scene && mesh.position.y < 0.1) c = SEM_ID.road;   // lane paint / crosswalk stripes
      else if (mesh.geometry && mesh.geometry.type === "ConeGeometry" && mm[0] && mm[0].isMeshBasicMaterial) c = SEM_ID.fire_smoke;
      else if (mesh.geometry && mesh.geometry.type === "ExtrudeGeometry") c = SEM_ID.building;                       // old extruded prisms (no building model)
    }
    g.semCls.set(mesh, c); return c;
  }
  /* variant material per (original material, mode, class): a handful of programs serve the whole scene (the program depends only on cut-out / glass / side defines) */
  function dsMat(g, mode, cls, orig, skinned) {
    const key = mode * 32 + (mode === 0 ? cls : 0) + (skinned ? 100 : 0); let per = g.dsOf.get(orig); if (!per) { per = {}; g.dsOf.set(orig, per); } let m = per[key]; if (m) return m;
    const T = THREE, hasCut = !!(orig && orig.map && orig.alphaTest > 0), glass = !!(orig && orig.userData && orig.userData.glass && mode === 1 && !/frosted/.test(orig.name || "") && !(orig.userData.milk || (orig.color && orig.color.r > 0.1 && orig.opacity > 0.5)));
    const gt = glass ? clamp(0.5 + 0.4 * (1 - (orig.opacity || 0.5)), 0.4, 0.95) : 1;
    m = new T.ShaderMaterial({ vertexShader: VS_DS, fragmentShader: FS_DS, defines: Object.assign(hasCut ? { USE_MAP: "" } : {}, glass ? { GLASS: "" } : {}), side: orig ? orig.side : T.FrontSide, toneMapped: false, fog: false, lights: false, transparent: false, skinning: !!skinned,
      polygonOffset: !!(orig && orig.polygonOffset), polygonOffsetFactor: orig ? orig.polygonOffsetFactor || 0 : 0, polygonOffsetUnits: orig ? orig.polygonOffsetUnits || 0 : 0,
      uniforms: { uColor: { value: new T.Vector3(...(SEM_RGB[cls] || [0, 0, 0]).map((v) => v / 255)) }, uFar: g.farU, uMode: { value: mode }, map: { value: hasCut ? orig.map : null }, uvTransform: { value: new T.Matrix3() }, uAlphaTest: { value: hasCut ? orig.alphaTest : 0 }, uGlassT: { value: gt } } });
    if (hasCut) { orig.map.updateMatrix(); m.uniforms.uvTransform.value.copy(orig.map.matrix); }
    per[key] = m; return m;
  }
  function renderDS(g, f, nowMs) {
    const R = g.R, V = g.V, w = f.w, h = f.h, mode = f.modality === "depth" ? 1 : 0, rt = rtByte(g, w, h, true);
    poseToCamera(f);
    const sv = { rt: R.getRenderTarget(), bg: V.scene.background, fog: V.scene.fog, ca: R.getClearAlpha(), cc: R.getClearColor(new THREE.Color()).clone(), sa: R.shadowMap.autoUpdate, sh: R.shadowMap.enabled }, hid = hideSet(f, V);
    const swapped = [], ctx = semContext(V); g.farU.value = f.far; const prof = CF.prof, t0 = now0();
    const swap = (o) => {
      if (o.isSprite || o.isPoints || o.isLine || o.isLight) { if (o.visible && (o.isSprite || o.isPoints || o.isLine)) { o.visible = false; hid.push(o); } return; }
      if (!o.isMesh || o === V.sky || !o.material) return;
      const cls = classOfMesh(g, V, o, ctx), orig = o.material;
      swapped.push([o, orig]); const sk = !!o.isSkinnedMesh; o.material = Array.isArray(orig) ? orig.map((m) => dsMat(g, mode, cls, m, sk)) : dsMat(g, mode, cls, orig, sk);
    };
    for (const o of hid) o.visible = false;
    if (V.sky) { V.sky.visible = false; hid.push(V.sky); } if (V.stars) { V.stars.visible = false; hid.push(V.stars); }
    let t1 = 0, t2 = 0;
    try {
      V.scene.traverse(swap); t1 = now0();
      V.scene.background = null; V.scene.fog = null; R.shadowMap.enabled = false;
      if (mode === 1) R.setClearColor(0xffffff, 1); else { const c = SEM_RGB[SEM_ID.sky]; R.setClearColor(new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255), 1); }
      R.setRenderTarget(rt); R.render(V.scene, f.cam); t2 = now0();
      submitRead(g, f, rt, { seq: ++f.seq, t: nowMs, kind: f.modality, pose: Object.assign({}, f.pose) });
    } finally {
      for (const [o, m] of swapped) o.material = m;
      for (const o of hid) o.visible = true;
      V.scene.background = sv.bg; V.scene.fog = sv.fog; R.shadowMap.enabled = sv.sh; R.setClearColor(sv.cc, sv.ca); R.setRenderTarget(sv.rt);
      if (prof) { prof.n = (prof.n || 0) + 1; prof.swap = (prof.swap || 0) + (t1 - t0); prof.render = (prof.render || 0) + (t2 - t1); prof.rest = (prof.rest || 0) + (now0() - t2); prof.meshes = swapped.length; }
    }
  }
  /* turbo colour map (Mikhailov polynomial); depth u = log-scaled so near geometry keeps resolution */
  const TURBO = new Uint8Array(256 * 3);
  (function () { for (let i = 0; i < 256; i++) { const x = i / 255, r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943)))), g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604)))), b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973)))); TURBO[i * 3] = clamp(r, 0, 1) * 255; TURBO[i * 3 + 1] = clamp(g, 0, 1) * 255; TURBO[i * 3 + 2] = clamp(b, 0, 1) * 255; } })();
  CF.TURBO = TURBO;
  CF.depthU = (d, near, far) => clamp(Math.log(Math.max(d, near) / near) / Math.log(far / near), 0, 1);       // false-colour position of a metric depth
  function processDS(f, cpu, meta) {
    const w = f.w, h = f.h, st = f.stats; if (!f.img || f.img.width !== w || f.img.height !== h) f.img = f.ctx.createImageData(w, h);
    const out = f.img.data, u32 = new Uint32Array(out.buffer);
    if (f.modality === "sem") {
      const hist = new Float32Array(16), ids = f.semIds && f.semIds.length === w * h ? f.semIds : (f.semIds = new Uint8Array(w * h)), lut = f.semLut || (f.semLut = new Map(SEM_RGB.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i])));
      for (let y = 0; y < h; y++) { const so = (h - 1 - y) * w * 4, dO = y * w; for (let x = 0; x < w; x++) { const i = so + x * 4, r = cpu[i], gg = cpu[i + 1], b = cpu[i + 2], id = lut.get((r << 16) | (gg << 8) | b); u32[dO + x] = 0xff000000 | (b << 16) | (gg << 8) | r; ids[dO + x] = id === undefined ? 255 : id; if (id !== undefined) hist[id]++; } }
      const tot = w * h; st.modality = "sem"; st.classes = {}; for (let c = 0; c < 16; c++) if (hist[c] > 0) st.classes[SEM_NAMES[c]] = hist[c] / tot;
    } else {
      const dep = f.depth && f.depth.length === w * h ? f.depth : (f.depth = new Float32Array(w * h)), far = f.far, near = Math.max(f.near, 0.3);
      let mn = 1e9, valid = 0, sum = 0;
      for (let y = 0; y < h; y++) { const so = (h - 1 - y) * w * 4, dO = y * w; for (let x = 0; x < w; x++) {
        const i = so + x * 4, u = cpu[i] / 255 + cpu[i + 1] / 65025 + cpu[i + 2] / 16581375, d = u * far, ok = u < 0.99995 && d >= f.near;
        if (ok) { dep[dO + x] = d; valid++; sum += d; if (d < mn) mn = d; const c = ((CF.depthU(d, near, far) * 255) | 0) * 3; u32[dO + x] = 0xff000000 | (TURBO[c + 2] << 16) | (TURBO[c + 1] << 8) | TURBO[c]; } else { dep[dO + x] = NaN; u32[dO + x] = 0xff1a1a1a; } } }
      const cx = w >> 1, cy = h >> 1, cs = []; for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { const d = dep[y * w + x]; if (d === d) cs.push(d); } cs.sort((a, b) => a - b);
      st.modality = "depth"; st.far = far; st.nearest = valid ? mn : NaN; st.centre = cs.length ? cs[cs.length >> 1] : NaN; st.validFrac = valid / (w * h); st.meanDepth = valid ? sum / valid : NaN;
    }
    st.frameT = meta.t; st.frames = (st.frames || 0) + 1; f.ctx.putImageData(f.img, 0, 0); f.shown = meta.t; f.hasImage = true;
  }
  function process(f, cpu, meta) { if (meta.kind === "rgb") processRGB(f, cpu, meta); else processDS(f, cpu, meta); f.lastShownSeq = meta.seq; }

  /* ------------------------------------------------------------------ feeds + global budget scheduler ------------------------------------------------------------------ */
  const feeds = [], SCH = CF.sched = { budgetMs: 3, stamp: -1, spent: 0, lastSpent: 0, renders: 0, ema: 0, perFrame: 0, skipped: 0, window: [] };
  const newFrame = (now) => { if (now !== SCH.stamp) { SCH.stamp = now; SCH.lastSpent = SCH.spent; SCH.ema += (SCH.spent - SCH.ema) * 0.05; SCH.spent = 0; } };
  class Feed {
    constructor(o) {
      this.id = o.id || "feed" + feeds.length; this.w = o.w || 320; this.h = o.h || 180; this.hfov = o.hfov || 90; this.modality = o.modality || "rgb"; this.fps = o.fps || 10; this.near = o.near || 0.1; this.far = o.far || 200; this.hideObject = o.hideObject || null;
      this.ss = o.ss || (this.w >= 128 ? 2 : 1); this.opt = o; this.lim = Object.assign({}, CAMLIM[o.device === "uav" ? "uav" : "default"], o.cam || {});
      this.canvas = document.createElement("canvas"); this.canvas.width = this.w; this.canvas.height = this.h; this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
      this.ctx.fillStyle = "#05080a"; this.ctx.fillRect(0, 0, this.w, this.h);
      this.pose = { x: 0, y: 0, z: 1.5, yaw: 0, pitch: 0, roll: 0 }; this.cam = new THREE.PerspectiveCamera(60, this.w / this.h, this.near, this.far);
      this.ae = { E: Math.max(0.5, triangle(this.lim, 1).Emin), lastT: 0 }; this.stats = { modality: this.modality }; this.last = -1e9; this.seq = 0; this.pending = []; this.cost = 1.5; this.hasImage = false; this.enabled = true; this.dispose_ = false;
      feeds.push(this);
    }
    setPose(p) { const q = this.pose; q.x = p.x; q.y = p.y; q.z = p.z; q.yaw = p.yaw; q.pitch = p.pitch || 0; q.roll = p.roll || 0; return this; }
    setModality(m) { if (m === this.modality) return this; this.modality = m; this.stats = { modality: m, ev: this.stats.ev, lux: this.stats.lux }; this.hasImage = false; this.last = -1e9; this.opt.modality = m; return this; }
    setSpec(s) {
      let size = false; for (const k of ["w", "h"]) if (s[k] && s[k] !== this[k]) { this[k] = s[k]; size = true; }
      if (s.hfov) this.hfov = s.hfov; if (s.fps) this.fps = s.fps; if (s.far) this.far = s.far; if (s.near) this.near = s.near; if (s.device) this.lim = Object.assign({}, CAMLIM[s.device === "uav" ? "uav" : "default"], s.cam || {});
      if (size) { this.canvas.width = this.w; this.canvas.height = this.h; this.img = null; this.hasImage = false; this.cam.aspect = this.w / this.h; }
      return this;
    }
    /* one call per frame: consume finished read-backs, render when due (the global budget gates it; the most overdue feed always gets through) */
    update(nowMs) {
      if (this.dispose_) return false; const g = ensureGL(); if (!g || !g.V.scene) return false;
      newFrame(nowMs); const got = pollRead(g, this);
      if (!this.enabled) return got;
      const period = 1000 / this.fps, overdue = (nowMs - this.last) / period; if (overdue < 1) return got;
      if (SCH.spent > 0 && SCH.spent + this.cost > SCH.budgetMs && overdue < 2.2) { SCH.skipped++; return got; }
      const t0 = now0(); this.last = nowMs;
      try { if (this.modality === "rgb") renderRGB(g, this, nowMs); else renderDS(g, this, nowMs); } catch (e) { console.error("camfeed render", this.id, e); this.enabled = false; }
      const dt = now0() - t0; this.cost += (dt - this.cost) * 0.2; SCH.spent += dt; SCH.renders++; this.renders = (this.renders || 0) + 1;
      return got;
    }
    /* synchronous variant for tests / the recorder: render now and wait for the picture */
    renderNow(nowMs) {
      const g = ensureGL(); if (!g || !g.V.scene) return false; const t = nowMs ?? now0();
      this._sync = true; try { if (this.modality === "rgb") renderRGB(g, this, t); else renderDS(g, this, t); } finally { this._sync = false; }
      return pollRead(g, this);
    }
    dispose() { this.dispose_ = true; const i = feeds.indexOf(this); if (i >= 0) feeds.splice(i, 1); const g = G; if (g && this.pbo) for (const s of this.pbo.slots) { if (s.fence) g.gl.deleteSync(s.fence); g.gl.deleteBuffer(s.buf); } this.pbo = null; }
  }
  CF.create = (o) => new Feed(o || {});
  CF.feeds = feeds;
  CF.pump = (nowMs) => { newFrame(nowMs); const order = feeds.slice().sort((a, b) => (nowMs - b.last) / (1000 / b.fps) - (nowMs - a.last) / (1000 / a.fps)); let n = 0; for (const f of order) if (f.update(nowMs)) n++; return n; };
  CF.budget = (ms) => { if (ms) SCH.budgetMs = ms; return SCH.budgetMs; };
  CF.ready = () => !!ensureGL();
  CF.dispose = () => { for (const f of feeds.slice()) f.dispose(); };
})();
