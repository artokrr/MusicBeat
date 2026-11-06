// Rebuild the written evidence and inline chart after perf-summary.mjs.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
const root=resolve('tools/out/perf'),read=p=>JSON.parse(readFileSync(`${root}/${p}`));
const b4=read('dense-before-4/summary.json'),a4=read('final-dense-after-4/summary.json');
const b6=read('dense-before-6/summary.json'),a6=read('final-dense-after-6/summary.json');
const mb=read('prod-before-4/summary.json').memory,ma=read('final-after-4/summary.json').memory;
const sb=read('startup-before/summary.json'),sa=read('startup-final/summary.json');
const fixed=read('pixel-diff.json'),song=read('final-full-playthrough.json'),prep=read('preparation/iz-us-checks.json'),controls=read('controls/checks.json');
const n=(v,d=2)=>v.toFixed(d),perFrame=s=>s.mainThreadTaskMs/s.frames.n,allocated=s=>Object.values(s.allocationBytes).reduce((a,v)=>a+v,0)/1e6;
const link=(label,file)=>`[${label}](${root}/${file})`;
const frameRows=[['CPU slowdown','4x before','4x after','6x before','6x after'],['Main-thread task time / displayed frame, ms',... [b4,a4,b6,a6].map(s=>n(perFrame(s)))],['Frame interval p50 / p95 / p99, ms',...[b4,a4,b6,a6].map(s=>[s.frames.p50,s.frames.p95,s.frames.p99].map(x=>n(x,1)).join(' / '))],['Frames above 20 ms',...[b4,a4,b6,a6].map(s=>s.frames.over20)],['Longest frame, ms',...[b4,a4,b6,a6].map(s=>n(s.frames.max,1))],['React commits in 30 s',...[b4,a4,b6,a6].map(s=>s.commits)],['Sampled allocated MB in 30 s',...[b4,a4,b6,a6].map(s=>n(allocated(s),1))],['GC events in 30 s',...[b4,a4,b6,a6].map(s=>s.gc.count)],['GC pause total, ms',...[b4,a4,b6,a6].map(s=>n(s.gc.totalMs,1))],['GC pause p95 / p99 / max, ms',...[b4,a4,b6,a6].map(s=>[s.gc.pauses.p95,s.gc.pauses.p99,s.gc.pauses.max].map(x=>n(x,2)).join(' / '))]];
const table=rows=>rows.map((r,i)=>'| '+r.join(' | ')+' |'+(i===0?'\n| '+r.map(()=>'---').join(' | ')+' |':'')).join('\n');
const areas=['Game loop/input','React','animator','describeFrame/rest','Three + GL','2D overlays','HUD/text','snow'];
const areaRows=[['Sampled self CPU ms / displayed frame','4x before','4x after','6x before','6x after'],...areas.map(k=>[k,...[b4,a4,b6,a6].map(s=>n(s.cpuMsPerDisplayFrame[k]??0,3))])];
const sizes=readdirSync('client/dist/assets').filter(f=>f.endsWith('.js')).map(file=>{const bytes=readFileSync(`client/dist/assets/${file}`);return {file,raw:bytes.length,gzip:gzipSync(bytes).length}});
writeFileSync(`${root}/build-final.json`,JSON.stringify(sizes,null,2));
const sizeRows=[['Production JS chunk','Raw KB','Gzip KB'],...sizes.map(s=>[s.file,n(s.raw/1000),n(s.gzip/1000)])];
const document=`The game was already fast on the desktop GPU. This work reduces CPU work, allocation and cold-load cost for weaker devices while preserving the courtyard artwork, shaders, dither, outlines, character models and ball/animation algorithms.

The audio clock now feeds the canvas and input directly instead of re-rendering React every 16 ms. Input listeners and the canvas loop stay installed, and expired-feedback cleanup only notifies Zustand when something actually expires. Shake decay accounts for the removed clock-effect renders so shakes keep their old duration, and failure fades retain their frozen gameplay clock. Three.js is a separate chunk; forced CPU mode does not request it. Model companion files use native, lossless gzip decompression, with original GLBs retained for older browsers and missing-companion fallback. Analysis and beatmap generation run in the same cancellable worker; the worker-less/error fallback keeps the original algorithms. The only BeatmapGenerator change is accepting an explicit diagnostics flag for worker use.

The baseline is commit 933561500bf478260d61d29cd13ead68f75cdb55 on pixel-perf. Immutable baseline and final production builds are under ${root}/{before-dist,after-dist}. Bench builds add one store reference for CDP; shipped builds do not contain that probe. Measurements use Chrome 156.0.8078.79, Apple M3 Max (14 cores, 36 GiB), macOS 26.5.2, a 390x844 viewport at DPR 2, five touch points, and Emulation.setCPUThrottlingRate at 4 and 6. Chrome is headless and muted. Profiles ran sequentially, with a 1 ms CPU sampling interval, 16 KiB heap sampling including collected objects, Performance metrics, and timeline/V8 GC traces.

The dense comparison uses IZ-US's busiest 30-second passage (87 note starts, up to eight overlapping incoming/return lifetimes). The harness seeks the music and notes together by 125 seconds, warms up for 10 seconds, and records roughly song time 135–165. It pauses the audio clock during profiler setup so setup's forced GC does not create late judgements. The original whole-song runs at 4x separately track memory through natural completion of all 177.27 seconds. The introductory 10–40 s profiles are retained as exploratory evidence, too.

${table(frameRows)}

Main-thread task time is the Performance TaskDuration delta divided by displayed RAF intervals. The table includes browser work on that thread. The following split is a statistical CPU-profile estimate, mapped through build source maps and classified at the nearest relevant stack frame. It excludes idle/program/unattributed samples and does not add up to TaskDuration. Three + GL includes renderer preparation, Three submission and the canvas blit; these are CPU costs, not GPU timings. The old RAF callback duration alone misses extra renders started inside React effects, so it is not a useful total-frame comparison.

${table(areaRows)}

The animator remains untouched. Its allocation in the final 6x sample was approximately ${n((a6.allocationBytes.animator??0)/1e6)} MB in 30 s, versus ${n((b6.allocationBytes.animator??0)/1e6)} MB before; part of this reduction comes from removing redundant render calls. GL snow is shader-driven and its measured CPU cost is near the sampling floor. Overlay caching, rig math changes and ball rewrites were not justified by the remaining costs. All 43 draw calls and the original shaders remain.

GC statistics use only renderer-main-thread MinorGC/MajorGC events within the measured Performance timestamp bounds; nested V8 events and profiler-stop GC are excluded. Tail pauses vary: fewer collections does not guarantee every individual pause is shorter. These are single before/after runs, not confidence intervals or a physical-phone claim.

Full-song memory at 4x (MB means decimal MB):

${table([['Metric','Before','After'],['Post-GC JS heap: 10 s -> song completed',n(mb.start.usedSize/1e6)+' -> '+n(mb.end.usedSize/1e6),n(ma.start.usedSize/1e6)+' -> '+n(ma.end.usedSize/1e6)],['Peak sampled live JS heap',n(mb.peakUsed/1e6),n(ma.peakUsed/1e6)],['Embedder heap: 10 s -> completed',n(mb.start.embedderHeapUsedSize/1e6)+' -> '+n(mb.end.embedderHeapUsedSize/1e6),n(ma.start.embedderHeapUsedSize/1e6)+' -> '+n(ma.end.embedderHeapUsedSize/1e6)],['ArrayBuffer/backing storage: 10 s -> completed',n(mb.start.backingStorageSize/1e6)+' -> '+n(mb.end.backingStorageSize/1e6),n(ma.start.backingStorageSize/1e6)+' -> '+n(ma.end.backingStorageSize/1e6)]])}

This reduces transient JS heap pressure; it does not establish that native memory growth disappeared. The embedder heap still grows during a song, and decoded PCM dominates backing storage. One song does not prove absence of leaks across repeated uploads, and these counters do not measure GPU/driver or total process memory.

Cold-load results use a fresh profile, disabled cache, 6x CPU, 2 Mbps throughput and 60 ms network latency. The harness chooses a song one second after the upload control appears. The local static server sends JS uncompressed, so actual browser download bytes below differ from gzip build sizes. Production hosting and transport headers were not changed. Model timing means the last model response, not an instrumented GPU upload fence.

${table([['Startup measurement','Before','After'],['First contentful paint, ms',n(sb.firstContentfulPaintMs,0),n(sa.firstContentfulPaintMs,0)],['First courtyard canvas frame, ms',n(sb.firstSceneFrameMs,0),n(sa.firstSceneFrameMs,0)],['Entry JS download, ms',n(sb.js[0].downloadMs,0),n(sa.js[0].downloadMs,0)],['Entry module compile event, ms',n(sb.moduleCompileMs[0].ms,2),n(sa.moduleCompileMs[0].ms,2)],['Default menu JS downloaded, raw bytes',sb.jsBytes,sa.jsBytes],['Model bytes downloaded',sb.modelBytes,sa.modelBytes],['Last model response since navigation, ms',n(sb.modelsLastResponseMs,0),n(sa.modelsLastResponseMs,0)],['Navigation -> playing with automatic song choice, ms',n(sb.navigationToPlayingMs,0),n(sa.navigationToPlayingMs,0)],['Song select -> playing, ms',n(sb.selectedToPlayingMs,0),n(sa.selectedToPlayingMs,0)],['Worker wall time, ms',n(sb.workerWallMs[0],0),n(sa.workerWallMs[0],0)],['Worker result -> map ready, ms',n(sb.workerResultToMapMs,1),n(sa.workerResultToMapMs,1)],['Beatmap generation sampled on main thread, ms',n(sb.generatorSampledMainThreadMs,1),n(sa.generatorSampledMainThreadMs,1)]])}

The VM compile event is the main-thread v8.compileModule span, not all streaming/background parsing or later JIT work. Those events and per-chunk resource timings remain in the saved startup trace and summary. The default menu still loads the GL chunk immediately for its 3D background, so its first courtyard frame barely changes; the UI can paint and accept a song much earlier. The three-second countdown and 500 ms map-ready pause remain. PCM copying still has one-time main-thread cost (about ${n(sa.analysisSetupSampledMainThreadMs,0)} ms sampled in this run). CPU slowdown is not a faithful model of phone worker speed, GPU, RAM, thermal throttling, browser power policies or physical touch latency.

The final Vite production build succeeded; TypeScript passed with no errors. The existing >500 KB raw GL-chunk advisory remains. Baseline entry JS was 950.21 KB raw / 271.15 KB gzip. Final JS sizes:

${table(sizeRows)}

The detector/generator chunks are loaded only for the worker-less/error fallback. The worker includes both algorithms. The gzip companions total 187,250 bytes versus 1,239,952 original GLB bytes; originals are retained, so repository/deployed disk use grows by 187,250 bytes. No geometry, texture, shader, dither or outline quality was reduced. Run node tools/compress-models.mjs after regenerating models.

The look check compared ${fixed.length} fixed 384x216 RGBA frames: eight GL, eight forced CPU, and eight with Chrome --disable-webgl --disable-3d-apis. Changed pixels: ${fixed.reduce((a,r)=>a+r.pixels,0)}; maximum channel difference: ${Math.max(...fixed.map(r=>r.maxChannelDifference))}. The fixture covers incoming/returned/held/missed balls, lane rings, text, health blinking, countdown and fade, and uses describeFrame plus the real rendering path. Its seed is reset after backend setup so Three UUID creation during failed GL setup cannot perturb CPU snow respawns. No product randomness changed. I inspected GL and CPU frames and the native-touch result screen.

The whole-song memory benchmark forces GC and starts profilers near 10 s. Both baseline and final runs recorded one good judgement near 10.2 s during that setup stall; those profiled bots are workloads, not the perfect-play gate. The final unprofiled Night, Blooming Jasmine gate completed: ${song.score.perfectCount}/${song.notes} perfect, ${song.score.goodCount} good, ${song.score.okCount} ok, ${song.score.missCount} miss. Worker/main map parity for IZ-US passed (${prep.notes} notes, SHA-256 ${prep.mapSha256}); only the diagnostics creation timestamp is ignored. Worker-less/failing-worker fallback, cancellation, unchanged PCM, missing compressed-model fallback and missing native decompressor checks passed. Real CDP touch input hit ${controls.played.score.perfectCount} notes perfectly before intentional input stop; pause froze both audio time and health, resume worked, and deliberate misses reached the normal defeat screen. CDP touch events were trusted native browser events. Touch timing uses a small lead to offset CDP transport and is not a real-device latency measurement.

Evidence (all absolute paths):

- ${link('Dense before/after profiles and traces','')} (dense-before-4, dense-before-6, final-dense-after-4, final-dense-after-6 each contain cpu.cpuprofile, heap.heapprofile, trace.json.gz, raw.json and summary.json).
- ${link('Whole-song baseline memory','prod-before-4/raw.json')} and ${link('final whole-song memory','final-after-4/raw.json')}.
- ${link('Cold-load baseline','startup-before/summary.json')} and ${link('final cold load','startup-final/summary.json')} with their startup profiles/traces.
- ${link('Pixel differences','pixel-diff.json')}, ${link('baseline GL frame','before-pixels/fixed-150.png')}, ${link('final GL frame','final-pixels/fixed-150.png')}, ${link('CPU frame','after-pixels-cpu/fixed-150.png')}.
- ${link('388/388 gate','final-full-playthrough.json')}, ${link('map/worker parity','preparation/iz-us-checks.json')}, ${link('native touch and pause','controls/checks.json')}, ${link('model fallback checks','models/model-checks.json')}.
- ${link('Build output','build-final.log')} and ${link('build sizes','build-final.json')}.

Reproduction uses the existing shared node_modules and installs no dependencies:

\`\`\`sh
node tools/perf-build.mjs tools/out/perf/after-dist
node tools/perf-serve.mjs
# In a separate shell, one profiling run at a time:
node tools/perf.mjs --url http://localhost:3101/after/ --out tools/out/perf/recheck-6 --rate 6 --port 9401 --prod true --offset 125
node tools/perf-summary.mjs tools/out/perf/recheck-6 tools/out/perf/after-dist
# --full true without --offset tracks an entire natural song.
# --startup true --network true records the cold-load experiment.
# Pixel fixtures / full-perfect gate use the documented tools/shot.mjs commands
# against Vite on 3101, then: python3 tools/perf-pixel-diff.py
\`\`\`

The choices most likely to be revisited are the asynchronous GL chunk (an empty canvas until GL is ready, with no CPU-art flash) and the extra gzip companion files. Animation, flight and noteToBall logic were not edited. No dependencies were installed, no other worktrees were edited, nothing was pushed, and no hosting changes or deployment were made. Branch: pixel-perf.
`;
writeFileSync('tools/PERFORMANCE.md',document);
writeFileSync(`${root}/REPORT.md`,document);
const bars=[['Main thread per frame · 4x',perFrame(b4),perFrame(a4),'ms'],['Main thread per frame · 6x',perFrame(b6),perFrame(a6),'ms'],['Allocated in 30 seconds · 6x',allocated(b6),allocated(a6),'MB'],['First contentful paint',sb.firstContentfulPaintMs/1000,sa.firstContentfulPaintMs/1000,'s'],['Model downloads complete',sb.modelsLastResponseMs/1000,sa.modelsLastResponseMs/1000,'s']];
const html=`<!doctype html><html><head><meta charset="utf-8"><style>:root{color:var(--foreground);font-family:var(--font-sans)}body{margin:0;padding:0;font-size:14px;line-height:1.4}.legend{display:flex;gap:22px;color:var(--muted-foreground);margin-bottom:18px}.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:var(--chart-2)}.dot.after{background:var(--primary)}.metric{margin-bottom:24px}.name{font-weight:600;margin-bottom:6px}.row{display:grid;grid-template-columns:55px minmax(0,1fr) 84px;align-items:center;gap:10px;margin-top:5px}.label{color:var(--muted-foreground);font-size:12px}.track{height:10px;background:var(--secondary);border-radius:4px}.bar{height:10px;border-radius:4px;background:var(--chart-2)}.bar.after{background:var(--primary)}.value{text-align:right;font-variant-numeric:tabular-nums}.note{color:var(--muted-foreground);font-size:12px;margin-top:12px}</style></head><body><div class="legend"><span><i class="dot"></i>Before</span><span><i class="dot after"></i>After</span></div>${bars.map(([name,b,a,unit])=>`<div class="metric"><div class="name">${name}</div>${[['Before',b,''],['After',a,'after']].map(([label,v,c])=>`<div class="row"><span class="label">${label}</span><div class="track"><div class="bar ${c}" style="width:${v/b*100}%"></div></div><span class="value">${n(v)} ${unit}</span></div>`).join('')}</div>`).join('')}<div class="note">Muted headless Chrome, phone viewport, 4x / 6x CPU slowdown. Dense IZ-US passage; startup at 2 Mbps. Emulation does not replace testing on a real phone.</div></body></html>`;
writeFileSync(`${root}/comparison.html`,html);
console.log('Wrote tools/PERFORMANCE.md and tools/out/perf/{REPORT.md,comparison.html,build-final.json}');
