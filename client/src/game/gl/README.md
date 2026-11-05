# GPU pixel renderer

The default renderer is Three.js/WebGL2. `?renderer=cpu` selects the original
software renderer. `?rig=procedural` exercises a real `SkinnedMesh` built from
`BONES`/`REST_JOINTS`, with the same pose adapter used for loaded models.

## Boundary and ownership

- `pixel/renderer.ts` computes a reusable `SceneFrame`: JointPoses, looks, balls,
  lane marks and camera shake. The added presentation clock, stroke timestamp
  and playing flag drive only atmosphere. Gameplay, animation targets, score,
  beatmap generation, input and audio timing are unchanged.
- `scene/camera.ts` supplies the shared orthographic projection. The camera and
  original prop ground placements have not changed.
- `scene/backend.ts` copies the chosen renderer's canvas into Canvas2D and
  collects timings. Context loss temporarily selects CPU; restoration resumes
  WebGL. Returning the actual backend kind keeps CPU/context-loss snow working.
- HUD, judgement text, hold rings, sparks, countdown and fade remain 2D overlays.
  Screen-space snow runs only for the CPU backend.

## GPU pipeline

Everything is rasterized at **384 × 216**, DPR 1, without MSAA, with nearest
upscaling. The scene has two colour attachments (display RGB and normals/mask)
and a nearest-filtered depth texture. A final depth/normal pass applies pixel
outlines and the lamp halo. There is no production readback or screen-resolution
blur, bloom or other effect.

`material.ts` supplies five-tone lighting, cool shadows, 4×4 Bayer dither, warm
sodium attenuation and distance haze. GLB linear base colours are converted back
to their authored display RGB before this shader. A shared lamp-level uniform is
set synchronously immediately before each backend render. It affects the bulb,
all pixel lighting, ground pool, halo and snow.

The original 1024² moon and lamp shadow maps and soft static proxy silhouettes
are retained. Figures and paddles cast from their moving geometry. Separate
depth materials for instanced spheres, capsules and paddles avoid repeatedly
switching Three's shared depth material between skin/instance shader variants.

## Authored props and characters

`props.ts` loads table, bench, lamppost, both bare trees and building facade once.
It bakes glTF Y-up to game Z-up, world placement and material attributes, then
merges all static colour geometry (including ground and net) into **one draw**.
The old complete yard remains visible until the replacement is ready; missing
or invalid props retain it. Aborts and disposal release late async results.

Facade panes remain separate only while loading: a deterministic random ranking
lights exactly **18 / 74 (24.3%)** warm. All other panes stay dark. The authored
facade has five floors; no camera adjustment is made to expose them during play.

Subpixel authored net strands are replaced by a 28% Bayer-covered dark mesh.
The original white tape gets a small width compensation and an unoutlined pale
material so it remains a continuous approximately one-pixel line from this view.

`paddles.ts` draws both copies of `paddle.glb` in one instance batch. The baked
asset has blade direction +Z and red normal +Y. Its grip origin is
`paddle.center - .145 * paddle.up`; its orthonormal basis follows the supplied
up/normal directly. Loading failure retains the procedural paddles.

`figures.ts` loads `player.glb` and `stranger.glb` with capsule fallback. See
`tools/blender/README.md` for the assets, material names and axes. `PoseRetargeter`
aims bone local Y at each joint pair, retains rest roll, derives twist from
forward/chestForward and resolves matrices through the actual parent. No glTF
animation clips, authored texture maps or morph-target cloth are consumed.

Authored right hands use the GLB's grip metadata to seat the mitten around the
unchanged paddle transform. The forearm meets that corrected wrist; the shared
animator's joint output and procedural/CPU rigs are unchanged. Imported material
sidedness is retained, including the recessed hood closure. The `face_void`
vertices follow the existing `Look.face` flicker and return to their idle colour.

## Atmosphere

- `lamp.ts`: deterministic brief dips, two 60Hz visual ticks, with events 24–40 s
  apart. Three sparse Bayer rings around the projected bulb are depth occluded.
- `weather.ts`: 360 seeded GPU points, 1–2 pixels, falling and gently swaying in
  world space. Depth tests hide flakes behind props/people. Brightness uses
  discrete bands inside the lamp pool. Only a time uniform changes each frame.
- `breath.ts`: a fixed 64-point ring. Player idle puffs every 2.6–3.5 s, short
  puffs 75 ms after strokes; stranger puffs every 3.6–4 s at lower coverage.
  Particles drift out/up, remain 1–3 pixels and evaporate through Bayer discard.
  Effects use their own surface-mask value to avoid dark outlines on flakes.
- `footprints.ts`: a 192×256 one-channel accumulation map, **48 KiB**, covering
  the 6×8 m snow patch around the table. Grounded ankles/toes stamp oriented
  sole shapes only on contact/movement. Standing does not repeatedly stamp.
  It uploads only after stamping or decay (one byte level per six seconds),
  quantizes into three trample levels and resets when a new song begins.

All particle buffers, instance matrices and ground storage are preallocated and
reused. No explicit arrays/objects/vectors/geometries are created in the new
per-frame effect update paths. This is **not a claim of zero JS heap allocation**:
CDP sampling still detects numeric/runtime allocations and Three internals
(including sorting, uniform upload and texture cache keys): approximately
4.6 KB/frame in a warmed 960-frame, 512-byte-interval CDP sample. Existing Canvas2D
text/spark helpers and CPU rendering also retain legacy allocations. See the
allocation report instead of treating stable buffers as a whole-engine proof.

## Reproduce verification

Use the worktree's linked dependencies; do not run npm install:

```sh
cd client
../node_modules/.bin/tsc --noEmit -p .
../node_modules/.bin/vite build
../node_modules/.bin/vite --port 3140 --strictPort
```

If this worktree lacks Three despite the shared symlink, the repository helper
`sh tools/blender/prepare_three.sh` fetches exactly r170 into ignored local
output without changing shared dependencies. The matching `@types/three` must
also be resolvable for type-checking.

From the worktree root with that server running:

```sh
node tools/shot.mjs --url http://localhost:3140/ --out tools/out/menu.png --port 9441
node tools/shot.mjs --url 'http://localhost:3140/?renderer=cpu' --out tools/out/cpu-menu.png --port 9443
node tools/shot.mjs --url http://localhost:3140/ --out tools/out/final-check.png --port 9441 \
  --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 6000 \
  --eval tools/gl-bot.js --after tools/fx-checks.js
node tools/shot.mjs --url http://localhost:3140/ --out tools/out/final-full-song.png --port 9442 \
  --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 6000 \
  --frames 3 --every 60000 --eval tools/gl-bot.js --verify true
node tools/fx-profile.mjs
```

For deterministic visual regressions, run `tools/shot.mjs --after
tools/visual-qa.js` on a running server. The `*-checks.json` must have an empty
`failures` array. It saves native-resolution normal/flicker/restored frames and
inspection-camera grip details, tests static pixels over 60 presentation ticks,
and checks both authored grips and sleeve junctions through 49 poses. The
inspection camera is confined to the check; gameplay keeps its original view.

`fx-checks.js` waits for authored assets, tests 48 paddle orientations, physically
occludes a test flake behind a head, measures flicker cadence, verifies footprint
contact/decay, times 180 warmed render+copy frames and checks buffer identities
and GPU resource counts. Its facade overview uses a verification-only camera.
`gl-checks.js` retains the 49-pose bone/vertex and binary glTF round-trip checks.
The bot sends real keyboard events against the audio clock and never writes
score/timing. Shot/profile tools close their Chrome processes and remove their
temporary profiles. Stop Vite separately when finished.

## Measured on Apple M3 Max / Chrome ANGLE Metal

A representative seven-ball scene with both authored characters:

- Main-thread GPU submission: median **0.40 ms**, p95 **0.70 ms** (180 warmed
  samples). Submission plus Canvas2D copy had the same rounded results.
- GPU execution, measured separately by asynchronous timer queries: median
  **0.50 ms**, p95 **0.74 ms**. Do not add these timings as end-to-end latency.
- **43 draw calls**, including both shadow maps, effects and outline pass;
  **18 geometries / 10 textures**, unchanged throughout the timed sample.
- Paddle centre/axis error below **1.3e-7 m** over 48 poses. Test snow flake:
  zero changed pixels behind the head, four pixels in front.
- Ten-minute 60Hz flicker check: 18 events, two ticks per dip, interval range
  **24.9–37.6 s**. Footprints remain after a three-minute fade.
- Full 178.868 s song: **388 perfect, 0 good, 0 ok, 0 miss**, combo 388, completed.

`tools/out/` holds PNG stages, before/after sheets, playthrough JSON, timings and
heap profiles; it is not committed. CPU/GPU images now intentionally differ in
props and atmosphere. Vite builds successfully with its existing large-chunk
advisory. The existing React countdown-render warning is unrelated to this work.
