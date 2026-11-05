# Pong procedural models

All nine assets are original polygon geometry generated with Blender Python. No textures, downloaded art, sculpt data, or AI images are required. Generated GLBs and `client/public/models/manifest.json` are committed. Intermediate renders and verification dependencies live in ignored `tools/out/`.

## Rebuild

From the repository root, with Blender 5.2, Node, Python 3 + Pillow, and Google Chrome available:

```sh
sh tools/blender/rebuild.sh
```

This builds every GLB, imports the **exported GLBs** back into Blender, renders 18 character pose/view checks plus seven props and the courtyard, runs Vite on **3120**, verifies with headless Chrome CDP on **9421**, writes reports/contact sheets, and stops its server and Chrome. It refuses an occupied 3120; it never touches port 3000. Blender exits after each batch. No `npm install` runs. If the linked dependencies lack three r170, `prepare_three.sh` downloads the exact official `three@0.170.0` tarball into ignored `tools/out/three` and adds a local, ignored `client/node_modules/three` symlink; shared dependencies are unchanged.

For just the deliverable GLBs:

```sh
blender --background --python tools/blender/build_all.py
```

For interactive inspection:

```sh
cd client
../node_modules/.bin/vite --port 3120 --strictPort
# Open http://localhost:3120/model-test.html
```

`build_characters.py` and `build_props.py` can also be run with Blender individually. `build_all.py` additionally writes the combined manifest. `render_check.py -- --quick` renders only rest turnarounds, all props, and the courtyard; omit `--quick` for the full pose set.

## Axes, rig, skinning

Source coordinates are **metres, X right, Y forward, Z up**. Character origin is on the ground between the feet, facing **+Y**. A-pose joints are read directly from `client/src/game/rig/joints.ts`, not copied into an independent rig definition.

There is one armature with exactly the 17 names and parents in `BONES`. Bone heads/tails are exactly `REST_JOINTS[from/to]`; root is `spine`. Parenting is **unconnected**, preserving the required neck, shoulder and hip offsets. There are no helper/end bones, no scale correction nodes and no baked animations.

Blender bone **local +Y** points head to tail. Bone **local +Z** is the normalized projection of world forward `(0,1,0)` onto the plane perpendicular to the bone. Local X completes the right-handed frame (`X = Y × Z`). A world +Z fallback is implemented only for a bone parallel to world forward; no current contract bone needs it. `align_roll` establishes this convention for every bone.

The glTF exporter converts world positions `(x,y,z) → (x,z,-y)`; a freshly loaded GLB is **Y-up, forward -Z**. Bone-local +Y remains the longitudinal axis and bone-local +Z remains projected forward. The verification page reconstructs each tail using `bone.localToWorld(0, restLength, 0)` and compares it with converted `REST_JOINTS`. To use these assets in a Z-up three.js scene, put the loaded scene under a group rotated **+π/2 about X** (or convert the game positions/forwards to glTF coordinates). Do not apply both conversions.

Skinning uses normalized linear blend weights with at most three influences per vertex: blended shoulder rings, elbow/knee transition rings, rigid feet/hands, head rigid to `head`, neck/collar to `neck`, and torso primarily `spine`. The coat skirt retains 62–96% spine influence, with 4–38% matching thigh influence toward the split hem. Hood and void are rigid together so the opening cannot separate from its darkness. The dropped player hood follows spine. Test poses stress shoulder, elbow, knee and coat deformation; they are verification poses, not animation clips.

Meshes are consolidated by material (five skinned meshes per character). Character part names survive in mesh `extras.source_parts`. Facade panes `window_<row>_<column>` stay separate for runtime relighting; other facade geometry is consolidated by material.

## Origins and dimensions

Positions below are **game/Blender Z-up**, before glTF conversion. Assets contain no baked courtyard translation.

| Asset | Local origin / orientation | Place in courtyard |
|---|---|---|
| `stranger.glb` | Ground between feet; faces +Y; hood crown about 1.82 m, 1.78 m skeleton | Opposite end of table, yaw π |
| `player.glb` | Ground between feet; faces +Y; hair crown 1.783 m | Near end of table |
| `paddle.glb` | **Grip centre (0,0,0)**; shaft and blade extend +Z; red face normal **+Y** | Attach using grip transform |
| `table.glb` | Ground under tabletop centre; width X **1.525 m**, length Y **2.74 m**; green top **Z=.76 m** | `(0,0,0)` |
| `bench.glb` | Ground under seat centre; 1.8 m along Y; faces +X; back at X≈−.29 | `(-3,.6,0)` |
| `lamppost.glb` | Pole foot; vertical pole 3.3 m; arm extends −X | `(2.25,.35,0)` |
| `tree_bare_a.glb` | Trunk foot; sparse asymmetric crown, approximately 4.8 m | `(-3.4,3.6,0)` |
| `tree_bare_b.glb` | Trunk foot; independent deterministic branch pattern, approximately 4.8 m | `(3.9,3.9,0)` |
| `building_facade.glb` | Bottom centre of **front** wall; visible face points **−Y**, wall extends +Y | `(0,4.6,0)` |

The paddle blade is .15 m wide × .16 m high with centre `(0,0,.145)` and thin rubber on both faces. The wooden grip runs Z≈−.053 to +.063. For an animation that supplies **blade centre**, subtract `.145 * paddle.up` to obtain the grip origin. In loaded Y-up glTF, blade direction is +Y, red normal −Z, and blade centre `(0,.145,0)`.

Table white paint is a separate 1 mm layer; the green tabletop itself is exactly .76 m. Net posts/tape reach about .916 m. The net uses open polygon strands with no alpha textures. The lamp's named emissive bulb centre is approximately `(-.30,0,3.275)` locally; the game's light may remain at `(1.95,.35,3.25)`.

The facade is **24 × .6 × 12 m**, five 2.4 m storeys with 15 window columns, seams, sill snow, a double entrance and canopy. This intentionally extends the CPU placeholder's 9 m wall to meet the requested five storeys. The tree crowns use the requested 4–5 m range, preserving the CPU scene's ground placements.

## Materials

All names are stable, untextured, flat base colours. RGB values in the manifest/this table are **sRGB bytes**; Blender converts them to linear values before GLB export (do not interpret the glTF numeric baseColorFactor as sRGB).

| Materials | sRGB |
|---|---|
| `coat`, `trousers`, `shoes`, `stranger_skin`, `face_void` | 40/40/48; 30/30/38; 26/26/30; 190/160/146; 14/14/20 |
| `hoodie`, `jeans`, `sneakers`, `player_skin`, `hair` | 52/62/82; 36/38/46; 190/190/196; 206/170/150; 30/26/26 |
| `rubber_red`, `rubber_black`, `wood` | 150/46/50; 22/23/28; 96/78/66 |
| `table_green`, `court_line`, `metal`, `net_mesh` | 42/88/84; 214/218/226; 58/60/70; 40/42/52 |
| `snow`, `bark`, `wall` | 196/202/220; 52/48/50; 104/106/118 |
| `panel_seam`, `window_frame`, `door` | 78/80/92; 128/130/140; 24/22/26 |
| `window_lit`, `window_dark`, `emissive_bulb` | 214/172/116; 30/32/44; 255/190/116 |

`window_lit` has emission strength .55; `emissive_bulb` has strength 2. These are emissive **materials**, not exported punctual lights. Render code supplies lighting. All surfaces are rough; metal has a modest .15 metallic factor. No face exists inside the stranger's hood: `face_void` is a dark funnel and recessed closure.

## Verification outputs

- `tools/out/courtyard.png`, `courtyard_3x.png`: Blender render at **384×216**, exact yaw .2 / pitch .75 / target (.1,.1,.6), **44 px/m**, six-pixel vertical offset; 3× nearest-neighbour enlargement.
- `tools/out/{stranger,player}_{rest,forehand,crouch}_{front,side,back}.png` and `_3x.png`: imported-GLB turnarounds; corresponding `{stranger,player}_poses.png` contact sheets.
- `tools/out/props-sheet.png`: all seven props rendered and visually inspected.
- `tools/out/three_courtyard_3x.png`, `three_{stranger,player}_poses.png`, `three-props-sheet.png`: Chrome screenshots of GLTFLoader-rendered assets. The preview adds five lighting bands, ordered dither, cool light and a sodium lamp; this is a material-level approximation, not an exact copy of the CPU renderer.
- `tools/out/three-report.json`: actual loaded triangle counts, material names, exact bone names/parents, dimensions, rest head/tail errors, projected-forward roll errors, normalized weights and browser errors.

Blender checks use Cycles CPU, 24 samples, Standard colour management. They deliberately retain unposterized lighting so cloth planes and deformation remain inspectable; the browser proves readability under quantized lighting. No changes to the game renderer/animation integration are included. Optional bin/fence/car assets are not included.
