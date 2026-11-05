# Table-tennis animator

`createAnimator()` owns both characters. Call `update(frame)` once per gameplay
frame, or `idle(nowMs, dt)` on menus. Pass the returned `player` and `stranger`
straight to any `JointPose` renderer. The object, joint arrays and paddle arrays
are **borrowed, mutable output**: copy them to retain a frame. `reset()` starts a
new match; a backwards song-time jump also resets automatically. One instance
belongs to one renderer/backend lifetime. No rig fields were added or changed.

The runtime import from `pixel/renderer` is type-only. No DOM, wall-clock reads,
randomness, gameplay mutation, or dependencies are required. Normal updates
allocate no arrays/objects. Reset and construction allocate the rig and a fixed
64-entry opponent event/history queue.

## Motion

- The player carries weight forward over bent knees. The approaching note loads
  the torso and a small backswing on the current stance lane; a cubic trajectory accelerates through its
  scheduled contact, continues 9 cm, then settles. Wide shots choose a forehand
  or backhand according to the target relative to the torso. Retargeting a fast
  stream preserves hand position and velocity, rather than restarting a pose.
- Critically damped root/weight/twist springs drive lateral preparation and hip
  counter-rotation. One foot steps while the other stays fixed in world space.
  Each step has zero horizontal/vertical speed at both ends; leg IK preserves
  thigh/shin lengths. The free arm counterbalances and the head follows the
  flight, including switch curves and the receiver-side bounce.
- The right-arm IK uses a 30 cm upper arm and a 43 cm elbow-to-blade link (27 cm
  forearm + 16 cm grip/blade). A continuous waist reach keeps the chain in range.
  The paddle centre is the end effector. `up` continues the forearm; `normal` is
  the outgoing table direction projected perpendicular to `up`.
- Holds arrive with zero hand velocity, retain the ball at the rendered hold
  height, and push 9 cm on release. Misses reach low and late, drop the shoulder,
  and recover without overriding the preparation of another imminent note.
- The stranger breathes only a few millimetres, tilts their head very slowly,
  makes a short free-hand toss, and uses compact strokes. Return deadlines are
  retained even after gameplay removes the returning note. Cloth trails local
  body velocity through slow springs; `figures.ts` now consumes lateral lag too.

## Coordinates and input limits

The fixed pixel-courtyard mapping is repeated here deliberately to keep the
renderer integration small. If that mapping changes, update `CONTACT`, `courtX`
and the two feet positions together with the renderer. Normal arrival height
is `TABLE_Z + BALL_R + flightHeight(1) = 1.055 m`; a new serve is `1.035 m`;
held balls use the renderer's separate `1.000 m` height. Contact y is -1.5 / +1.5.
Player root is approximately `courtX(playerX) - .3`; stranger root is to the
right of its paddle. Returns reach **x = 0**, regardless of `startX`.

Known incoming notes are anticipated to meet their scheduled beat exactly.
FrameState contains no future serve before it launches, and no future keypress.
A newly revealed serve or unexpected input therefore gets a **65 ms continuous
reaction stroke**, not an instantaneous pose jump. Early/late presses can differ
from the scheduled contact; the exact-contact guarantee and sheet assertions
are for on-beat input. Supporting arbitrary exact press-time/serve-time contact
without discontinuity requires upstream pre-serve information or visual ball
retiming, neither of which this animation-only change alters. Overlapping
opponent serves/returns are performed in deadline order; coincident balls at
different positions cannot all physically touch one paddle at the same instant.

The current CPU figure draws spherical heads, so gaze is conveyed by neck/head
position and tilt rather than an independently rotated face mesh.

## Integration and verification

`renderer.ts` only creates the animator, calls `update` / `idle`, and passes the
poses to `drawFigure`. Old angle-pose selection and its five globals are removed;
`pose.ts` remains available for other consumers. The only figure change is the
two hem-coordinate expressions using `cloth.swingSide`. `Game.tsx` is untouched.

Run from repository root (no installation):

```sh
node tools/anim-sheet.mjs
cd client && ../node_modules/.bin/tsc --noEmit -p .
```

The sheet script bundles TypeScript with the existing esbuild, then samples at
200 Hz. It renders side and courtyard-camera stick figures with Pillow for idle,
one ball, 8 Hz outside-lane alternation, a shuffle, hold/release, miss, and stranger
serve/return. It checks contacts within 3 cm, fixed limbs, planted feet, finite
joints, paddle basis, velocity bounds, deterministic replay, stable output
identity, culled-return deadlines, unexpected input and menu/restart transitions. `tools/out/animation.json` contains measurements and trajectories.
All generated output is ignored by `tools/.gitignore`.

For the real-song test, start Vite on the reserved test port:

```sh
cd client && ../node_modules/.bin/vite --port 3130 --strictPort
```

Then, from repository root:

```sh
node tools/anim-play.mjs --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --port 9431
```

The bot discovers the store's actual module URL in `/src/App.tsx`, waits for
`playing`, and dispatches real window keydown/keyup events at the generated
beatmap's times. It reads the committed Game props for the same time used by
judgement; it never changes the score, notes, difficulty or timing windows.
The runner captures 60 canvas PNGs and asserts a completed all-perfect run. It
closes its own Chrome and deletes its isolated profile in `finally`.

Local verification: all seven sheets passed; contact error was floating-point
zero on scheduled beats (including all 12 dense contacts and isolated stranger
returns); limb error < 1e-12 m; planted-foot drift < 1e-12 m. Dense paddle speed
peaked at 10.80 m/s and acceleration at 336.38 m/s², consistent with traversing
90 cm between 125 ms beats; no position/velocity resets occur at retargets.
A 60,000-frame active-window Node benchmark measured median 0.0025 ms/update,
p95 batch mean 0.0039 ms (not an end-to-end rendering/frame-time benchmark).

The 178.868-second song completed with 388/388 perfects, 388 max combo, score
112760, and no good/ok/miss. A React setState-in-render warning from the unchanged
GameScreen countdown was present; there were no runtime exceptions. Evidence:
`tools/out/game-verification.json`, `anim-gameplay-sheet.png`, `anim-gameplay.mp4`,
`anim-*.png`, and `anim-trajectories.png`. The MP4 is a 12 fps review sequence
of captured frames, not a real-time recording.
