// Muted, real Chrome/CDP phone CPU benchmark; no browser automation dependency.
// node tools/perf.mjs --out tools/out/perf/before-4 --rate 4 --full true
// Samples 30 seconds (song time 10..40), --full true also tracks a whole song.
// --offset 125 seeks the music + notes together: the sample is IZ-US 135..165s.
// --startup true --network true records cold load at 2 Mbps / 60 ms latency.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a, []));
const out = args.out ?? 'tools/out/perf/run';
const rate = Number(args.rate ?? 4), port = Number(args.port ?? 9401);
const url = args.url ?? 'http://localhost:3101/';
const song = args.song ?? '/Users/artem/Downloads/Aphex Twin - IZ-US.mp3';
const profileStart = Number(args.start ?? 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(out, { recursive: true });
const userData = mkdtempSync(resolve(out, 'chrome-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, 'about:blank',
], { stdio: 'ignore' });
let ws;
try {
  let page;
  for (let i = 0; i < 75 && !page; i++) {
    await sleep(200);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page'); } catch {}
  }
  if (!page) throw new Error('Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0, traceResolve;
  const pending = new Map(), errors = [], resources = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === 'Tracing.tracingComplete') traceResolve?.(m.params);
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    else if (m.method === 'Network.responseReceived') resources.push({ url: m.params.response.url, mime: m.params.response.mimeType, time: m.params.timestamp });
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  for (const domain of ['Page', 'Runtime', 'Network', 'Performance', 'Profiler', 'HeapProfiler']) await send(domain + '.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setCPUThrottlingRate', { rate });
  if(args.network==='true')await send('Network.emulateNetworkConditions',{offline:false,latency:60,downloadThroughput:250000,uploadThroughput:250000,connectionType:'cellular4g'});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__perf = {raf:[], costs:[], commits:0, sceneDraws:0, started:0, firstFrame:null, phaseTimes:[], workers:[], observing:false};
    const NativeWorker=Worker;
    window.Worker=new Proxy(NativeWorker,{construct(Target,args){
      const worker=new Target(...args), record={url:String(args[0]),start:performance.now()};
      window.__perf.workers.push(record);
      worker.addEventListener('message',()=>record.end=performance.now(),{once:true});return worker;
    }});
    const nativeRAF = requestAnimationFrame;
    let last = 0;
    window.requestAnimationFrame = cb => nativeRAF.call(window, function(t) {
      const p=window.__perf, start=performance.now();
      if(p.observing && t!==last){if(last)p.raf.push(t-last);last=t;}
      cb(t);
      if(p.observing)p.costs.push({name:cb.name,ms:performance.now()-start});
    });
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(...a){
      const r=draw.apply(this,a);
      if(this.canvas.isConnected && a[0]?.width===384 && a[0]?.height===216){
        if(window.__perf.firstFrame===null)window.__perf.firstFrame=performance.now();
        if(window.__perf.observing)window.__perf.sceneDraws++;
      }
      return r;
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(renderer){this.renderers.set(1,renderer);return 1},onCommitFiberRoot(){window.__perf.commits++},onCommitFiberUnmount(){}};
  ` });
  if(args.startup==='true'){
    await send('Profiler.start');
    await send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.compile',transferMode:'ReturnAsStream'});
  }
  await send('Page.navigate', { url });
  for (let i = 0; i < 150 && !await evaluate('!!document.querySelector("input[type=file]")'); i++) await sleep(200);
  await sleep(1000);
  // Same store instance as the app, including Vite's versioned HMR import URLs.
  if(args.prod!=='true')await evaluate(`(async()=>{
    const src=await(await fetch('/src/App.tsx')).text();
    const url=src.match(/from "(\\/src\\/store\\/gameStore\\.ts[^\"]*)"/)[1];
    const {useGameStore:store}=await import(url); window.__perfStore=store;
    store.subscribe((s,p)=>{if(s.phase!==p.phase||s.screen!==p.screen||s.beatmap!==p.beatmap)window.__perf.phaseTimes.push({phase:s.phase,screen:s.screen,beatmap:!!s.beatmap,ms:performance.now()})});
  })()`);
  else await evaluate(`window.__perfStore.subscribe((s,p)=>{if(s.phase!==p.phase||s.screen!==p.screen||s.beatmap!==p.beatmap)window.__perf.phaseTimes.push({phase:s.phase,screen:s.screen,beatmap:!!s.beatmap,ms:performance.now()})})`);
  if(args.offset)await evaluate(`(()=>{
    const offset=${Number(args.offset)},store=window.__perfStore;let shifted=false;
    store.subscribe((s,p)=>{if(s.beatmap&&s.beatmap!==p.beatmap&&!shifted){
      shifted=true;store.setState({beatmap:{...s.beatmap,metadata:{...s.beatmap.metadata,duration:s.beatmap.metadata.duration-offset},notes:s.beatmap.notes.filter(n=>n.time>=offset).map(n=>({...n,time:n.time-offset,holdEndTime:n.holdEndTime===undefined?undefined:n.holdEndTime-offset}))}});
    }});
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(when=0,at=0,duration){
      const seek=this.buffer===store.getState().audioBuffer?offset:0;
      return duration===undefined?start.call(this,when,at+seek):start.call(this,when,at+seek,duration);
    };
  })()`);
  let botSource=readFileSync('tools/gl-bot.js','utf8');
  if(args.prod==='true')botSource=botSource.replace(/const app=[\s\S]*?const \{useGameStore:store\}=await import\(url\);/,'const store=window.__perfStore, url="production-store-probe";');
  botSource=botSource.replace('origin=clock.currentTime;','window.__perfClock=clock;origin=clock.currentTime;');
  console.log('bot', await evaluate(botSource));
  const selected = await evaluate('performance.now()');
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [song] });
  for (let i = 0; i < 600 && !await evaluate('window.__perfStore.getState().phase==="playing"'); i++) await sleep(200);
  const startup = await evaluate(`({selected:${selected},segmentOffset:${Number(args.offset??0)},...window.__perf,paints:performance.getEntriesByType('paint').map(r=>r.toJSON()),resources:performance.getEntriesByType('resource').map(r=>({name:r.name,start:r.startTime,duration:r.duration,size:r.encodedBodySize})),navigation:performance.getEntriesByType('navigation').map(r=>r.toJSON()),notes:window.__perfStore.getState().beatmap?.notes.length,duration:window.__perfStore.getState().audioBuffer?.duration,noteTimes:window.__perfStore.getState().beatmap?.notes.map(n=>n.time)})`);
  delete startup.costs; delete startup.raf;
  writeFileSync(`${out}/startup.json`, JSON.stringify(startup, null, 2));
  console.log('started', JSON.stringify({rate,notes:startup.notes,duration:startup.duration,selectedToPlaying:startup.phaseTimes.at(-1).ms-selected,firstFrame:startup.firstFrame}));
  if(args.startup==='true'){
    const cpu=await send('Profiler.stop');
    writeFileSync(`${out}/startup.cpuprofile`,JSON.stringify(cpu.profile));
    const done=new Promise(r=>traceResolve=r);await send('Tracing.end');
    const {stream}=await done;let trace='';
    while(true){const c=await send('IO.read',{handle:stream,size:1024*1024});trace+=c.data;if(c.eof)break;}
    await send('IO.close',{handle:stream});
    writeFileSync(`${out}/startup-trace.json.gz`,gzipSync(trace));
    writeFileSync(`${out}/metrics.json`,JSON.stringify(await send('Performance.getMetrics'),null,2));
    ws.close();chrome.kill();await sleep(400);rmSync(userData,{recursive:true,force:true});
    process.exit(0);
  }
  // Measure the same 10s..40s song window. A full run additionally samples heap
  // every 5 s until natural audio completion, with profilers stopped after 40s.
  while (await evaluate('window.__bot.elapsed') < profileStart) await sleep(500);
  // For the dense excerpt, pause the real audio clock during profiler setup;
  // the setup's forced GC must not itself cause late keyboard judgements.
  if(args.offset)await evaluate('window.__perfClock.suspend()');
  await send('HeapProfiler.collectGarbage');
  const heapStart = await send('Runtime.getHeapUsage');
  const metricsStart = await send('Performance.getMetrics');
  await send('Profiler.setSamplingInterval', { interval: 1000 });
  await send('Profiler.start');
  await send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.gc', transferMode: 'ReturnAsStream' });
  await evaluate('window.__perf.raf=[];window.__perf.costs=[];window.__perf.commits=0;window.__perf.sceneDraws=0;window.__perf.observing=true;window.__perf.started=performance.now()');
  if(args.offset)await evaluate('window.__perfClock.resume()');
  const memory = [{ songTime:profileStart, ...heapStart }];
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    memory.push({ songTime: await evaluate('window.__bot.elapsed'), ...await send('Runtime.getHeapUsage') });
  }
  const measured = await evaluate('window.__perf.observing=false;({...window.__perf,ms:performance.now()-window.__perf.started,bot:window.__bot})');
  const metricsEnd = await send('Performance.getMetrics');
  const cpu = await send('Profiler.stop');
  const heap = await send('HeapProfiler.stopSampling');
  const traceDone = new Promise(r => traceResolve = r);
  await send('Tracing.end');
  const { stream } = await traceDone;
  let trace = '';
  while (true) { const chunk = await send('IO.read', { handle:stream, size:1024*1024 }); trace += chunk.data; if(chunk.eof)break; }
  await send('IO.close', { handle:stream });
  writeFileSync(`${out}/trace.json.gz`, gzipSync(trace));
  writeFileSync(`${out}/cpu.cpuprofile`, JSON.stringify(cpu.profile));
  writeFileSync(`${out}/heap.heapprofile`, JSON.stringify(heap.profile));
  if (args.full === 'true') {
    while (!await evaluate('window.__bot.done')) {
      await sleep(5000);
      memory.push({ songTime:await evaluate('window.__bot.elapsed'), ...await send('Runtime.getHeapUsage') });
      if(memory.length%6===0)console.log('song',memory.at(-1).songTime.toFixed(1));
      if(memory.length>100)throw new Error('Full song timed out');
    }
  }
  const bot = await evaluate('window.__bot');
  await send('HeapProfiler.collectGarbage');
  const heapEnd = await send('Runtime.getHeapUsage');
  const environment={browser:await send('Browser.getVersion'),phone:await evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints})')};
  writeFileSync(`${out}/raw.json`, JSON.stringify({rate,url,song,offset:Number(args.offset??0),environment,measured,metricsStart,metricsEnd,memory,heapStart,heapEnd,bot,errors,resources},null,2));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${out}/page.png`,Buffer.from(shot.data,'base64'));
  console.log('finished', JSON.stringify({rate,frames:measured.raf.length,commits:measured.commits,bot,heapStart,heapEnd}));
} finally {
  ws?.close(); chrome.kill(); await sleep(400); rmSync(userData, { recursive:true,force:true });
}
