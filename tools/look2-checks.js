// Fixed poses, clocks and effect history: comparable even when asset loading varies.
(async()=>{
 const raf=window.requestAnimationFrame.bind(window); window.requestAnimationFrame=()=>0;
 await new Promise(r=>setTimeout(r,100));
 const {GLBackend}=await import('/src/game/gl/renderer.ts');
 const fixturePath=new URL('../tools/look-fixture.json',new URL('/@fs/Users/artem/Desktop/Development/personal/MusicBeat-look/client/',location.origin));
 const frame=await (await fetch(fixturePath)).json(); frame.playerStrokeMs=-Infinity; frame.playing=true;
 frame.musicNoteTime=new Float64Array([-Infinity]); frame.timeMs=0;
 const gl=new GLBackend(), files=[];
 const c=document.createElement('canvas');c.width=384;c.height=216;const ctx=c.getContext('2d');
 try {
  gl.render(frame);await Promise.all([gl.props.ready,gl.paddles.ready]);
  for(let i=0;i<200&&(gl.player.status!=='glb'||gl.stranger.status!=='glb');i++)await new Promise(r=>setTimeout(r,20));
  if(gl.player.status!=='glb'||gl.stranger.status!=='glb')throw Error('Characters failed to load');
  frame.timeMs=-1000;gl.render(frame);
  for(let i=0;i<=240;i++) {
   frame.timeMs=i*1000/60;ctx.drawImage(gl.render(frame),0,0);
   if([0,60,108,133,150,180,220,240].includes(i))files.push({name:`fixed-${i}.png`,dataUrl:c.toDataURL()});
  }
  for (const [name,progress] of [['start',0],['mid',.5],['end',1]]) {
   frame.introProgress=progress;ctx.drawImage(gl.render(frame),0,0);
   files.push({name:`intro-${name}.png`,dataUrl:c.toDataURL()});
  }
  frame.introProgress=undefined;
  const samples=[],copy=[];let memory;
  const {GPUTimer}=await import('/src/game/gl/timing.ts');
  for(let i=0;i<300;i++) {
   await new Promise(raf);
   if(i===60){memory={...gl.renderer.info.memory};gl.timing.dispose();gl.timing=new GPUTimer(gl.renderer.getContext());}
   frame.timeMs=10000+i*1000/60;
   const t=performance.now(),canvas=gl.render(frame);const submit=performance.now()-t;
   ctx.drawImage(canvas,0,0);if(i>=60){samples.push(submit);copy.push(performance.now()-t);}
  }
  const stats=a=>{a.sort((a,b)=>a-b);return {samples:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]}};
  const context=gl.renderer.getContext(),ext=context.getExtension('WEBGL_debug_renderer_info');
  return {files,submission:stats(samples),submissionAndCopy:stats(copy),gpu:gl.timing.stats(),drawCalls:gl.renderer.info.render.calls,memory,stableResources:JSON.stringify(memory)===JSON.stringify(gl.renderer.info.memory),hardware:context.getParameter(ext.UNMASKED_RENDERER_WEBGL),error:context.getError()};
 }finally{gl.dispose()}
})()
