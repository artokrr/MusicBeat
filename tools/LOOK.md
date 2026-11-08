The new default keeps the courtyard cold, but the lamp has warm air, warmer flakes,
a controlled highlight rolloff and a faint reflection on the table. Black hood
materials get no bounce, glints or grade. All work happens at 384x216; the existing
nearest upscale, outlines and five material tones remain. `?look=old` selects the
original shader and CPU colour path, independently of `?renderer=cpu`.

The old shadow path multiplied already-lit RGB by (0.64, 0.65, 0.76), or a
checkerboard of that and (0.8, 0.8, 0.87). A moon occluder therefore removed up to
36% of the lamp's red contribution too, leaving a conspicuous pink silhouette.
The new GL path applies each visibility to its own light before tone selection.
Snow uses a 0.46 sky fill and 0.24 directional strength (about 0.169 on horizontal
snow), so the remaining moon silhouette is faint in the sodium pool. Lamp-blocked
snow loses the warm term and falls back to the same cool sky palette. These are
art-directed display-RGB approximations, not a linear/path-traced renderer.

Tabletop shadow lookup no longer projects the receiver onto the ground. A nine-tap
shadow filter uses blocker/receiver separation to grow from 0.45 to 7 shadow-map
texels; three visibility bands and Bayer coverage express the penumbra. The centre
sample estimates blocker depth, so this is a cheap contact-hardening approximation,
not a full blocker search. Existing static caster proxies remain.

Contact ellipses anchor table/bench legs, recorder, basket and trees, plus four
moving foot contacts which disappear when lifted. The CPU fallback adds these cues
and softens shadow stamps by caster height, separating moon/lamp attenuation using
cached lamp weights. CPU shading remains an approximation over baked RGB and does
not get the GL atmosphere, glints or bounce.

Kept after native-size inspection:

- Twelve fixed height slices integrate the lamp cone up to scene depth in the
  existing final pass. The volume is subtle and depth-clipped, but does not trace
  volumetric shadows through the shadow maps. Snow uses the same cone dimensions.
- Existing bulb Bayer rings plus two-pixel, emissive-tagged window halation. The
  gameplay camera shows little facade; this matters mainly where panes are visible.
- Low snow bounce on lower surfaces, excluding the dark face closure; slight cool
  grade elsewhere. No broad object recolour.
- Fixed world-cell ice glints and a faint quantized table sheen. No animated glitter.
  A separate paddle highlight was omitted to preserve its small readable silhouette.

Taste controls:

- `client/src/game/gl/material.ts`: visibility radius 0.45–7, snow fill 0.46 / moon
  0.24, warm snow vector (0.48,0.33,0.17), contact strength 0.28, bounce 0.065,
  glint threshold 0.996, table sheen 0.10, final grade.
- `gl/atmosphere.ts`: cone slope 0.63, density 0.024, 48-step Bayer volume and
  32-step pane halation. `gl/weather.ts` shares the cone shape and flake colours.
- `gl/contacts.ts`: static ellipse locations/radii and grounded-foot thresholds.
- `pixel/engine3d.ts`: CPU height penumbra and independent shadow attenuation.

Verification on Apple M3 Max, Chrome ANGLE Metal (one sequential warmed run per
look; 60 warmup + 240 measured GL submissions; async timer queries):

| Cost, ms median / p95 | old | new |
| --- | --- | --- |
| GL main-thread submission | 0.600 / 1.300 | 0.500 / 1.300 |
| GL submission + Canvas2D copy | 0.700 / 1.300 | 0.600 / 1.500 |
| GPU execution | 0.379 / 1.060 | 0.440 / 1.051 |
| CPU fallback render (180 samples) | 1.200 / 1.600 | 1.300 / 1.600 |

Both: 45 draws, 20 geometries, 10 textures, stable during measurement, GL error 0.
This is desktop evidence, not a weak-phone GPU guarantee or a statistical speedup.
No new explicit per-frame JS allocations: contact storage, tint scratch and CPU
shadow planes are created once; atmosphere is shader work with no extra draw.
Three/V8 and the existing CPU rasterizer still allocate; no whole-engine zero-heap
claim is made.

TypeScript and Vite build passed (existing large-chunk advisory). The requested
real-song gate completed Night, Blooming Jasmine: 393 perfect, 0 good/ok/miss,
combo 393. `tools/out/look-full-playthrough.json` is the result. The image parity
gate compares eight fully loaded GL frames and eight CPU frames against task head
`816fcbcec9a7fdb3bb0f4140e14204b1131e1653`: 0 changed pixels and 0 maximum channel
difference. The initial generic perf fixture had load-dependent breath history;
`look-checks.js` pins poses, clocks and effect history and waits for both GLBs.

Reproduce with linked dependencies (never install):

```sh
cd client
../node_modules/.bin/tsc --noEmit -p .
../node_modules/.bin/vite build
../node_modules/.bin/vite --port 3230 --strictPort
# from the worktree root, one at a time:
python3 tools/look-baseline.py
node tools/shot.mjs --url 'http://localhost:3230/?look=old' --out tools/out/look-old-fixed/capture.png --after tools/look-checks.js --port 9534
node tools/shot.mjs --url 'http://localhost:3230/?nointro' --out tools/out/look-new-fixed/capture.png --after tools/look-checks.js --port 9534
node tools/shot.mjs --url 'http://localhost:3230/?nointro' --out tools/out/look-full.png --eval tools/gl-bot.js --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 1000 --verify true --port 9531
node tools/look-video.mjs
python3 tools/look-artifacts.py
```

The baseline helper temporarily restores the three original GL source files and
restores working versions in `finally`; do not run other captures concurrently.
The CPU baseline PNGs were captured before implementation using perf-frames.js.
All runners use muted headless Chrome and close it; stop Vite separately.

Deliverables (ignored, not committed): `tools/out/look-before-after.png`,
`look-before-after.mp4` (2304x648, side by side at 3x), `look-new-1080p.mp4`
(1920x1080, nearest 5x), and `look-cpu.png`. Both videos are 15.035 seconds, 60 fps,
H.264/AAC. Audio is captured from Web Audio into an in-page MediaStream, never
speakers (measured mean -17.6 dB, peak -5.5 dB). The comparison renders the same
live SceneFrame through both shader variants, sharing the current HUD overlays;
the high-res video is the unmodified new canvas half. Native video was inspected.

Machine-readable evidence: `look-old-parity.json`, `look-{old,new}-fixed/capture-checks.json`,
`look-cpu-{before,after}/capture-checks.json`, `look-full-playthrough.json` and
`look-build.log`, all under `tools/out/`.
