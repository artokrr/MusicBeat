(async()=>{
 window.requestAnimationFrame=()=>0;await new Promise(r=>setTimeout(r,100));
 const {CPUBackend}=await import('/src/game/scene/cpu.ts');
 const frame=await(await fetch('/@fs/Users/artem/Desktop/Development/personal/MusicBeat-look/tools/look-fixture.json')).json();
 frame.playerStrokeMs=-Infinity;frame.musicNoteTime=new Float64Array([-Infinity]);
 const backend=new CPUBackend(),samples=[];
 try{
  for(let i=0;i<240;i++){frame.timeMs=10000+i*1000/60;const t=performance.now();backend.render(frame);if(i>=60)samples.push(performance.now()-t)}
  samples.sort((a,b)=>a-b);return {samples:samples.length,medianMs:samples[90],p95Ms:samples[171]};
 }finally{backend.dispose()}
})()
