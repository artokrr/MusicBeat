// Worker/main-thread algorithm parity, legacy fallback, and cancellation.
// shot.mjs --song ... --play 0 --after tools/perf-preparation.js
(async()=>{
  const src=await(await fetch('/src/App.tsx')).text();
  const url=src.match(/from "(\/src\/store\/gameStore\.ts[^\"]*)"/)[1];
  const {useGameStore:store}=await import(url),audio=store.getState().audioBuffer;
  const [{analyzeBeatmap},{generateBeatmap},{prepareSongInBackground}]=await Promise.all([
    import('/src/audio/BeatDetector.ts'),import('/src/beatmap/BeatmapGenerator.ts'),import('/src/audio/analyzeInBackground.ts'),
  ]);
  const failures=[],WorkerClass=window.Worker,saved=localStorage.getItem('pong:debugBeatmap');
  const pcmHash=()=>{
    let h=2166136261;for(let c=0;c<audio.numberOfChannels;c++){
      const data=audio.getChannelData(c),bits=new Uint32Array(data.buffer,data.byteOffset,data.length);
      for(let i=0;i<bits.length;i+=1024)h=Math.imul(h^bits[i],16777619)>>>0;
    }return h;
  };
  const before=pcmHash();
  try{
    localStorage.setItem('pong:debugBeatmap','0');
    const analysis=await analyzeBeatmap(audio),expected=generateBeatmap(analysis,{debug:false});
    const worker=await prepareSongInBackground(audio);
    const workerMatches=JSON.stringify(worker.beatmap)===JSON.stringify(expected);
    if(!workerMatches)failures.push('Worker map differs from original main-thread map');
    window.Worker=undefined;
    const fallback=await prepareSongInBackground(audio);window.Worker=WorkerClass;
    const fallbackMatches=JSON.stringify(fallback.beatmap)===JSON.stringify(expected);
    if(!fallbackMatches)failures.push('Worker-less fallback map differs');
    window.Worker=function(){throw new Error('Intentional worker failure for fallback verification')};
    const recovered=await prepareSongInBackground(audio);window.Worker=WorkerClass;
    const workerFailureMatches=JSON.stringify(recovered.beatmap)===JSON.stringify(expected);
    if(!workerFailureMatches)failures.push('Worker failure fallback map differs');
    localStorage.setItem('pong:debugBeatmap','1');
    const debug=await prepareSongInBackground(audio),expectedDebug=generateBeatmap(analysis,{debug:true});
    // Only the diagnostic creation timestamp is expected to differ.
    delete debug.beatmap.debug.generatedAt;delete expectedDebug.debug.generatedAt;
    const debugMatches=JSON.stringify(debug.beatmap)===JSON.stringify(expectedDebug)&&debug.beatmap.debug?.enabled;
    if(!debugMatches)failures.push('Worker diagnostics differ or disappear');
    const already=new AbortController();already.abort();let preCancelled=false,inFlightCancelled=false;
    try{await prepareSongInBackground(audio,already.signal)}catch(e){preCancelled=e.name==='AbortError'}
    const live=new AbortController(),promise=prepareSongInBackground(audio,live.signal);setTimeout(()=>live.abort(),10);
    try{await promise}catch(e){inFlightCancelled=e.name==='AbortError'}
    if(!preCancelled||!inFlightCancelled)failures.push('Cancellation did not reject promptly');
    if(pcmHash()!==before)failures.push('Playback PCM changed or detached');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(expected)));
    return {failures,notes:expected.notes.length,mapSha256:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''),workerMatches,fallbackMatches,workerFailureMatches,debugMatches,ignoredDiagnosticField:'generatedAt',preCancelled,inFlightCancelled,pcmHash:before};
  }finally{window.Worker=WorkerClass;if(saved===null)localStorage.removeItem('pong:debugBeatmap');else localStorage.setItem('pong:debugBeatmap',saved);}
})()
