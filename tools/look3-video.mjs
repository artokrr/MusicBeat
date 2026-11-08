// Live paired rendering of one SceneFrame, muted headless Chrome, in-page audio.
// Left panel restores the complete 573b8f1 material, atmosphere, maps and ball casters.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),work=mkdtempSync(resolve('tools/out/look3-video-'));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--mute-audio','--autoplay-policy=no-user-gesture-required','--remote-debugging-port=9536',`--user-data-dir=${work}`,'--no-first-run','about:blank'],{stdio:'ignore'});
let ws;
try{
 let page;for(let i=0;i<75&&!page;i++){await sleep(200);try{page=(await(await fetch('http://127.0.0.1:9536/json/list')).json()).find(p=>p.type==='page')}catch{}}
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await send('Page.enable');await send('Runtime.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 const mixContext=new AudioContext(),mix=mixContext.createMediaStreamDestination(),connect=AudioNode.prototype.connect,sinks=new WeakMap();
 AudioNode.prototype.connect=function(destination,...rest){if(destination instanceof AudioDestinationNode){let sink=sinks.get(this.context);if(!sink){sink=this.context.createMediaStreamDestination();sinks.set(this.context,sink);connect.call(mixContext.createMediaStreamSource(sink.stream),mix)}return connect.call(this,sink,...rest)}return connect.call(this,destination,...rest)};
 window.__audioMix={mixContext,mix};
 `});
 await send('Page.navigate',{url:'http://localhost:3230/?nointro'});await sleep(2500);
 const source=file=>execFileSync('git',['show',`573b8f1:client/src/game/gl/${file}.ts`],{encoding:'utf8'});
 const glsl=(s,name)=>s.match(new RegExp('(?:export )?const '+name+' = /\\* glsl \\*/ `([\\s\\S]*?)`;'))[1];
 const noise=glsl(source('material'),'pixelNoise');
 const fragment=glsl(source('material'),'fragment').replace('${pixelNoise}',noise);
 const atmosphere=source('atmosphere');
 const outline=glsl(source('renderer'),'outlineFragment').replace('${pixelNoise}',noise)
  .replace("${PREMIUM_LOOK ? atmosphereUniforms : ''}",glsl(atmosphere,'atmosphereUniforms'))
  .replace("${PREMIUM_LOOK ? atmosphereFragment : ''}",glsl(atmosphere,'atmosphereFragment'));
 await evaluate(`(async()=>{
  const path=performance.getEntriesByType('resource').find(r=>r.name.includes('/src/game/gl/renderer.ts')).name;
  const {GLBackend}=await import(path);
  const old=new GLBackend();await Promise.all([old.props.ready,old.paddles.ready]);
  for(let i=0;i<200&&(old.player.status!=='glb'||old.stranger.status!=='glb');i++)await new Promise(r=>setTimeout(r,20));
  old.scene.traverse(o=>{
   if(o.material?.fragmentShader?.includes('contactBalls')){o.material.fragmentShader=${JSON.stringify(fragment)};o.material.needsUpdate=true}
   if(o.isLight && o.shadow){o.shadow.mapSize.set(1024,1024)}
  });
  old.spheres.mesh.customDepthMaterial.onBeforeCompile=()=>{};
  old.spheres.mesh.customDepthMaterial.customProgramCacheKey=()=> 'look3-baseline-depth';
  old.spheres.mesh.customDepthMaterial.needsUpdate=true;
  old.outputScene.children[0].material.fragmentShader=${JSON.stringify(outline)};old.outputScene.children[0].material.needsUpdate=true;
  const render=GLBackend.prototype.render;
  GLBackend.prototype.render=function(frame){const canvas=render.call(this,frame);if(this!==old){render.call(old,frame);window.__pair={fresh:canvas,old:old.renderer.domElement}}return canvas};
  const pair=document.createElement('canvas');pair.width=768;pair.height=216;const ctx=pair.getContext('2d');
  const scratch=document.createElement('canvas');scratch.width=384;scratch.height=216;const s=scratch.getContext('2d',{willReadFrequently:true});
  window.__recordPair=async()=>{
   await window.__audioMix.mixContext.resume();
   const stream=pair.captureStream(60);for(const track of window.__audioMix.mix.stream.getAudioTracks())stream.addTrack(track);
   const chunks=[],rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9,opus',videoBitsPerSecond:8000000});rec.ondataavailable=e=>chunks.push(e.data);
   const draw=()=>{if(!window.__pair)return;const p=window.__pair;const game=[...document.querySelectorAll('canvas')].find(c=>c.width===384&&c.height===216);if(!game)return;
    s.clearRect(0,0,384,216);s.drawImage(game,0,0);const overlay=s.getImageData(0,0,384,216);
    s.drawImage(p.fresh,0,0);const fresh=s.getImageData(0,0,384,216);
    s.drawImage(p.old,0,0);const old=s.getImageData(0,0,384,216);
    for(let i=0;i<old.data.length;i+=4){if(overlay.data[i]!==fresh.data[i]||overlay.data[i+1]!==fresh.data[i+1]||overlay.data[i+2]!==fresh.data[i+2]){old.data[i]=overlay.data[i];old.data[i+1]=overlay.data[i+1];old.data[i+2]=overlay.data[i+2]}}
    ctx.putImageData(old,0,0);ctx.drawImage(game,384,0);
   };
   draw();const timer=setInterval(draw,1000/60);rec.start();
   return await new Promise(resolve=>{setTimeout(()=>{clearInterval(timer);rec.onstop=()=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(new Blob(chunks,{type:rec.mimeType}))};rec.stop()},15000)});
  };
 })()`);
 await evaluate(readFileSync('tools/gl-bot.js','utf8'));
 const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});
 await send('DOM.setFileInputFiles',{nodeId,files:['/Users/artem/Downloads/Night, Blooming Jasmine.mp3']});
 for(let i=0;i<300;i++){await sleep(100);if(await evaluate('window.__bot.elapsed>8'))break}
 if(!await evaluate('!!window.__pair'))throw Error('Live backend hook was not installed');
 const data=await evaluate('__recordPair()');writeFileSync('tools/out/look3-pair-native.webm',Buffer.from(data.split(';base64,')[1],'base64'));
 const ff=args=>execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-i','tools/out/look3-pair-native.webm',...args],{stdio:'inherit'});
 ff(['-vf','scale=2304:648:flags=neighbor,fps=60','-c:v','libx264','-crf','14','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','tools/out/look3-before-after.mp4']);
 ff(['-vf','crop=384:216:384:0,scale=1920:1080:flags=neighbor,fps=60','-c:v','libx264','-crf','14','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','tools/out/look3-1080p.mp4']);
 console.log(await evaluate('window.__bot'));
}finally{ws?.close();chrome.kill();await sleep(400);rmSync(work,{recursive:true,force:true})}
