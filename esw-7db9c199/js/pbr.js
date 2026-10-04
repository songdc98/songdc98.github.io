/* pbr.js: photographic PBR material library (environment agent).  ES.pbr.material(family, opts), ES.pbr.ground(kind), ES.pbr.fromBim(row), ES.pbr.glass(opts)
   Textures (web/assets/tex/<id>/{d,n}.jpg, Poly Haven CC0; scripts/export_web_textures.py): d = albedo (sRGB), n = packed normal x,y (R,G) + roughness (B).  Every material owns
   placeholders (flat colour / flat normal) created synchronously, so the shader program is compiled once and the real maps are swapped in when they arrive (no hitch, no recompile);
   downloads run 3 at a time, decoded off the main thread, at most 1 texture is uploaded to the GPU per frame.  The photo is tinted to the requested albedo exactly as the Blender
   pipeline does (colour = target / mean texture colour).  UV convention: BIM meshes are in tile units (1 uv = 1 tile of tile_m metres, material.userData.tile); ground meshes are in metres
   (uEsUv = 1/tile_m is applied in the vertex shader), so a repeat of the texture is always the physical size of the real surface.
   Shader features (onBeforeCompile on MeshStandardMaterial): packed normal/roughness sampling, optional anti-tiling for isotropic ground, macro colour variation in world space (hides the
   repetition), ground-contact grime and vertical streaks on walls, wet look (global ES.pbr.setWet(0..1)), indirect-light AO term (esAO) used by the shader patch in env.js. */
(function () {
  const ES = (window.ES = window.ES || {});
  const MANIFEST = /*MANIFEST*/{"asphalt_02":{"tile":3.0,"avg":[0.1121,0.1103,0.098],"rough":0.77,"d":1024,"nr":1024,"kb":1089,"name":"Asphalt 02"},"leafy_grass":{"tile":2.0,"avg":[0.3212,0.2362,0.1064],"rough":0.685,"d":1024,"nr":1024,"kb":1292,"name":"Leafy Grass"},"large_grey_tiles":{"tile":3.0,"avg":[0.2402,0.2195,0.1806],"rough":0.815,"d":1024,"nr":1024,"kb":483,"name":"Large Grey Tiles"},"concrete_floor_01":{"tile":2.0,"avg":[0.1944,0.1589,0.1083],"rough":0.525,"d":1024,"nr":1024,"kb":804,"name":"Concrete Floor 01"},"rocks_ground_02":{"tile":2.0,"avg":[0.1747,0.1326,0.0823],"rough":0.793,"d":1024,"nr":1024,"kb":1266,"name":"Rocks Ground 02"},"brown_mud_dry":{"tile":1.3,"avg":[0.1889,0.1158,0.0545],"rough":0.527,"d":512,"nr":512,"kb":353,"name":"Brown Mud Dry"},"forrest_ground_01":{"tile":2.0,"avg":[0.2909,0.2472,0.1189],"rough":0.936,"d":512,"nr":512,"kb":318,"name":"Forest Ground 01"},"stone_tiles_02":{"tile":2.0,"avg":[0.1991,0.1971,0.1719],"rough":0.667,"d":1024,"nr":1024,"kb":565,"name":"Stone Tiles 02"},"cobblestone_floor_08":{"tile":2.0,"avg":[0.3008,0.274,0.2299],"rough":0.578,"d":512,"nr":512,"kb":207,"name":"Cobblestone Floor 08"},"gravel_concrete":{"tile":2.12,"avg":[0.2965,0.2325,0.1754],"rough":0.761,"d":512,"nr":512,"kb":206,"name":"Gravel Concrete"},"concrete_floor_worn_001":{"tile":3.0,"avg":[0.0929,0.0947,0.089],"rough":0.541,"d":512,"nr":512,"kb":57,"name":"Concrete Floor Worn 001"},"aerial_grass_rock":{"tile":15.0,"avg":[0.1711,0.1234,0.0291],"rough":0.809,"d":1024,"nr":512,"kb":392,"name":"Aerial Grass Rock"},"asphalt_04":{"tile":4.04,"avg":[0.2387,0.223,0.211],"rough":0.931,"d":512,"nr":512,"kb":119,"name":"Asphalt 04"},"red_brick":{"tile":1.4,"avg":[0.2769,0.1381,0.0858],"rough":0.923,"d":1024,"nr":1024,"kb":647,"name":"Red Brick"},"red_brick_03":{"tile":1.0,"avg":[0.1548,0.0997,0.0831],"rough":0.532,"d":1024,"nr":1024,"kb":786,"name":"Red Brick 03"},"plastered_wall":{"tile":2.0,"avg":[0.4361,0.3923,0.335],"rough":0.912,"d":1024,"nr":1024,"kb":646,"name":"Plastered Wall"},"concrete_wall_007":{"tile":2.16,"avg":[0.2574,0.2248,0.1568],"rough":0.774,"d":1024,"nr":1024,"kb":337,"name":"Concrete Wall 007"},"exterior_wall_cladding":{"tile":2.0,"avg":[0.1986,0.1752,0.1469],"rough":0.727,"d":1024,"nr":512,"kb":226,"name":"Exterior Wall Cladding"},"grey_roof_01":{"tile":8.0,"avg":[0.11,0.1066,0.0978],"rough":0.857,"d":1024,"nr":1024,"kb":631,"name":"Grey Roof 01"},"clay_roof_tiles_02":{"tile":2.5,"avg":[0.3119,0.0864,0.0267],"rough":0.915,"d":1024,"nr":1024,"kb":666,"name":"Clay Roof Tiles 02"},"box_profile_metal_sheet":{"tile":2.0,"avg":[0.0451,0.0451,0.0451],"rough":0.446,"d":1024,"nr":512,"kb":96,"name":"Box Profile Metal Sheet"},"factory_wall":{"tile":3.0,"avg":[0.1639,0.1639,0.1639],"rough":0.95,"d":1024,"nr":512,"kb":132,"name":"Factory Wall"},"corrugated_iron":{"tile":1.12,"avg":[0.4029,0.4503,0.4272],"rough":0.702,"d":512,"nr":512,"kb":102,"name":"Corrugated Iron"},"metal_plate_02":{"tile":2.0,"avg":[0.0706,0.0706,0.0706],"rough":0.659,"d":512,"nr":512,"kb":116,"name":"Metal Plate 02"},"metal_plate":{"tile":0.5,"avg":[0.0356,0.0356,0.0356],"rough":0.589,"d":512,"nr":512,"kb":146,"name":"Metal Plate"},"rusty_metal_sheet":{"tile":2.0,"avg":[0.1854,0.1571,0.0936],"rough":0.82,"d":512,"nr":512,"kb":76,"name":"Rusty Metal Sheet"},"broken_wall":{"tile":3.0,"avg":[0.282,0.2452,0.2088],"rough":0.843,"d":512,"nr":512,"kb":223,"name":"Broken Wall"},"beige_wall_002":{"tile":3.0,"avg":[0.2273,0.1583,0.0922],"rough":0.666,"d":512,"nr":512,"kb":136,"name":"Beige Wall 002"},"wood_floor":{"tile":1.7,"avg":[0.2171,0.117,0.0549],"rough":0.471,"d":512,"nr":512,"kb":57,"name":"Wood Floor"},"laminate_floor_02":{"tile":1.7,"avg":[0.3307,0.2182,0.1266],"rough":0.377,"d":512,"nr":512,"kb":61,"name":"Laminate Floor 02"},"interior_tiles":{"tile":1.9,"avg":[0.4113,0.3199,0.238],"rough":0.696,"d":512,"nr":512,"kb":73,"name":"Interior Tiles"},"dirty_carpet":{"tile":0.6,"avg":[0.0385,0.0307,0.0198],"rough":0.813,"d":512,"nr":512,"kb":210,"name":"Dirty Carpet"},"oak_veneer_01":{"tile":1.83,"avg":[0.3594,0.2107,0.0979],"rough":0.53,"d":512,"nr":512,"kb":104,"name":"Oak Veneer 01"},"rough_linen":{"tile":0.271,"avg":[0.2844,0.4079,0.6135],"rough":0.718,"d":512,"nr":512,"kb":107,"name":"Rough Linen"}}/*END_MANIFEST*/;
  const TEXDIR = () => `${ES.ASSET_DIR || "assets"}/tex`;
  const P = (ES.pbr = ES.pbr || {});
  const STATE = { sets: {}, queue: [], active: 0, ready: [], bytes: 0, loaded: 0, failed: 0, wet: { value: 0 }, mats: {}, anis: 8 };
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const srgb3 = (c) => (Array.isArray(c) ? c.map((v) => v / 255) : [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => v / 255)).map(lin);          // 0xRRGGBB or [r,g,b] 0..255 -> linear

  /* ================================================================ texture sets (shared by every material that uses them) ================================================================ */
  function placeholder(rgb, srgb) {
    const c = document.createElement("canvas"); c.width = c.height = 4; const g = c.getContext("2d"); g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; g.fillRect(0, 0, 4, 4); return c;
  }
  function texSet(id) {
    if (STATE.sets[id]) return STATE.sets[id];
    const m = MANIFEST[id] || { avg: [0.3, 0.3, 0.3], tile: 1, rough: 0.8 }, T = THREE, anis = STATE.renderer ? Math.min(STATE.anis, STATE.renderer.capabilities.getMaxAnisotropy()) : 4;
    const mk = (cv, enc) => { const t = new T.Texture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.anisotropy = anis; t.encoding = enc; t.needsUpdate = true; return t; };
    const avgS = m.avg.map((v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
    const set = { id, meta: m, map: mk(placeholder(avgS), T.sRGBEncoding), nr: mk(placeholder([128, 128, Math.round(255 * (m.rough || 0.8))]), T.LinearEncoding), loaded: 0, tex: 2 };
    STATE.sets[id] = set; if (MANIFEST[id]) { STATE.queue.push(set); pump(); } else set.loaded = 2;
    return set;
  }
  const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => (i.decode ? i.decode().then(() => res(i), () => res(i)) : res(i)); i.onerror = () => rej(new Error("tex " + url)); i.src = url; });
  function pump() {
    while (STATE.active < 3 && STATE.queue.length) {
      const set = STATE.queue.shift(); STATE.active++;
      Promise.all([loadImg(`${TEXDIR()}/${set.id}/d.jpg`).then((i) => STATE.ready.push({ t: set.map, i, set })).catch(() => (STATE.failed++, set.loaded++)),
        loadImg(`${TEXDIR()}/${set.id}/n.jpg`).then((i) => STATE.ready.push({ t: set.nr, i, set })).catch(() => (STATE.failed++, set.loaded++))]).then(() => { STATE.active--; pump(); });
    }
    if (!STATE.pumping && (STATE.ready.length || STATE.active)) { STATE.pumping = true; requestAnimationFrame(upload); }
  }
  function upload() {                                                   // one GPU upload per frame
    STATE.pumping = false; const it = STATE.ready.shift();
    if (it) { it.t.image = it.i; it.t.needsUpdate = true; it.set.loaded++; STATE.loaded++; STATE.bytes += it.i.width * it.i.height * 4 * 1.33; ES.bus && ES.bus.emit("pbr:tex", it.set.id); }
    if (STATE.ready.length || STATE.active || STATE.queue.length) { STATE.pumping = true; requestAnimationFrame(upload); }
  }

  /* ================================================================ shader patch ================================================================ */
  const NOISE = `
    float esHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
    float esVN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( esHash( i ), esHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( esHash( i + vec2( 0.0, 1.0 ) ), esHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
    float esFbm( vec2 p ) { return 0.5 * esVN( p ) + 0.25 * esVN( p * 2.03 + 11.7 ) + 0.125 * esVN( p * 4.1 + 3.1 ); }
    vec2 esPlane() { vec3 a = abs( vEsN ); if ( a.y > 0.7 ) return vEsW.xz; vec2 t = normalize( vec2( -vEsN.z, vEsN.x ) + vec2( 1e-5 ) ); return vec2( dot( vEsW.xz, t ), vEsW.y ); }`;
  const MAP_FRAG = `
    float esWetK = 0.0; float esAO = 1.0; float esW = 0.0; vec2 esUv2 = vUv;
    #ifdef USE_MAP
      vec4 esT = texture2D( map, vUv );
      #ifdef ES_NOTILE
        esW = smoothstep( 0.30, 0.70, esFbm( esPlane() * 0.11 ) );
        esUv2 = mat2( 0.8387, 0.5446, -0.5446, 0.8387 ) * vUv * 0.613 + vec2( 0.37, 0.71 );
        esT = mix( esT, texture2D( map, esUv2 ), esW );
      #endif
      esT = mapTexelToLinear( esT );
      float esLum = dot( esT.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      esT.rgb = mix( vec3( esLum ), esT.rgb, uEsA.z );
      diffuseColor *= esT;
      float esN = esFbm( esPlane() * uEsA.y );
      diffuseColor.rgb *= 1.0 + uEsA.x * ( esN - 0.44 ) * 2.4;
      #ifdef ES_PAINT
      { float chip = esFbm( vEsW.xz * 11.0 ) * 0.65 + esVN( vEsW.xz * 47.0 ) * 0.35; float wear = esFbm( vEsW.xz * 0.35 + 3.0 ); if ( chip < 0.20 + 0.32 * wear ) discard;
        diffuseColor.rgb = uEsP.rgb * ( 0.78 + 0.34 * esFbm( vEsW.xz * 23.0 ) ) * mix( 1.0, 0.72, wear ); }
      #endif
    #endif
    #ifdef ES_GRIME
      {
        float h = vEsW.y - uEsB.y; float wall = 1.0 - smoothstep( 0.3, 0.7, abs( vEsN.y ) );
        float low = 1.0 - smoothstep( 0.0, 1.6, h ); vec2 pl = esPlane();
        float nz = esFbm( vec2( pl.x * 1.3, h * 0.9 ) );
        float streak = esVN( vec2( pl.x * 7.0, h * 0.22 ) ) * esVN( vec2( pl.x * 2.3 + 5.0, h * 0.07 ) );
        float dirt = clamp( uEsB.z * low * ( 0.45 + 0.9 * nz ) + uEsB.w * streak * 1.6, 0.0, 0.8 ) * wall;
        diffuseColor.rgb *= 1.0 - dirt;
        esAO = mix( 1.0, mix( 0.62, 1.0, smoothstep( 0.0, 1.4, h ) ), wall );
      }
    #endif
    esWetK = uEsWet * uEsB.x * smoothstep( 0.30, 0.55, esFbm( esPlane() * 0.45 + 7.0 ) * 1.6 ) * smoothstep( 0.55, 0.85, vEsN.y );
    diffuseColor.rgb *= 1.0 - 0.38 * esWetK;`;
  const ROUGH_FRAG = `
    float roughnessFactor = roughness;
    #ifdef USE_ROUGHNESSMAP
      vec4 esRt = texture2D( roughnessMap, vUv );
      #ifdef ES_NOTILE
        esRt = mix( esRt, texture2D( roughnessMap, esUv2 ), esW );
      #endif
      roughnessFactor *= esRt.b;
    #endif
    roughnessFactor = mix( roughnessFactor, 0.04 + 0.2 * roughnessFactor, esWetK );`;
  const NORMAL_FRAG = `
    #ifdef TANGENTSPACE_NORMALMAP
      vec4 esNt = texture2D( normalMap, vUv );
      #ifdef ES_NOTILE
        vec4 esNt2 = texture2D( normalMap, esUv2 ); esNt2.xy = ( mat2( 0.8387, -0.5446, 0.5446, 0.8387 ) * ( esNt2.xy * 2.0 - 1.0 ) ) * 0.5 + 0.5; esNt = mix( esNt, esNt2, esW );
      #endif
      vec3 mapN = vec3( esNt.rg * 2.0 - 1.0, 0.0 ); mapN.xy *= uEsA.w * ( 1.0 - 0.7 * esWetK ); mapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );
      normal = perturbNormal2Arb( -vViewPosition, normal, mapN, faceDirection );
    #endif`;

  function patch(mat, f) {
    const key = "es-pbr:" + [f.notile ? "T" : "", f.grime ? "G" : ""].join("");
    mat.defines = Object.assign(mat.defines || {}, { ES_AO: "" }, f.paint ? { ES_PAINT: "" } : {}, f.notile ? { ES_NOTILE: "" } : {}, f.grime ? { ES_GRIME: "" } : {});
    const uP = { value: new THREE.Vector4(...(f.paint || [1, 1, 1]), 1) }, uA = { value: new THREE.Vector4(f.macro || 0, f.macroScale || 0.05, f.sat == null ? 1 : f.sat, f.nor == null ? 1 : f.nor) }, uB = { value: new THREE.Vector4(f.wet == null ? 0.6 : f.wet, f.groundY == null ? 0.15 : f.groundY, f.grime || 0, f.streak || 0) }, uUv = { value: new THREE.Vector2(f.uvx || 1, f.uvy || 1) };
    mat.userData.esU = { uA, uB, uUv };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uEsP = uP; shader.uniforms.uEsA = uA; shader.uniforms.uEsB = uB; shader.uniforms.uEsUv = uUv; shader.uniforms.uEsWet = STATE.wet;
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vEsW; varying vec3 vEsN; uniform vec2 uEsUv;")
        .replace("#include <uv_vertex>", "#ifdef USE_UV\n\tvUv = uv * uEsUv;\n#endif").replace("#include <begin_vertex>", "#include <begin_vertex>\nvEsW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vEsN = normalize( mat3( modelMatrix ) * objectNormal );");
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vEsW; varying vec3 vEsN; uniform vec4 uEsA; uniform vec4 uEsB; uniform vec4 uEsP; uniform float uEsWet;\n" + NOISE)
        .replace("#include <map_fragment>", MAP_FRAG).replace("#include <roughnessmap_fragment>", ROUGH_FRAG).replace("#include <normal_fragment_maps>", NORMAL_FRAG);
    };
    mat.customProgramCacheKey = () => key;
  }

  /* ================================================================ material factory ================================================================ */
  /* family table: tex = texture id; macro = colour variation amplitude; scale = macro noise frequency (1/m); nor = normal strength; sat = saturation of the photo; tint = linear multiplier
     (ground, like TINTS / SAT in bl_materials.py); rough = roughness multiplier; metal; notile = anti-tiling (isotropic surfaces only); grime / streak = weathering of walls */
  const FAM = {
    asphalt: { tex: "asphalt_02", macro: 0.14, scale: 0.06, sat: 0.3, nor: 1.1, rough: 1.0, notile: true, tint: [1.2, 1.2, 1.2], wet: 1.0 },
    asphalt2: { tex: "asphalt_04", macro: 0.12, scale: 0.06, sat: 0.2, nor: 1.0, rough: 1.0, notile: true, tint: [0.5, 0.5, 0.5], wet: 1.0 },
    grass: { tex: "leafy_grass", macro: 0.30, scale: 0.035, sat: 0.72, nor: 1.0, rough: 1.0, notile: true, tint: [0.36, 0.86, 0.28], wet: 0.5 },
    grass_dry: { tex: "leafy_grass", macro: 0.30, scale: 0.035, sat: 0.6, nor: 1.0, rough: 1.0, notile: true, tint: [0.55, 0.78, 0.30], wet: 0.5 },
    sidewalk: { tex: "large_grey_tiles", macro: 0.10, scale: 0.08, sat: 0.5, nor: 1.0, rough: 1.0, tint: [1.0, 1.0, 1.0], wet: 1.0 },
    paved: { tex: "concrete_floor_01", macro: 0.10, scale: 0.08, sat: 0.4, nor: 0.8, rough: 1.0, notile: true, tint: [1.15, 1.15, 1.15], wet: 1.0 },
    plaza: { tex: "stone_tiles_02", macro: 0.08, scale: 0.08, sat: 0.6, nor: 1.0, rough: 1.0, tint: [1.0, 1.0, 1.0], wet: 1.0 },
    gravel: { tex: "rocks_ground_02", macro: 0.15, scale: 0.05, sat: 0.35, nor: 1.2, rough: 1.0, notile: true, tint: [1.0, 1.0, 1.0], wet: 0.8 },
    dirt: { tex: "brown_mud_dry", macro: 0.18, scale: 0.05, sat: 0.8, nor: 1.0, rough: 1.0, notile: true, tint: [1.0, 1.0, 1.0], wet: 0.6 },
    curb: { tex: "concrete_wall_007", macro: 0.10, scale: 0.12, sat: 0.4, nor: 0.7, rough: 1.0, tint: [1.3, 1.3, 1.3], wet: 1.0, grime: 0.25 },
    terrain: { tex: "aerial_grass_rock", macro: 0.35, scale: 0.004, sat: 0.7, nor: 0.6, rough: 1.0, notile: true, tint: [0.62, 1.0, 0.52], wet: 0.3 },
    rubble: { tex: "broken_wall", macro: 0.12, scale: 0.1, sat: 0.7, nor: 1.2, rough: 1.0, notile: true, tint: [1, 1, 1] },
  };
  /* BIM material names with photographic maps (same table as PBR / PBR_MACRO / PBR_NOR in scripts/esworld/bl_bim.py) */
  const BIMTEX = {
    brick: ["red_brick", 0.12, 1.0], brick_brown: ["red_brick_03", 0.12, 1.0], stucco: ["plastered_wall", 0.06, 0.3], stucco_white: ["plastered_wall", 0.05, 0.3], stucco_peach: ["plastered_wall", 0.06, 0.3],
    concrete: ["concrete_wall_007", 0.10, 0.6], concrete_light: ["concrete_wall_007", 0.10, 0.6], polished_concrete: ["concrete_floor_01", 0.06, 0.5], stair_concrete: ["concrete_floor_01", 0.06, 0.5],
    roof_shingle: ["grey_roof_01", 0.10, 1.0], asphalt_shingle_dark: ["grey_roof_01", 0.10, 1.0], roof_tile: ["clay_roof_tiles_02", 0.08, 1.0], roof_membrane: ["gravel_concrete", 0.10, 1.0],
  };
  const TEXFAM = { siding: ["exterior_wall_cladding", 0.06, 1.0], metal_rib: ["box_profile_metal_sheet", 0.04, 1.0], wood_floor: ["wood_floor", 0.04, 1.0], carpet: ["dirty_carpet", 0.05, 1.0], tile: ["interior_tiles", 0.03, 1.0],
    wood: ["oak_veneer_01", 0.06, 1.0], fabric: ["rough_linen", 0.04, 1.0], plaster: ["plastered_wall", 0.04, 0.3], stone: ["concrete_floor_01", 0.04, 0.5], steel: ["metal_plate", 0.05, 0.8], metal: ["metal_plate", 0.05, 0.8] };
  const METALLIC = { metal_panel: 0.85, roof_metal: 0.8, frame_dark: 0.6, door_metal: 0.7, metal_furn: 0.45, steel: 0.9, rail: 0.5, grating: 0.9, lockers: 0.25, appliance: 0.3, rack_blue: 0.2, rack_orange: 0.2, machine_green: 0.2, machine_yellow: 0.2 };
  const EXTERIOR_GRIME = { brick: [0.22, 0.14], brick_brown: [0.22, 0.14], stucco: [0.30, 0.2], stucco_white: [0.30, 0.2], stucco_peach: [0.30, 0.2], concrete: [0.28, 0.2], concrete_light: [0.28, 0.2], siding: [0.18, 0.1] };

  function build(spec, name) {
    const set = texSet(spec.tex), m = set.meta, T = THREE, tint = spec.color ? spec.color : null;
    // colour: the photo is multiplied by tint; an explicit target albedo (BIM rgb) is divided by the mean colour of the photo
    let col;
    if (spec.target) col = spec.target.map((v, k) => Math.min(30, Math.max(0.08, v / Math.max(1e-3, m.avg[k])))); else col = spec.tint || [1, 1, 1];
    const mat = new T.MeshStandardMaterial({ color: new T.Color(col[0], col[1], col[2]), map: set.map, normalMap: set.nr, roughnessMap: set.nr, roughness: spec.rough == null ? 1 : spec.rough, metalness: spec.metal || 0, envMapIntensity: 1.0, vertexColors: !!spec.vertexColors });
    mat.name = name || spec.tex; mat.userData.tile = m.tile; mat.userData.pbr = spec.tex;
    patch(mat, { paint: spec.paint, macro: spec.macro, macroScale: spec.scale, sat: spec.sat, nor: spec.nor, notile: spec.notile, grime: spec.grime, streak: spec.streak, wet: spec.wet, groundY: spec.groundY, uvx: spec.world ? 1 / m.tile : 1, uvy: spec.world ? 1 / m.tile : 1 });
    return mat;
  }
  /* ES.pbr.material("brick", {target:[r,g,b] linear albedo, rough, metal, nor, macro, world:true for ground meshes in metres}) */
  P.material = function (family, opts = {}) {
    const key = family + "|" + JSON.stringify(opts); if (STATE.mats[key]) return STATE.mats[key];
    const f = FAM[family]; if (!f) throw new Error("ES.pbr: unknown family " + family);
    const mat = build(Object.assign({ world: true }, f, opts), family); return (STATE.mats[key] = mat);
  };
  P.ground = (kind, opts) => P.material(kind, opts);
  /* road paint: worn, chipped, on top of the asphalt grain (normal / roughness of the asphalt photo); rgb = linear albedo */
  P.paint = function (rgb) {
    const key = "paint|" + rgb.join(","); if (STATE.mats[key]) return STATE.mats[key];
    const mat = build({ tex: "asphalt_02", paint: rgb, world: true, notile: true, rough: 0.8, nor: 0.9, macro: 0, tint: [1, 1, 1] }, "paint"); mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4; return (STATE.mats[key] = mat);
  };
  /* a BIM material row ({name, rgb, rough, tex, trans, ...}); returns null when this material has no photographic version (the caller keeps its own) */
  P.fromBim = function (row, opts = {}) {
    const name = row.name, tex = row.tex; let id, macro, nor, grime = 0, streak = 0;
    if (BIMTEX[name]) [id, macro, nor] = BIMTEX[name]; else if (TEXFAM[tex]) [id, macro, nor] = TEXFAM[tex]; else return null;
    if (/glass|light|blinds|grating|screen|^curtain$/.test(name) || tex === "glass" || tex === "light" || tex === "blinds" || tex === "grating") return null;
    if (EXTERIOR_GRIME[name] && opts.weather !== false) [grime, streak] = EXTERIOR_GRIME[name];
    const key = "bim:" + name + "|" + row.rgb.join(",") + "|" + (opts.weather === false ? 0 : 1) + "|" + (opts.groundY || ""); if (STATE.mats[key]) return STATE.mats[key];
    const target = srgb3(row.rgb), metal = METALLIC[name] || 0;
    const mat = build({ tex: id, target, macro, scale: 0.05, nor, metal, grime, streak, sat: 1, wet: 0.7, groundY: opts.groundY }, name);
    mat.userData.bimRough = row.rough; return (STATE.mats[key] = mat);
  };
  /* window glass: Fresnel reflection of the sky / sun (standard specular IBL), most of the light behind passes through (absorb = share absorbed by the pane, tint = colour of the pane) */
  P.glass = function (opts = {}) {
    const absorb = opts.absorb == null ? 0.16 : opts.absorb, tint = opts.tint || [0.55, 0.7, 0.75], key = "glass|" + absorb + "|" + tint.join(",") + "|" + (opts.refl || 0) + "|" + (opts.rough || 0) + "|" + (opts.milk || 0); if (STATE.mats[key]) return STATE.mats[key];
    const T = THREE, cls = opts.refl ? T.MeshPhysicalMaterial : T.MeshStandardMaterial;
    const mat = new cls({ color: opts.milk ? new T.Color(0.2, 0.22, 0.23) : new T.Color(0, 0, 0), roughness: opts.rough == null ? 0.03 : opts.rough, metalness: 0, transparent: true, opacity: absorb, depthWrite: false, side: T.DoubleSide, envMapIntensity: 1.0,
      blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor });
    if (opts.refl) mat.reflectivity = opts.refl;
    mat.userData.glass = true; mat.userData.tile = 1; mat.userData.tint = tint; return (STATE.mats[key] = mat);
  };
  /* a BIM glass row: curtain_glass = coated (reflective, tinted), glass = clear, glass_frosted = milky */
  P.glassFor = function (row) {
    const n = row.name, t = row.trans == null ? 0.85 : row.trans, c = row.rgb.map((v) => v / 255);
    if (/frosted/.test(n)) return P.glass({ absorb: 0.5, rough: 0.38, tint: c, milk: 1 });
    if (/curtain/.test(n)) return P.glass({ absorb: Math.min(0.7, 1 - t * 0.9), rough: 0.03, tint: c, refl: 0.55 });
    return P.glass({ absorb: Math.min(0.5, Math.max(0.1, 1 - t)), rough: 0.03, tint: c });
  };
  P.setWet = (w) => { STATE.wet.value = Math.max(0, Math.min(1, w)); };
  P.wet = () => STATE.wet.value;
  P.pending = () => STATE.queue.length + STATE.active + STATE.ready.length;
  P.stats = () => ({ sets: Object.keys(STATE.sets).length, loaded: STATE.loaded, failed: STATE.failed, pending: P.pending(), estimatedMB: +(STATE.bytes / 1048576).toFixed(1), materials: Object.keys(STATE.mats).length });
  P.setRenderer = (r) => { STATE.renderer = r; };
  P.MANIFEST = MANIFEST; P.FAM = FAM; P.texSet = texSet; P.tileOf = (id) => (MANIFEST[id] ? MANIFEST[id].tile : 1);
})();
