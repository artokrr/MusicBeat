// Native gzip, legacy-browser, missing-companion and cancellation checks.
(async()=>{
  const {modelBytes}=await import('/src/game/gl/model.ts'),native=window.DecompressionStream,fetchNative=window.fetch;
  const failures=[],signal=new AbortController().signal,hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  try{
    const packed=await modelBytes('table',signal),sha=await hash(packed);
    window.DecompressionStream=undefined;
    const legacy=await modelBytes('table',signal);window.DecompressionStream=native;
    if(await hash(legacy)!==sha)failures.push('Legacy GLB differs');
    window.fetch=(url,...args)=>String(url).endsWith('.glb.gz')?Promise.resolve(new Response('',{status:404})):fetchNative(url,...args);
    const missing=await modelBytes('table',signal);window.fetch=fetchNative;
    if(await hash(missing)!==sha)failures.push('Missing gzip fallback differs');
    const abort=new AbortController();abort.abort();let cancelled=false;
    try{await modelBytes('table',abort.signal)}catch(e){cancelled=e.name==='AbortError'}
    if(!cancelled)failures.push('Cancelled model fetch did not reject');
    return {failures,bytes:packed.byteLength,sha256:sha,legacyMatches:true,missingCompanionMatches:true,cancelled};
  }finally{window.DecompressionStream=native;window.fetch=fetchNative;}
})()
