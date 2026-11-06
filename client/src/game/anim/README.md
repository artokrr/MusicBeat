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
  feeds balls from a waist-height basket with its free hand, and uses compact
  strokes. A successful return carries the next consecutive note when its
  launch is 0.35-1.0 seconds after actual player contact. Other returns pass
  left of the stranger, bounce on the snow and fade while rolling away. Cloth trails local
  body velocity through slow springs; `figures.ts` now consumes lateral lag too.

## Coordinates and input limits

The fixed pixel-courtyard mapping is repeated here deliberately to keep the
renderer integration small. If that mapping changes, update `CONTACT`, `courtX`
and the two feet positions together with the renderer. Normal arrival height
is `TABLE_Z + BALL_R + flightHeight(1) = 1.055 m`; a new serve is `1.035 m`;
held balls use the renderer's separate `1.000 m` height. Contact y is -1.5 / +1.5.
Player root is approximately `courtX(playerX) - .3`; stranger root is to the
right of its paddle. Rally returns reach the next note's exact `startX`, y=1.5, z=1.035. Drill
returns clear the stranger at x=-0.88.

Known incoming notes are anticipated to meet their scheduled beat exactly.
FrameState contains a render-only `upcomingFeeds` preview for 320 ms before
a launch, and no future keypress.
An input with no ball gets a **65 ms continuous reaction stroke**. Normal
feeds are prepared from the preview and meet their original launch deadline.

A pressed ball is met where it really is (`strike`). The paddle reaches the
ball's path 16-70 ms after the press (no faster than 7 m/s from where the hand
is), and the renderer keeps the ball coming until then and sends it back from
that point (`strikeFor`). The hit flash waits for the same moment. The press's
timing shapes the stroke: on the beat it is the usual drive; early, the ball is
still out over the table and the stroke is a reaching poke with the body leaning
in; late, the ball has passed the hit line and dropped, so the stroke is a
cramped upward flick with the body leaning back. "ok" presses also cost a little
balance. If the beat arrives with no press, the swing checks (`wait`) and the
ball runs on, slowing to rest 30 cm past the hit line (`flight.ts`), which is
where a missed ball's fall starts. Opponent events now represent launches only: either a basket feed or the
next stroke of a rally. Discarded returns do not compete with incoming feeds
for the paddle. A miss creates no return plan and the next note is fed anew.

The current CPU figure draws spherical heads, so gaze is conveyed by neck/head
position and tilt rather than an independently rotated face mesh.

## Integration and verification

`renderer.ts` only creates the animator, calls `update` / `idle`, and passes the
poses to `drawFigure`. Old angle-pose selection and its five globals are removed;
`pose.ts` remains available for other consumers. The only figure change is the
two hem-coordinate expressions using `cloth.swingSide`. `Game.tsx` supplies cached visual lookahead and retains returned notes through
their disposal fade. Its incoming spawn conditions, input, judgement and score
paths are unchanged.

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


## Rally and feed verification

`tools/rally-check.js` is a browser probe for `tools/shot.mjs --after`. It runs
real `describeFrame` output at 200 Hz and checks sparse chains, 250 ms feeds,
24 consecutive 130 ms feeds, a broken rally, early/late presses near the minimum gap, and a
long pause. It measures launch paddle contact, handoff position, fixed free-arm
lengths and returns reaching the snow before fading. Fixtures exercise long
rallies without modifying any generated song or beatmap format.

The stranger-specific feed arm is in `Stranger extends Body`; the shared Body
and all player stroke code are kept intact for the parallel player-animation
work. Return plans, contact history and opponent events use fixed 64-slot storage. `strikeFor`
continues to determine the exact returned ball origin. Holds leave from the
held position when they complete. A backwards song-time jump clears all plans.

The basket is generated with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/build_basket.py
```

Its 1,100 triangles use the existing metal/court-line palette. Placement in
`gl/props.ts`, `pixel/courtyard.ts`, and `anim/flight.ts` must stay aligned.
