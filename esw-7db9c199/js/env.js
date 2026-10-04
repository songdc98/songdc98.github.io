/* env.js: sun / sky / image-based light / looks / shadows / post-processing / backdrop (environment agent).  Documentation: web/docs/environment.md
   Units.  Scene radiance is stored in "sky units" of the Poly Haven HDRIs: a white diffuse surface under irradiance E units has radiance E / pi units.  Each look declares luxPerUnit, so
   1 unit of irradiance = luxPerUnit lux and 1 unit of radiance = luxPerUnit cd/m2.  The camera exposure is photographic: EV100 -> the luminance that maps to display white,
   L_white = 0.694 * 2^EV100 cd/m2 (12.5 * 2^EV / 100 / 0.18).  Lights follow the legacy three.js convention (intensity = E / pi in units, renderer.physicallyCorrectLights = false).
   Frames: lab ENU (x east, y north, z up); three.js (x, z, -y).  Azimuth arguments are compass bearings (clockwise from north, 0 = N, 90 = E). */
(function () {
  const ES = (window.ES = window.ES || {});
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, PI = Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const SKY_DIR = () => `${ES.ASSET_DIR || "assets"}/sky`;

  /* ======================================================================== looks ======================================================================== */
  /* sun: E = direct-normal irradiance in lux (0 = none); sky = horizontal illuminance of the sky dome in lux; ev = EV100 of the (virtual) camera; hdr = sky map; hdrSun = take the sun from the map
     fog: extinction coefficient 1/m near the ground and its height scale (m); haze tint; stars / moon for night skies; elRange: allowed sun elevations of the slider */
  const LOOKS = {
    day_cloud: { label: "白天", hdr: "day_cloud", sunLux: 88000, skyLux: 30700, ev: 15.4, fog: [1.6e-4, 1800], bloom: 0.10, vig: 0.16, sat: 1.08, con: 0.18, night: false, elRange: [12, 80], sunCol: null },
    overcast: { label: "阴天", hdr: "overcast", sunLux: 0, skyLux: 18000, ev: 13.0, fog: [4.5e-4, 900], bloom: 0.06, vig: 0.14, sat: 1.0, con: 0.12, night: false, elRange: null },
    sunset: { label: "日落", hdr: "sunset", sunLux: 12000, skyLux: 2000, ev: 11.2, fog: [2.4e-4, 1500], bloom: 0.16, vig: 0.2, sat: 1.05, night: false, elRange: [2, 14], sunCol: [1.0, 0.56, 0.28], sunEl: 4.0 },
    dawn: { label: "黎明", hdr: "dawn", sunLux: 0, skyLux: 400, ev: 8.2, fog: [3.0e-4, 1200], bloom: 0.12, vig: 0.2, sat: 1.0, night: false, elRange: null },
    night: { label: "夜晚", lamps: 1, hdr: "night", sunLux: 0, skyLux: 0.5, ev: 3.0, fog: [1.2e-4, 2500], bloom: 0.22, vig: 0.26, sat: 0.9, night: true, stars: 1, elRange: null, scotopic: 0.55 },
    moonlit: { label: "月夜", hdr: "moonlit", sunLux: 0.25, skyLux: 0.01, ev: -1.6, fog: [1.0e-4, 2500], bloom: 0.2, vig: 0.24, sat: 0.9, night: true, stars: 0.7, elRange: [10, 80], sunCol: [0.80, 0.88, 1.0], moon: true, scotopic: 0.5 },
  };
  const LOOK_ORDER = ["day_cloud", "overcast", "sunset", "dawn", "night", "moonlit"];
  const lwhite = (ev) => 0.694 * Math.pow(2, ev);                      // cd/m2 that maps to display white at this EV100
  const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  /* ======================================================================== state ======================================================================== */
  const S = {
    look: "day_cloud", L: LOOKS.day_cloud, sky: {}, cur: null, quality: "high", auto: true, wet: 0, time: 0, frame: 0, renderer: null, pipe: null, fps: 60, lowT: 0, listeners: [],
    sunAz: 124.2, sunEl: 47.9, rot: 0,           // bearing (deg), elevation (deg), rotation of the sky map about the vertical axis (deg, CCW seen from above)
    sunE: 0, skyE: 0, lpu: 20000, exposure: 1, ev: 15.4, ready: false, failed: false, fade: 0, still: 0,
    sunCol: [1, 1, 1], groundAlbedo: 0.2, shadowOn: true, patched: false, fogK: 1,
  };
  const env = (ES.env = ES.env || {});

  /* ======================================================================== shader patches ======================================================================== */
  function patchChunks() {
    if (S.patched) return; S.patched = true; const SC = THREE.ShaderChunk;
    // 1. diffuse image-based light comes from the spherical-harmonic light probe (exact cosine convolution) instead of the roughest PMREM level; specular keeps the PMREM
    SC.envmap_physical_pars_fragment = SC.envmap_physical_pars_fragment.replace("return PI * envMapColor.rgb * envMapIntensity;", "return vec3( 0.0 );");
    // 2. cascaded shadow maps: three directional shadow lights (index 0 = the sun, 1 and 2 = intensity 0 shadow-only lights); the sun picks the finest cascade that contains the fragment
    SC.shadowmap_pars_fragment += `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 3
float esEdge( vec4 c ) { vec3 p = c.xyz / c.w; return max( abs( p.x - 0.5 ), abs( p.y - 0.5 ) ); }
float esCascadeShadow() {
  float ceE0 = esEdge( vDirectionalShadowCoord[ 0 ] );
  if ( ceE0 < 0.46 ) {
    float s = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
    if ( ceE0 > 0.38 ) s = mix( s, getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] ), smoothstep( 0.38, 0.46, ceE0 ) );
    return s;
  }
  float ceE1 = esEdge( vDirectionalShadowCoord[ 1 ] );
  if ( ceE1 < 0.46 ) {
    float s = getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] );
    if ( ceE1 > 0.38 ) s = mix( s, getShadow( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ].shadowMapSize, directionalLightShadows[ 2 ].shadowBias, directionalLightShadows[ 2 ].shadowRadius, vDirectionalShadowCoord[ 2 ] ), smoothstep( 0.38, 0.46, ceE1 ) );
    return s;
  }
  float ceE2 = esEdge( vDirectionalShadowCoord[ 2 ] );
  float s2 = getShadow( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ].shadowMapSize, directionalLightShadows[ 2 ].shadowBias, directionalLightShadows[ 2 ].shadowRadius, vDirectionalShadowCoord[ 2 ] );
  return mix( s2, 1.0, smoothstep( 0.40, 0.5, ceE2 ) );
}
#endif
`;
    const orig = "directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
    if (SC.lights_fragment_begin.indexOf(orig) < 0) console.warn("env: lights_fragment_begin changed, cascaded shadows disabled");
    else SC.lights_fragment_begin = SC.lights_fragment_begin.replace(orig, `
#if ( UNROLLED_LOOP_INDEX == 0 ) && ( NUM_DIR_LIGHT_SHADOWS >= 3 )
		directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? esCascadeShadow() : 1.0;
#else
		${orig}
#endif`);
    // 2b. legacy (non physically-correct) lights have NO distance falloff when distance = 0; give such lights the inverse-power law, windowed lights (distance > 0) keep the old behaviour
    const key = "\treturn pow( saturate( -lightDistance / cutoffDistance + 1.0 ), decayExponent );\n\t}\n\treturn 1.0;";
    if (SC.bsdfs.indexOf(key) < 0) console.warn("env: bsdfs changed, lamp falloff unchanged"); else SC.bsdfs = SC.bsdfs.replace(key, key.replace("\treturn 1.0;", "\tif ( decayExponent > 0.0 ) return 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );\n\treturn 1.0;"));
    // 3. ambient occlusion hook for our materials: ES_AO defines a float esAO (0..1) that darkens indirect light only
    const ao = SC.aomap_fragment;
    SC.aomap_fragment = ao + `
#ifdef ES_AO
	reflectedLight.indirectDiffuse *= esAO;
	reflectedLight.indirectSpecular *= mix( 1.0, esAO, 0.7 );
#endif
`;
  }

  /* ======================================================================== fullscreen helper ======================================================================== */
  const FS_VERT = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }";
  let FSQ = null;
  function fsq() {
    if (FSQ) return FSQ;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const mesh = new THREE.Mesh(g, null); mesh.frustumCulled = false; const scene = new THREE.Scene(); scene.add(mesh); FSQ = { mesh, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }; return FSQ;
  }
  function mat(frag, uniforms, extra) {
    return new THREE.ShaderMaterial(Object.assign({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, blending: THREE.NoBlending }, extra || {}));
  }
  function pass(material, target) {
    const r = S.renderer, q = fsq(); q.mesh.material = material; const keep = r.autoClear; r.autoClear = false; r.setRenderTarget(target); r.render(q.scene, q.cam); r.autoClear = keep;
  }
  const rtOpts = (o) => Object.assign({ type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false }, o || {});

  /* ======================================================================== sky maps ======================================================================== */
  const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image " + url)); i.src = url; });
  const DECODE_FRAG = `uniform sampler2D tSrc; varying vec2 vUv;
    void main() { vec4 t = texture2D( tSrc, vUv ); float e = t.a * 255.0; vec3 c = t.rgb * 255.0 * exp2( e - 136.0 ); if ( e < 1.0 ) c = vec3( 0.0 ); gl_FragColor = vec4( c, 1.0 ); }`;
  async function loadSky(name) {
    if (S.sky[name]) return S.sky[name];
    const job = (async () => {
      const [meta, img] = await Promise.all([fetch(`${SKY_DIR()}/${name}.json`).then((r) => r.json()), loadImg(`${SKY_DIR()}/${name}.png`)]);
      const src = new THREE.Texture(img); src.minFilter = src.magFilter = THREE.NearestFilter; src.generateMipmaps = false; src.premultiplyAlpha = false; src.needsUpdate = true;
      const rt = new THREE.WebGLRenderTarget(img.width, img.height, rtOpts()); rt.texture.mapping = THREE.EquirectangularReflectionMapping;
      pass(mat(DECODE_FRAG, { tSrc: { value: src } }), rt); src.dispose();
      return { name, meta, rt, tex: rt.texture };
    })();
    S.sky[name] = job; return job;
  }

  /* spherical harmonics (three.js frame: y up) of the low-res copy of the sky, rotated about the vertical axis by rotDeg, plus a uniform ground colour below the horizon */
  function computeSH(meta, rotDeg, ground) {
    const lr = meta.lowres, W = lr.w, H = lr.h, d = lr.data, sh = new Float64Array(27), rot = rotDeg * D2R;
    for (let j = 0; j < H; j++) {
      const th = ((j + 0.5) / H) * PI, el = PI / 2 - th, ce = Math.cos(el), se = Math.sin(el), dom = ((2 * PI) / W) * (PI / H) * Math.sin(th);
      for (let i = 0; i < W; i++) {
        const az = (0.5 - (i + 0.5) / W) * 2 * PI + rot;                         // ENU azimuth of the (rotated) content
        const x = ce * Math.cos(az), y = se, z = -ce * Math.sin(az);             // three frame
        if (y <= 0) continue; const k = (j * W + i) * 3, w = dom;
        const b = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
        for (let n = 0; n < 9; n++) { const bw = b[n] * w; sh[n * 3] += d[k] * bw; sh[n * 3 + 1] += d[k + 1] * bw; sh[n * 3 + 2] += d[k + 2] * bw; }
      }
    }
    for (let n = 0; n < 9; n++) { const g = meta.sh_lo[n]; sh[n * 3] += ground[0] * g; sh[n * 3 + 1] += ground[1] * g; sh[n * 3 + 2] += ground[2] * g; }
    return sh;
  }

  /* ======================================================================== shaders ======================================================================== */
  const SKY_VERT = `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 ); gl_Position = p.xyww; }`;
  const EQ = `vec2 eqUv( vec3 r ) { return vec2( atan( r.z, r.x ) * 0.15915494 + 0.5, asin( clamp( r.y, -1.0, 1.0 ) ) * 0.31830989 + 0.5 ); }
    vec3 rotY( vec3 d, float c, float s ) { return vec3( c * d.x - s * d.z, d.y, s * d.x + c * d.z ); }`;
  const SKY_FRAG = `uniform sampler2D tSky; uniform float uRotC, uRotS; uniform vec3 uSunDir, uSunRad, uHaze; uniform float uStars, uMoon, uCosOuter, uCosInner, uTime, uGroundFade;
    varying vec3 vDir;
    ${EQ}
    float hash13( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
    void main() {
      vec3 d = normalize( vDir ); vec3 col = texture2D( tSky, eqUv( rotY( d, uRotC, uRotS ) ) ).rgb;
      col = mix( col, uHaze, uGroundFade * smoothstep( 0.0, -0.08, d.y ) );
      float cs = dot( d, uSunDir ); col += uSunRad * smoothstep( uCosOuter, uCosInner, cs );
      if ( uStars > 0.0 ) {                                              // crisp procedural stars (the map is too small to hold them), fading near the horizon and in the moon's glare
        vec3 p = d * 260.0; vec3 i = floor( p ); vec3 f = fract( p ) - 0.5; float h = hash13( i ); float st = step( 0.9975, h ) * smoothstep( 0.55, 0.0, length( f - ( vec3( hash13( i + 7.1 ), hash13( i + 3.7 ), hash13( i + 1.3 ) ) - 0.5 ) * 0.6 ) );
        float br = ( h - 0.9975 ) / 0.0025; col += vec3( 0.75, 0.82, 1.0 ) * st * br * br * 0.35 * uStars * smoothstep( 0.02, 0.25, d.y ) * ( 1.0 - 0.9 * smoothstep( 0.9, 0.995, cs ) * uMoon );
      }
      gl_FragColor = vec4( col, 1.0 );
    }`;
  const IBL_FRAG = `uniform sampler2D tSky; uniform float uRotC, uRotS; uniform vec3 uGround; varying vec2 vUv;
    ${EQ}
    void main() {
      float az = ( vUv.x - 0.5 ) * 6.2831853, el = ( vUv.y - 0.5 ) * 3.1415927; vec3 d = vec3( cos( el ) * cos( az ), sin( el ), cos( el ) * sin( az ) );
      vec3 sky = texture2D( tSky, eqUv( rotY( d, uRotC, uRotS ) ) ).rgb; gl_FragColor = vec4( mix( uGround, sky, smoothstep( -0.05, 0.1, d.y ) ), 1.0 );
    }`;

  /* ======================================================================== the rig of one scene ======================================================================== */
  /* sun (cascade 0) + two shadow-only lights, light probe, sky dome; created once per THREE.Scene */
  function makeRig(scn) {
    const rig = { scene: scn, sun: [], probe: new THREE.LightProbe(new THREE.SphericalHarmonics3(), 1), dir: new THREE.Vector3(0, 1, 0), sunCol: new THREE.Color(1, 1, 1) };
    for (let i = 0; i < 3; i++) {
      const l = new THREE.DirectionalLight(0xffffff, i === 0 ? 1 : 0); l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.0004; l.shadow.normalBias = 0.02; l.shadow.camera.near = 1; l.shadow.camera.far = 600;
      scn.add(l, l.target); rig.sun.push(l);
    }
    scn.add(rig.probe);
    const g = new THREE.SphereGeometry(1, 48, 24);
    const m = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
      uniforms: { tSky: { value: null }, uRotC: { value: 1 }, uRotS: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunRad: { value: new THREE.Vector3(0, 0, 0) }, uHaze: { value: new THREE.Vector3(0.5, 0.55, 0.6) }, uStars: { value: 0 }, uMoon: { value: 0 }, uCosOuter: { value: Math.cos(0.2665 * D2R) }, uCosInner: { value: Math.cos(0.2 * D2R) }, uTime: { value: 0 }, uGroundFade: { value: 1 } } });
    rig.skyMesh = new THREE.Mesh(g, m); rig.skyMesh.frustumCulled = false; rig.skyMesh.renderOrder = -1000; rig.skyMesh.userData.dyn = true; rig.skyMesh.name = "es-sky"; scn.add(rig.skyMesh);
    return rig;
  }

  /* ======================================================================== applying a look ======================================================================== */
  function sunDirThree(azBearing, elDeg) {                       // compass bearing -> three.js unit vector towards the sun
    const azEnu = (90 - azBearing) * D2R, el = elDeg * D2R; return new THREE.Vector3(Math.cos(el) * Math.cos(azEnu), Math.sin(el), -Math.cos(el) * Math.sin(azEnu));
  }
  const airmass = (elDeg) => 1 / (Math.sin(Math.max(elDeg, 0.5) * D2R) + 0.50572 * Math.pow(6.07995 + Math.max(elDeg, 0.5), -1.6364));
  function ensureIbl() {
    const P = S.pipe; if (!P || !P.ibl) return;
    if (!S.cur || !S.cur.skyData) return;
    const u = P.ibl.material.uniforms, rot = S.rot * D2R, g = S.ground; u.tSky.value = S.cur.skyData.tex; u.uRotC.value = Math.cos(rot); u.uRotS.value = Math.sin(rot); u.uGround.value.set(g[0], g[1], g[2]);
    pass(P.ibl.material, P.ibl.rt);
    if (!P.pmrem) { P.pmrem = new THREE.PMREMGenerator(S.renderer); }
    const old = S.envTarget; S.envTarget = P.pmrem.fromEquirectangular(P.ibl.rt.texture); if (old) old.dispose();
    S.cur.rig.scene.environment = S.envTarget.texture;
  }
  function applyLook() {
    const c = S.cur; if (!c || !c.skyData) return; const L = S.L, meta = c.skyData.meta, rig = c.rig, hs = meta.sun, hdrSunEl = hs ? hs.elevation : meta.glow ? meta.glow.elevation : 45, hdrSunAz = hs ? 90 - hs.azimuth : meta.glow ? 90 - meta.glow.azimuth : 120;
    // units: lux per unit from the sky illuminance of the map
    const skyUnits = meta.sky.E_h; S.lpu = L.skyLux / skyUnits; const lpu = S.lpu;
    // sun direction, irradiance (units), colour (unit luminance)
    const hasSun = L.sunLux > 0, el = S.sunEl, az = S.sunAz; S.rot = hdrSunAz - az;
    const dir = sunDirThree(az, el); rig.dir.copy(dir);
    let E = hasSun ? L.sunLux / lpu : 0, col = L.sunCol || (hs ? hs.color : [1, 0.97, 0.9]);
    if (hasSun && !L.sunCol && hs) { const dam = airmass(el) - airmass(hdrSunEl); E *= Math.exp(-0.14 * dam); col = [hs.color[0] * Math.exp(-0.03 * dam), hs.color[1] * Math.exp(-0.085 * dam), hs.color[2] * Math.exp(-0.17 * dam)]; }
    const cl = lumOf(col) || 1; const colN = [col[0] / cl, col[1] / cl, col[2] / cl]; S.sunCol = colN; S.sunE = E; S.skyE = meta.sky.E_h; env.sunDir = dir; env.sunDirENU = [dir.x, -dir.z, dir.y];
    const horiz = Math.max(0, Math.sin(el * D2R)), eAbove = el > 0 ? 1 : 0;
    rig.sunCol.setRGB(colN[0], colN[1], colN[2]); rig.sun[0].color.copy(rig.sunCol); rig.sun[0].intensity = (E / PI) * eAbove;
    // ground bounce colour: albedo * total horizontal irradiance / pi (units), slightly warm-neutral
    const eh = E * horiz + meta.sky.E_h, gAlb = S.groundAlbedo; S.ground = [gAlb * eh / PI * 1.0, gAlb * eh / PI * 0.97, gAlb * eh / PI * 0.9];
    // exposure (units -> display) from the camera EV100
    S.ev = L.ev; S.exposure = lpu / lwhite(L.ev);
    // sky dome uniforms
    const u = rig.skyMesh.material.uniforms; u.tSky.value = c.skyData.tex; u.uRotC.value = Math.cos(S.rot * D2R); u.uRotS.value = Math.sin(S.rot * D2R); u.uSunDir.value.copy(dir);
    const omega = 2 * PI * (1 - Math.cos(0.2665 * D2R)), Ldisc = (E / omega) * eAbove; u.uSunRad.value.set(Math.min(colN[0] * Ldisc, 2.5e4), Math.min(colN[1] * Ldisc, 2.5e4), Math.min(colN[2] * Ldisc, 2.5e4));
    if (L.moon) { const Lm = Math.min(E / omega, 2.5e4); u.uSunRad.value.set(colN[0] * Lm * 0.9, colN[1] * Lm * 0.9, colN[2] * Lm); }
    u.uStars.value = L.stars || 0; u.uMoon.value = L.moon ? 1 : 0; const hz = meta.sky.horizon; u.uHaze.value.set(hz[0], hz[1], hz[2]);
    // probe
    const shc = computeSH(meta, S.rot, S.ground); for (let i = 0; i < 9; i++) rig.probe.sh.coefficients[i].set(shc[i * 3], shc[i * 3 + 1], shc[i * 3 + 2]);
    ensureIbl();
    S.fade = 1;
    for (const f of S.listeners) { try { f(env); } catch (e) { console.warn(e); } }
  }

  /* ======================================================================== cascaded shadows ======================================================================== */
  let _r, _u, _c, _up;                                          // scratch vectors (created in init, THREE is loaded lazily)
  function fitCascades(cam, rig) {
    const n = S.quality === "low" ? 1 : 3, sp = n === 1 ? [0, 90] : [0, 14, 56, 230], dir = rig.dir, lights = rig.sun;
    if (!dir || !isFinite(dir.x)) return;
    const on = lights[0].intensity > 0;
    _r.crossVectors(_up, dir); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize(); _u.crossVectors(dir, _r).normalize();
    const camDir = new THREE.Vector3(); cam.getWorldDirection(camDir); const tanY = Math.tan((cam.fov * D2R) / 2), tanX = tanY * cam.aspect, k2 = tanX * tanX + tanY * tanY;
    for (let i = 0; i < 3; i++) {
      const L = lights[i];
      if (!on) { L.shadow.autoUpdate = false; continue; }
      if (i >= n) { const sc = L.shadow.camera; if (sc.right !== 1) { sc.left = -1; sc.right = 1; sc.top = 1; sc.bottom = -1; sc.updateProjectionMatrix(); L.position.set(0, 1e4, 0); L.target.position.set(0, 0, 0); } L.shadow.autoUpdate = false; continue; }
      const a = sp[i], b = sp[i + 1]; let zc = ((a + b) / 2) * (1 + k2); zc = Math.min(zc, b);
      const R = Math.sqrt(b * b * k2 + (b - zc) * (b - zc)) * 1.02 + 0.5;
      _c.copy(cam.position).addScaledVector(camDir, zc);
      const tex = (2 * R) / L.shadow.mapSize.x, cx = _c.dot(_r), cy = _c.dot(_u), sx = Math.round(cx / tex) * tex, sy = Math.round(cy / tex) * tex;
      _c.addScaledVector(_r, sx - cx).addScaledVector(_u, sy - cy);
      const back = 700 + R;                                    // casters up-sun (tall buildings, hills) must be inside the light frustum
      L.position.copy(_c).addScaledVector(dir, back); L.target.position.copy(_c); const sc = L.shadow.camera;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = back + R + 20; sc.updateProjectionMatrix();
      L.shadow.bias = -0.00025 * (i + 1); L.shadow.normalBias = Math.max(0.01, tex * 1.6);
      if (i === 0) L.shadow.autoUpdate = true;
      else { const key = sx.toFixed(3) + "|" + sy.toFixed(3) + "|" + R.toFixed(2) + "|" + dir.x.toFixed(4) + dir.y.toFixed(4) + dir.z.toFixed(4); L.shadow.autoUpdate = false; if (L.userData.key !== key || S.frame - (L.userData.fr || 0) > 12 || !L.shadow.map) { L.userData.key = key; L.userData.fr = S.frame; L.shadow.needsUpdate = true; } }
    }
  }
  function setShadowSize(rig, size) {
    rig.sun.forEach((l, i) => { const s = size[i] || size[size.length - 1]; if (l.shadow.mapSize.x !== s) { l.shadow.mapSize.set(s, s); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } } });
  }

  /* ======================================================================== pipeline ======================================================================== */
  const DEPTH_FUNCS = `uniform mat4 uProjInv; uniform sampler2D tDepth;
    vec3 vpos( vec2 uv ) { float d = texture2D( tDepth, uv ).x; vec4 c = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); return c.xyz / c.w; }`;
  const AO_FRAG = `${DEPTH_FUNCS} uniform vec2 uRes; uniform float uRadius, uProjScale, uIntensity, uInvR6, uTime; uniform int uN; varying vec2 vUv;
    vec3 vposS( vec2 uv ) { return vpos( ( floor( uv * uRes + 0.25 ) + 0.5 ) / uRes ); }
    float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
    void main() {
      float d0 = texture2D( tDepth, vUv ).x; if ( d0 >= 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
      vec3 P = vposS( vUv ); vec2 px = 1.0 / uRes;
      vec3 Pr = vposS( vUv + vec2( px.x, 0.0 ) ), Pl = vposS( vUv - vec2( px.x, 0.0 ) ), Pu = vposS( vUv + vec2( 0.0, px.y ) ), Pd = vposS( vUv - vec2( 0.0, px.y ) );
      vec3 dx = abs( Pr.z - P.z ) < abs( Pl.z - P.z ) ? Pr - P : P - Pl; vec3 dy = abs( Pu.z - P.z ) < abs( Pd.z - P.z ) ? Pu - P : P - Pd;
      vec3 N = normalize( cross( dx, dy ) ); if ( dot( N, -P ) < 0.0 ) N = -N;
      float rpx = min( uRadius * uProjScale / max( -P.z, 0.2 ), 120.0 ); float ang0 = 6.2831853 * ign( gl_FragCoord.xy + uTime * 17.0 ); float occ = 0.0;
      for ( int i = 0; i < 16; i ++ ) {
        if ( i >= uN ) break; float a = ( float( i ) + 0.5 ) / float( uN ); float ang = ang0 + a * 6.2831853 * 3.4;
        vec2 uvS = vUv + vec2( cos( ang ), sin( ang ) ) * ( a * rpx ) * px; vec3 v = vposS( uvS ) - P; float vv = dot( v, v );
        float f = max( uRadius * uRadius - vv, 0.0 ); occ += f * f * f * max( ( dot( v, N ) - 0.02 * uRadius - 0.004 * -P.z ) / ( 0.01 + vv ), 0.0 );
      }
      occ *= uInvR6 * ( 5.0 / float( uN ) ) * uIntensity; gl_FragColor = vec4( vec3( clamp( 1.0 - occ, 0.0, 1.0 ) ), 1.0 );
    }`;
  const BLUR_FRAG = `uniform sampler2D tAO, tDepth; uniform vec2 uStep; uniform float uPA, uPB; varying vec2 vUv;
    float lin( vec2 uv ) { return uPB / ( texture2D( tDepth, uv ).x * 2.0 - 1.0 + uPA ); }
    void main() {
      float dc = lin( vUv ); float sum = texture2D( tAO, vUv ).r * 3.0, ws = 3.0;
      for ( int i = -3; i <= 3; i ++ ) { if ( i == 0 ) continue; vec2 uv = vUv + uStep * float( i ); float w = ( 1.0 - abs( float( i ) ) / 4.0 ) * exp( -abs( lin( uv ) - dc ) / ( 0.04 * dc + 0.05 ) ); sum += texture2D( tAO, uv ).r * w; ws += w; }
      gl_FragColor = vec4( vec3( sum / ws ), 1.0 );
    }`;
  const HAZE_FRAG = `uniform sampler2D tSky; uniform float uRotC, uRotS; varying vec2 vUv;
    ${EQ}
    void main() {
      float az = ( vUv.x - 0.5 ) * 6.2831853, el = ( vUv.y - 0.5 ) * 3.1415927; vec3 acc = vec3( 0.0 );
      for ( int i = -3; i <= 3; i ++ ) for ( int j = -2; j <= 2; j ++ ) { float a = az + float( i ) * 0.07, e = clamp( el + float( j ) * 0.07, -1.5, 1.5 ); vec3 d = vec3( cos( e ) * cos( a ), sin( e ), cos( e ) * sin( a ) ); acc += texture2D( tSky, eqUv( rotY( d, uRotC, uRotS ) ) ).rgb; }
      gl_FragColor = vec4( min( acc / 35.0, vec3( 30.0 ) ), 1.0 );
    }`;
  const COMP_FRAG = `${DEPTH_FUNCS} ${EQ}
    uniform sampler2D tColor, tAO, tHaze; uniform mat4 uCamWorld; uniform vec3 uCamPos, uSunDir, uSunCol; uniform float uBeta, uH, uAOk, uRotC, uRotS, uSunK; varying vec2 vUv;
    void main() {
      vec3 col = texture2D( tColor, vUv ).rgb; float d01 = texture2D( tDepth, vUv ).x;
      if ( d01 < 1.0 ) {
        vec3 v = vpos( vUv ); float dist = length( v ); vec3 dirW = normalize( ( uCamWorld * vec4( v, 0.0 ) ).xyz );
        float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ); float ao = texture2D( tAO, vUv ).r; float w = uAOk * ( 1.0 - 0.55 * smoothstep( 0.6, 2.2, lum ) ); col *= mix( 1.0, ao, w );
        float dd = dist + max( 0.0, dist - 2500.0 ) * 2.0, dy = dirW.y, k = dy / uH, h0 = exp( -max( uCamPos.y, 0.0 ) / uH );
        float tau = uBeta * h0 * ( abs( k * dd ) < 1e-3 ? dd : ( 1.0 - exp( -k * dd ) ) / k ); float T = exp( -tau );
        vec3 hz = texture2D( tHaze, eqUv( rotY( dirW, uRotC, uRotS ) ) ).rgb;
        float g = 0.62, ct = dot( dirW, uSunDir ), ph = ( 1.0 - g * g ) / ( 12.566 * pow( 1.0 + g * g - 2.0 * g * ct, 1.5 ) ); hz += uSunCol * ph * uSunK;
        col = col * T + hz * ( 1.0 - T );
      }
      gl_FragColor = vec4( col, 1.0 );
    }`;
  const BPRE_FRAG = `uniform sampler2D tColor; uniform float uExp, uThr; uniform vec2 uTexel; varying vec2 vUv;
    vec3 tap( vec2 o ) { return min( texture2D( tColor, vUv + o * uTexel ).rgb * uExp, vec3( 60.0 ) ); }
    void main() {
      vec3 s = tap( vec2( -1.0, -1.0 ) ) + tap( vec2( 1.0, -1.0 ) ) + tap( vec2( -1.0, 1.0 ) ) + tap( vec2( 1.0, 1.0 ) ); s *= 0.25;
      float l = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) ); float w = max( l - uThr, 0.0 ) / max( l, 1e-3 ); gl_FragColor = vec4( s * w / uExp, 1.0 );
    }`;
  const BDOWN_FRAG = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
    void main() { vec3 c = texture2D( tSrc, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb + texture2D( tSrc, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb + texture2D( tSrc, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb + texture2D( tSrc, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb; gl_FragColor = vec4( c * 0.25, 1.0 ); }`;
  const BUP_FRAG = `uniform sampler2D tCur, tLow; uniform vec2 uTexel; uniform float uW; varying vec2 vUv;
    void main() {
      vec3 l = texture2D( tLow, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb + texture2D( tLow, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb + texture2D( tLow, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb + texture2D( tLow, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
      l += 2.0 * ( texture2D( tLow, vUv + uTexel * vec2( 0.0, 1.0 ) ).rgb + texture2D( tLow, vUv + uTexel * vec2( 0.0, -1.0 ) ).rgb + texture2D( tLow, vUv + uTexel * vec2( 1.0, 0.0 ) ).rgb + texture2D( tLow, vUv + uTexel * vec2( -1.0, 0.0 ) ).rgb ) + 4.0 * texture2D( tLow, vUv ).rgb;
      gl_FragColor = vec4( texture2D( tCur, vUv ).rgb + l * ( 1.0 / 16.0 ) * uW, 1.0 );
    }`;
  const FXAA_FRAG = `uniform sampler2D tSrc; uniform vec2 uRcp; varying vec2 vUv;
    void main() {
      vec3 lumaV = vec3( 0.299, 0.587, 0.114 );
      vec3 cNW = texture2D( tSrc, vUv + vec2( -1.0, -1.0 ) * uRcp ).rgb, cNE = texture2D( tSrc, vUv + vec2( 1.0, -1.0 ) * uRcp ).rgb, cSW = texture2D( tSrc, vUv + vec2( -1.0, 1.0 ) * uRcp ).rgb, cSE = texture2D( tSrc, vUv + vec2( 1.0, 1.0 ) * uRcp ).rgb, cM = texture2D( tSrc, vUv ).rgb;
      float lNW = dot( cNW, lumaV ), lNE = dot( cNE, lumaV ), lSW = dot( cSW, lumaV ), lSE = dot( cSE, lumaV ), lM = dot( cM, lumaV );
      float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) ), lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
      vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( ( lNW + lSW ) - ( lNE + lSE ) ) );
      float dirReduce = max( ( lNW + lNE + lSW + lSE ) * 0.03125, 0.0078125 ); float rcpMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );
      dir = clamp( dir * rcpMin, -8.0, 8.0 ) * uRcp;
      vec3 rgbA = 0.5 * ( texture2D( tSrc, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb + texture2D( tSrc, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
      vec3 rgbB = rgbA * 0.5 + 0.25 * ( texture2D( tSrc, vUv + dir * -0.5 ).rgb + texture2D( tSrc, vUv + dir * 0.5 ).rgb ); float lB = dot( rgbB, lumaV );
      gl_FragColor = vec4( ( lB < lMin || lB > lMax ) ? rgbA : rgbB, 1.0 );
    }`;
  const TONE_FUNCS = `
    const mat3 ACESInputMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
    const mat3 ACESOutputMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
    vec3 RRTAndODTFit( vec3 v ) { vec3 a = v * ( v + 0.0245786 ) - 0.000090537; vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081; return a / b; }
    vec3 toneACES( vec3 c ) { c *= 1.0 / 0.6; c = ACESInputMat * c; c = RRTAndODTFit( c ); c = ACESOutputMat * c; return clamp( c, 0.0, 1.0 ); }
    const mat3 LIN2REC2020 = mat3( vec3( 0.6274, 0.0691, 0.0164 ), vec3( 0.3293, 0.9195, 0.0880 ), vec3( 0.0433, 0.0113, 0.8956 ) );
    const mat3 REC20202LIN = mat3( vec3( 1.6605, -0.1246, -0.0182 ), vec3( -0.5876, 1.1329, -0.1006 ), vec3( -0.0728, -0.0083, 1.1187 ) );
    const mat3 AgXInset = mat3( vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ), vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ), vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 ) );
    const mat3 AgXOutset = mat3( vec3( 1.1271005818144368, -0.1413297634984383, -0.14132976349843826 ), vec3( -0.11060664309660323, 1.157823702216272, -0.11060664309660294 ), vec3( -0.016493938717834573, -0.016493938717834257, 1.2519364065950405 ) );
    vec3 agxContrast( vec3 x ) { vec3 x2 = x * x; vec3 x4 = x2 * x2; return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
    vec3 toneAgX( vec3 c ) { c *= 1.0 / 0.6; c = LIN2REC2020 * c; c = AgXInset * c; c = max( c, 1e-10 ); c = log2( c ); c = ( c + 12.47393 ) / ( 4.026069 + 12.47393 ); c = clamp( c, 0.0, 1.0 ); c = agxContrast( c ); c = AgXOutset * c; c = pow( max( vec3( 0.0 ), c ), vec3( 2.2 ) ); c = REC20202LIN * c; return clamp( c, 0.0, 1.0 ); }
    vec3 toneNeutral( vec3 c ) { const float sc = 0.8 - 0.04; const float ds = 0.15; float x = min( c.r, min( c.g, c.b ) ); float offset = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= offset; float peak = max( c.r, max( c.g, c.b ) ); if ( peak < sc ) return c; float d = 1.0 - sc; float np = 1.0 - d * d / ( peak + d - sc ); c *= np / peak; float g = 1.0 - 1.0 / ( ds * ( peak - np ) + 1.0 ); return mix( c, vec3( np ), g ); }
    vec3 toSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 0.41666667 ) ) - 0.055, step( 0.0031308, c ) ); }`;
  const FINAL_FRAG = `uniform sampler2D tColor, tBloom; uniform float uExposure, uBloom, uVig, uSat, uTone, uScot, uFade, uTime, uContrast; uniform vec2 uRes; varying vec2 vUv;
    ${TONE_FUNCS}
    float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
    void main() {
      vec3 c = texture2D( tColor, vUv ).rgb; c += texture2D( tBloom, vUv ).rgb * uBloom; c *= uExposure * uFade;
      vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y; c *= 1.0 - uVig * smoothstep( 0.25, 1.15, length( q ) );
      float y = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      if ( uScot > 0.0 ) { float t = uScot * ( 1.0 - smoothstep( 0.002, 0.08, y ) ); c = mix( c, vec3( y ) * vec3( 0.80, 0.95, 1.25 ), t ); }      // scotopic: dark scenes lose colour and drift blue
      c = mix( vec3( y ), c, uSat );
      c = uTone < 0.5 ? toneACES( c ) : uTone < 1.5 ? toneAgX( c ) : toneNeutral( c );
      c = mix( c, c * c * ( 3.0 - 2.0 * c ), uContrast ); c = toSRGB( clamp( c, 0.0, 1.0 ) ); c += ( hash12( gl_FragCoord.xy + fract( uTime ) * 61.0 ) - 0.5 ) * ( 1.5 / 255.0 );
      gl_FragColor = vec4( c, 1.0 );
    }`;
  const QUAL = { high: { scale: 1, shadow: [2048, 2048, 2048], ao: 12, bloom: 5, fxaa: true, aoHalf: true, casc: 3 }, medium: { scale: 1, shadow: [2048, 2048, 1024], ao: 8, bloom: 4, fxaa: true, aoHalf: true, casc: 3 },
    low: { scale: 0.8, shadow: [2048], ao: 0, bloom: 0, fxaa: true, aoHalf: true, casc: 1 }, off: { scale: 1, shadow: [2048], ao: 0, bloom: 0, fxaa: false, aoHalf: true, casc: 1 } };
  const QORDER = ["high", "medium", "low", "off"];
  const rt8 = () => ({ type: THREE.UnsignedByteType });
  function buildPipe(w, h, q) {
    const P = { w, h, q }, aw = Math.max(8, w >> 1), ah = Math.max(8, h >> 1);
    P.scene = new THREE.WebGLRenderTarget(w, h, rtOpts({ depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    P.scene.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); P.scene.depthTexture.minFilter = P.scene.depthTexture.magFilter = THREE.NearestFilter;
    P.shaded = new THREE.WebGLRenderTarget(w, h, rtOpts({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
    P.ao = [0, 1].map(() => new THREE.WebGLRenderTarget(aw, ah, rtOpts(rt8()))); P.ldr = new THREE.WebGLRenderTarget(w, h, rtOpts(Object.assign(rt8(), { minFilter: THREE.LinearFilter })));
    P.down = []; P.up = []; for (let i = 0, ww = aw, hh = ah; i < 5; i++, ww = Math.max(2, ww >> 1), hh = Math.max(2, hh >> 1)) { P.down.push(new THREE.WebGLRenderTarget(ww, hh, rtOpts())); P.up.push(new THREE.WebGLRenderTarget(ww, hh, rtOpts())); }
    const V2 = () => ({ value: new THREE.Vector2() }), M4 = () => ({ value: new THREE.Matrix4() }), V3 = () => ({ value: new THREE.Vector3() });
    P.mAO = mat(AO_FRAG, { tDepth: { value: P.scene.depthTexture }, uProjInv: M4(), uRes: { value: new THREE.Vector2(w, h) }, uRadius: { value: 1.2 }, uProjScale: { value: 1 }, uIntensity: { value: 1.4 }, uInvR6: { value: 1 }, uTime: { value: 0 }, uN: { value: 12 } });
    P.mBlur = mat(BLUR_FRAG, { tAO: { value: null }, tDepth: { value: P.scene.depthTexture }, uStep: V2(), uPA: { value: 0 }, uPB: { value: 0 } });
    P.mComp = mat(COMP_FRAG, { tColor: { value: P.scene.texture }, tDepth: { value: P.scene.depthTexture }, tAO: { value: P.ao[0].texture }, tHaze: { value: null }, uProjInv: M4(), uCamWorld: M4(), uCamPos: V3(), uSunDir: V3(), uSunCol: V3(), uBeta: { value: 1e-4 }, uH: { value: 1500 }, uAOk: { value: 1 }, uRotC: { value: 1 }, uRotS: { value: 0 }, uSunK: { value: 0 } });
    P.mBpre = mat(BPRE_FRAG, { tColor: { value: P.shaded.texture }, uExp: { value: 1 }, uThr: { value: 1 }, uTexel: V2() }); P.mBdown = mat(BDOWN_FRAG, { tSrc: { value: null }, uTexel: V2() }); P.mBup = mat(BUP_FRAG, { tCur: { value: null }, tLow: { value: null }, uTexel: V2(), uW: { value: 1 } });
    P.final = mat(FINAL_FRAG, { tColor: { value: P.shaded.texture }, tBloom: { value: P.up[0].texture }, uExposure: { value: 1 }, uBloom: { value: 0.1 }, uVig: { value: 0.15 }, uSat: { value: 1 }, uTone: { value: 1 }, uScot: { value: 0 }, uFade: { value: 1 }, uTime: { value: 0 }, uContrast: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) } });
    P.mFxaa = mat(FXAA_FRAG, { tSrc: { value: P.ldr.texture }, uRcp: { value: new THREE.Vector2(1 / w, 1 / h) } });
    return P;
  }
  function disposePipe(P) { for (const k of ["scene", "shaded", "ldr"]) P[k].dispose(); P.scene.depthTexture.dispose(); [...P.ao, ...P.down, ...P.up].forEach((t) => t.dispose()); for (const k of Object.keys(P)) if (P[k] && P[k].isShaderMaterial) P[k].dispose(); }
  function makeIbl() { return { rt: new THREE.WebGLRenderTarget(512, 256, rtOpts()), material: mat(IBL_FRAG, { tSky: { value: null }, uRotC: { value: 1 }, uRotS: { value: 0 }, uGround: { value: new THREE.Vector3(0.3, 0.3, 0.3) } }), haze: new THREE.WebGLRenderTarget(64, 32, rtOpts({ wrapS: THREE.RepeatWrapping })), hazeMat: mat(HAZE_FRAG, { tSky: { value: null }, uRotC: { value: 1 }, uRotS: { value: 0 } }) }; }
  function ensurePipe(renderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2()), q = QUAL[S.quality] || QUAL.high, sc = q.scale * (S.dyn || 1), w = Math.max(16, Math.round(size.x * sc)), h = Math.max(16, Math.round(size.y * sc));
    if (!S.pipe || S.pipe.w !== w || S.pipe.h !== h) { const old = S.pipe; const P = buildPipe(w, h, S.quality); if (old) { P.ibl = old.ibl; P.pmrem = old.pmrem; disposePipe(old); } else P.ibl = makeIbl(); S.pipe = P; }
    return S.pipe;
  }
  function updateHaze() {
    const P = S.pipe; if (!P || !P.ibl || !S.cur || !S.cur.skyData) return; const u = P.ibl.hazeMat.uniforms, rot = S.rot * D2R; u.tSky.value = S.cur.skyData.tex; u.uRotC.value = Math.cos(rot); u.uRotS.value = Math.sin(rot); pass(P.ibl.hazeMat, P.ibl.haze);
  }

  /* ======================================================================== ground, terrain, backdrop ======================================================================== */
  const mkRng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const segDist = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9, t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1); return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y); };
  function shapeOf(ring, holes) { const sh = new THREE.Shape(ring.map((p) => new THREE.Vector2(p[0], p[1]))); (holes || []).forEach((h) => sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))))); return sh; }
  /* quads on the ground (list of [x0, y0, x1, y1, x2, y2, x3, y3] in lab metres, height y) merged into one geometry; uv = metres */
  function quadsGeo(list, y) {
    const pos = new Float32Array(list.length * 18), uv = new Float32Array(list.length * 12), nrm = new Float32Array(list.length * 18); let o = 0, u = 0;
    for (const q of list) { const idx = [0, 1, 2, 0, 2, 3]; for (const i of idx) { pos[o] = q[i * 2]; pos[o + 1] = y; pos[o + 2] = -q[i * 2 + 1]; nrm[o + 1] = 1; o += 3; uv[u++] = q[i * 2]; uv[u++] = q[i * 2 + 1]; } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); return g;
  }
  const strip = (a, b, hw) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, px = (-dy / L) * hw, py = (dx / L) * hw; return [a[0] - px, a[1] - py, b[0] - px, b[1] - py, b[0] + px, b[1] + py, a[0] + px, a[1] + py]; };

  function terrainFor(sc) {
    const S0 = sc.size; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const b of sc.blocks || []) for (const p of b.ring) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (x0 > x1) { x0 = -30; y0 = -30; x1 = S0 + 30; y1 = S0 + 30; }
    const rays = [], segs = []; const EXT = 7000;
    for (const r of sc.roads || []) {
      const L = r.line, w = r.width; for (let k = 0; k + 1 < L.length; k++) segs.push({ a: L[k], b: L[k + 1], w });
      for (const [p, q] of [[L[0], L[1]], [L[L.length - 1], L[L.length - 2]]]) { const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1, d = [dx / l, dy / l], far = [p[0] + d[0] * EXT, p[1] + d[1] * EXT]; if (p[0] < x0 - 5 || p[0] > x1 + 5 || p[1] < y0 - 5 || p[1] > y1 + 5 || true) { segs.push({ a: p, b: far, w }); rays.push({ x: p[0], y: p[1], dx: d[0], dy: d[1], w, ext: true }); } }
    }
    const rnd = mkRng((sc.seed | 0) * 7919 + 17), waves = []; for (let i = 0; i < 9; i++) { const th = rnd() * 6.283, sc2 = 320 + 900 * rnd(); waves.push([Math.cos(th) * 6.283 / sc2, Math.sin(th) * 6.283 / sc2, rnd() * 6.283, 0.3 + 0.7 * rnd()]); }
    const nz = (x, y) => { let v = 0, a = 0; for (const w of waves) { v += w[3] * Math.sin(w[0] * x + w[1] * y + w[2]); a += w[3]; } return v / a; };
    const outside = (x, y) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
    const roadD = (x, y) => { let m = 1e9, hw = 5; for (const s of segs) { const d = segDist(x, y, s.a, s.b) - s.w / 2; if (d < m) { m = d; } } return m; };
    const h = (x, y) => {
      const d = outside(x, y), ramp = smooth(160, 1500, d), hill = ramp * 78 * (0.35 + 0.65 * clamp(nz(x, y) * 0.9 + 0.55, 0, 1.2)), base = 0.11 * (1 - smooth(0, 90, d)) - 0.0;
      const c = smooth(2.5, 90, roadD(x, y)); return -0.03 + (base + hill + 0.03) * c;
    };
    return { h, rays, segs, box: [x0, y0, x1, y1], roadD, outside, rnd, nz };
  }
  function terrainMesh(T, cx, cy) {
    const axis = (c) => { const a = [c], inner = 300, step = 20; for (let p = step; p <= inner; p += step) { a.unshift(c - p); a.push(c + p); } let s = 24, lo = c - inner, hi = c + inner; for (let i = 0; i < 40 && hi - c < 7000; i++) { lo -= s; hi += s; a.unshift(lo); a.push(hi); s *= 1.12; } return a; };
    const xs = axis(cx), ys = axis(cy), nx = xs.length, ny = ys.length, pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), idx = [];
    const fld = (x, y) => T.nz(x * 1.9 + 31, y * 1.9 - 17) * 0.5 + 0.5;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], y = ys[j], k = j * nx + i, hh = T.h(x, y); pos[k * 3] = x; pos[k * 3 + 1] = hh - Math.max(0, Math.hypot(x - cx, y - cy) - 4200) * 0.004; pos[k * 3 + 2] = -y;
      const f = fld(x, y), d = T.outside(x, y), forest = smooth(0.55, 0.7, f) * smooth(60, 300, d), field = smooth(0.35, 0.2, f) * smooth(60, 400, d), g = 1 - 0.45 * forest + 0.12 * field;
      col[k * 3] = g * (1 + 0.25 * field); col[k * 3 + 1] = g * (1 + 0.05 * field - 0.05 * forest); col[k * 3 + 2] = g * (1 - 0.12 * field); uv[k * 2] = x; uv[k * 2 + 1] = y;
    }
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  /* facade atlas (4 x 4 cells, each = 6 m x 3.3 m): cell 0 blank wall, 1..15 window variants; a second atlas holds the lit windows (night) */
  function facadeAtlas() {
    if (facadeAtlas.t) return facadeAtlas.t; const N = 4, C = 64, mk = () => { const c = document.createElement("canvas"); c.width = c.height = N * C; return c; }, a = mk(), b = mk(), ga = a.getContext("2d"), gb = b.getContext("2d"), r = mkRng(5);
    ga.fillStyle = "#fff"; ga.fillRect(0, 0, N * C, N * C); gb.fillStyle = "#000"; gb.fillRect(0, 0, N * C, N * C);
    for (let k = 0; k < N * N; k++) {
      const ox = (k % N) * C, oy = Math.floor(k / N) * C; ga.fillStyle = "rgba(0,0,0,0.04)"; ga.fillRect(ox, oy + C - 3, C, 3);
      if (k === 0) continue; for (let wi = 0; wi < 2; wi++) {
        const wx = ox + 6 + wi * 32, wy = oy + 14, ww = 20, wh = 33, lit = r() < 0.35; ga.fillStyle = "#2c3a46"; ga.fillRect(wx, wy, ww, wh); ga.fillStyle = "rgba(255,255,255,.18)"; ga.fillRect(wx, wy, ww, 8); ga.strokeStyle = "#e8e6df"; ga.lineWidth = 2; ga.strokeRect(wx, wy, ww, wh);
        if (lit) { gb.fillStyle = r() < 0.5 ? "#ffd9a0" : "#fff0cc"; gb.fillRect(wx + 1, wy + 1, ww - 2, wh - 2); }
      }
    }
    const mkT = (c, enc) => { const t = new THREE.CanvasTexture(c); t.encoding = enc; t.anisotropy = 4; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
    return (facadeAtlas.t = { map: mkT(a, THREE.sRGBEncoding), emi: mkT(b, THREE.sRGBEncoding), N });
  }
  /* distant building masses: one merged mesh of wall cells (6 m x 3.3 m) + roofs; kinds follow the scene type */
  function buildMasses(list) {
    const A = facadeAtlas(), pos = [], uv = [], col = [], nrm = [], N = A.N, rnd = mkRng(99);
    const quad = (p, n, c, cell) => { const u0 = (cell % N) / N, v0 = 1 - (Math.floor(cell / N) + 1) / N, du = 1 / N; const uvs = [[u0, v0], [u0 + du, v0], [u0 + du, v0 + du], [u0, v0 + du]]; for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...p[i]); nrm.push(...n); col.push(...c); uv.push(...uvs[i]); } };
    for (const b of list) {
      const { x, y, w, d, h, yaw, wall, roof, gable } = b, c = Math.cos(yaw), s = Math.sin(yaw), P = (lx, ly, z) => [x + lx * c - ly * s, z, -(y + lx * s + ly * c)], hw = w / 2, hd = d / 2, nSt = Math.max(1, Math.round(h / 3.3)), sh = h / nSt;
      const sides = [[-hw, -hd, hw, -hd, 0, -1], [hw, -hd, hw, hd, 1, 0], [hw, hd, -hw, hd, 0, 1], [-hw, hd, -hw, -hd, -1, 0]];
      for (const [ax, ay, bx, by, nx, ny] of sides) {
        const L = Math.hypot(bx - ax, by - ay), nc = Math.max(1, Math.round(L / 6)), nW = [nx * c - ny * s, 0, -(nx * s + ny * c)];
        for (let i = 0; i < nc; i++) for (let j = 0; j < nSt; j++) { const t0 = i / nc, t1 = (i + 1) / nc, px0 = ax + (bx - ax) * t0, py0 = ay + (by - ay) * t0, px1 = ax + (bx - ax) * t1, py1 = ay + (by - ay) * t1, z0 = j * sh, z1 = (j + 1) * sh;
          quad([P(px0, py0, z0), P(px1, py1, z0), P(px1, py1, z1), P(px0, py0, z1)], nW, wall, j === 0 && b.shop ? 0 : 1 + Math.floor(rnd() * 15)); }
      }
      if (gable) { const rh = Math.min(hw, hd) * 0.55 + 0.6, ridgeX = hw >= hd; const r0 = ridgeX ? P(-hw, 0, h + rh) : P(0, -hd, h + rh), r1 = ridgeX ? P(hw, 0, h + rh) : P(0, hd, h + rh), c0 = P(-hw, -hd, h), c1 = P(hw, -hd, h), c2 = P(hw, hd, h), c3 = P(-hw, hd, h);
        const up = (a, b2, c2_) => { const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = c2_[0] - a[0], vy = c2_[1] - a[1], vz = c2_[2] - a[2]; const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n) || 1; return n.map((v) => (n[1] < 0 ? -v : v) / l); };
        const tri = (a, b2, c2_) => { const n = up(a, b2, c2_); for (const p of [a, b2, c2_]) { pos.push(...p); nrm.push(...n); col.push(...roof); uv.push(0.05, 0.05); } };
        if (ridgeX) { tri(c0, c1, r1); tri(c0, r1, r0); tri(c3, r0, r1); tri(c3, r1, c2); tri(c0, r0, c3); tri(c1, c2, r1); } else { tri(c0, c1, r1); tri(c0, r1, r0); tri(c1, c2, r1); tri(c0, r0, c3); tri(c3, r0, r1); tri(c3, r1, c2); }
      } else quad([P(-hw, -hd, h), P(hw, -hd, h), P(hw, hd, h), P(-hw, hd, h)], [0, 1, 0], roof, 0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.MeshStandardMaterial({ map: A.map, emissiveMap: A.emi, emissive: new THREE.Color(0, 0, 0), vertexColors: true, roughness: 0.9, metalness: 0 }); const mesh = new THREE.Mesh(g, m); mesh.name = "es-masses"; mesh.frustumCulled = false; mesh.userData.masses = true; return mesh;
  }
  function treeCards(list) {
    if (!list.length) return null; const cv = document.createElement("canvas"); cv.width = cv.height = 128; const g = cv.getContext("2d"), r = mkRng(3);
    g.clearRect(0, 0, 128, 128); g.fillStyle = "#4a3a2a"; g.fillRect(60, 80, 8, 48);
    for (let i = 0; i < 70; i++) { const a = r() * 6.283, rr = Math.sqrt(r()) * 38, x = 64 + Math.cos(a) * rr * 0.95, y = 52 + Math.sin(a) * rr * 0.85, rad = 9 + r() * 12, sh = 0.55 + 0.45 * (1 - (y - 14) / 76) * 0.8 + 0.25 * r(); g.fillStyle = `rgb(${Math.round(52 * sh + 8)},${Math.round(98 * sh + 12)},${Math.round(40 * sh + 6)})`; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0); const q2 = quad.clone(); q2.rotateY(Math.PI / 2); const geo = THREE.BufferGeometryUtils ? null : null;
    const pos = [], uv = [], nrm = [], idx = []; for (let k = 0; k < 2; k++) { const base = k * 4, src = k ? q2 : quad, P = src.attributes.position, U = src.attributes.uv; for (let i = 0; i < 4; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); uv.push(U.getX(i), U.getY(i)); nrm.push(0, 1, 0); } idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); gg.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3)); gg.setIndex(idx);
    const mt = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0, envMapIntensity: 1 }); const im = new THREE.InstancedMesh(gg, mt, list.length), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
    list.forEach((t, i) => { e.set(0, t.rot, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(t.x, t.z, -t.y), q, new THREE.Vector3(t.w, t.h, t.w)); im.setMatrixAt(i, M); c.setRGB(t.g * (0.85 + 0.3 * t.v), t.g * (0.9 + 0.2 * t.v), t.g * (0.8 + 0.3 * (1 - t.v))); im.setColorAt(i, c); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.name = "es-farTrees"; im.userData.dyn = true; return im;
  }
  /* what the surroundings look like per scene type: house / block / tower / shed rows along the continued roads, forest belts, street trees */
  const SURR = {
    suburb: { row: { kind: "house", w: [8, 13], d: [7, 10], h: [4.5, 7], gap: [10, 26], setback: 15, occ: 0.85, maxLen: 900 }, towers: 0, forest: 1800, density: 0.9 },
    courtyard: { row: { kind: "block", w: [26, 46], d: [12, 15], h: [14, 26], gap: [8, 20], setback: 22, occ: 0.75, maxLen: 1100 }, towers: 10, forest: 1400, density: 0.55 },
    mainstreet: { row: { kind: "mid", w: [14, 26], d: [14, 22], h: [9, 38], gap: [0, 3], setback: 9, occ: 0.92, maxLen: 1300, shop: true }, towers: 90, forest: 700, density: 0.25 },
    campus: { row: { kind: "campus", w: [30, 52], d: [14, 20], h: [10, 18], gap: [24, 60], setback: 40, occ: 0.45, maxLen: 900 }, towers: 6, forest: 2000, density: 1.2 },
    industrial: { row: { kind: "shed", w: [36, 80], d: [20, 34], h: [7, 12], gap: [14, 40], setback: 30, occ: 0.7, maxLen: 1400, gable: true }, towers: 14, forest: 1000, density: 0.5 },
  };
  const WALLS = { house: [[0.86, 0.80, 0.70], [0.78, 0.74, 0.68], [0.70, 0.46, 0.38], [0.82, 0.78, 0.60], [0.72, 0.76, 0.82]], block: [[0.72, 0.52, 0.42], [0.80, 0.78, 0.72], [0.66, 0.68, 0.72]], mid: [[0.70, 0.52, 0.42], [0.78, 0.76, 0.70], [0.58, 0.64, 0.72], [0.82, 0.80, 0.76]], campus: [[0.72, 0.46, 0.36], [0.80, 0.78, 0.72]], shed: [[0.72, 0.74, 0.76], [0.80, 0.82, 0.82], [0.62, 0.66, 0.70]], tower: [[0.62, 0.70, 0.78], [0.70, 0.72, 0.74], [0.55, 0.60, 0.66]] };
  const ROOFS = [[0.28, 0.27, 0.27], [0.36, 0.22, 0.18], [0.40, 0.40, 0.42], [0.30, 0.30, 0.34]];
  function backdrop(scn, A, T) {
    const sc = A.scene, cfg = SURR[A.name] || SURR.suburb, rnd = mkRng((sc.seed | 0) * 31 + A.name.length * 977 + 5), out = [], masses = [], trees = [], R = cfg.row, [bx0, by0, bx1, by1] = T.box;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)], ur = (a) => a[0] + (a[1] - a[0]) * rnd();
    const nearRegion = (x, y, m) => T.outside(x, y) < m;
    for (const ray of T.rays) {
      const nx = -ray.dy, ny = ray.dx;
      for (const side of [-1, 1]) {
        let s = 55 + rnd() * 20; const end = Math.min(R.maxLen, 4000);
        while (s < end) {
          const w = ur(R.w), d = ur(R.d), h = ur(R.h) * (R.kind === "mid" ? 0.6 + 0.9 * Math.pow(rnd(), 2.2) * (1 + s / 900) : 1), off = ray.w / 2 + R.setback + d / 2, x = ray.x + ray.dx * (s + w / 2) + nx * side * off, y = ray.y + ray.dy * (s + w / 2) + ny * side * off;
          if (rnd() < R.occ && !nearRegion(x, y, 35) && T.roadD(x, y) > d / 2 + 6) { const yaw = Math.atan2(ray.dy, ray.dx), pal = WALLS[R.kind] || WALLS.house; masses.push({ x, y, w, d, h, yaw, wall: pick(pal), roof: pick(ROOFS), gable: R.gable || R.kind === "house", shop: R.shop }); }
          s += w + ur(R.gap);
        }
        // street trees continue outward
        if (R.kind !== "shed") for (let t = 60; t < 520; t += 14 + rnd() * 6) { const o = ray.w / 2 + 6 + rnd() * 2, x = ray.x + ray.dx * t + nx * side * o, y = ray.y + ray.dy * t + ny * side * o; if (!nearRegion(x, y, 30)) trees.push({ x, y, z: T.h(x, y) - 0.3, w: 6 + rnd() * 4, h: 8 + rnd() * 5, rot: rnd() * 3.14, g: 0.9, v: rnd() }); }
      }
    }
    // towers / mid-rise ring (skyline)
    for (let i = 0; i < cfg.towers; i++) { const a = rnd() * 6.283, r = 650 + rnd() * 1500, x = (bx0 + bx1) / 2 + Math.cos(a) * r, y = (by0 + by1) / 2 + Math.sin(a) * r; if (T.roadD(x, y) < 30) continue; const tall = A.name === "mainstreet" ? 30 + rnd() * 90 : 14 + rnd() * 30; masses.push({ x, y, w: 22 + rnd() * 30, d: 22 + rnd() * 30, h: tall, yaw: rnd() * 3, wall: pick(WALLS.tower), roof: pick(ROOFS), gable: false }); }
    // forest belts and hedgerows
    const nT = Math.round(1800 * cfg.density);
    for (let i = 0, tries = 0; i < nT && tries < nT * 6; tries++) { const a = rnd() * 6.283, r = 70 + Math.pow(rnd(), 0.6) * cfg.forest, x = (bx0 + bx1) / 2 + Math.cos(a) * (r + (bx1 - bx0) / 2), y = (by0 + by1) / 2 + Math.sin(a) * (r + (by1 - by0) / 2); if (T.roadD(x, y) < 14 || nearRegion(x, y, 40)) continue; const f = T.nz(x * 1.9 + 31, y * 1.9 - 17) * 0.5 + 0.5, clump = smooth(0.35, 0.6, f); if (rnd() > 0.25 + 0.75 * clump) continue; if (masses.some((m) => Math.abs(m.x - x) < m.w && Math.abs(m.y - y) < m.d)) continue; trees.push({ x, y, z: T.h(x, y) - 0.3, w: 5 + rnd() * 6, h: 8 + rnd() * 9, rot: rnd() * 3.14, g: 0.8 + 0.2 * rnd(), v: rnd() }); i++; }
    if (masses.length) { const m = buildMasses(masses); out.push(m); }
    const tc = treeCards(trees); if (tc) out.push(tc);
    for (const o of out) { o.raycast = () => {}; scn.add(o); }
    return { masses: out.find((o) => o.userData.masses) || null, count: { masses: masses.length, trees: trees.length } };
  }

  function buildGround(scn, A, V) {
    const P = ES.pbr; if (!P) return; const sc = A.scene, S0 = sc.size, grp = new THREE.Group(); grp.name = "es-ground"; grp.userData.dyn = false;
    const m = (k, o) => P.ground(k, o), grass = m("grass"), paved = m("paved"), gravel = m("gravel"), side = m("curb"), sidewalk = m("sidewalk"), asphalt = m("asphalt"), plaza = m("plaza");
    const flat = (ring, holes, mat, y) => { const g = new THREE.ShapeGeometry(shapeOf(ring, holes)); g.rotateX(-Math.PI / 2); const mm = new THREE.Mesh(g, mat); mm.position.y = y; mm.receiveShadow = true; grp.add(mm); return mm; };
    const slab = (ring, holes, top, sd, depth) => { const g = new THREE.ExtrudeGeometry(shapeOf(ring, holes), { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); const mm = new THREE.Mesh(g, [top, sd]); mm.receiveShadow = true; grp.add(mm); return mm; };
    for (const b of sc.blocks) slab(b.ring, null, b.ground === "paved" ? paved : b.ground === "gravel" ? gravel : grass, side, 0.14);
    for (const p of sc.parks) flat(p, null, grass, 0.15).material = m("grass", { variant: "park" }); for (const p of sc.plazas) flat(p, null, plaza, 0.15);
    const water = (c, o) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.04, metalness: 0, transparent: true, opacity: o, envMapIntensity: 1 });
    const pond = water([0.012, 0.03, 0.03], 0.93); for (const p of sc.ponds) flat(p, null, pond, 0.1);
    for (const p of sc.sidewalk_poly) slab(p.ring, p.holes, sidewalk, side, 0.16); for (const p of sc.path_poly) slab(p.ring, p.holes, m("sidewalk", { variant: "path" }), side, 0.164);
    for (const p of sc.road_poly) flat(p.ring, p.holes, asphalt, 0.012);
    // the roads, sidewalks and lanes continue to the horizon (terrain.js-style corridor): extended strips, flat, same materials
    const T = terrainFor(sc); V.terrain = T; const ext = [], extSide = [], dash = [], dashY = [];
    for (const r of T.rays) { const a = [r.x, r.y], b = [r.x + r.dx * 6000, r.y + r.dy * 6000]; ext.push(strip(a, b, r.w / 2)); const sw = 2.2; extSide.push(strip([a[0] + -r.dy * (r.w / 2 + sw / 2), a[1] + r.dx * (r.w / 2 + sw / 2)], [b[0] + -r.dy * (r.w / 2 + sw / 2), b[1] + r.dx * (r.w / 2 + sw / 2)], sw / 2), strip([a[0] - -r.dy * (r.w / 2 + sw / 2), a[1] - r.dx * (r.w / 2 + sw / 2)], [b[0] - -r.dy * (r.w / 2 + sw / 2), b[1] - r.dx * (r.w / 2 + sw / 2)], sw / 2)); for (let t = 3; t < 1500; t += 9) dash.push(strip([r.x + r.dx * t, r.y + r.dy * t], [r.x + r.dx * (t + 3), r.y + r.dy * (t + 3)], 0.075)); }
    if (ext.length) { const mm = new THREE.Mesh(quadsGeo(ext, 0.012), asphalt); mm.receiveShadow = true; mm.name = "es-roadext"; grp.add(mm); const ms = new THREE.Mesh(quadsGeo(extSide, 0.16), sidewalk); ms.receiveShadow = true; grp.add(ms); }
    // markings: dashed centre lines, zebra crossings (merged), worn paint on the same asphalt grain
    const paint = P.paint ? P.paint([0.82, 0.82, 0.78]) : null, yellow = P.paint ? P.paint([0.78, 0.58, 0.08]) : null, wq = [], zq = [];
    for (const c of sc.centrelines) if (c.dashed) for (let k = 0; k + 1 < c.line.length; k++) { const a = c.line[k], b = c.line[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; for (let t = 1; t < L - 3; t += 6) wq.push(strip([a[0] + ux * t, a[1] + uy * t], [a[0] + ux * (t + 3), a[1] + uy * (t + 3)], 0.075)); }
    for (const z of sc.crosswalks) { const n = Math.floor(z.w / 0.9), ang = Math.atan2(z.d[1], z.d[0]); for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * 0.9, cx = z.c[0] - z.d[1] * off, cy = z.c[1] + z.d[0] * off, hx = Math.cos(ang) * z.len / 2, hy = Math.sin(ang) * z.len / 2; zq.push(strip([cx - hx, cy - hy], [cx + hx, cy + hy], 0.22)); } }
    if (paint && (wq.length || dash.length)) { const mm = new THREE.Mesh(quadsGeo(wq.concat(dash), 0.02), paint); mm.receiveShadow = true; grp.add(mm); } if (paint && zq.length) { const mm = new THREE.Mesh(quadsGeo(zq, 0.02), paint); mm.receiveShadow = true; grp.add(mm); }
    for (const o of sc.objects) {
      if (o.type === "pave") flat(o.ring, null, o.surface === "concrete" ? paved : m("asphalt", { variant: "lot" }), 0.152);
      else if (o.type === "pool") flat(o.ring, null, water([0.04, 0.3, 0.42], 0.9), 0.15);
      else if (o.type === "walkway") { const g = quadsGeo([strip(o.from, o.to, o.w / 2)], 0.153); const mm = new THREE.Mesh(g, sidewalk); mm.receiveShadow = true; grp.add(mm); }
    }
    for (const sp of (A.W && A.W.variantData && A.W.variantData.spills) || []) flat(sp.ring, null, m("rubble", { variant: "spill" }), 0.16);
    // terrain: rolling hills, flat corridors along the roads, fields / forest tint per vertex
    const tm = P.material("terrain", { vertexColors: true }), tg = terrainMesh(T, S0 / 2, S0 / 2), terrain = new THREE.Mesh(tg, tm); terrain.receiveShadow = true; terrain.frustumCulled = false; terrain.name = "es-terrain"; grp.add(terrain);
    terrain.raycast = () => {}; scn.add(grp); V.ground = grp;
    const bd = backdrop(scn, A, T); V.backdrop = bd; if (bd.masses) bd.masses.material.emissive.setScalar(S.L.night ? 6 : 0); return grp;
  }

  /* ======================================================================== night: street lamps ======================================================================== */
  const LAMP_K = 12;
  function makeLamps(rig) {
    rig.lamps = []; for (let i = 0; i < LAMP_K; i++) { const l = new THREE.SpotLight(0xffb36b, 0, 0, 1.3, 0.75, 2); l.castShadow = false; l.userData.k = 0; rig.scene.add(l, l.target); rig.lamps.push(l); }
  }
  /* sodium / warm LED luminaire (2700 K): ~9000 lm, peak ~3000 cd; legacy-light intensity = J / (pi * luxPerUnit) because the shader multiplies by pi */
  const LAMP_CD = 1800, LAMP_COL = [1.0, 0.72, 0.43];
  function updateLamps(cam, V) {
    const c = S.cur, rig = c && c.rig; if (!rig || !rig.lamps) return; const heads = (V && V.lamps) || [], cp = cam.position, L = rig.lamps;
    const cand = heads.map((p) => ({ p, d: Math.hypot(p[0] - cp.x, p[2] - cp.z) })).sort((a, b) => a.d - b.d).slice(0, LAMP_K), I0 = LAMP_CD / (Math.PI * Math.max(S.lpu, 1e-6));
    for (let i = 0; i < L.length; i++) { const l = L[i], q = cand[i]; if (q) { if (!l.userData.p || l.userData.p !== q.p) { l.userData.p = q.p; l.userData.k = 0; } l.position.set(q.p[0], q.p[1], q.p[2]); l.target.position.set(q.p[0], 0.15, q.p[2]); l.userData.want = (S.L.lamps ? I0 : 0) * (1 - smooth(70, 130, q.d)); } else l.userData.want = 0; l.userData.k += (l.userData.want - l.userData.k) * 0.15; l.intensity = l.userData.k; l.color.setRGB(LAMP_COL[0], LAMP_COL[1], LAMP_COL[2]); }
  }
  function headlight(obj, o = {}) {      // ES.env.headlight(group, {x, y, z, lx}): a pair of low beams for a vehicle, only lit at night; props / vehicle modules call this once per vehicle
    const lights = []; for (const s of [-1, 1]) { const l = new THREE.SpotLight(0xfff0d8, 0, 0, 0.4, 0.5, 2); l.position.set(o.x || 2.1, o.y || 0.7, (o.z || 0.6) * s); l.target.position.set((o.x || 2.1) + 8, 0.3, (o.z || 0.6) * s); obj.add(l, l.target); l.userData.headlight = true; lights.push(l); }
    obj.userData.headlights = lights; return lights;
  }
  function updateHeadlights(scn) { const night = !!S.L.night, I = (6000 / (Math.PI * Math.max(S.lpu, 1e-6))); scn.traverse((o) => { if (o.userData && o.userData.headlight) o.intensity = night && o.parent && o.parent.visible ? I : 0; }); }

  /* ======================================================================== attach / render ======================================================================== */
  function attach(scn, A, V) {
    patchChunks(); if (ES.pbr && S.renderer) ES.pbr.setRenderer(S.renderer);
    const rig = makeRig(scn); S.cur = { scene: scn, rig, A, V, skyData: null }; S.pipeNeed = true;
    if (V) { V.sky = rig.skyMesh; V.sun = rig.sun[0]; V.stars = null; }
    if (A && A.look === "night" && !S.L.night) S.pending = S.look === "moonlit" ? "moonlit" : "night"; else if (A && A.look !== "night" && S.L.night) S.pending = "day_cloud";
    if (S.L.night || S.pending === "night" || S.pending === "moonlit") makeLamps(rig);
    const want = S.pending || S.look; S.pending = null; setLook(want, true);
    return rig;
  }
  async function setLook(name, silent) {
    if (!LOOKS[name]) return false; const prevNight = !!S.L.night; S.look = name; S.L = LOOKS[name];
    const L = S.L, cur = S.cur; if (!cur) return true;
    if (!!L.night !== prevNight && cur.A && !cur.rig.lamps && L.night) makeLamps(cur.rig);
    const sd = await loadSky(L.hdr); if (S.cur !== cur) return true; cur.skyData = sd; const meta = sd.meta, hs = meta.sun, gl = meta.glow;
    if (hs) { S.sunAz = 90 - hs.azimuth; S.sunEl = hs.elevation; } else if (gl) { S.sunAz = 90 - gl.azimuth; S.sunEl = L.sunEl || gl.elevation; } else { S.sunAz = 120; S.sunEl = 30; }
    if (S.userSun && S.userSun[name]) { S.sunAz = S.userSun[name][0]; S.sunEl = S.userSun[name][1]; }
    S.groundAlbedo = L.night ? 0.12 : 0.22; applyLook(); updateHaze(); S.fade = 0.0;
    const mass = cur.V && cur.V.backdrop && cur.V.backdrop.masses; if (mass) mass.material.emissive.setScalar(L.night ? 6 : 0);
    if (cur.A && cur.A.look !== undefined) { const nightClass = !!L.night; if ((cur.A.look === "night") !== nightClass) { cur.A.look = nightClass ? "night" : "day"; if (ES.view3d && ES.view3d.refresh && !silent) ES.view3d.refresh(cur.A); if (ES.lab && ES.lab.recompute) ES.lab.recompute(); } }
    if (ES.bus) ES.bus.emit("env:look", name, !!L.night);
    return true;
  }
  function setSun(azBearing, elDeg) {
    const L = S.L; if (azBearing != null) S.sunAz = ((azBearing % 360) + 360) % 360; if (elDeg != null && L.elRange) S.sunEl = clamp(elDeg, L.elRange[0], L.elRange[1]);
    (S.userSun = S.userSun || {})[S.look] = [S.sunAz, S.sunEl]; applyLook(); updateHaze();
  }
  function setQuality(q) { if (!QUAL[q]) return; S.quality = q; S.splits = null; if (S.cur) setShadowSize(S.cur.rig, QUAL[q].shadow); }
  const BASEQ = () => QUAL[S.quality] || QUAL.high;

  function render(scn, cam, V) {
    const r = S.renderer || (S.renderer = V && V.renderer); if (!r) return; S.V = V || S.V; const c = S.cur;
    const now = performance.now(), dt = S.last ? Math.min(0.25, (now - S.last) / 1000) : 0.016; S.last = now;
    r.info.reset();
    if (!c || c.scene !== scn || !c.skyData || S.failed || S.quality === "off") { fallbackRender(r, scn, cam, c && c.scene === scn ? c : null); return; }
    try { frame(r, scn, cam, c, dt); } catch (e) { console.warn("env pipeline failed, falling back:", e); S.failed = true; fallbackRender(r, scn, cam, null); }
    autoQuality(dt);
  }
  function autoQuality(dt) {         // degrade one step when the frame rate stays below 30 fps for 2 s (never upgrades by itself)
    if (!S.auto || !(ES.view3d && ES.view3d.walk && ES.view3d.walk.active) || dt > 0.2) return; const f = 1 / Math.max(dt, 1e-3); S.fps += (f - S.fps) * 0.05; if (document.hidden) { S.lowT = 0; return; }
    if (S.fps < 46 && (S.dyn || 1) > 0.61) { S.slowT = (S.slowT || 0) + dt; if (S.slowT > 0.8) { S.slowT = 0; S.dyn = Math.max(0.6, (S.dyn || 1) - 0.1); S.fps = 55; } } else S.slowT = 0;          // dynamic resolution: keep >= 45 fps
    if (S.fps > 57 && (S.dyn || 1) < 1) { S.fastT = (S.fastT || 0) + dt; if (S.fastT > 5) { S.fastT = 0; S.dyn = Math.min(1, S.dyn + 0.05); } } else S.fastT = 0;
    if (S.fps < 30 && (S.dyn || 1) <= 0.61) S.lowT += dt; else S.lowT = Math.max(0, S.lowT - dt); if (S.lowT > 2.0) { S.lowT = 0; const i = QORDER.indexOf(S.quality); if (i < QORDER.length - 1) { setQuality(QORDER[i + 1]); S.fps = 60; console.info("env: quality lowered to", S.quality); for (const f of S.listeners) { try { f(env); } catch (e) {} } } }
  }
  function frame(r, scn, cam, c, dt) {
    const P = ensurePipe(r), rig = c.rig, q = BASEQ(), L = S.L; if (!S.cur.iblDone) { ensureIbl(); updateHaze(); S.cur.iblDone = true; }
    setShadowSize(rig, q.shadow); S.time += dt; S.frame++;
    // depth range: the nearer the eye is to the ground the closer the near plane can be (24-bit depth resolves coplanar ground layers at distance)
    cam.near = clamp(0.12 * Math.max(cam.position.y, 0.2), 0.05, 0.6); cam.far = 9000; cam.updateProjectionMatrix();
    fitCascades(cam, rig); if (L.night || rig.lamps) updateLamps(cam, c.V); if (S.frame % 30 === 0) updateHeadlights(scn);
    r.toneMapping = THREE.NoToneMapping; r.outputEncoding = THREE.LinearEncoding; r.shadowMap.enabled = true;
    r.setRenderTarget(P.scene); r.setClearColor(0x000000, 1); r.clear(true, true, true); r.render(scn, cam);
    const pm = cam.projectionMatrix, inv = cam.projectionMatrixInverse, w = P.w, h = P.h, eye = r.toneMappingExposure || 1, lc = c.skyData.meta;
    // ambient occlusion (half resolution, depth only) + depth-aware blur
    const doAO = q.ao > 0; if (doAO) {
      const u = P.mAO.uniforms; u.uProjInv.value.copy(inv); u.uProjScale.value = 0.5 * h / Math.tan(cam.fov * D2R / 2); u.uRadius.value = 1.1; u.uInvR6.value = 1 / Math.pow(1.1, 6); u.uIntensity.value = 1.5; u.uTime.value = S.time; u.uN.value = q.ao; u.uRes.value.set(w, h);
      pass(P.mAO, P.ao[0]); const b = P.mBlur.uniforms; b.uPA.value = pm.elements[10]; b.uPB.value = pm.elements[14];
      b.tAO.value = P.ao[0].texture; b.uStep.value.set(1 / (w / 2), 0); pass(P.mBlur, P.ao[1]); b.tAO.value = P.ao[1].texture; b.uStep.value.set(0, 1 / (h / 2)); pass(P.mBlur, P.ao[0]);
    }
    if (S.debug === "ao") { pass(copyMat(P.ao[0].texture), null); return; }
    // aerial perspective (height fog tinted by the sky) + AO applied to the indirect part
    const cu = P.mComp.uniforms, hz = P.ibl.haze.texture; cu.tHaze.value = hz; cu.uProjInv.value.copy(inv); cu.uCamWorld.value.copy(cam.matrixWorld); cu.uCamPos.value.copy(cam.position); cu.uSunDir.value.copy(rig.dir);
    cu.uSunCol.value.set(S.sunCol[0] * S.sunE, S.sunCol[1] * S.sunE, S.sunCol[2] * S.sunE).multiplyScalar(rig.sun[0].intensity > 0 ? 1 : 0); cu.uBeta.value = L.fog[0] * (S.fogK || 1); cu.uH.value = L.fog[1]; cu.uAOk.value = doAO ? (S.aoK == null ? 1 : S.aoK) : 0;      /* S.aoK: interior.js sets 0 indoors (the baked room AO replaces the screen-space AO there) */ cu.uRotC.value = Math.cos(S.rot * D2R); cu.uRotS.value = Math.sin(S.rot * D2R); cu.uSunK.value = L.night ? 0 : 0.012;
    cu.tAO.value = P.ao[0].texture; pass(P.mComp, P.shaded);
    // bloom
    const nb = q.bloom; if (nb > 0) {
      const exp = S.exposure * eye, bp = P.mBpre.uniforms; bp.uExp.value = exp; bp.uThr.value = L.night ? 0.8 : 1.0; bp.uTexel.value.set(1 / w, 1 / h); pass(P.mBpre, P.down[0]);
      for (let i = 1; i < nb; i++) { const bd = P.mBdown.uniforms; bd.tSrc.value = P.down[i - 1].texture; bd.uTexel.value.set(0.5 / P.down[i - 1].width, 0.5 / P.down[i - 1].height); pass(P.mBdown, P.down[i]); }
      pass(copyMat(P.down[nb - 1].texture), P.up[nb - 1]);
      for (let i = nb - 2; i >= 0; i--) { const bu = P.mBup.uniforms; bu.tCur.value = P.down[i].texture; bu.tLow.value = P.up[i + 1].texture; bu.uTexel.value.set(0.5 / P.up[i + 1].width, 0.5 / P.up[i + 1].height); bu.uW.value = 0.62; pass(P.mBup, P.up[i]); }
    }
    // tone mapping, grading, film dither -> LDR -> FXAA -> screen
    const u = P.final.uniforms; u.tColor.value = P.shaded.texture; u.tBloom.value = P.up[0].texture; u.uExposure.value = S.exposure * eye; u.uBloom.value = nb > 0 ? L.bloom : 0; u.uVig.value = L.vig; u.uSat.value = L.sat; u.uTone.value = S.tone == null ? 1 : S.tone; u.uContrast.value = L.con || 0; u.uScot.value = L.scotopic || 0; u.uFade.value = S.fade = Math.min(1, S.fade + dt * 4); u.uTime.value = S.time; u.uRes.value.set(w, h);
    if (q.fxaa) { pass(P.final, P.ldr); pass(P.mFxaa, null); } else pass(P.final, null);
  }
  let COPY = null; function copyMat(tex) { if (!COPY) COPY = mat("uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = vec4( texture2D( tSrc, vUv ).rgb, 1.0 ); }", { tSrc: { value: null } }); COPY.uniforms.tSrc.value = tex; return COPY; }
  function fallbackRender(r, scn, cam, c) {              // before the sky has loaded, or if the pipeline is off / failed: plain tone-mapped direct render with the same lights
    const eye = r.toneMappingExposure || 1; r.toneMapping = THREE.ACESFilmicToneMapping; r.outputEncoding = THREE.sRGBEncoding; r.toneMappingExposure = eye * (c && c.skyData ? S.exposure * 0.9 : 1);
    cam.near = clamp(0.12 * Math.max(cam.position.y, 0.2), 0.05, 0.6); cam.far = 9000; cam.updateProjectionMatrix(); if (c && c.skyData) fitCascades(cam, c.rig); r.setRenderTarget(null); r.render(scn, cam); r.toneMappingExposure = eye;
  }
  /* render the scene for another camera (sensor feeds) into the caller's render target in linear scene units (HalfFloat / Float target recommended); no post effects, no haze */
  function renderLinear(target, cam, scn) {
    const r = S.renderer, c = S.cur; scn = scn || (c && c.scene); if (!r || !scn) return; const tm = r.toneMapping, oe = r.outputEncoding; r.toneMapping = THREE.NoToneMapping; r.outputEncoding = THREE.LinearEncoding; r.setRenderTarget(target); r.render(scn, cam); r.setRenderTarget(null); r.toneMapping = tm; r.outputEncoding = oe;
  }

  function init(renderer) {
    S.renderer = renderer; patchChunks(); _r = new THREE.Vector3(); _u = new THREE.Vector3(); _c = new THREE.Vector3(); _up = new THREE.Vector3(0, 1, 0); if (ES.pbr) ES.pbr.setRenderer(renderer);
    renderer.info.autoReset = false;                         // renderer.info then counts the whole frame (shadow cascades + main + post passes); reset at the start of every frame below
    renderer.physicallyCorrectLights = false; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.NoToneMapping; renderer.outputEncoding = THREE.LinearEncoding;
    try { const q = new URLSearchParams(location.search).get("quality"); if (q && QUAL[q]) { S.quality = q; S.auto = false; } } catch (e) {}
    S.ready = true;
  }

  /* ======================================================================== UI ======================================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const compass = (b) => ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][Math.round((((b % 360) + 360) % 360) / 45) % 8];
  function syncUI() {
    const L = S.L, az = Math.round(S.sunAz == null ? 0 : S.sunAz), el = Math.round(S.sunEl == null ? 0 : S.sunEl), hasSun = !!L.elRange;
    document.querySelectorAll("[data-look]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.look === S.look));
    for (const [a, e, ao, eo] of [["#env-az", "#env-el", "#env-az-o", "#env-el-o"], ["#fp-sun-az", "#fp-sun-el", "#fp-sun-az-o", "#fp-sun-el-o"]]) {
      const A1 = $(a), E1 = $(e); if (!A1) continue; A1.value = az; E1.value = el; $(ao).textContent = `${az}° ${compass(az)}`; $(eo).textContent = hasSun ? `${el}°` : "—";
      A1.disabled = !(S.sunE > 0 || L.moon || hasSun || S.look === "overcast" || true); E1.disabled = !hasSun; if (hasSun) { E1.min = L.elRange[0]; E1.max = L.elRange[1]; E1.value = clamp(el, L.elRange[0], L.elRange[1]); }
    }
    const lux = $("#env-lux"); if (lux) lux.textContent = `日照 ${fmtLux(S.sunE * S.lpu)} · 天空 ${fmtLux(S.skyE * S.lpu)} · EV ${S.ev.toFixed(1)}`;
    const t = $("#fp-sun-t"); if (t) t.textContent = `${L.label}${hasSun ? ` ${az}°/${el}°` : ""}`;
    const q = $("#env-q"); if (q) q.value = S.quality;
  }
  const fmtLux = (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " klx" : v >= 10 ? v.toFixed(0) + " lx" : v.toFixed(2) + " lx");
  function initUI() {
    const seg = $("#seg-time"); if (!seg || $("#env-ui")) return; seg.style.display = "none";
    const box = document.createElement("div"); box.id = "env-ui"; box.className = "envui";
    box.innerHTML = `<div class="seg envseg" id="env-looks" role="group" aria-label="光照与天空">${LOOK_ORDER.map((k) => `<button data-look="${k}" aria-pressed="false">${LOOKS[k].label}</button>`).join("")}</div>
      <label class="envrow"><span>太阳方位</span><input type="range" id="env-az" min="0" max="359" step="1" aria-label="太阳方位角"><output id="env-az-o" class="mono"></output></label>
      <label class="envrow"><span>太阳高度</span><input type="range" id="env-el" min="2" max="85" step="1" aria-label="太阳高度角"><output id="env-el-o" class="mono"></output></label>
      <div class="envinfo mono" id="env-lux"></div>
      <div class="envrow2"><label><input type="checkbox" id="env-wet"> 潮湿路面</label><select id="env-q" aria-label="画质"><option value="high">画质:高</option><option value="medium">画质:中</option><option value="low">画质:低</option><option value="off">画质:关</option></select></div>`;
    seg.insertAdjacentElement("afterend", box);
    box.querySelectorAll("[data-look]").forEach((b) => b.addEventListener("click", () => { setLook(b.dataset.look).then(syncUI); }));
    const az = $("#env-az", box), el = $("#env-el", box); az.addEventListener("input", () => { setSun(+az.value, null); syncUI(); }); el.addEventListener("input", () => { setSun(null, +el.value); syncUI(); });
    $("#env-wet", box).addEventListener("change", (e) => env.setWet(e.target.checked ? 0.85 : 0)); $("#env-q", box).addEventListener("change", (e) => { S.auto = false; setQuality(e.target.value); });
    // compact control inside the walk HUD
    const acts = $("#fp-acts") || $(".fp-acts"); if (acts && !$("#fp-sun")) {
      const b = document.createElement("button"); b.className = "btn envchip"; b.id = "fp-sun"; b.type = "button"; b.title = "太阳方位 / 高度与光照(看迎光、逆光对相机的影响)"; b.innerHTML = `☀ <span id="fp-sun-t"></span>`; acts.appendChild(b);
      const pop = document.createElement("div"); pop.id = "fp-sunpop"; pop.className = "fp-panel envpop"; pop.hidden = true;
      pop.innerHTML = `<div class="seg envseg">${LOOK_ORDER.map((k) => `<button data-look="${k}" aria-pressed="false">${LOOKS[k].label}</button>`).join("")}</div><label class="envrow"><span>方位</span><input type="range" id="fp-sun-az" min="0" max="359" step="1"><output id="fp-sun-az-o" class="mono"></output></label><label class="envrow"><span>高度</span><input type="range" id="fp-sun-el" min="2" max="85" step="1"><output id="fp-sun-el-o" class="mono"></output></label>`;
      const hud = $("#fphud"); (hud || document.body).appendChild(pop);
      b.addEventListener("click", (e) => { e.target.blur && e.target.blur(); pop.hidden = !pop.hidden; syncUI(); });
      pop.querySelectorAll("[data-look]").forEach((x) => x.addEventListener("click", () => { x.blur(); setLook(x.dataset.look).then(syncUI); }));
      const a2 = $("#fp-sun-az", pop), e2 = $("#fp-sun-el", pop); a2.addEventListener("input", () => { setSun(+a2.value, null); syncUI(); }); e2.addEventListener("input", () => { setSun(null, +e2.value); syncUI(); });
      ["keydown", "keyup"].forEach((ev) => pop.addEventListener(ev, (e) => e.stopPropagation()));
    }
    env.onChange(syncUI); syncUI();
  }
  if (ES.bus) ES.bus.on("ready", initUI);

  /* ======================================================================== public API ======================================================================== */
  const api = {
    handlesLamps: true,                                     // env.js owns the street-lamp lights (view3d.placeAgents skips its legacy ones)
    LOOKS, LOOK_ORDER, QUALITY: QUAL, init, attach, render, renderLinear, setLook, setSun, setQuality, buildGround, headlight, updateLamps,
    setWet(w) { if (ES.pbr) ES.pbr.setWet(w); S.wet = w; },
    settle() { return Promise.resolve(); },                 // no temporal accumulation in this pipeline (kept for the screenshot scripts)
    get look() { return S.look; }, get isNight() { return !!S.L.night; }, get sunColor() { return S.cur ? S.cur.rig.sunCol : new THREE.Color(1, 1, 1); },
    get sunIlluminanceLux() { return S.sunE * S.lpu; }, get skyIlluminanceLux() { return S.skyE * S.lpu; }, get luxPerUnit() { return S.lpu; }, get cdm2PerUnit() { return S.lpu; }, get ev100() { return S.ev; }, get exposure() { return S.exposure; },
    debug(m) { S.debug = m || null; }, get quality() { return S.quality; }, get fps() { return S.fps; }, get azimuth() { return S.sunAz; }, get elevation() { return S.sunEl; },
    onChange(f) { S.listeners.push(f); }, state: S,
  };
  Object.defineProperties(env, Object.getOwnPropertyDescriptors(api));
  env.sunDir = null; env.sunDirENU = [0, 0, 1];
})();
