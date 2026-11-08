// Intro interaction regressions through real DOM input and drop events. Always muted.
// node tools/intro-check.mjs --cdp 9529
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const vite = Number(arg('vite', 3220)), cdp = Number(arg('cdp', 9529));
const song = arg('song', '/Users/artem/Downloads/Night, Blooming Jasmine.mp3');
mkdirSync('tools/out', { recursive: true });
const work = mkdtempSync(resolve('tools/out', 'intro-check-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  let id = 0; const pending = new Map(), errors = [];
  const send = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; pending.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(Error(JSON.stringify(m.error))) : p.ok(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 384, height: 216, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {source: `
    window.addEventListener('change', e => { if(window.__holdChange)e.stopImmediatePropagation(); }, true);
    if(new URLSearchParams(location.search).get('storage')==='denied') {
      for(const name of ['getItem','setItem']) {
        const native=Storage.prototype[name];
        Storage.prototype[name]=function(key,...args) {
          if(key==='courtyard-intro-seen')throw new DOMException('Blocked','SecurityError');
          return native.call(this,key,...args);
        };
      }
    }
  `});
  const rows=[];
  const assert=async(name,expression)=>{const ok=await evaluate(expression);rows.push({name,ok});if(!ok)throw Error(name);};
  // The opening is opt-in (?intro); ?nointro checks still mean "no opening".
  const nav=async(query='')=>{const q=query.includes('nointro')?query:(query?query.replace('?','?intro&'):'?intro');await send('Page.navigate',{url:`http://localhost:${vite}/${q}`});await sleep(1200);};
  const menu=`document.querySelector('[data-opening]')`;
  await nav();
  await assert('starts hidden',`${menu}?.dataset.opening==='active' && getComputedStyle(${menu}).visibility==='hidden'`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(100);
  await assert('key skips immediately',`${menu}?.dataset.opening==='done' && getComputedStyle(${menu}).opacity==='1'`);
  await evaluate(`(async()=>{const app=await(await fetch('/src/App.tsx')).text();const {useGameStore:s}=await import(app.match(/from "(\\/src\\/store\\/gameStore\\.ts[^"]*)"/)[1]);window.__store=s;s.getState().setScreen('loading')})()`);
  await sleep(100);await evaluate(`__store.getState().setScreen('upload')`);await sleep(100);
  await assert('return to upload does not replay',`${menu}?.dataset.opening==='done'`);
  await nav();await assert('reload in session does not replay',`${menu}?.dataset.opening==='done'`);
  await evaluate(`sessionStorage.clear()`);await nav('?nointro');
  await assert('nointro disables opening',`${menu}?.dataset.opening==='done'`);
  await nav();await send('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:10,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:10,button:'left',clickCount:1});await sleep(100);
  await assert('pointer skips',`${menu}?.dataset.opening==='done'`);
  await evaluate(`sessionStorage.clear()`);await nav();
  await evaluate(`window.__holdChange=true`);
  const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});
  await send('DOM.setFileInputFiles',{nodeId,files:[song]});
  await assert('file staged while intro remains active',`${menu}?.dataset.opening==='active'`);
  await evaluate(`window.__holdChange=false;const dt=new DataTransfer();dt.items.add(document.querySelector('input[type=file]').files[0]);document.querySelector('canvas').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));`);
  await sleep(100);
  await assert('drop marks intro finished',`sessionStorage.getItem('courtyard-intro-seen')==='1'`);
  for(let i=0;i<200;i++){if(await evaluate(`!!document.querySelector('button[aria-label="Pause"]')`))break;await sleep(100);}
  await assert('drop during intro reaches gameplay',`!!document.querySelector('button[aria-label="Pause"]')`);
  await nav('?storage=denied');
  await assert('storage denial still starts opening',`${menu}?.dataset.opening==='active'`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(100);
  await evaluate(`(async()=>{const app=await(await fetch('/src/App.tsx')).text();const {useGameStore:s}=await import(app.match(/from "(\\/src\\/store\\/gameStore\\.ts[^"]*)"/)[1]);window.__store=s;s.getState().setScreen('loading')})()`);
  await sleep(100);await evaluate(`__store.getState().setScreen('upload')`);await sleep(100);
  await assert('memory prevents replay with denied storage',`${menu}?.dataset.opening==='done'`);
  if(errors.length)throw Error(JSON.stringify(errors));
  const report={rows,errors};writeFileSync('tools/out/intro-checks.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally { ws?.close(); chrome.kill(); await sleep(400); rmSync(work, { recursive: true, force: true }); }
