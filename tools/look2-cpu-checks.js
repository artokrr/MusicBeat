(async()=>{
 window.requestAnimationFrame=()=>0;await new Promise(r=>setTimeout(r,100));
 const {CPUBackend}=await import('/src/game/scene/cpu.ts');
 const frame=await(await fetch('/@fs/Users/artem/Desktop/Development/personal/MusicBeat-look/tools/look-fixture.json')).json();
 frame.playerStrokeMs=-Infinity;frame.musicNoteTime=new Float64Array([-Infinity]);
 const backend=new CPUBackend(),samples=[],files=[];
 try{
  for(let i=0;i<240;i++){frame.timeMs=10000+i*1000/60;const t=performance.now();const c=backend.render(frame);if([0,60,108,133,150,180,220,239].includes(i))files.push({name:`fixed-${i}.png`,dataUrl:c.toDataURL()});if(i>=60)samples.push(performance.now()-t)}
  samples.sort((a,b)=>a-b);return {files,samples:samples.length,medianMs:samples[90],p95Ms:samples[171]};
 }finally{backend.dispose()}
})()
