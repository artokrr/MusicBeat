#!/usr/bin/env node
// cd repository && node tools/blender/verify_three.mjs --port 9421
// Uses the user's installed Chrome and a disposable profile inside tools/out.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const args=process.argv.slice(2);const port=Number(args[args.indexOf('--port')+1]||9421);
const out=resolve('tools/out');mkdirSync(out,{recursive:true});
const profile=mkdtempSync(resolve(out,'chrome-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,
  '--window-size=1200,900','--mute-audio','--no-first-run','--no-default-browser-check',
  '--enable-unsafe-swiftshader','about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
  let endpoint;
  for(let attempt=0;attempt<100&&!endpoint;attempt++){
    await pause(100);try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();endpoint=list.find(p=>p.type==='page')?.webSocketDebuggerUrl;}catch{}
  }
  if(!endpoint)throw Error('Chrome CDP did not start');
  ws=new WebSocket(endpoint);await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no});
  let id=0;const pending=new Map();const errors=[];
  ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}
    if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description??msg.params.exceptionDetails.text);
    if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error')errors.push(msg.params.args.map(a=>a.value??a.description).join(' '));};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:'http://localhost:3120/model-test.html'});
  let ready=false;
  for(let i=0;i<120&&!ready;i++){await pause(250);ready=await evaluate('!!window.modelTest?.ready');}
  if(!ready)throw Error('Model check did not finish loading');
  const report=await evaluate('window.modelTest.report');
  const cases=[['courtyard','rest','front'],...Object.keys(report.assets??{}).map(name=>[name,'rest','front'])];
  for(const name of ['stranger','player'])for(const pose of ['forehand','crouch'])for(const view of ['front','side','back'])cases.push([name,pose,view]);
  for(const [asset,pose,view] of cases){
    const data=await evaluate(`(()=>{window.modelTest.show(${JSON.stringify(asset)},${JSON.stringify(pose)},${JSON.stringify(view)});return window.modelTest.capture()})()`);
    const path=resolve(out,`three_${asset}_${pose}_${view}.png`);writeFileSync(path,Buffer.from(data.split(',')[1],'base64'));
  }
  report.browserErrors=errors;report.passed=report.passed&&errors.length===0;
  writeFileSync(resolve(out,'three-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,maxJointError:report.maxJointError,errors:report.errors,browserErrors:errors,assets:Object.fromEntries(Object.entries(report.assets??{}).map(([k,v])=>[k,{triangles:v.triangles,bones:v.bones.length,head:v.maxHeadError,tail:v.maxTailError,roll:v.maxRollError}]))},null,2));
  if(!report.passed)process.exitCode=1;
}finally{
  ws?.close();chrome.kill('SIGTERM');await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);setTimeout(()=>{chrome.kill('SIGKILL');resolve()},3000).unref();});
  rmSync(profile,{recursive:true,force:true});
}
