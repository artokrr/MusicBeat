// Eight real file-input loads, captured with internal audio and muted headless Chrome.
// node tools/tapes-session.mjs [--cpu true --pass cpu --cdp 9493]
// Vite must already be running on 3190. GL writes the two tapes-*.mp4 deliverables;
// both backends write native PNGs and pose snapshots under tools/out/.
// Snow acceleration uses only the DEV-gated presentation hook.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const vite = Number(arg('vite', 3190)), cdp = Number(arg('cdp', 9492)), pass = arg('pass', 'session');
const song = arg('song', '/Users/artem/Downloads/Night, Blooming Jasmine.mp3');
const out = resolve('tools/out'), framesDir = resolve(out, `cassette-sound-${pass}-frames`);
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const profile = mkdtempSync(resolve(out, 'cassette-sound-chrome-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ffmpeg = args => execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${cdp}`,
  `--user-data-dir=${profile}`, '--window-size=1152,648', 'about:blank'], { stdio: 'ignore' });

// Durations (s) of the cassette buffers as decoded, used to tell sources apart.
const CASSETTE = { doorOpen: .45, eject: .30, snow: .28, seat: .50, doorShut: .36, play: .48, stop: .80, air: 1.3, thump: .09,
  rewindKey: .40, rewind: 4.40, rewindStop: .52 };
const HIT = .16; // paddle, smash and table takes

let ws;
try {
  let page;
  for (let i = 0; i < 75 && !page; i++) { await sleep(200); try { page = (await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).find(p => p.type === 'page'); } catch { /* starting */ } }
  if (!page) throw Error('Chrome did not start');
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(), frames = [], errors = [], consoleLines = [];
  const send = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; pending.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(Error(JSON.stringify(m.error))) : p.ok(m.result); }
    else if (m.method === 'Page.screencastFrame') {
      void send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
      const name = resolve(framesDir, `${String(frames.length).padStart(5, '0')}.png`);
      writeFileSync(name, Buffer.from(m.params.data, 'base64')); frames.push({ name, time: m.params.metadata.timestamp });
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    else if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) consoleLines.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
  const escape = () => key('Escape', 'Escape', 27);
  const mark = name => evaluate(`window.__capture.marks.push({name:${JSON.stringify(name)},ms:performance.now(),epoch:Date.now()/1000}),performance.now()`);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 384, height: 216, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__capture={starts:[],marks:[],events:[],claps:[]};
    window.__allow=null; // null: everything plays; else a predicate on the buffer duration
    const startNative=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(when=0,offset=0,...rest){
      const c=this.context,s=c.getOutputTimestamp?.()??{},d=this.buffer?Math.round(this.buffer.duration*100)/100:0;
      const allowed=!window.__allow||window.__allow(d);
      window.__capture.starts.push({perf:performance.now(),duration:d,when,offset,currentTime:c.currentTime,contextTime:s.contextTime,performanceTime:s.performanceTime,outputLatency:c.outputLatency,baseLatency:c.baseLatency,allowed});
      if(allowed)return startNative.call(this,when,offset,...rest);
      this.__blocked=true;
    };
    const stopNative=AudioScheduledSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop=function(...args){if(!this.__blocked)return stopNative.apply(this,args);};
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
      window.__capture.audioStart=Date.now()/1000;window.__capture.audioStartPerf=performance.now();rec.start();
    };
  ` });
  await send('Page.navigate', { url: `http://localhost:${vite}/${arg("cpu", "false")==="true"?"?renderer=cpu":""}` });
  await sleep(2800);
  await evaluate(`(async()=>{
    const src=async p=>(await fetch(p)).text(),find=(text,re)=>text.match(re)[1];
    const app=await src('/src/App.tsx'),upload=await src('/src/components/UploadScreen.tsx');
    const {useGameStore:store}=await import(find(app,/from "(\\/src\\/store\\/gameStore\\.ts[^"]*)"/));
    const {recorder,setTapeBurialTimeScale}=await import(find(upload,/from "(\\/src\\/game\\/anim\\/recorder\\.ts[^"]*)"/));
    const {cassette}=await import(find(upload,/from "(\\/src\\/audio\\/cassetteSfx\\.ts[^"]*)"/));
    const sfxURL=find(await src('/src/audio/cassetteSfx.ts'),/from "(\\/src\\/audio\\/sfx\\.ts[^"]*)"/);
    const sfxModule=await import(sfxURL);
    Object.assign(window,{__store:store,__recorder:recorder,__setTapeBurialTimeScale:setTapeBurialTimeScale,__cassette:cassette,__sfx:sfxModule.sfx,__sfxOutput:sfxModule.sfxOutput});
    let last={};
    const watch=()=>{const s=store.getState(),r=recorder;const e={screen:s.screen,phase:s.phase,ejectMoving:r.tapes.some(t=>t.active&&performance.now()-t.startedMs>100&&performance.now()-t.startedMs<820),ejectLanded:r.tapes.some(t=>t.active&&t.startedMs===r.startedMs&&t.landed),inserting:r.inserting,loaded:r.loaded,key:r.key,playing:r.playing,startedMs:r.startedMs,rewindStartedMs:r.rewindStartedMs};
      if(Object.keys(e).some(k=>e[k]!==last[k]))window.__capture.events.push({ms:performance.now(),epoch:Date.now()/1000,...e});last=e;requestAnimationFrame(watch)};watch();
    // Clapperboard: a white frame and a click started in the same animation frame, on the sfx context.
    window.__clap=()=>new Promise(done=>{
      const output=window.__sfxOutput(),c=output.context,s=c.getOutputTimestamp();
      const target=performance.now()+120,at=s.contextTime+(target-s.performanceTime)/1000;
      const o=c.createBufferSource(),g=c.createGain(),buffer=c.createBuffer(1,Math.round(c.sampleRate*.30),c.sampleRate);
      const data=buffer.getChannelData(0);for(let i=0;i<c.sampleRate*.012;i++)data[i]=Math.sin(i/c.sampleRate*Math.PI*3000);o.buffer=buffer;
      g.gain.setValueAtTime(.4,at);g.gain.setValueAtTime(0,at+.012);
      o.connect(g);g.connect(output.bus);o.start(at);o.stop(at+.03);
      window.__capture.claps.push({perf:target,epoch:Date.now()/1000+.120,scheduled:true,currentTime:c.currentTime,contextTime:s.contextTime,performanceTime:s.performanceTime});
      const show=()=>{if(performance.now()<target){requestAnimationFrame(show);return;}
        const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;background:#fff;z-index:99999';document.body.appendChild(d);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{d.remove();done()}));
      };requestAnimationFrame(show);
    });
  })()`);
  const isCassette = Object.values(CASSETTE).map(d => `d===${d}`).join('||');
  if (pass === 'measure') await evaluate(`window.__allow=d=>${isCassette}`);
  await evaluate('__startAudio()');
  // The way a player arrives: the pointer moves over the drop zone, which wakes the audio.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 192, y: 130 });
  await sleep(300);
  await evaluate('__sfxOutput().context.resume()');
  await sleep(300);

  if (arg('sfx')) await evaluate(`__store.getState().setSfxVolume(${Number(arg('sfx'))})`);
  {
    await send('Page.startScreencast', { format: 'png', maxWidth: 384, maxHeight: 216, everyNthFrame: 1 });
    await sleep(500);
    for (let i = 0; i < 3; i++) { await evaluate('__clap()'); await sleep(350); }
    const nodeOf = async selector => { const { root } = await send('DOM.getDocument'); return (await send('DOM.querySelector', { nodeId: root.nodeId, selector })).nodeId; };
    await sleep(400);
    await mark('upload1');
    await send('DOM.setFileInputFiles', { nodeId: await nodeOf('input[type=file]'), files: [song] });
    for (let i = 0; i < 200; i++) { await sleep(100); if (await evaluate('__store.getState().phase==="playing"')) break; }
    await mark('pause'); await escape(); await sleep(1300);
    await mark('resume'); await escape(); await sleep(1500);
    await mark('quit'); await escape(); await sleep(150);
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='quit').click()`);
    await sleep(700);

    await mark('upload2');
    await send('DOM.setFileInputFiles', { nodeId: await nodeOf('input[type=file]'), files: [song] });
    // Esc during the second countdown: the game ignores it there, and the rewind must carry on once.
    for (let i = 0; i < 300; i++) { await sleep(20); if (await evaluate(`__store.getState().screen==='playing'&&__store.getState().phase==='countdown'`)) break; }
    await sleep(1200); await mark('countdown-escape'); await escape();
    await mark(`phase after Esc: ${await evaluate('__store.getState().phase')}`);
    for (let i = 0; i < 200; i++) { await sleep(100); if (await evaluate('__store.getState().phase==="playing"')) break; }
    const snapshots=[];
    const shot=async name=>{
      const data=await evaluate(`document.querySelector('canvas').toDataURL()`);
      writeFileSync(resolve(out, `tapes-${arg('cpu','false')==='true'?'cpu':'gl'}-${name}.png`),Buffer.from(data.split(',')[1],'base64'));
      snapshots.push({name,tapes:await evaluate('__recorder.tapes')});
    };
    await shot('1');
    const songs=[song,'/Users/artem/Downloads/Aphex Twin - IZ-US.mp3','/Users/artem/Downloads/Буерак - Шаги.mp3'];
    for(let load=3;load<=8;load++) {
      await escape();await sleep(100);
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='quit').click()`);
      await sleep(300);await mark('upload'+load);
      await send('DOM.setFileInputFiles',{nodeId:await nodeOf('input[type=file]'),files:[songs[(load-1)%3]]});
      for(let i=0;i<400;i++){await sleep(50);if(await evaluate('__store.getState().phase==="playing"'))break;}
      await sleep(150);
      if(load===4)await shot('3');
      if(load===7){
        await shot('6');
        await evaluate(`__setTapeBurialTimeScale(300)`);
        await sleep(1750);
        await evaluate(`__setTapeBurialTimeScale(0)`);
        await shot('snow');
      }
    }
    await shot('mixed');
    await evaluate(`__setTapeBurialTimeScale(300)`);
    await sleep(3000);await shot('buried');
    writeFileSync(resolve(out,`tapes-${arg('cpu','false')==='true'?'cpu':'gl'}-flow.json`),JSON.stringify(snapshots,null,2));
    for (let i = 0; i < 3; i++) { await evaluate('__clap()'); await sleep(350); }
    await send('Page.stopScreencast');
    const audio = await evaluate('__stopAudio()');
    const capture = await evaluate('window.__capture');
    const prefix = resolve(out, `cassette-sound-${pass}`);
    writeFileSync(prefix + '-audio.webm', Buffer.from(audio.split(',')[1], 'base64'));
    ffmpeg(['-i', prefix + '-audio.webm', '-ar', '48000', '-c:a', 'pcm_s16le', prefix + '-audio.wav']);
    writeFileSync(prefix + '.json', JSON.stringify({ frames: frames.map(f => f.time), capture, errors, console: consoleLines, bot: await evaluate('window.__bot') }, null, 2));
    // Native-resolution video on the frames' own timestamps, with the audio laid at its capture start.
    const start = frames[0].time;
    writeFileSync(resolve(framesDir, 'frames.txt'), frames.map((f, i) => `file '${f.name}'\nduration ${i + 1 < frames.length ? Math.max(.001, frames[i + 1].time - f.time) : 1 / 60}\n`).join('') + `file '${frames.at(-1).name}'\n`);
    const audioLead = start - capture.audioStart;
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', resolve(framesDir, 'frames.txt'), '-ss', String(Math.max(0, audioLead)), '-i', prefix + '-audio.wav', '-vf', 'fps=60', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv444p', '-c:a', 'pcm_s16le', '-shortest', prefix + '-native.mkv']);
    if (pass === 'session') {
      ffmpeg(['-i', prefix+'-native.mkv','-vf','scale=1152:648:flags=neighbor,fps=60','-c:v','libx264','-crf','14','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k',resolve(out,'tapes-session.mp4')]);
      const up2=capture.marks.find(m=>m.name==='upload2').epoch-start;
      ffmpeg(['-ss',String(up2-.25),'-t','2.3','-i',prefix+'-native.mkv','-vf','setpts=2*PTS,scale=1152:648:flags=neighbor,fps=60','-af','atempo=0.5','-c:v','libx264','-crf','14','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k',resolve(out,'tapes-eject-half-speed.mp4')]);
    }
    console.log(JSON.stringify({ frames: frames.length, errors: errors.length, console: consoleLines, marks: capture.marks.map(m => m.name) }));
  }
} finally { ws?.close(); chrome.kill(); await sleep(400); rmSync(profile, { recursive: true, force: true }); }
