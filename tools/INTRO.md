# Courtyard opening

The first upload screen starts on the upper three floors of the existing panel
block. Dark sky occupies a narrow strip above the roof; warm windows and snow
supply the movement and colour. After the assets load, a 2 s hold leads into a
4.5 s descent with quintic easing (zero velocity and acceleration at both ends).
The stranger, trees and lamp pool enter before the camera settles. The menu and
its dim layer then appear over 400 ms in four pixel steps. No audio was added.

The opening uses a separate camera description. `CAMERA`, the gameplay projection,
lighting, shadow maps, haze and geometry are unchanged. GL restores an exact
copy of its original camera. The bulb's screen-space halo is reprojected while
the camera moves. Snow expands above the original 7 m volume during the opening
and returns to its original seeded positions at the end. The existing dark
clear colour supplies the sky; the 40 m far plane covers the whole move.

CPU uses a simpler flat panel elevation, with matching scattered warm windows,
and the existing screen-space snow. It follows the same camera framing and
fades into the cached software courtyard in the latter half of the descent.
It does not load Three.js. Camera vectors, particle buffers and CPU drawing
state are reused; the opening adds no per-frame arrays or objects.

Pointer down, click, any key, drop and file-input changes finish the opening
without swallowing the event. File processing remains on the existing upload
path. Completion is stored in sessionStorage, with an in-memory fallback if
storage is blocked. Menu returns and reloads in that tab do not replay it.
`?nointro` bypasses it. Hold/descent timing and the opening target, scale and
pitch live in `client/src/game/scene/camera.ts`.

## Reproduction

All commands run in this worktree. Never install dependencies. Chrome is
headless with `--mute-audio`; recording captures audio inside the page.

```sh
cd client
../node_modules/.bin/vite --port 3220 --strictPort
# Separate terminal at repository root:
node tools/intro-check.mjs --cdp 9529
node tools/shot.mjs --url http://localhost:3220/ --wait 900 --out tools/out/intro-stills.png --after tools/intro-stills.js --port 9527
node tools/intro-video.mjs --mode full --cdp 9527
node tools/intro-video.mjs --mode skip --cdp 9527
node tools/intro-video.mjs --mode cpu --cdp 9527
node tools/shot.mjs --url 'http://localhost:3220/?nointro' --out tools/out/verify-nointro.png --eval tools/gl-bot.js --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 1000 --verify true --port 9521
node tools/shot.mjs --url 'http://localhost:3220/' --wait 9500 --out tools/out/verify-intro.png --eval tools/gl-bot.js --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 1000 --verify true --port 9521
```

`intro-parity.js` exercises the opening at three camera positions on the same
backend before running the production deterministic gameplay fixture. The
presentation clock is rewound to normalize breath/animation state. Run the same
fixture on the original revision (whose idle renderer ignores introProgress)
and the implementation, then compare using `tools/perf-pixel-diff.py`. Eight
frames each cover GL, CPU and disabled-WebGL fallback. Comparing captures with
different breath warm-up histories can produce a few differing puff pixels;
use the same fixture on both revisions.

Evidence is local and ignored by git, in `tools/out/`: the three MP4s (1920x1080,
nearest-neighbour, 60 fps, in-page audio), `intro-frames.png` (three native frames
scaled 4x), interaction results, song playthrough JSONs and `perf/pixel-diff.json`.

## Verified result

- Baseline: `816fcbcec9a7fdb3bb0f4140e14204b1131e1653`; implementation:
  `bf6d531` (camera/renderers), `9ff02f1` (menu/session/skip).
- Client TypeScript check and Vite production build pass (existing chunk-size warning).
- Both complete 178.868 s Night, Blooming Jasmine runs: 393/393 perfect;
  zero good/OK/miss, outcome completed. Intro run waits 9500 ms before upload.
- Eleven interaction checks pass, no runtime exceptions: key, pointer, drop,
  file input, menu return, reload, bypass, and denied-storage fallback.
- `python3 tools/perf-pixel-diff.py`: 24 comparisons, **0 changed pixels**.
  Both original and final use `intro-parity.js` so their breath state matches.
  Final fixtures actually move the camera before rendering the gameplay frames.
- All three MP4s have 1920x1080 H.264 video at 60 fps and captured AAC audio.
  The full recording begins with silence; no ambient audio was introduced.
- Visual inspection at 384x216: roof/sky boundary, upper-floor snow coverage,
  lit windows, lower trees, lamp halo/pool and final courtyard framing checked.
  No visible geometry clipping, shadow-map boundary or far-plane cutoff found.
  The facade's existing mottled concrete is deliberately retained.

The first set of unnormalized GL fixtures differed by ten breath pixels, even
between two captures of the untouched baseline. Those original images remain
in `tools/out/perf/initial-pixels`. The normalized baseline and final captures
are the inputs to the reported zero-difference result.
