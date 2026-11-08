// Real upload, native-resolution screencast and in-page-only mixed audio.
// node tools/cassette-sequence.mjs [--cpu] [--slow-analysis]
// Requires the worktree's Vite on 3130. Own muted headless Chrome, CDP 9435.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const cpu=process.argv.includes('--cpu'),slow=process.argv.includes('--slow-analysis');
const prefix=cpu?'cassette-cpu':slow?'cassette-slow':'cassette';
const out=resolve('tools/out'),framesDir=resolve(out,prefix+'-frames');
mkdirSync(framesDir,{recursive:true});
const profile=mkdtempSync(resolve(out,'cassette-chrome-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
 '--headless=new','--mute-audio','--no-first-run','--no-default-browser-check',
 '--autoplay-policy=no-user-gesture-required','--remote-debugging-port=9435',
 `--user-data-dir=${profile}`,'--window-size=1152,648','about:blank'],{stdio:'ignore'});
let ws;
try {
 let page;
 for(let i=0;i<75&&!page;i++){await sleep(200);try{page=(await(await fetch('http://127.0.0.1:9435/json/list')).json()).find(p=>p.type==='page')}catch{}}
 if(!page)throw Error('Chrome did not start');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map(),frames=[],errors=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 ws.onmessage=e=>{
  const m=JSON.parse(e.data);
  if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}
  else if(m.method==='Page.screencastFrame'){
   void send('Page.screencastFrameAck',{sessionId:m.params.sessionId});
   const name=resolve(framesDir,`${String(frames.length).padStart(5,'0')}.png`);
   writeFileSync(name,Buffer.from(m.params.data,'base64'));frames.push({name,time:m.params.metadata.timestamp});
  } else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
 };
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:384,height:216,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__capture={events:[],workers:[],audioStart:0};
  const WorkerNative=Worker;
  window.Worker=new Proxy(WorkerNative,{construct(Target,args){
   const w=new Target(...args), record={start:performance.now()};window.__capture.workers.push(record);
   w.addEventListener('message',()=>record.end=performance.now(),{once:true});
   ${slow?`const post=w.postMessage.bind(w);w.postMessage=(...args)=>setTimeout(()=>post(...args),2300);`:''}
   return w;
  }});
  // Divert every production destination into a MediaStream, never speakers.
  const mixContext=new AudioContext(),mix=mixContext.createMediaStreamDestination();
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
   const chunks=[],rec=new MediaRecorder(mix.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:192000});
   rec.ondataavailable=e=>chunks.push(e.data);
   window.__stopAudio=()=>new Promise(resolve=>{rec.onstop=()=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(new Blob(chunks,{type:rec.mimeType}));};rec.stop();});
   window.__capture.audioStart=Date.now()/1000;rec.start();
  };
 `});
 await send('Page.navigate',{url:`http://localhost:3130/${cpu?'?renderer=cpu':''}`});
 await sleep(2800);
 console.log('bot',await evaluate(readFileSync('tools/gl-bot.js','utf8')));
 await evaluate(`(async()=>{
  const app=await(await fetch('/src/App.tsx')).text();
  const storeURL=app.match(/from "(\\/src\\/store\\/gameStore\\.ts[^"]*)"/)[1];
  const {useGameStore:store}=await import(storeURL);
  const upload=await(await fetch('/src/components/UploadScreen.tsx')).text();
  const recorderURL=upload.match(/from "(\\/src\\/game\\/anim\\/recorder\\.ts[^"]*)"/)[1];
  const {recorder}=await import(recorderURL);window.__store=store;window.__recorder=recorder;
  const capture=()=>{const s=store.getState(),r=recorder;window.__capture.events.push({ms:performance.now(),epoch:Date.now()/1000,screen:s.screen,phase:s.phase,inserting:r.inserting,loaded:r.loaded,key:r.key,reel:r.reel,door:r.door,oldVisible:r.oldVisible,x:r.tapeX,y:r.tapeY,z:r.tapeZ});if(!window.__capture.done)requestAnimationFrame(capture)};capture();
 })()`);
 await evaluate('__startAudio()');
 await send('Page.startScreencast',{format:'png',maxWidth:384,maxHeight:216,everyNthFrame:1});
 await sleep(800);
 const selected=await evaluate('performance.now()');
 const {root}=await send('DOM.getDocument');
 const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});
 await send('DOM.setFileInputFiles',{nodeId,files:['/Users/artem/Downloads/Night, Blooming Jasmine.mp3']});
 for(let i=0;i<160;i++){await sleep(100);if(await evaluate('window.__bot.elapsed>=8.2'))break;}
 await send('Page.stopScreencast');
 const audio=await evaluate('__stopAudio()');
 writeFileSync(resolve(out,prefix+'-audio.webm'),Buffer.from(audio.split(',')[1],'base64'));
 const result=await evaluate(`window.__capture.done=true;({...window.__capture,bot:window.__bot,selected:${selected}})`);
 result.errors=errors;result.frames=frames.map(f=>f.time);
 const ev=result.events,accepted=ev.find(e=>e.inserting),seated=ev.find(e=>e.loaded&&e.ms>selected),playing=ev.find(e=>e.phase==='playing');
 result.summary={renderer:cpu?'cpu':'gl',frameCount:frames.length,meanFps:(frames.length-1)/(frames.at(-1).time-frames[0].time),flightMs:seated.ms-accepted.ms,firstPlayingMs:playing.ms-selected,workerStartMs:result.workers[0].start-selected,workerEndMs:result.workers[0].end-selected,playKey:playing.key,reelsMoved:ev.at(-1).reel!==playing.reel,errors:errors.length};
 const checks=[];
 if(result.summary.flightMs<1400||result.summary.flightMs>1520)checks.push('Flight duration outside tolerance');
 if(result.workers[0].start>=seated.ms)checks.push('Preparation did not start in parallel');
 if(playing.ms<seated.ms+2900)checks.push('Countdown shortened');
 if(playing.key!==1||!result.summary.reelsMoved)checks.push('PLAY/reels did not start');
 if(result.bot.failures.length)checks.push('Bot registered bad judgements');
 result.failures=checks;
 // Record pause/resume through the real Escape input after the video ends.
 const key=()=>send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await key();await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(80);
 const paused=await evaluate('({phase:__store.getState().phase,reel:__recorder.reel,key:__recorder.key})');await sleep(400);
 const held=await evaluate('__recorder.reel');
 await key();await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(400);
 const resumed=await evaluate('({phase:__store.getState().phase,reel:__recorder.reel,key:__recorder.key})');
 result.pause={paused,held,resumed};if(paused.phase!=='paused'||paused.reel!==held||resumed.key!==1||resumed.reel===held)checks.push('Pause/resume failed');
 // A second accepted file uses the existing loaded deck: quit via the real
 // pause menu, select the same file again, and observe the old tape on snow.
 await key();await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(80);
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='quit').click()`);
 await sleep(120);
 const nextDoc=await send('DOM.getDocument');
 const nextInput=await send('DOM.querySelector',{nodeId:nextDoc.root.nodeId,selector:'input[type=file]'});
 await send('DOM.setFileInputFiles',{nodeId:nextInput.nodeId,files:['/Users/artem/Downloads/Night, Blooming Jasmine.mp3']});
 await sleep(560);
 result.replacement=await evaluate('({oldVisible:__recorder.oldVisible,oldZ:__recorder.oldZ,inserting:__recorder.inserting,loaded:__recorder.loaded})');
 if(!result.replacement.oldVisible||!result.replacement.inserting||result.replacement.oldZ>.02)checks.push('Replacement did not eject the old tape first');
 const ejectShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,prefix+'-eject-native.png'),Buffer.from(ejectShot.data,'base64'));
 await sleep(1000);
 result.replacement.seated=await evaluate('__recorder.loaded && !__recorder.inserting');
 if(!result.replacement.seated)checks.push('Replacement did not seat');
 writeFileSync(resolve(out,prefix+'-sequence.json'),JSON.stringify(result,null,2));
 const start=frames[0].time;
 const concat=frames.map((f,i)=>`file '${f.name}'\nduration ${i+1<frames.length?Math.max(.001,frames[i+1].time-f.time):1/60}\n`).join('')+`file '${frames.at(-1).name}'\n`;
 writeFileSync(resolve(framesDir,'frames.txt'),concat);
 const ff=(args)=>execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});
 ff(['-f','concat','-safe','0','-i',resolve(framesDir,'frames.txt'),'-ss',String(Math.max(0,start-result.audioStart)),'-i',resolve(out,prefix+'-audio.webm'),'-vf','fps=60','-c:v','libx264','-crf','15','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest',resolve(out,prefix+'-native.mp4')]);
 ff(['-i',resolve(out,prefix+'-native.mp4'),'-vf','scale=1152:648:flags=neighbor','-c:v','libx264','-crf','15','-pix_fmt','yuv420p','-c:a','copy',resolve(out,prefix+'-sequence.mp4')]);
 ff(['-ss',String(accepted.epoch-start),'-t','1.5','-i',resolve(out,prefix+'-native.mp4'),'-vf','setpts=2*PTS,fps=60,scale=1152:648:flags=neighbor','-af','atempo=0.5','-c:v','libx264','-crf','15','-pix_fmt','yuv420p',resolve(out,prefix+'-flight-half-speed.mp4')]);
 const still=(name,time,crop)=>{
  const f=frames.reduce((a,b)=>Math.abs(b.time-time)<Math.abs(a.time-time)?b:a);
  ff(['-i',f.name,'-vf',`${crop?`crop=${crop},`:''}scale=iw*3:ih*3:flags=neighbor`,'-frames:v','1',resolve(out,prefix+'-'+name+'.png')]);
 };
 still('upload',accepted.epoch-.25);still('mid-flight',accepted.epoch+.46);still('gameplay',playing.epoch+6);
 still('recorder-close',playing.epoch+6,'28:22:276:157');
 console.log(JSON.stringify({summary:result.summary,pause:result.pause,failures:checks,video:resolve(out,prefix+'-sequence.mp4')},null,2));
 if(checks.length)process.exitCode=1;
} finally {ws?.close();chrome.kill();await sleep(400);rmSync(profile,{recursive:true,force:true});}
