# Model verification — 2026-11-06

Completed with Blender 5.2.3, three.js r170, Vite 5.4.21, and headless Google Chrome. Full `sh tools/blender/rebuild.sh` completed successfully. All PNGs are ignored local artifacts under `tools/out/`.

## Exported GLB results

| File | Triangles | Loaded meshes | Bytes |
|---|---:|---:|---:|
| `stranger.glb` | 1,212 | 5 | 124,700 |
| `player.glb` | 1,359 | 5 | 143,680 |
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
- Maximum normalized skin-weight sum error: **2.98023223877e-08**.
- Browser errors: **0**. All nine GLBs loaded and rendered with GLTFLoader.
- Required named materials `face_void`, `emissive_bulb`, `window_lit`, and `window_dark` are present.
- Independent GLB JSON audit found no images/textures; base colours match requested sRGB values within **0.000005 byte units** after linear-to-sRGB conversion.
- Python syntax, Node syntax, shell syntax and `git diff --check` passed.

## Visual inspection

Opened the supplied CPU screenshot and compared its camera composition. Opened the Blender rest/front/side/back sheet, full forehand/crouch turnarounds for both characters, all seven props, and the 384×216 courtyard at 3× nearest enlargement. Also opened the final three.js courtyard and pose/prop sheets.

The hood has a visible recessed dark opening, the coat reaches below the knee and separates into two tails, limbs remain slender, and the dropped player hood is visible from behind. Both posed rigs retain connected elbow/knee surfaces. Test-pose root placement is adjusted to ground the lowest sole; it does not alter exported rest transforms.

- `tools/out/stranger_poses.png`
- `tools/out/player_poses.png`
- `tools/out/props-sheet.png`
- `tools/out/courtyard_3x.png`
- `tools/out/three_courtyard_3x.png`
- `tools/out/three_stranger_poses.png`
- `tools/out/three_player_poses.png`
- `tools/out/three-props-sheet.png`
- Raw 384×216 views and corresponding 1152×648 nearest enlargements are also retained.

## Scope and limits

The requested nine models, generators and inspection page are complete. The game renderer/animation integration belongs to the other workstreams and was not changed. Browser posterization approximates the intended lighting; it is not a pixel-exact duplicate of the CPU renderer. Optional bin/fence/car were omitted. The requested five-storey facade is 12 m high instead of the CPU placeholder’s 9 m.

## Delivered GLB SHA-256

| File | SHA-256 |
|---|---|
| `bench.glb` | `2d0b1d576a37d02c3673283b3cb95d153c2e3bc05d565d7539312915d7abb25d` |
| `building_facade.glb` | `01a4fe82ccb9094b42abf03c08e024771e516cc53f1393b91daf4de2e14d66d5` |
| `lamppost.glb` | `5cf9d8e54d47e322d73c7ec1da1ec9d4c0114efd918c3b35085fa2657e358684` |
| `paddle.glb` | `51045afdf0fe13265707bdebfb25ae27a012000661ba57ead668527a283e2a37` |
| `player.glb` | `d500d79dcb3412084ff7104386efee6568ee1b4d3ccff7cdd0837d82d5ab22c6` |
| `stranger.glb` | `cffe4368daaa4544644492685079bd130639b2706dbc1c5e78890386b6496917` |
| `table.glb` | `e4a60cef04238824b6a1953dd71c40485fb8bd71a777df288ca3388ae58a50d5` |
| `tree_bare_a.glb` | `c1345b633cdb579afb2f7edbfe57bb4114d3e3547cbc80feb7d1db247864d385` |
| `tree_bare_b.glb` | `820ddee02edc32d547c87de891c5d13d08f384cd7f8070c0ef7de722bc42f824` |
