# Asset credits (web/assets)

One line per asset family: name, source URL, licence, what was changed.

- rover.glb, veh_*.glb, tree_*.glb: own models exported from Blender by `scripts/export_glb_assets.py` / `export_tree_assets.py` (project assets). (go2.glb / x2.glb were superseded by `robots/` and removed.)

## Humans (web/assets/humans/*)

- `humans/*.glb` (eight people): Microsoft Rocketbox avatars (https://github.com/microsoft/Microsoft-Rocketbox, MIT licence, copyright Microsoft Corporation; project copy in assets/humans/rocketbox): Construction_Male_02, Construction_Female_01, Male_Adult_03, Female_Adult_02, Male_Adult_06, Female_Adult_05, Business_Male_01, Female_Adult_07.
  Changed: textures resized (body 1024 px, head / hair 512 px, normals 512 px), uniform scale to the roster height, poses baked as animation clips (planted-foot gait, own code), hi-vis vest overlay + helmet camera added (own geometry), materials rebuilt (`scripts/export_human_assets.py`).

## Robots (go2, x2)

- `robots/go2.glb`: Unitree Go2 CAD from MuJoCo Menagerie (https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_go2, BSD-3-Clause, (c) Unitree Robotics); cleaned, decimated, head split off, lamps / camera glass / rear light bar added (`scripts/export_robot_assets.py`).
- `robots/x2.glb`: Skydio X2 class UAV modelled here; the Menagerie X2 (https://github.com/google-deepmind/mujoco_menagerie/tree/main/skydio_x2, Apache-2.0) was only a size reference.

## Rover and vehicles

- Lamp lenses, light bars, rover lamps and LiDAR puck: procedural, `web/js/vehicles.js` (own code, no third-party assets). Vehicle and rover meshes are the project's own Blender models (see the first line).

## Props (web/assets/props/*)

- `props/placements_<scene>.json`: street-furniture placements computed by `scripts/export_props.py` from the project's own world data (esworld.placement_props). All prop geometry (lamps, fences, bins, mailbox, hydrants, bollards, stop signs, benches) is procedural three.js code in `web/js/props.js`; no third-party models or textures.

## Audio (web/assets/audio/*)
- *.ogg + manifest.json: own sounds rendered by `scripts/export_web_audio.py` with the project's acoustics library (`scripts/esworld/acoustics`; rotors, robot, sirens, footsteps, birds, wind, hums ...) and a formant speech synthesiser; no recordings, no third-party audio (project assets).

- tex/<id>/{d,n}.jpg (34 texture sets: aerial_grass_rock, asphalt_02, asphalt_04, beige_wall_002, box_profile_metal_sheet, broken_wall, brown_mud_dry, clay_roof_tiles_02, cobblestone_floor_08, concrete_floor_01, concrete_floor_worn_001, concrete_wall_007, corrugated_iron, dirty_carpet, exterior_wall_cladding, factory_wall, forrest_ground_01, gravel_concrete, grey_roof_01, interior_tiles, laminate_floor_02, large_grey_tiles, leafy_grass, metal_plate, metal_plate_02, oak_veneer_01, plastered_wall, red_brick, red_brick_03, rocks_ground_02, rough_linen, rusty_metal_sheet, stone_tiles_02, wood_floor): Poly Haven (https://polyhaven.com/textures), CC0; resized to 1k / 512, normal xy + roughness packed into one JPEG (`scripts/export_web_textures.py`). Poly Haven licence: https://polyhaven.com/license
- sky/<look>.png|json (day_cloud = kloofendal_48d_partly_cloudy_puresky, overcast = overcast_soil_puresky, sunset = belfast_sunset_puresky, dawn = kiara_1_dawn, night = satara_night_no_lamps, moonlit = moonlit_golf): Poly Haven HDRIs (https://polyhaven.com/hdris), CC0; sun removed, ground replaced, downsampled to 2k / 1k, RGBE in PNG (`scripts/export_web_textures.py --hdri`).
- Backdrop (distant buildings, tree cards, terrain tint): generated procedurally in the browser (`web/js/env.js`), no external assets.
