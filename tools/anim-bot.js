// Paste/evaluate in the Vite page BEFORE uploading a song. Read-only store use;
// input is real window keyboard events, gameplay/judgement are unmodified.
(async () => {
  const source = await (await fetch('/src/App.tsx')).text();
  const moduleUrl = source.match(/from "(\/src\/store\/gameStore\.ts[^"]*)"/)?.[1];
  if (!moduleUrl) throw new Error('Cannot locate the live gameStore module');
  const { useGameStore } = await import(moduleUrl);
  const keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight'];
  const fired = new Set(), releases = [], log = [];
  const bot = window.animBot = { log, getState: () => useGameStore.getState(), time: 0, done: false };
  function gameTime() {
    const canvas = document.querySelector('canvas');
    const key = canvas && Object.keys(canvas).find(k => k.startsWith('__reactFiber$'));
    for (let f = key ? canvas[key] : null; f; f = f.return) {
      if (typeof f.memoizedProps?.currentTime === 'number') {
        return Math.max(f.memoizedProps.currentTime, f.alternate?.memoizedProps?.currentTime ?? 0);
      }
    }
    return null;
  }
  bot.timer = setInterval(() => {
    const state = useGameStore.getState();
    if (state.screen === 'results') {
      bot.done = true; bot.result = { score: state.score, outcome: state.runOutcome, notes: state.beatmap.notes.length, duration: state.beatmap.metadata.duration, fired: fired.size };
      clearInterval(bot.timer); return;
    }
    if (state.phase !== 'playing' || !state.beatmap) return;
    const t = gameTime(); if (t === null) return;
    bot.time = t;
    for (let i = releases.length - 1; i >= 0; i--) if (t >= releases[i].at) {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: releases[i].key, code: releases[i].key, bubbles: true }));
      releases.splice(i, 1);
    }
    for (const n of state.beatmap.notes) {
      if (fired.has(n.id) || t < n.time - .008) continue;
      fired.add(n.id);
      const key = keys[n.laneIndex];
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
      releases.push({ at: n.type === 'hold' ? n.holdEndTime + .025 : t + .025, key });
      log.push({ id: n.id, type: n.type, at: t, due: n.time, deltaMs: (t - n.time) * 1000 });
    }
  }, 2);
  return { ready: true, moduleUrl };
})()
