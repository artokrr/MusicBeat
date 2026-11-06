// Real CDP touch events, audio-clock pause/resume, and the failure fade.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const out='tools/out/perf/controls',port=9405;
mkdirSync(out,{recursive:true});
const userData=mkdtempSync(resolve(out,'chrome-')),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--mute-audio','--disable-extensions','--no-first-run',
  '--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`,`--user-data-dir=${userData}`,'about:blank',
],{stdio:'ignore'});
let ws;
try{
  let page;for(let i=0;i<75&&!page;i++){await sleep(200);try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page')}catch{}}
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pending=new Map(),errors=[];let touchCount=0,touching=false;
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}))});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}
    else if(m.method==='Runtime.bindingCalled'&&m.params.name==='perfTouch'){
      const p=JSON.parse(m.params.payload),down=p.type==='keydown';touchCount++;
      if(!down&&!touching)return;
      touching=down;
      send('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x:p.x,y:p.y,id:1}]:[]}).catch(e=>errors.push(String(e)));
    }
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
  };
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value};
  await send('Page.enable');await send('Runtime.enable');await send('Runtime.addBinding',{name:'perfTouch'});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await send('Emulation.setCPUThrottlingRate',{rate:4});
  await send('Page.navigate',{url:process.argv[2]??'http://localhost:3101/after/'});
  for(let i=0;i<150&&!await evaluate('!!document.querySelector("input[type=file]")');i++)await sleep(200);
  let bot=readFileSync('tools/gl-bot.js','utf8').replace(/const app=[\s\S]*?const \{useGameStore:store\}=await import\(url\);/,'const store=window.__perfStore,url="production-store-probe";');
  bot=bot.replace(/function key\(type,lane\)\{[^\n]*\}/,`function key(type,lane){const r=document.querySelector('canvas').getBoundingClientRect();window.perfTouch(JSON.stringify({type,x:r.left+(lane+.5)*r.width/3,y:r.top+r.height/2}));}`);
  bot=bot.replace('const t=clock.currentTime-origin;','if(window.__stopBot)return;const t=clock.currentTime-origin;');
  // The stock one-run bot resets its origin on every playing transition. A
  // pause check must retain that origin, and touch CDP transport needs lead time.
  bot=bot.replace("state.phase==='playing' && prev.phase!=='playing'", "state.phase==='playing' && prev.phase!=='playing' && !clock");
  bot=bot.replace('notes[index].time+.012','notes[index].time-.010');
  await evaluate(bot);
  await evaluate(`window.__trustedTouches=0;window.addEventListener('touchstart',e=>{if(e.isTrusted&&e.target.tagName==='CANVAS')window.__trustedTouches++})`);
  const {root}=await send('DOM.getDocument'),{nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});
  await send('DOM.setFileInputFiles',{nodeId,files:['/Users/artem/Downloads/Night, Blooming Jasmine.mp3']});
  const status=()=>evaluate('({phase:window.__perfStore.getState().phase,time:window.__bot.elapsed,health:window.__perfStore.getState().health,score:window.__perfStore.getState().score})');
  for(let i=0;i<200&&(await status()).time<14;i++)await sleep(200);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  await sleep(100);const paused=await status();await sleep(750);const stillPaused=await status();
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  for(let i=0;i<200&&(await status()).time<30;i++)await sleep(200);
  const played=await status();
  await evaluate('window.__stopBot=true');
  if(touching)await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const gameTime=()=>evaluate(`(()=>{
    const host=document.getElementById('root'),key=Object.keys(host).find(k=>k.startsWith('__reactContainer$'));
    const root=host[key].stateNode.current;let answer=null;
    function walk(node){if(!node||answer!==null)return;const p=node.memoizedProps;if(typeof p?.getCurrentTime==='function'&&p.beatmap){answer=p.getCurrentTime();return;}walk(node.child);walk(node.sibling);}
    walk(root);return answer;
  })()`);
  let failureFreeze;
  for(let i=0;i<150&&!await evaluate('window.__bot.done');i++){
    if((await status()).phase==='ended'&&!failureFreeze){const first=await gameTime();await sleep(250);failureFreeze={first,second:await gameTime()};}
    await sleep(200);
  }
  const result={paused,stillPaused,played,failureFreeze,bot:await evaluate('window.__bot'),trustedTouches:await evaluate('window.__trustedTouches'),touchCommands:touchCount,errors};
  result.failures=[];
  if(paused.phase!=='paused'||stillPaused.phase!=='paused'||Math.abs(stillPaused.time-paused.time)>.02||stillPaused.health!==paused.health)result.failures.push('Pause changed the audio clock or health');
  if(played.phase!=='playing'||played.score.goodCount||played.score.okCount||played.score.missCount)result.failures.push('Touch/resume did not keep perfect judgements');
  if(result.trustedTouches<30)result.failures.push('Native touch input was not exercised');
  if(!result.bot.done||!['miss_streak','hp_depleted'].includes(result.bot.outcome))result.failures.push('Natural misses did not end the run');
  if(!failureFreeze||failureFreeze.first===null||failureFreeze.first!==failureFreeze.second)result.failures.push('Failure fade did not freeze the gameplay clock');
  if(errors.length)result.failures.push('CDP/runtime errors');
  writeFileSync(`${out}/checks.json`,JSON.stringify(result,null,2));
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/results.png`,Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify(result,null,2));
  if(result.failures.length)process.exitCode=1;
}finally{ws?.close();chrome.kill();await sleep(400);rmSync(userData,{recursive:true,force:true})}
