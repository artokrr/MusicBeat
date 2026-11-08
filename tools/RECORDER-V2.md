# Recorder readability and quiet music notes

Artem sees a larger worn portable cassette recorder on the right-hand snow,
with an open handle silhouette, three grille slats, pale keys, a dark cassette
window and turning reels. A few dim cream-grey quavers drift from its grille.

The body is 54 cm wide (previously 36 cm), at (2.35, -1.85) metres. Orthographic
projection makes distance irrelevant to apparent size. Its static native
bounds are x 293.64–318.27, y 159.00–180.45: about 25 pixels wide. This is outside
the player's ±0.6 m movement, below judgement text, and above the progress bar.
The upload and pause panels leave it visible. It uses the original scene
lighting, with no emissive material or new light. The raised handle and reduced
grille detail were chosen after inspecting native screenshots, not just zooms.

All millisecond expressions in anim/recorder.ts are unchanged. Only world
placement and spatial dimensions changed; the cassette seats at
(2.47, -1.952, 0.1875), matching the enlarged slot. The source JSON supplies both
Blender and the CPU fallback. Blender 5.2.3 regenerated the GLB, then
`node tools/compress-models.mjs` regenerated its gzip companion.

Notes use beatmap onsets regardless of whether the player hits them. Seeded
thinning and a 0.65–1.30 s minimum interval keep at most two alive. Each lives
1.65 s, rises 27 cm, and drifts a few centimetres. Single/paired glyphs occupy
3–5 by 5 native pixels. They use the existing Bayer dissolve and depth buffer;
lighting and haze are sampled once at the grille. Countdown, pause, menus and
failure clear the pool. Nothing is emitted near the stranger.

## Validation

- `cd client && ../node_modules/.bin/tsc --noEmit -p .`: clean.
- `../node_modules/.bin/vite build`: successful. Build logs are
  `tools/out/recorder-build-before.txt` and `recorder-build-after.txt`.
- Entry JS gzip: 105.38 → 106.34 kB. Renderer JS gzip: 163.82 → 164.26 kB.
  Recorder GLB: 39,324 → 35,720 bytes; gzip: 4,297 → 4,215 bytes.
- Full real-song keyboard gate: **388/388 perfect, 0 good/ok/miss, completed**,
  duration 178.868 s. Evidence: `tools/out/recorder-full-playthrough.json` and
  `recorder-full.log`. Screenshot series: `recorder-full-song-*.png`;
  native-size contact sheet: `recorder-whole-song.png`.
- Real file-input GL/CPU upload, flight, countdown, pause/resume and replacement:
  `cassette-sequence.json`, `cassette-cpu-sequence.json`, and their flow logs.
  Both passed with zero exceptions and zero failed checks. Observed flight
  1507.6 ms GL / 1478.5 ms CPU; gameplay started at 4543.6 / 4519.3 ms after
  selection. Intentional failure reached hp_depleted with both note opacities
  zero. These also record actual note visibility and intentional failure stopping.
  Native upload/pause/failure frames are named `cassette-*-native.png` and
  `cassette-cpu-*-native.png`; the upload frame also appears in each sequence.
- `recorder-checks.js`: two-slot cap, stable buffer identity, phase gating,
  minimum emission gap, CPU foreground occlusion and projected bounds all pass.
  The synthetic 60 s onset fixture produced 46 notes, minimum observed gap 1.25 s.
- Main-thread scene render plus canvas presentation, same 600-frame diagnostic
  ring at approximately 12 s gameplay: median/p95 **0.8/1.3 ms before** and
  **0.4/0.8 ms after**. These are local headless samples, not a speedup claim;
  shader warmup and host scheduling vary. GL calls increase 44 → 45. See
  `recorder-before-checks.json` and `recorder-after-checks.json`.
- GL and CPU heap sampling: 512-byte interval, collected objects included,
  12 s warmup then 16 s capture. **Zero sampled allocations in the new note
  simulation and drawing paths**. Evidence: `recorder-allocation-heap.json`,
  `recorder-cpu-allocation-heap.json`, and their `*-summary.json` files.
  The initial cold sample exposed numeric temporaries; typed clocks and
  construction-time lighting removed those from the warm sample. The new
  gameplay code creates no arrays, objects or geometry per frame. This does
  not claim the existing game/Three.js has no allocations or that sampling
  proves mathematically zero runtime allocation.
- Timing expression comparison: `recorder-timing-check.json`.

## Review artifacts

- `tools/out/recorder-before-after.png`: native crops at 4× nearest neighbour,
  native full frames and the final full frame enlarged 4×.
- `tools/out/recorder-notes.mp4`: 20 seconds, 1152×648, 60 fps, in-page audio.
- `tools/out/cassette-sequence-v2.mp4`: upload → flight → countdown → gameplay,
  1152×648 at 60 fps, in-page audio. Captured frames averaged 58.3 fps GL /
  58.5 fps CPU and were resampled to 60 fps for encoding.
- `tools/out/cassette-cpu-sequence.mp4`: matching CPU real-flow recording.

All browsers were headless Chrome with `--mute-audio`. Video audio was captured
by diverting Web Audio destinations into in-page MediaStreams. No media was
opened or played through speakers. Only this worktree was edited; no dependency
installation, sound-file edits, audio-source edits or push was performed.

Taste choices to revisit: the taller handle, slightly lighter casing, and
how faint the notes remain against the lit snow. Their sparsity and lack of
glow are intentional. Evidence is local and ignored by Git; source, model
binaries and reproducible verification tools are committed on pixel-recorder2.
