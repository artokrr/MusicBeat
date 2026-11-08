(async()=>{
 window.requestAnimationFrame=()=>0;await new Promise(r=>setTimeout(r,100));
 const {CPUBackend}=await import('/src/game/scene/cpu.ts');
 const frame=await(await fetch('/@fs/Users/artem/Desktop/Development/personal/MusicBeat-look/tools/look-fixture.json')).json();
 frame.playerStrokeMs=-Infinity;frame.musicNoteTime=new Float64Array([-Infinity]);frame.timeMs=2500;frame.ballCount=0;
 const probe=new CPUBackend(),Renderer3D=probe.renderer.constructor;probe.dispose();
 const files=[],original=Renderer3D.prototype.applyShadows;
 try {
  for(const mode of ['shadows','lit']) {
   if(mode==='lit')Renderer3D.prototype.applyShadows=()=>{};
   const b=new CPUBackend();files.push({name:mode+'.png',dataUrl:b.render(frame).toDataURL()});b.dispose();
  }
  return {files};
 }finally{Renderer3D.prototype.applyShadows=original}
})()
