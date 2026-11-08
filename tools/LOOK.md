> The first-pass notes below are historical. See **Second pass: contrast** at the end for the current tuning and evidence.

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


## Second pass: contrast

Artem now sees a bright warm pool against darker cold snow, rather than beige
light on uniformly grey snow. The highlights are deliberately bright, with a
steeper outer falloff; the lamp-lit flakes and small volume retain their original
density. Moon/lamp visibility remains independent. Table receiver height,
contact ellipses, distance penumbra, halation, ice glints and table sheen remain.
The hood closure now explicitly rejects direct sodium tint too, in GL and CPU.

Current changes relative to a1871a6's new look:

- GL snow sky fill: 0.46 -> 0.25; directional moon: 0.24 -> 0.28.
- Visible lamp energy multiplier: 1 -> 1.35 (before the existing warm clamp).
- Snow warm RGB contribution: (0.48,0.33,0.17) -> (1.25,1.05,0.75).
- Highlight rolloff starts at 0.85 instead of 0.65; coefficient 0.30 instead of
  0.65. The output still clamps to display bytes. The bright centre consequently
  loses some grain detail, like the original pool.
- CPU ground uses the matching fill, lamp colour and rolloff. Its cached lamp
  weight uses this new energy split; lamp shadow loss is 0.85 instead of 0.65.
  Moon loss stays 0.22, contact 0.25. It is still a baked-colour approximation,
  without GL volumetrics/glints. No shadow-map bias or depth range changed.

Display-RGB luminance Y = .2126R+.7152G+.0722B, range 0..255. This is an art
comparison, not linear radiometry. Same native fixed-150 pose and clock:

| Region | Old a1871a6 | Previous new a1871a6 | Retuned |
| --- | ---: | ---: | ---: |
| Pool mean / peak | 229.69 / 241.86 | 177.74 / 213.40 | 237.77 / 245.93 |
| Courtyard away, mean | 148.80 | 146.17 | 105.18 |
| Table-shadow interior, mean | 103.76 | 141.99 | 102.24 |
| Former ghost area, mean | 184.72 | 156.87 | 214.77 |
| Pool pixels >=220 | 3166 | 0 | 3442 |

The ghost region is now illuminated snow, not a silhouette; its mean alone is
not an absence test. Native inspection confirms no pink cutout. The quantitative
regions and full falloff bins are in `out/look2-luminance.json`.
The footprint counts exposed snow in [240,114,380,151). Falloff at y132..138,
10-pixel bins, deliberately retains the old pole shadow near x320:

| Bin x | Old | Previous new | Retuned |
| --- | ---: | ---: | ---: |
| 270 | 235.86 | 183.41 | 239.20 |
| 310 | 223.76 | 168.33 | 237.00 |
| 330 | 223.03 | 163.00 | 220.73 |
| 350 | 194.73 | 156.54 | 181.05 |
| 370 | 175.21 | 152.42 | 149.26 |

The facade waves were authored procedural grain, not shadow acne. On a front
wall Y is constant; `noise(x*grain+z*3, y*grain+z*9)` stretches noise into horizontal
waves, then five-tone quantization makes them conspicuous. A frozen opening probe
with shadow visibility forced to 1 changes zero pixels. Removing grain changes
11,645 pixels (max channel delta 29). See `out/look2-facade-diagnosis.json` and
`out/look2-facade-probe/`. Both looks now use wall-plane XZ grain at amplitude
0.08 instead of 0.35 during the close-up. It blends back with a smoothstep from
intro progress 0.6 to 1. Gameplay uses the exact original expression, including
old look. The CPU opening is a separate flat elevation and had no such grain.

Files: `gl/material.ts`, `gl/props.ts`, `gl/renderer.ts`, `pixel/courtyard.ts`,
`pixel/engine3d.ts` under `client/src/game/`. No animation files changed.
Implementation commits: 4f56343 (opening grain), f11b775 (contrast / CPU / hood).

Validation:

- `tsc --noEmit -p client`: clean; Vite build passes, existing large-chunk warning.
- Requested song/keyboard bot: 393/393 perfect, completed, zero good/ok/miss,
  max combo 393. `out/look2-full-playthrough.json` and `out/look2-bot.log`.
- Eight GL and eight CPU old-look frames vs captures made at a1871a6: zero changed
  pixels and zero max channel delta. `out/look2-old-parity.json`.
- Explicit CPU frames plus an automatic fallback with Chrome `--disable-webgl`:
  `out/look2-cpu.png`, `out/look2-auto-cpu.png`, `out/look2-auto-cpu.log`. The latter
  log's context creation errors are the intentionally disabled WebGL path.
- Both videos: H.264/AAC, 60 fps, 15.030 seconds, nearest scaling. Side by side
  is 2304x648 (3x each); retuned only is 1920x1080 (5x). In-page Web Audio capture,
  Chrome muted, mean -17.6 dB / peak -6.1 dB. Native video inspected at 7 seconds.
- Deliverables: `out/look2-three-way.png`, `out/look2-before-after.mp4`,
  `out/look2-1080p.mp4`, `out/look2-intro-frames.png`, `out/look2-cpu.png`.

Reproduction: run the existing muted `shot.mjs` on port 3230 with
`--after tools/look2-checks.js` for GL, or `--after tools/look2-cpu-checks.js` for
CPU. The same eight pinned frames are used for both versions. Baseline directories
`look2-base-old`, `look2-base-cpu`, `look2-previous` were saved before edits at
a1871a6. Capture final `look2-old`, `look2-old-cpu`, `look2-retuned`, `look2-cpu`,
then `python3 tools/look2-artifacts.py` asserts pixel parity, pool mean/peak/area,
and darker courtyard/shadow samples. `node tools/look2-video.mjs` captures both
videos; the old panel removes premium defines and uses the original output pass.
All artifacts remain ignored; scripts and this report are committed.

Remaining taste controls: sky fill controls night depth, warm vector and rolloff
control the pool's white centre versus amber shoulder, and atmosphere density
(default unchanged at 0.024) controls haze. Avoid raising fill to brighten the
pool: it erases the very separation this pass restores.

Final isolated sequential measurement on Apple M3 Max / Chrome ANGLE Metal,
60 warmup + 240 GL submissions (239 completed GPU queries), 180 CPU samples:

| Cost, ms median / p95 | Old | Retuned |
| --- | ---: | ---: |
| GL main-thread submission | 0.700 / 1.500 | 0.900 / 1.700 |
| Submission + Canvas2D copy | 0.800 / 1.700 | 1.000 / 1.900 |
| GPU execution | 0.387 / 0.929 | 0.491 / 2.481 |
| CPU fallback | 0.900 / 1.400 | 1.300 / 1.700 |

Both GL runs: 45 draws, 20 geometries, 10 textures, stable resources and GL error
0. These desktop samples are not a mobile guarantee. GPU p95 is noisy (the prior
retuned capture measured 1.145 ms); report the final run rather than select the
fastest one. Detailed results: `out/look2-perf-{old,retuned}/capture-checks.json`
and `out/look2-perf-cpu-{old,retuned}/capture-checks.json`.

## Third pass: quiet ball cues, textured pool, moonlit form

Artem sees a smaller, textured warm pool, compact neutral ball cues instead of
moving yellow blobs, and darker bench/tree/character/table shadow masses. The
lamppost streaks lose their amber saturation. The hood exclusion remains intact.
The building edge gets a soft ground-value band, **not** a new full-building
shadow-map caster (that would cover most of this courtyard).

Implementation commits: `f7ac590`, then `8ffe8c4` (skip ball falloff math
outside the cue footprint; eight native frames remain pixel-identical). All changes are gated by the existing new-look
path; the old path's inputs and rendering operations stay intact.

Knobs, relative to 573b8f1:

- Snow sky fill .25 -> .19; directional moon .28 -> .40. Snow variation around
  the existing palette is amplified 1.2x. The far-wall band reaches 18% at y=4.6.
- Sodium multiplier 1.35 -> 1.05; snow RGB contribution (1.25,1.05,.75) ->
  (.85,.68,.43). Highlight shoulder .85/.30 -> .65/.65. This preserves grain
  through the centre instead of clipping it before depth haze.
- Shadow visibility still removes each light's own energy. After footprint wear,
  contact and haze, snow shadow luminance is retained but chroma is limited to
  55% of the corresponding unoccluded receiver. This is a display-RGB art
  constraint, not a claim of physically exact spectral lighting. In particular,
  cool receivers may become less blue; they must not gain warm excess or saturation.
- Ball kind 2 no longer casts into either GL shadow map. The vertical cue uses
  radius .038 -> .052 m over the first .8 m height, a soft edge and 30% peak loss.
  It fades between .45 and 1.8 m above its receiver. Its RGB ratio is
  (.985,.995,1). Table and snow receive the same cue. Old balls retain all their
  historical shadows.
- New shadow maps: 512 instead of 1024; five taps instead of nine, retaining the
  same UV penumbra extent. Eight volume slices instead of twelve, density .018
  instead of .024. No added draw calls. Pane halation stays unchanged.
- CPU: corresponding snow knobs, stronger moon loss .22 -> .55, lamp loss
  .85 -> .75, neutral ball cues with height fade. Desaturation is applied to the
  actual baked receiver; neutral haze avoids adding blue saturation back into
  dark shadows. CPU remains an approximation with soft stamps, not GL parity.
  One extra reusable 384x216 Float32 ball mask costs 324 KiB; no new per-frame
  mask allocations.

Fixed native frame 150, all display RGB Y = .2126R+.7152G+.0722B, range 0..255:

| Measurement | Old | 573b8f1 default | New |
| --- | ---: | ---: | ---: |
| Pool mean / peak | 229.69 / 241.86 | 237.77 / 245.93 | 188.37 / 229.61 |
| Clipped pool pixels before haze | 3192 | 3418 | 3 |
| Courtyard mean | 148.80 | 105.18 | 109.39 |
| Far courtyard mean | 104.73 | 80.40 | 76.23 |
| Bench moon shadow / equivalent lit snow | 103.63 / 141.58 | 62.17 / 99.95 | 49.01 / 102.46 |
| Moon-shadow value loss | 37.95 | 37.78 | 53.45 |
| Low pool-ball cue: pixels / mean loss | 20 / 79.04 | 20 / 74.76 | 8 / 34.14 |
| Pool-ball cue bounding box | 6x4 | 6x4 | 4x2 |
| Cue at 2.5 m height, pixels | 20 | 20 | 0 |
| Snow shadow warmer / more saturated samples | 994 / 13843 | 2084 / 9926 | 0 / 0 |

The three clipped pixels are isolated glints; there is no large clipped pool.
The comparison sheet includes balls in the pinned gameplay pose and a separate
controlled low ball in the pool crop. Ball counts above measure the vertical cue
only; the old/current extra light-projected ball shadows also disappear in new.
Moon contrast is measured at the bench away from sodium, not the lamp-lit table
edge. The table's leftward shadow is still weak in sodium; the large foreground
and bench/tree masses supply most of the restored form.

Colour regression checks compare rendered snow to the identical pixel with
visibility forced to one (same pose, texture, clocks). They then independently
compare nearby unshadowed pixels within 12 pixels, matching unoccluded RGB
exactly so texture or lamp falloff cannot masquerade as shadow colour.
Saturation=(max-min)/max, warm excess=max(0,R-B)/Y; tolerances .02 for chroma and
2 RGB luminance bytes. These are rendered receiver tests, not a universal proof
for every material/camera. New: 12,949 causal pixels and 5,012 adjacent pairs,
zero brighter/warmer/more-saturated failures. CPU: 22,341 changed receiver pixels,
zero failures. The same test deliberately detects the defect in both baselines.

Evidence under ignored `tools/out/`:

- `look3-three-way.png`: old | 573b8f1 | new at 4x, with native and 2x crops.
- `look3-before-after.mp4`: 573b8f1 | new, 2304x648, 60 fps, 15.03 s.
- `look3-1080p.mp4`: new, 1920x1080, 60 fps, same in-page audio.
- `look3-cpu.png`, `look3-motion-sheet.png`: CPU and sampled native video review.
- `look3-metrics.json`, `look3-old-parity.json`, `look3-artifacts.log`.
- `look3-{current,new,old}/capture-checks.json`: renderer cost and resources.
- `look3-video-metadata.json`, `look3-native-video-metadata.json`,
  `look3-audio-check.log`: encoded dimensions/rate and non-silent audio.

The native recording contains 895 video frames in 14.997 s (59.68 fps average);
exports are CFR 60. Audio is intercepted into MediaStream destinations, never
sent to speakers, and Chrome is always `--headless=new --mute-audio`.
Native stills and sampled motion frames were inspected. Subjective real-speed
playback judgment remains for Artem; no audible playback was performed.

Reproduction (Vite 3230 already running, linked node_modules, never install):

```sh
node tools/look3-baseline.mjs
# Before implementation, look2-checks.js / look2-cpu-checks.js saved the
# look3-base-old, look3-base-old-cpu, look3-current and look3-current-cpu fixtures.
# Current baseline GL can also be reconstructed without modifying any source:
node tools/shot.mjs --url 'http://localhost:3230/?nointro&probeBaseline' --out tools/out/look3-replay/capture.png --after tools/look3-checks.js --port 9531
# Capture final fixed frames/perf into look3-new and look3-old:
node tools/shot.mjs --url 'http://localhost:3230/?nointro' --out tools/out/look3-new/capture.png --after tools/look3-checks.js --port 9531
# For probes use look3-probes.js (GL) or look3-cpu-probes.js (CPU).
# URL probeBaseline restores 573b8f1 shaders and ball casters, look=old selects old.
python3 tools/look3-artifacts.py
node tools/look3-video.mjs
```

Remaining taste controls: moon/fill balance, the .55 snow-shadow chroma cap,
ball .30 strength / 1.8 m fade end, and pool vector/shoulder. The distant building
band and CPU neutral haze are deliberately cheap approximations. Desktop timing
is not a weak-device guarantee; avoid promising a speedup from a single p95.


Final isolated sequential desktop measurements, Apple M3 Max / Chrome ANGLE Metal.
Each GL capture: 60 warmup + 240 submissions, 239 completed GPU queries. CPU:
180 samples after 60 warmup. Current default uses the verified 573b8f1 shader/map
reconstruction; the new column is the final bounds-check optimization.

| Cost, ms median / p95 | Old | 573b8f1 default | New |
| --- | ---: | ---: | ---: |
| GPU execution | .369 / 1.024 | .498 / 1.169 | .430 / .932 |
| GL main-thread submission | .900 / 1.700 | 1.100 / 1.800 | 1.000 / 2.100 |
| Submission + Canvas2D copy | 1.000 / 1.800 | 1.200 / 2.000 | 1.100 / 2.200 |
| CPU fallback | 1.000 / 1.300 | 1.200 / 1.600 | 1.400 / 1.800 |

CPU current-default numbers are the pre-edit capture, not the final sweep.
GPU p95 is below the previous ~2.5 ms observation, but JS and CPU fallback did
not improve. Before the ball bounds check the same sweep measured new GPU
1.049 / 1.843; earlier captures ranged up to 2.58 ms p95. Keep the variation in
mind instead of treating these desktop runs as a guaranteed weak-device gain.
All GL captures retained 45 draws, 20 geometries, 10 textures, stable resources,
and GL error 0. Detailed final files: `look3-perf-old`, `look3-replay`,
`look3-perf-optimized`, `look3-perf-old-cpu`, `look3-perf-new-cpu` under `out/`.

Validation: TypeScript clean; Vite production build passed (existing chunk-size
advisory). Old parity: 8 GL + 8 CPU frames have zero changed pixels relative to
573b8f1. Reconstructed movie baseline: 8 frames also match the pre-edit default
exactly. The final bounds optimization changes zero pixels in 8 new-look frames,
so the delivered videos and crops also represent the final look. Automatic CPU
fallback with `--disable-webgl` rendered gameplay (`look3-auto-cpu.png`); its log
contains expected WebGL-disabled errors. `look3-baseline-parity.json` and
`look3-optimization-parity.json` preserve the additional comparisons.

Final-song gate (on the final optimized implementation):

```sh
node tools/shot.mjs --url 'http://localhost:3230/?nointro' --out tools/out/look3-full.png --eval tools/gl-bot.js --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 1000 --verify true --port 9531
```

The earlier pre-optimization run also completed 393 perfect. An initial run
stalled at 60 s without misses while other validation was ongoing; it is retained
as `look3-bot.log`, excluded from completion evidence, and was rerun in isolation.

Final optimized song result: completed, 393/393 perfect, max combo 393, zero
good/ok/miss and no bot failures. Evidence: `look3-full-playthrough.json` and
`look3-bot-final.log`. All task-owned Chrome instances and Vite were stopped.
