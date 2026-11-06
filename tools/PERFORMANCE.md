The game was already fast on the desktop GPU. This work reduces CPU work, allocation and cold-load cost for weaker devices while preserving the courtyard artwork, shaders, dither, outlines, character models and ball/animation algorithms.

The audio clock now feeds the canvas and input directly instead of re-rendering React every 16 ms. Input listeners and the canvas loop stay installed, and expired-feedback cleanup only notifies Zustand when something actually expires. Shake decay accounts for the removed clock-effect renders so shakes keep their old duration, and failure fades retain their frozen gameplay clock. Three.js is a separate chunk; forced CPU mode does not request it. Model companion files use native, lossless gzip decompression, with original GLBs retained for older browsers and missing-companion fallback. Analysis and beatmap generation run in the same cancellable worker; the worker-less/error fallback keeps the original algorithms. The only BeatmapGenerator change is accepting an explicit diagnostics flag for worker use.

The baseline is commit 933561500bf478260d61d29cd13ead68f75cdb55 on pixel-perf. Immutable baseline and final production builds are under /Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/{before-dist,after-dist}. Bench builds add one store reference for CDP; shipped builds do not contain that probe. Measurements use Chrome 156.0.8078.79, Apple M3 Max (14 cores, 36 GiB), macOS 26.5.2, a 390x844 viewport at DPR 2, five touch points, and Emulation.setCPUThrottlingRate at 4 and 6. Chrome is headless and muted. Profiles ran sequentially, with a 1 ms CPU sampling interval, 16 KiB heap sampling including collected objects, Performance metrics, and timeline/V8 GC traces.

The dense comparison uses IZ-US's busiest 30-second passage (87 note starts, up to eight overlapping incoming/return lifetimes). The harness seeks the music and notes together by 125 seconds, warms up for 10 seconds, and records roughly song time 135–165. It pauses the audio clock during profiler setup so setup's forced GC does not create late judgements. The original whole-song runs at 4x separately track memory through natural completion of all 177.27 seconds. The introductory 10–40 s profiles are retained as exploratory evidence, too.

| CPU slowdown | 4x before | 4x after | 6x before | 6x after |
| --- | --- | --- | --- | --- |
| Main-thread task time / displayed frame, ms | 6.54 | 2.95 | 8.72 | 4.53 |
| Frame interval p50 / p95 / p99, ms | 16.7 / 16.7 / 16.8 | 16.7 / 16.7 / 16.8 | 16.7 / 16.8 / 16.8 | 16.7 / 16.7 / 16.8 |
| Frames above 20 ms | 0 | 0 | 1 | 1 |
| Longest frame, ms | 16.8 | 16.8 | 33.3 | 33.3 |
| React commits in 30 s | 3837 | 0 | 3812 | 0 |
| Sampled allocated MB in 30 s | 138.0 | 30.8 | 138.3 | 29.3 |
| GC events in 30 s | 68 | 34 | 64 | 34 |
| GC pause total, ms | 111.3 | 49.5 | 154.5 | 86.0 |
| GC pause p95 / p99 / max, ms | 2.13 / 7.93 / 13.85 | 1.66 / 5.09 / 12.63 | 2.95 / 9.47 / 14.83 | 2.40 / 13.02 / 23.08 |

Main-thread task time is the Performance TaskDuration delta divided by displayed RAF intervals. The table includes browser work on that thread. The following split is a statistical CPU-profile estimate, mapped through build source maps and classified at the nearest relevant stack frame. It excludes idle/program/unattributed samples and does not add up to TaskDuration. Three + GL includes renderer preparation, Three submission and the canvas blit; these are CPU costs, not GPU timings. The old RAF callback duration alone misses extra renders started inside React effects, so it is not a useful total-frame comparison.

| Sampled self CPU ms / displayed frame | 4x before | 4x after | 6x before | 6x after |
| --- | --- | --- | --- | --- |
| Game loop/input | 0.302 | 0.060 | 0.422 | 0.130 |
| React | 0.124 | 0.000 | 0.139 | 0.001 |
| animator | 0.134 | 0.039 | 0.164 | 0.056 |
| describeFrame/rest | 0.039 | 0.011 | 0.054 | 0.029 |
| Three + GL | 2.274 | 1.150 | 3.376 | 1.882 |
| 2D overlays | 0.034 | 0.021 | 0.063 | 0.045 |
| HUD/text | 0.305 | 0.224 | 0.516 | 0.465 |
| snow | 0.000 | 0.000 | 0.000 | 0.000 |

The animator remains untouched. Its allocation in the final 6x sample was approximately 3.64 MB in 30 s, versus 7.97 MB before; part of this reduction comes from removing redundant render calls. GL snow is shader-driven and its measured CPU cost is near the sampling floor. Overlay caching, rig math changes and ball rewrites were not justified by the remaining costs. All 43 draw calls and the original shaders remain.

GC statistics use only renderer-main-thread MinorGC/MajorGC events within the measured Performance timestamp bounds; nested V8 events and profiler-stop GC are excluded. Tail pauses vary: fewer collections does not guarantee every individual pause is shorter. These are single before/after runs, not confidence intervals or a physical-phone claim.

Full-song memory at 4x (MB means decimal MB):

| Metric | Before | After |
| --- | --- | --- |
| Post-GC JS heap: 10 s -> song completed | 7.60 -> 7.98 | 6.93 -> 7.36 |
| Peak sampled live JS heap | 21.73 | 9.10 |
| Embedder heap: 10 s -> completed | 2.21 -> 10.57 | 2.32 -> 10.54 |
| ArrayBuffer/backing storage: 10 s -> completed | 76.25 -> 76.25 | 76.23 -> 76.23 |

This reduces transient JS heap pressure; it does not establish that native memory growth disappeared. The embedder heap still grows during a song, and decoded PCM dominates backing storage. One song does not prove absence of leaks across repeated uploads, and these counters do not measure GPU/driver or total process memory.

Cold-load results use a fresh profile, disabled cache, 6x CPU, 2 Mbps throughput and 60 ms network latency. The harness chooses a song one second after the upload control appears. The local static server sends JS uncompressed, so actual browser download bytes below differ from gzip build sizes. Production hosting and transport headers were not changed. Model timing means the last model response, not an instrumented GPU upload fence.

| Startup measurement | Before | After |
| --- | --- | --- |
| First contentful paint, ms | 4840 | 1520 |
| First courtyard canvas frame, ms | 4796 | 4621 |
| Entry JS download, ms | 3899 | 1305 |
| Entry module compile event, ms | 7.65 | 1.40 |
| Default menu JS downloaded, raw bytes | 950246 | 929144 |
| Model bytes downloaded | 1239952 | 187250 |
| Last model response since navigation, ms | 10527 | 5805 |
| Navigation -> playing with automatic song choice, ms | 11163 | 7891 |
| Song select -> playing, ms | 5319 | 5368 |
| Worker wall time, ms | 753 | 756 |
| Worker result -> map ready, ms | 86.9 | 2.2 |
| Beatmap generation sampled on main thread, ms | 77.0 | 0.0 |

The VM compile event is the main-thread v8.compileModule span, not all streaming/background parsing or later JIT work. Those events and per-chunk resource timings remain in the saved startup trace and summary. The default menu still loads the GL chunk immediately for its 3D background, so its first courtyard frame barely changes; the UI can paint and accept a song much earlier. The three-second countdown and 500 ms map-ready pause remain. PCM copying still has one-time main-thread cost (about 61 ms sampled in this run). CPU slowdown is not a faithful model of phone worker speed, GPU, RAM, thermal throttling, browser power policies or physical touch latency.

The final Vite production build succeeded; TypeScript passed with no errors. The existing >500 KB raw GL-chunk advisory remains. Baseline entry JS was 950.21 KB raw / 271.15 KB gzip. Final JS sizes:

| Production JS chunk | Raw KB | Gzip KB |
| --- | --- | --- |
| BeatDetector-ezUKO1un.js | 10.17 | 4.51 |
| BeatmapGenerator-DhQpHqQH.js | 13.31 | 5.79 |
| analysis.worker-CNDoNa38.js | 25.26 | 10.61 |
| index-Cy4w3V0O.js | 301.92 | 99.51 |
| renderer-0LD-JM0h.js | 627.12 | 163.56 |

The detector/generator chunks are loaded only for the worker-less/error fallback. The worker includes both algorithms. The gzip companions total 187,250 bytes versus 1,239,952 original GLB bytes; originals are retained, so repository/deployed disk use grows by 187,250 bytes. No geometry, texture, shader, dither or outline quality was reduced. Run node tools/compress-models.mjs after regenerating models.

The look check compared 24 fixed 384x216 RGBA frames: eight GL, eight forced CPU, and eight with Chrome --disable-webgl --disable-3d-apis. Changed pixels: 0; maximum channel difference: 0. The fixture covers incoming/returned/held/missed balls, lane rings, text, health blinking, countdown and fade, and uses describeFrame plus the real rendering path. Its seed is reset after backend setup so Three UUID creation during failed GL setup cannot perturb CPU snow respawns. No product randomness changed. I inspected GL and CPU frames and the native-touch result screen.

The whole-song memory benchmark forces GC and starts profilers near 10 s. Both baseline and final runs recorded one good judgement near 10.2 s during that setup stall; those profiled bots are workloads, not the perfect-play gate. The final unprofiled Night, Blooming Jasmine gate completed: 388/388 perfect, 0 good, 0 ok, 0 miss. Worker/main map parity for IZ-US passed (297 notes, SHA-256 95c77f5403802509d2864eba4faabdbe3285b953800a21cabed16cb28f1145cb); only the diagnostics creation timestamp is ignored. Worker-less/failing-worker fallback, cancellation, unchanged PCM, missing compressed-model fallback and missing native decompressor checks passed. Real CDP touch input hit 83 notes perfectly before intentional input stop; pause froze both audio time and health, resume worked, and deliberate misses reached the normal defeat screen. CDP touch events were trusted native browser events. Touch timing uses a small lead to offset CDP transport and is not a real-device latency measurement.

Evidence (all absolute paths):

- [Dense before/after profiles and traces](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/) (dense-before-4, dense-before-6, final-dense-after-4, final-dense-after-6 each contain cpu.cpuprofile, heap.heapprofile, trace.json.gz, raw.json and summary.json).
- [Whole-song baseline memory](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/prod-before-4/raw.json) and [final whole-song memory](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/final-after-4/raw.json).
- [Cold-load baseline](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/startup-before/summary.json) and [final cold load](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/startup-final/summary.json) with their startup profiles/traces.
- [Pixel differences](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/pixel-diff.json), [baseline GL frame](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/before-pixels/fixed-150.png), [final GL frame](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/final-pixels/fixed-150.png), [CPU frame](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/after-pixels-cpu/fixed-150.png).
- [388/388 gate](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/final-full-playthrough.json), [map/worker parity](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/preparation/iz-us-checks.json), [native touch and pause](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/controls/checks.json), [model fallback checks](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/models/model-checks.json).
- [Build output](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/build-final.log) and [build sizes](/Users/artem/Desktop/Development/personal/MusicBeat-perf/tools/out/perf/build-final.json).

Reproduction uses the existing shared node_modules and installs no dependencies:

```sh
node tools/perf-build.mjs tools/out/perf/after-dist
node tools/perf-serve.mjs
# In a separate shell, one profiling run at a time:
node tools/perf.mjs --url http://localhost:3101/after/ --out tools/out/perf/recheck-6 --rate 6 --port 9401 --prod true --offset 125
node tools/perf-summary.mjs tools/out/perf/recheck-6 tools/out/perf/after-dist
# --full true without --offset tracks an entire natural song.
# --startup true --network true records the cold-load experiment.
# Pixel fixtures / full-perfect gate use the documented tools/shot.mjs commands
# against Vite on 3101, then: python3 tools/perf-pixel-diff.py
```

The choices most likely to be revisited are the asynchronous GL chunk (an empty canvas until GL is ready, with no CPU-art flash) and the extra gzip companion files. Animation, flight and noteToBall logic were not edited. No dependencies were installed, no other worktrees were edited, nothing was pushed, and no hosting changes or deployment were made. Branch: pixel-perf.
