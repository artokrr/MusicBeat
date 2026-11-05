# GPU pixel renderer

The default renderer is Three.js/WebGL2. `?renderer=cpu` selects the original
software renderer. `?rig=procedural` exercises a real `SkinnedMesh` built from
`BONES`/`REST_JOINTS`, with the same pose adapter used for loaded models.

## Boundary and ownership

- `pixel/renderer.ts` computes one reusable `SceneFrame`: world-space JointPoses,
  looks, ball positions/colours/coverage, lane marks, flicker and camera shake.
  `playerPose` and `strangerPose` are the replaceable animation entry points.
- `scene/camera.ts` is the shared orthographic projection. The gameplay mapping,
  hit times, score logic, audio and beatmap generation are unchanged.
- `scene/backend.ts` lazily chooses a renderer, copies its canvas into the final
  2D canvas, and collects timings. Context loss temporarily uses the CPU backend;
  a restored context resumes WebGL. HMR disposes GPU resources.
- HUD, judgement text, hold rings, sparks, snow, countdown and fade remain the
  existing 2D overlays, after the scene copy and with the original shake rules.
- `pixel/courtyard.ts` supplies one shared static geometry recipe. The software
  path keeps its face-paint callbacks; semantic surface tags select equivalent
  GPU material logic.

## GPU pipeline

Everything renders at **384 × 216**, device pixel ratio 1, without MSAA. The scene
uses a two-attachment render target (colour, world normals/receiver mask) plus a
nearest-filtered depth texture. A fullscreen depth/normal pass applies the
original silhouette and depth-break darkening before the hidden WebGL canvas is
copied to Canvas2D. No GPU readback is used in production.

`material.ts` implements the original five tone scales/cool mixes, screen-aligned
4×4 Bayer pattern, downward sixth-power lamp attenuation, warm hue shift and
static distance haze. Output is already display RGB: there is no subsequent
photographic tone mapping or gamma conversion. Snow grain and window choices
are tiny, once-created material textures so JavaScript/GLSL hash precision cannot
change the composition. Lighting and rasterization stay on the GPU.

A 1024² directional shadow map supplies quantized/dithered moon shadows. A 1024²
spot shadow map supplies hard lamp shadows using a single depth comparison.
Static shadow proxies follow the CPU scene's explicit caster recipe: the wall
and tree branches do not cast; table/bench shadows retain their round contours.
The proxies render into real depth maps, with the original lamp reach and size
cap. Table receivers use the software renderer's screen-projected receiver rule.
Figures cast from the moving meshes. Balls also keep their small contact cue.

Static geometry is merged. Moving capsules and spheres use two reusable instance
batches, including real capsule endcaps and a flattened paddle blade. Scene
storage, pose outputs, instance attributes, matrices, and GPU timer queries are
reused. Existing Canvas2D text/effect helpers and the CPU reference still have
legacy allocations. Contact-shadow uniforms cover 64 simultaneous balls; colour
instances have capacity for 2,048 spheres (including lane marks).

## Optional authored GLBs

Place body skins at `client/public/models/player.glb` and/or `stranger.glb`.
Missing files or Vite's HTML fallback retain capsules. Invalid rigs warn and
retain capsules. Assets are loaded once per backend; reload after adding files.

The armature must use every name in `BONES`, with heads/tails at the corresponding
`REST_JOINTS`, in metres. Blender Z-up exports as glTF Y-up; the loader applies
one +90° X conversion. `PoseRetargeter` captures rest rotations (including bone
roll), aims the local Y axis at the target joint pair, derives twist from
`forward`/`chestForward`, stretches to the target length, and resolves the desired
world matrix through the actual parent. This supports disconnected bone heads
and armature wrapper objects. A deterministic fallback handles facing parallel
to a bone. The paddle remains driven directly by `JointPose.paddle`.

The pixel material preserves flat per-material colours. Authored texture maps,
normal maps, morph-target cloth and glTF animation clips are not consumed. The
actual artist GLBs were not present in this worktree during implementation;
a binary glTF round-trip fixture verifies the production loading/retarget path.

## Reproduce verification

Run from this worktree, using the shared dependencies (do not install into the
shared symlink):

```sh
cd client
../node_modules/.bin/tsc --noEmit -p .
../node_modules/.bin/vite build
../node_modules/.bin/vite --port 3110 --strictPort
```

From the worktree root, with that server running:

```sh
node tools/shot.mjs --url http://localhost:3110/ --out tools/out/menu.png --port 9411
node tools/shot.mjs --url 'http://localhost:3110/?renderer=cpu' --out tools/out/menu-cpu.png --port 9411
node tools/shot.mjs --url http://localhost:3110/ --out tools/out/compare.png --port 9411 \
  --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 7000 \
  --eval tools/gl-bot.js --after tools/gl-checks.js
node tools/shot.mjs --url http://localhost:3110/ --out tools/out/full-play-final.png --port 9413 \
  --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 7000 \
  --eval tools/gl-bot.js --verify true
```

The bot scrapes the actual Zustand module URL from `/src/App.tsx`, observes the
transition to `playing`, then dispatches lane keydown/keyup events against the
song's audio clock, retaining holds through their ends. It never writes score,
notes, health, or game timing. `--verify` fails unless the complete song finishes
with every note perfect. The fixture script resolves the current renderer module
URL from `Game.tsx` as well, including Vite's HMR query string.

The paired PNGs render one frozen gameplay description through both backends,
with 2D overlays omitted to expose differences. Normal menu/gameplay screenshots
include the overlays. The checks warm both renderers, measure 180 frames including
Canvas2D copy, collect asynchronous GPU timer queries, check 49 retarget poses
(22,197 sampled skinned vertices), and export/load a binary glTF fixture.
Screenshot tools close Chrome and remove their local temporary profile.

## Measured result (Apple M3 Max, Chrome / ANGLE Metal)

- CPU render + copy: median **1.3 ms**, p95 **1.5 ms**.
- GPU submission + copy on the main thread: median **0.2 ms**, p95 **0.3 ms**.
- GPU execution separately: median **0.42 ms**, p95 **1.27 ms**.
- **12 draw calls** including both shadow maps and the outline pass, with seven
  balls in the compared scene. GPU/CPU timings are different resources and must
  not be added to claim a measured end-to-end frame latency.
- Complete 178.868 s song: **388 perfect, 0 good, 0 ok, 0 miss**, combo 388,
  score 112,675, outcome `completed`.
- Maximum bone endpoint error below **2e-15 m**; all sampled skin vertices finite.
  Exported binary glTF endpoint error below **2e-15 m**.
- Both backends share palette, projection and scene state. Paired mean absolute
  RGB-channel difference is about **2.7 / 255** in the gameplay sample. The result
  is not bit-identical: triangle coverage, thin net/line edges, material grain,
  and the physically rasterized moving shadows differ from sphere/ellipse stamps.

`tools/out` is local verification output and must not be committed. The existing
React development warning about updating `GameScreen` during its countdown render
is observable on both backends; this renderer change does not alter that code.
Vite builds successfully, with its large-chunk advisory for the Three.js bundle.
