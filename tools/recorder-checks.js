// Browser-only invariants, used with shot.mjs --after. No production hooks.
(async () => {
  const { RecorderNotes, NOTE_CAPACITY } = await import('/src/game/scene/recorder-notes.ts');
  const { CPURecorderNotes } = await import('/src/game/pixel/recorder-notes.ts');
  const { currentSceneFrame } = await import('/src/game/pixel/renderer.ts');
  const { project } = await import('/src/game/scene/camera.ts');
  const { recorderParts } = await import('/src/game/scene/recorder.ts');
  const { RECORDER_X, RECORDER_Y } = await import('/src/game/anim/recorder.ts');
  const { rendererDiagnostics } = await import(performance.getEntriesByType('resource').find(r=>r.name.includes('/src/game/scene/backend.ts')).name);
  const frame = {...currentSceneFrame(), recorder: {...currentSceneFrame().recorder, playing: true}, playing: true, timeMs: 0, musicNoteTime: new Float64Array([-Infinity])};
  const pool = new RecorderNotes(), cpu = new CPURecorderNotes(), failures = [];
  const check = (value, message) => { if (!value) failures.push(message); };
  const refs = [pool.positions, pool.opacity, pool.shapes, pool.colors];
  let maxVisible = 0, emissions = 0, lastEmit = -Infinity, minimumGap = Infinity;
  const born = new Float64Array(2).fill(-Infinity);
  for (let i = 0; i < 3600; i++) {
    frame.timeMs = i * 1000 / 60;
    frame.musicNoteTime[0] = Math.floor(i / 15) / 4;
    pool.update(frame);
    let visible = 0;
    for (let k = 0; k < 2; k++) {
      if (pool.born[k] !== born[k]) {
        minimumGap = Math.min(minimumGap, frame.timeMs / 1000 - lastEmit);
        lastEmit = frame.timeMs / 1000; born[k] = pool.born[k]; emissions++;
      }
      if (pool.opacity[k] > 0) visible++;
    }
    maxVisible = Math.max(maxVisible, visible);
  }
  check(maxVisible <= NOTE_CAPACITY && emissions > 10, 'Sparse pool must emit with capacity two');
  check(minimumGap >= .55, 'Emission spacing below 550 ms');
  check(refs[0] === pool.positions && refs[1] === pool.opacity && refs[2] === pool.shapes && refs[3] === pool.colors, 'Pool buffers changed');
  frame.playing = false; pool.update(frame);
  check(pool.opacity.every(a => a === 0), 'Pause/menu/failure did not clear notes');
  frame.playing = true; frame.recorder.playing = false; pool.update(frame);
  check(pool.opacity.every(a => a === 0), 'Recorder stopped but notes remained');
  // A foreground surface must occlude every glyph pixel in the CPU path.
  const R = {zb: new Float32Array(384 * 216).fill(Infinity), pix: new Uint8ClampedArray(384 * 216 * 4)};
  frame.recorder.playing = true;
  for (let i = 0; i < 300; i++) { frame.timeMs = i * 1000 / 60; frame.musicNoteTime[0] = Math.floor(i / 30) / 2; cpu.draw(R, frame); }
  check(R.pix.every(v => v === 0), 'CPU notes drew through foreground depth');
  const bounds = {left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity};
  for (const part of recorderParts) {
    if (part.group !== 0) continue;
    for (let i = 0; i < 8; i++) {
      const p = project([RECORDER_X + part.center[0] + part.size[0] * (i & 1 ? .5 : -.5), RECORDER_Y + part.center[1] + part.size[1] * (i & 2 ? .5 : -.5), part.center[2] + part.size[2] * (i & 4 ? .5 : -.5)]);
      bounds.left = Math.min(bounds.left, p.sx); bounds.right = Math.max(bounds.right, p.sx);
      bounds.top = Math.min(bounds.top, p.sy); bounds.bottom = Math.max(bounds.bottom, p.sy);
    }
  }
  check(bounds.left > 290 && bounds.right < 335 && bounds.top > 150 && bounds.bottom < 200, 'Recorder outside reserved clear region');
  return {failures, maxVisible, emissions, minimumGap, stableBuffers: true, cpuOcclusion: true, bounds, diagnostics: rendererDiagnostics()};
})()
