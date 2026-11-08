// Capture native canvas frames by camera progress, independent of load time.
(async () => {
  const source = await (await fetch('/src/components/SceneBackdrop.tsx')).text();
  const url = source.match(/from "(\/src\/game\/pixel\/renderer\.ts[^"]*)"/)[1];
  const { currentSceneFrame } = await import(url);
  const files = [];
  for (let i = 0; i < 1800 && files.length < 3; i++) {
    const f = currentSceneFrame(), p = f.introProgress;
    const name = files.length === 0 && p === 0 && f.timeMs > 0 ? 'start'
      : files.length === 1 && p !== undefined && p >= .5 ? 'mid'
      : files.length === 2 && p === undefined ? 'end' : null;
    if (name) files.push({ name: `intro-native-${name}.png`, dataUrl: document.querySelector('canvas').toDataURL() });
    await new Promise(r => setTimeout(r, 16));
  }
  if(files.length !== 3) throw Error('Missed an opening phase');
  return {files};
})()
