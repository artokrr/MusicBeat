# Model verification — character pass two, 2026-11-06

Completed with Blender 5.2.3, three.js r170, Vite 5.4.21, and headless Google Chrome. `sh tools/blender/rebuild.sh --characters-only` completed successfully. All seven prop GLBs and `client/src/game/rig/joints.ts` are byte-identical to `e6d6b76`. All PNGs are ignored local artifacts under `tools/out/`.

## Exported GLB results

| File | Triangles | Loaded meshes | Bytes |
|---|---:|---:|---:|
| `stranger.glb` | 1,640 | 5 | 163,096 |
| `player.glb` | 1,834 | 5 | 187,848 |
| `paddle.glb` | 272 | 3 | 17,004 |
| `table.glb` | 780 | 4 | 60,292 |
| `bench.glb` | 420 | 3 | 35,332 |
| `lamppost.glb` | 268 | 2 | 21,652 |
| `tree_bare_a.glb` | 1,054 | 1 | 55,860 |
| `tree_bare_b.glb` | 1,054 | 1 | 55,860 |
| `building_facade.glb` | 8,340 | 80 | 643,008 |

Both characters have exactly 17 bones, with the required names and parents. Every character mesh is skinned; all weights sum to one within floating-point tolerance.

- Maximum rest head/tail error against imported TypeScript `REST_JOINTS`: **3.38338885347e-07 m** (0.338 micrometres).
- Maximum projected-forward local-Z vector error: **9.91743412504e-07**.
- Maximum normalized skin-weight sum error: **4.47034835815e-08**.
- Browser errors: **0**. All nine GLBs loaded and rendered with GLTFLoader.
- Required named materials `face_void`, `emissive_bulb`, `window_lit`, and `window_dark` are present.
- Independent GLB JSON audit found no images/textures; base colours match requested sRGB values within **0.000005 byte units** after linear-to-sRGB conversion.
- Python syntax, Node syntax, shell syntax and `git diff --check` passed.

## Visual inspection

Compared baseline `e6d6b76` with two geometry iterations. Opened every final character view in the Blender and three.js sheets, all 12 front/back game-camera pose views, all six grip close-ups (three poses per character), both courtyard renders, the prop sheets, and all three before/after comparison sheets. Individual nearest enlargements were also inspected for the shoulder silhouette, hair intersections, side-on crouch and paddle grip.

- Shoulder shelves were replaced with a continuous neck/trapezius slope and lower sleeve caps; the first iteration's remaining ridge was removed by fixing the upper sleeve ring frame.
- Eight-sided sleeves/legs have fuller upper arms/calves and narrower forearms/ankles. Extra supported blend rings preserve the elbow/knee bends.
- Stranger: a mostly level, heavier A-line hem, broad back fold planes and rear vent; raised collar; deeper peaked hood with a recessed black cavity visible from front-above.
- Player: baggier sleeves/cuffs, a thick bunched hood, shaped short hair (first-iteration skin intersections corrected), jeans and dark sneaker uppers above light soles.
- Both right fists wrap the unchanged exported paddle handle. Grip renders verify rest, forehand and crouch without adding bones or changing the paddle.

`audit_deformation.py` measures the imported GLBs, not generator-only geometry. All four eight-vertex elbow/knee rings per character remain finite through rest, forehand and crouch (24 measured sections): minimum cross-sectional area **0.7489345644× rest**, minimum principal diameter **0.7889745300× rest**. The figures retain volume at the bends; no detached shoulder seam or candy-wrapper collapse was visible in the reviewed poses. This measurement does not prove arbitrary animation poses are collision-free.

Review artifacts (all under `tools/out/`):

- `before_after_game_3x.png`: old/new courtyard plus isolated game-size stranger front and player back; `before_after_game.png` retains native pixels.
- `before_after_stranger_game_3x.png`, `before_after_player_game_3x.png`: old/new rest, forehand and crouch at the game camera.
- `before/`: original character GLBs, manifest, report and baseline renders.
- `stranger_poses.png`, `player_poses.png`: nine Blender pose/view checks each.
- `three_stranger_poses.png`, `three_player_poses.png`: matching nine-view GLTFLoader sheets.
- `three_stranger_game_poses.png`, `three_player_game_poses.png`: six game-camera pose/view checks each.
- `stranger_grips.png`, `player_grips.png`: three imported-paddle grip checks each.
- `courtyard_3x.png`, `three_courtyard_3x.png`: 384×216 source renders enlarged 3× nearest.
- `three-report.json`, `deformation-report.json`: numerical validation results.
- `props-sheet.png`, `three-props-sheet.png`: unchanged props.

All character source PNGs are 384×216 and have corresponding 1152×648 nearest enlargements. The comparison source pixels were cropped/composited without interpolation; only the `_3x` copies are enlarged.

## Scope and limits

This pass changes only the two character assets, their generator/manifest entries, and verification tooling/documentation. All nine models remain loadable. The game renderer/animation integration belongs to the other workstreams and was not changed. Browser posterization approximates the intended lighting; it is not a pixel-exact duplicate of the CPU renderer. Optional bin/fence/car were omitted. The requested five-storey facade is 12 m high instead of the CPU placeholder’s 9 m.

## Delivered GLB SHA-256

| File | SHA-256 |
|---|---|
| `bench.glb` | `2d0b1d576a37d02c3673283b3cb95d153c2e3bc05d565d7539312915d7abb25d` |
| `building_facade.glb` | `01a4fe82ccb9094b42abf03c08e024771e516cc53f1393b91daf4de2e14d66d5` |
| `lamppost.glb` | `5cf9d8e54d47e322d73c7ec1da1ec9d4c0114efd918c3b35085fa2657e358684` |
| `paddle.glb` | `51045afdf0fe13265707bdebfb25ae27a012000661ba57ead668527a283e2a37` |
| `player.glb` | `d007658f8c171c0be41deeb746da8b3a06ffcba027ad51fdbed45a633abf6b27` |
| `stranger.glb` | `4f3401a85a953477eadcc88991c12cc07ab21bd67b433dd3bef522856be7a168` |
| `table.glb` | `e4a60cef04238824b6a1953dd71c40485fb8bd71a777df288ca3388ae58a50d5` |
| `tree_bare_a.glb` | `c1345b633cdb579afb2f7edbfe57bb4114d3e3547cbc80feb7d1db247864d385` |
| `tree_bare_b.glb` | `820ddee02edc32d547c87de891c5d13d08f384cd7f8070c0ef7de722bc42f824` |
