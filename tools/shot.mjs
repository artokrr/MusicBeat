#!/usr/bin/env node
// Captures the game's canvas from a headless Chrome, for checking visual work
// without a browser window.
//
//   node tools/shot.mjs --url http://localhost:3000/ --out shot.png
//     [--wait 2500]          ms to wait after load before capturing
//     [--eval script.js]     JS to run in the page first (may return a promise)
//     [--song path.mp3]      hand this file to the upload screen's file input
//     [--play 6000]          after --song, ms to wait once gameplay starts
//     [--scale 3]            nearest-neighbour upscale of the 384x216 canvas
//     [--frames 1 --every 250]  capture several frames: out-0.png, out-1.png...
//     [--port 9333]          DevTools port (use different ports in parallel)
//
// The page's audio is not muted: run with the game volume down if needed.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]] : acc), []),
);
const url = args.url ?? 'http://localhost:3000/';
const out = args.out ?? 'shot.png';
const port = Number(args.port ?? 9333);
const scale = Number(args.scale ?? 3);
const frames = Number(args.frames ?? 1);
const every = Number(args.every ?? 250);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'shot-chrome-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1152,648', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: 'ignore' });

try {
  let pageWs = null;
  for (let i = 0; i < 75 && !pageWs; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch {}
  }
  if (!pageWs) throw new Error('Chrome did not start');
  const ws = new WebSocket(pageWs);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleLines.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleLines.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(Number(args.wait ?? 2500));
  if (args.eval) console.log('eval:', JSON.stringify(await evaluate(readFileSync(args.eval, 'utf8'))));

  if (args.song) {
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
    await send('DOM.setFileInputFiles', { nodeId, files: [args.song] });
    // Wait for gameplay (the HUD's pause button appears), then the requested time.
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      if (await evaluate(`!!document.querySelector('button[aria-label="Pause"]')`)) break;
    }
    await sleep(Number(args.play ?? 6000));
  }

  for (let k = 0; k < frames; k++) {
    const dataUrl = await evaluate(`(() => {
      const src = document.querySelector('canvas');
      const c = document.createElement('canvas');
      c.width = src.width * ${scale}; c.height = src.height * ${scale};
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      x.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    })()`);
    const file = frames > 1 ? out.replace(/\.png$/, `-${k}.png`) : out;
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', file);
    if (k < frames - 1) await sleep(every);
  }
  if (consoleLines.length) console.log(consoleLines.slice(0, 20).join('\n'));
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
