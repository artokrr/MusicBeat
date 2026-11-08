# Session cassette pile

Run all commands from this worktree. No installation is needed. Chrome capture tools always use `--headless=new --mute-audio` and divert recorded audio inside the page. They close their own Chrome in `finally`; stop Vite after verification.

```sh
cd client
../node_modules/.bin/vite --port 3190 --strictPort
```

In a second shell at the worktree root:

```sh
node tools/cassette-check.mjs
node tools/tapes-check.mjs
node tools/shot.mjs --url http://localhost:3190/ --out tools/out/tapes-playthrough.png --eval tools/gl-bot.js --song '/Users/artem/Downloads/Night, Blooming Jasmine.mp3' --play 1000 --verify true --port 9491
node tools/tapes-session.mjs
node tools/tapes-session.mjs --cpu true --pass cpu --cdp 9493
python3 -I tools/tapes-evidence.py
node tools/cassette-sound.mjs --vite 3190 --cdp 9495 --pass measure
python3 -I tools/cassette-sound-sync.py
node tools/tapes-profile.mjs after
```

Run the profile by itself, after the captures finish. It records CPU time spent in `GLBackend.render`, not GPU completion time, for 960 frames after warmup, with six tapes. Heap sampling includes objects collected by minor and major GC. The original `before` artifacts were captured on the original implementation; running `before` on the new code instead measures an empty new pile. It also checks that reload clears the pile.

The session capture uses the real file input eight times, rotating the three requested MP3s. After six ejects, it accelerates only the burial clock by 300x for 1.75 seconds, freezes it to show a fresh seventh ejection among old tapes, then advances until all tapes are buried. The hook is ignored in production (covered by `tapes-check.mjs`). There is no persistent storage.

Outputs are intentionally ignored by git under `tools/out/`:

- `tapes-eject-half-speed.mp4`: replacement, half speed, nearest-neighbour 3x, 60 fps, captured audio slowed with it.
- `tapes-session.mp4`: eight loads at real speed, with captured audio; only burial is accelerated near the end.
- `tapes-pile.png`: native crops at 4x, a complete gameplay frame at 2x, and a CPU comparison.
- `tapes-gl-flow.json` / `tapes-cpu-flow.json`: actual pooled states at each snapshot.
- `tapes-playthrough-playthrough.json`: full-song bot result.
- `tapes-*-cost.json`, `tapes-*-heap-summary.json`, `tapes-reload.json`: performance and lifecycle evidence.

The sound probe uses a scheduled buffered clapperboard through the production bus. The measure pass adds two tiny corner markers to the actual scene copy (movement and first contact), so analysis can distinguish presentation/compositor latency from the named timeline. Local picture changes are checked too. The eject and snow recordings are waveform-matched, preventing the nearby door latch from being mistaken for eject. No sound assets are changed. Python analysis needs numpy, scipy, and Pillow.

Taste controls live in `anim/recorder.ts`: 100 ms eject start, 820 ms first contact, 1080 ms rest; 1.65x ejected shell scale; seven separated destinations; six retained tapes plus one retiring slot; 700 ms retirement; nine-minute snow coverage and thirteen-minute complete burial. Faded label colours live in `scene/recorder.ts`. Flight, seating, door, rewind and PLAY timings are unchanged.

Verified on this worktree: TypeScript and Vite build pass; 388/388 perfect full-song completion; eight real loads in each renderer, no runtime errors; reload clears all tapes. GL CPU render submission: 0.10/1.40 ms median/p95 before, 0.10/1.80 ms with six tapes (960 frames, 42 draw calls). New pile/render allocation samples: 0 bytes; the existing clock sampler measured 11,916 bytes both before and after. Presented-frame sound offsets: pop +1.5 ms, snow +4.8 ms; 16.7 ms frame interval, 7.9 ms clapper spread. See `tools/out/tapes-verification.json` for the exact values and source reports. Other rows in the legacy sound checker retain its older pixel heuristics; only the two eject rows use the new frame markers.
