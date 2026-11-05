#!/usr/bin/env node
// Isolated real-song verification. Run with Vite already on 3130:
// node tools/anim-play.mjs [--song /absolute/song.mp3] [--port 9431]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a, []));
const port = +(args.port ?? 9431), song = args.song ?? '/Users/artem/Downloads/Night, Blooming Jasmine.mp3';
mkdirSync('tools/out', { recursive: true });
const profile = resolve(mkdtempSync('tools/out/anim-chrome-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1152,648',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let page;
  for (let i = 0; i < 75 && !page; i++) {
    await sleep(200);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  }
  assert(page, 'Chrome failed to start');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timeout);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(x => x.value ?? x.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; const timeout = setTimeout(() => { pending.delete(n); reject(new Error(`${method} timed out`)); }, 20000);
    pending.set(n, { resolve, reject, timeout }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:3130/' }); await sleep(1500);
  console.log('bot', await evaluate(readFileSync('tools/anim-bot.js', 'utf8')));
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [song] });
  let captured = 0, lastCapture = 0, lastReport = -20, result;
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    await sleep(captured < 60 ? 65 : 1000);
    const state = await evaluate(`({time:animBot.time,done:animBot.done,result:animBot.result,phase:animBot.getState().phase,score:animBot.getState().score})`);
    if (state.time - lastReport >= 20) { console.log(JSON.stringify(state)); lastReport = state.time; }
    if (state.time >= 6 && captured < 60 && state.time > lastCapture) {
      const png = await evaluate(`document.querySelector('canvas').toDataURL('image/png').split(',')[1]`);
      writeFileSync(`tools/out/game-${String(captured++).padStart(3,'0')}.png`, Buffer.from(png, 'base64')); lastCapture = state.time;
    }
    if (state.done) { result = state.result; break; }
  }
  assert(result, 'Song did not finish within ten minutes');
  const log = await evaluate('animBot.log');
  writeFileSync('tools/out/game-verification.json', JSON.stringify({ song, result, errors, log }, null, 2));
  console.log('RESULT', JSON.stringify({ ...result, errors }));
  assert.equal(result.outcome, 'completed');
  assert.equal(result.fired, result.notes);
  assert.equal(result.score.goodCount + result.score.okCount + result.score.missCount, 0, 'Bot did not score all perfect');
} finally {
  ws?.close(); chrome.kill(); await sleep(400); rmSync(profile, { recursive: true, force: true });
}
