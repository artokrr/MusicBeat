// Recorder allocation audit in the real GL render path.
// node tools/tapes-profile.mjs [before|after]; Vite 3190, own muted headless Chrome on 9494.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const label=process.argv[2]??'after';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
mkdirSync('tools/out',{recursive:true});
const profile=mkdtempSync(resolve('tools/out/cassette-heap-chrome-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9494',`--user-data-dir=${profile}`,'--autoplay-policy=no-user-gesture-required','--mute-audio','--no-first-run','about:blank'],{stdio:'ignore'});
let ws;
try{
 let page;
 for(let i=0;i<50&&!page;i++){await sleep(200);try{page=(await(await fetch('http://127.0.0.1:9494/json/list')).json()).find(p=>p.type==='page')}catch{}}
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await send('Page.navigate',{url:'http://localhost:3190/'});await sleep(2500);
 await evaluate(`(async()=>{
  const source=await(await fetch('/src/game/Game.tsx')).text();const url=source.match(/from "(\\/src\\/game\\/pixel\\/renderer\\.ts[^"]*)"/)[1];
  const {currentSceneFrame}=await import(url);const {GLBackend}=await import('/src/game/gl/renderer.ts');
  const {recorder,insertCassette,sampleRecorder,playRecorder}=await import('/src/game/anim/recorder.ts');insertCassette(0);sampleRecorder(1450);playRecorder(true,1450);
  if(${JSON.stringify(label)}!=='before'){for(let i=0;i<6;i++){insertCassette(2000+i*1600);sampleRecorder(3450+i*1600);}playRecorder(true,12000);}
  const frame=structuredClone(currentSceneFrame());frame.player.visible=true;frame.playing=true;frame.playerStrokeMs=-Infinity;frame.recorder=recorder;
  const gl=new GLBackend();gl.render(frame);await Promise.all([gl.props.ready,gl.paddles.ready]);await new Promise(r=>setTimeout(r,1000));
  window.requestAnimationFrame=()=>0;await new Promise(r=>setTimeout(r,100));
  for(let i=0;i<2400;i++){frame.timeMs=10000+i*16.67;sampleRecorder(frame.timeMs);gl.render(frame)}
  window.__bench={frame,gl,sampleRecorder};return true;
 })()`);
 await send('HeapProfiler.startSampling',{samplingInterval:512,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
 console.log(await evaluate(`(async()=>{const {frame,gl,sampleRecorder}=window.__bench;const costs=[];for(let b=0;b<8;b++){for(let i=0;i<120;i++){frame.timeMs=60000+(b*120+i)*16.67;sampleRecorder(frame.timeMs);if(i%24===0)frame.playerStrokeMs=frame.timeMs;const start=performance.now();gl.render(frame);costs.push(performance.now()-start)}await new Promise(r=>setTimeout(r,0));}costs.sort((a,b)=>a-b);window.__renderCost={median:costs[480],p95:costs[912]};return {costs:window.__renderCost,frames:960,drawCalls:gl.renderer.info.render.calls};})()`));
 writeFileSync(`tools/out/tapes-${label}-cost.json`,JSON.stringify(await evaluate('window.__renderCost')));
 const result=await send('HeapProfiler.stopSampling');writeFileSync('tools/out/cassette-heap-profile.json',JSON.stringify(result));
 const rows=[];function walk(n,stack){const next=[...stack,{fn:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber+1}];if(n.selfSize>0&&next.some(f=>f.url.includes('/src/game/gl/')||f.url.includes('/src/game/anim/recorder')))rows.push({bytes:n.selfSize,stack:next});for(const c of n.children??[])walk(c,next)}walk(result.profile.head,[]);
 rows.sort((a,b)=>b.bytes-a.bytes);writeFileSync('tools/out/cassette-heap-render-allocations.json',JSON.stringify(rows,null,2));
 const recorderRows=rows.filter(r=>r.stack.at(-1).url.includes('/recorder.ts'));
 const own=rows.filter(r=>r.stack.at(-1).url.includes('/src/game/gl/'));
 const summary={recorderRows,recorderLeafBytes:recorderRows.reduce((a,r)=>a+r.bytes,0),frames:960,samplingInterval:512,sampledBytes:rows.reduce((a,r)=>a+r.bytes,0),ownLeafBytes:own.reduce((a,r)=>a+r.bytes,0),top:rows.slice(0,8)};
 writeFileSync(`tools/out/tapes-${label}-heap-summary.json`,JSON.stringify(summary,null,2));
 console.log(JSON.stringify({frames:summary.frames,sampledBytes:summary.sampledBytes,ownLeafBytes:summary.ownLeafBytes,recorderLeafBytes:summary.recorderLeafBytes}));
 await evaluate('window.__bench.gl.dispose()');
 await send('Page.reload');await sleep(1500);
 const reset=await evaluate(`import('/src/game/anim/recorder.ts').then(m=>({active:m.recorder.tapes.filter(t=>t.active).length,loaded:m.recorder.loaded}))`);
 if(reset.active!==0||reset.loaded)throw Error('Tape pile survived reload');
 writeFileSync('tools/out/tapes-reload.json',JSON.stringify(reset));
}finally{ws?.close();chrome.kill();await sleep(300);rmSync(profile,{recursive:true,force:true})}
