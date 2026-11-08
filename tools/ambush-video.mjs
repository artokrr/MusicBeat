// Records the start of a song the way a player meets it (real file input, the
// bot playing perfectly), from the tape seating through the 3-2-1 countdown and
// PLAY to a few seconds of play. Chrome is muted; audio is captured in the page.
//
//   node tools/ambush-video.mjs [--classic] [--vite 3200] [--cdp 9505] [--song path] [--out tools/out/ambush-shagi.mp4] [--after 5]
//
// The default start is the ambush (the stranger serves during the countdown); --classic opens ?classic.
// Writes the 3x nearest-neighbour 60 fps video and <out>.json (page events, countdown ticks, presses).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const ambush = !process.argv.includes('--classic');
const vite = Number(arg('vite', 3200)), cdp = Number(arg('cdp', 9505)), after = Number(arg('after', 5));
const song = arg('song', '/Users/artem/Downloads/Буерак - Шаги.mp3');
const outFile = resolve(arg('out', ambush ? 'tools/out/ambush-shagi.mp4' : 'tools/out/ambush-off-shagi.mp4'));
const work = mkdtempSync(resolve('tools/out', 'ambush-video-')), framesDir = resolve(work, 'frames');
mkdirSync(framesDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ffmpeg = args => execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`,
  `--user-data-dir=${resolve(work, 'chrome')}`, '--window-size=1152,648', 'about:blank'], { stdio: 'ignore' });

let ws;
try {
  let page;
  for (let i = 0; i < 75 && !page; i++) { await sleep(200); try { page = (await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).find(p => p.type === 'page'); } catch { /* starting */ } }
  if (!page) throw Error('Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), frames = [], errors = [];
  const send = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; pending.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(Error(JSON.stringify(m.error))) : p.ok(m.result); }
    else if (m.method === 'Page.screencastFrame') {
      void send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
      const name = resolve(framesDir, `${String(frames.length).padStart(5, '0')}.png`);
      writeFileSync(name, Buffer.from(m.params.data, 'base64')); frames.push({ name, time: m.params.metadata.timestamp });
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 384, height: 216, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__capture={events:[],ticks:[]};
    // The countdown's one-second timer: note the song clock at each tick.
    const setIntervalNative=window.setInterval;
    window.setInterval=function(fn,ms,...rest){
      if(ms===1000){const inner=fn;fn=function(){window.__capture.ticks.push({epoch:Date.now()/1000,clock:window.__songClock?.()});return inner.apply(this,arguments);};}
      return setIntervalNative.call(this,fn,ms,...rest);
    };
    // Divert every production destination into a MediaStream, never speakers.
    const mixContext=new AudioContext({sampleRate:48000}),mix=mixContext.createMediaStreamDestination();
    const originalConnect=AudioNode.prototype.connect,sinks=new WeakMap();
    AudioNode.prototype.connect=function(destination,...rest){
      if(destination instanceof AudioDestinationNode){
        let sink=sinks.get(this.context);
        if(!sink){sink=this.context.createMediaStreamDestination();sinks.set(this.context,sink);originalConnect.call(mixContext.createMediaStreamSource(sink.stream),mix);}
        return originalConnect.call(this,sink,...rest);
      }
      return originalConnect.call(this,destination,...rest);
    };
    window.__startAudio=async()=>{
      await mixContext.resume();
      const silent=mixContext.createConstantSource(),gain=mixContext.createGain();gain.gain.value=0;silent.connect(gain);gain.connect(mix);silent.start();
      const chunks=[],rec=new MediaRecorder(mix.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:256000});
      rec.ondataavailable=e=>chunks.push(e.data);
      window.__stopAudio=()=>new Promise(resolve=>{rec.onstop=()=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(new Blob(chunks,{type:rec.mimeType}));};rec.stop();});
      window.__capture.audioStart=Date.now()/1000;rec.start();
    };
  ` });
  await send('Page.navigate', { url: `http://localhost:${vite}/${ambush ? '' : '?classic'}` });
  await sleep(2800);
  await evaluate(`(async()=>{
    const src=async p=>(await fetch(p)).text(),find=(text,re)=>text.match(re)[1];
    const app=await src('/src/App.tsx'),upload=await src('/src/components/UploadScreen.tsx');
    const {useGameStore:store}=await import(find(app,/from "(\\/src\\/store\\/gameStore\\.ts[^"]*)"/));
    const {recorder}=await import(find(upload,/from "(\\/src\\/game\\/anim\\/recorder\\.ts[^"]*)"/));
    window.__store=store;
    let last={};
    const watch=()=>{const s=store.getState(),e={screen:s.screen,phase:s.phase,inserting:recorder.inserting,loaded:recorder.loaded,playing:recorder.playing};
      if(Object.keys(e).some(k=>e[k]!==last[k]))window.__capture.events.push({epoch:Date.now()/1000,clock:window.__songClock?.(),...e});last=e;requestAnimationFrame(watch)};watch();
  })()`);
  await evaluate('__startAudio()');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 192, y: 130 });
  await sleep(300);
  await evaluate(readFileSync('tools/gl-bot.js', 'utf8'));
  await send('Page.startScreencast', { format: 'png', maxWidth: 384, maxHeight: 216, everyNthFrame: 1 });
  await sleep(500);
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [song] });
  for (let i = 0; i < 300; i++) { await sleep(100); if (await evaluate(`window.__bot.elapsed>=${after + 0.5}`)) break; }
  await send('Page.stopScreencast');
  const audio = await evaluate('__stopAudio()');
  const capture = await evaluate('window.__capture');
  const bot = await evaluate('window.__bot');
  writeFileSync(resolve(work, 'audio.webm'), Buffer.from(audio.split(',')[1], 'base64'));
  ffmpeg(['-i', resolve(work, 'audio.webm'), '-ar', '48000', '-c:a', 'pcm_s16le', resolve(work, 'audio.wav')]);
  // Native-resolution video on the frames' own timestamps, audio laid at its capture start.
  const start = frames[0].time;
  writeFileSync(resolve(framesDir, 'frames.txt'), frames.map((f, i) => `file '${f.name}'\nduration ${i + 1 < frames.length ? Math.max(.001, frames[i + 1].time - f.time) : 1 / 60}\n`).join('') + `file '${frames.at(-1).name}'\n`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', resolve(framesDir, 'frames.txt'), '-ss', String(Math.max(0, start - capture.audioStart)), '-i', resolve(work, 'audio.wav'),
    '-vf', 'fps=60', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv444p', '-c:a', 'pcm_s16le', '-shortest', resolve(work, 'native.mkv')]);
  // From just before the tape seats to `after` seconds of play.
  const inserted = capture.events.find(e => e.inserting);
  const playing = capture.events.find(e => e.phase === 'playing' && e.screen === 'playing');
  const from = inserted.epoch - start + 0.85, to = playing.epoch - start + after;
  ffmpeg(['-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', resolve(work, 'native.mkv'), '-vf', 'scale=1152:648:flags=neighbor,fps=60',
    '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', outFile]);
  const at = epoch => +(epoch - start - from).toFixed(3); // seconds into the output video
  const report = {
    video: outFile, ambush,
    countdownTicks: capture.ticks.map(t => ({ videoSec: at(t.epoch), songClock: t.clock })),
    play: { videoSec: at(playing.epoch) },
    presses: bot.presses, score: bot.score ?? null, failures: bot.failures, errors: errors.length,
  };
  writeFileSync(outFile.replace(/\.mp4$/, '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { ws?.close(); chrome.kill(); await sleep(400); rmSync(work, { recursive: true, force: true }); }
