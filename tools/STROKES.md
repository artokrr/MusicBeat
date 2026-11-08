# Player strokes: capture and verification

Worktree: `MusicBeat-strokes`, branch `pixel-strokes`. Baseline: `816fcbc`.
All Chrome processes are headless with `--mute-audio`. Audio is recorded from
Web Audio destinations inside the page, never sent to speakers. No camera,
beatmap, judgement, score, input window or music clock edits are involved.

## Reproduce

From `client`, start `../node_modules/.bin/vite --port 3210 --strictPort`.
From the worktree root:

```sh
node tools/strokes-capture.mjs --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --out tools/out/strokes-after-jasmine.mp4 --cdp 9512
node tools/strokes-capture.mjs --song '/Users/artem/Downloads/Буерак - Шаги.mp3' --out tools/out/strokes-after-shagi.mp4 --cdp 9513
python3 tools/strokes-metrics.py tools/out/strokes-before-jasmine-motion.json tools/out/strokes-after-jasmine-motion.json tools/out/strokes-before-shagi-motion.json tools/out/strokes-after-shagi-motion.json
python3 tools/strokes-artifacts.py
node tools/strokes-check.mjs
node tools/shot.mjs --url http://localhost:3210/ --out tools/out/strokes-full-song.png --eval tools/gl-bot.js --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 1000 --verify true --port 9511
node tools/shot.mjs --url http://localhost:3210/ --out tools/out/strokes-rally.png --after tools/rally-check.js --port 9514
node tools/shot.mjs --url http://localhost:3210/ --out tools/out/strokes-perf.png --after tools/strokes-perf.js --port 9515
```

The before videos must be recorded before applying the implementation. The
baseline animator bundle in `tools/out/strokes-baseline.mjs` was compiled from
that revision; `strokes-bench.mjs` compares it with the current test bundle.
Stop Vite after testing; every runner closes its own Chrome in `finally`.
Generated media and measurements stay in ignored `tools/out/`.

## Measurement boundaries

The capture wraps the real GL renderer, copies the player skeleton after drawing,
and records the song clock and CPU render submission cost. Telemetry copies are
outside the timed render. These copies are tooling allocations, not game changes.
Metrics cover song seconds 3–30, resampled to 60 Hz, projected through the existing
44 px/m courtyard camera. Velocity, acceleration and jerk are successive finite
differences in native screen pixels. Vertical range is world Z, also expressed in
projected pixels. Horizontal reversals exclude velocities below 2 px/s.

This is the real bot-driven game, including holds, dense notes, and reward hits.
It is not a fixed-step physics experiment: browser/audio scheduling introduces
small differences between runs, especially in peak acceleration and jerk. Full
peak metrics (including increases) are retained. Rare overhead smashes deliberately
increase paddle-height range and can increase the peak hand speed on Shagi.
The critical spring unit step has zero overshoot and zero target crossings both
before and after: the baseline bobbing was changing targets, not underdamping.

The videos are 60 fps exports on the captured timestamps, without optical-flow
interpolation. Comparison: song seconds 3–23, 20 seconds at real speed, each half
384×216 enlarged 3× by nearest neighbour. The half-speed montage uses actual
forehand, backhand, hold and combo-25 events; labels name each event and song time.
The pose sheet uses native player crops enlarged 4×, six phases per stroke.

## Motion choices

- Keep the low stance, reduce the hold load/release pulse, breathe less, and
  counterbalance with a small free-arm movement. Feet lift 2.5 cm instead of
  5.5 cm; ordinary lateral steps take 190–230 ms instead of 75–155 ms.
- Move the trunk through 65% of the selected lane displacement. Let the shoulder
  reach while the head stays over the trunk. Retain timing-dependent leaning
  and a smaller 16–18 cm forward/back timing step.
- Prepare for the nominal 25 ms visual contact delay rather than aiming at the
  beat line and pulling back on every perfect press. `strike()` still targets
  `incomingBall()` at the actual contact time. Input and judgement do not move.
- Give ordinary follow-through time to settle, but let dense feeds interrupt
  after contact. Cubic position/velocity continuity, exact IK endpoints, planted
  support feet and fixed output buffers remain intact.
- Choose forehand/backhand from ball X relative to the torso when preparing.
  Roll continuously about the paddle handle to use the black face on backhands.
  Drives load below the contact and rise through it; actual contact height and
  early/late timing adjust the path. Holds load above contact, cut down with an
  open face, stay at the held ball, then make a small downward/forward release.
- Latch the combo reward on the existing input event before the combo increments.
  Every 25th hit gets the existing smash sound bank (switch sounds are retained),
  an overhead cut and a lower return with greater initial speed. Return start,
  arrival point, arrival time and rally classification stay unchanged. A milestone hold keeps the open face/held contact after its larger downward preparation. No extra
  particles, flash or shake are added.

Taste knobs: reward cadence 25, overhead preparation 42 cm, lane displacement
65%, head reach contribution 35%, foot lift 2.5 cm. Readability comes mainly from
stroke direction and the paddle face; the camera and character meshes are untouched.

## Verification evidence

`tools/out/strokes-checks.json`: exact retained contact, early/late inputs,
50 consecutive 130 ms cross-court hits, planted support, leg lengths, paddle
basis, deterministic replay, stable output identity, return endpoints and net
clearance. `strokes-rally-checks.json` adds the existing real scene-description
checks (sparse/dense/miss/early/late rallies). `strokes-cpu-checks.json` confirms
the CPU renderer remains usable. `strokes-full-song-playthrough.json` records the
full 393-note run. TypeScript and Vite build are checked separately.

`strokes-metrics.md` and `strokes-comparison.json` retain every measured joint's
before/after velocity, acceleration, jerk, bobbing and reversals. The stricter
symptom checks in `strokes-compare.py` fail on baseline-vs-baseline and pass on both
songs. They require at least 50% less pelvis/free-hand vertical movement, 30% less
peak head speed, and 35% less peak foot speed.

The paired GL benchmark alternates 60-frame before/after pose batches in one
browser: CPU submission median 0.368 / 0.352 ms, p95 0.542 / 0.558 ms (before /
after); it does not measure GPU completion. Animator-only batches: median about
0.00225 / 0.00228 ms, p95 0.00276 / 0.00291 ms. This is effectively unchanged at
frame scale. Independently recorded live runs show more load/scheduler variation;
their raw numbers are retained rather than substituted with the paired result.

The update adds scalar fields and a construction-time spring, no per-frame arrays,
objects or queues. Output/history storage is reused. Heap sampling still observes
existing V8 numeric boxing: about 19.9 MB baseline versus 20.3 MB after over 9,600
updates (512-byte sampling). It is not a claim of zero heap traffic. The source
and stable-identity checks establish no new per-frame containers; sampling alone
cannot prove an absolute zero-allocation guarantee.
