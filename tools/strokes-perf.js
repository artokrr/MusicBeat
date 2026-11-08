(async()=>{
 window.requestAnimationFrame=()=>0; await new Promise(r=>setTimeout(r,100));
 const source=await(await fetch('/src/game/Game.tsx')).text();
 const url=source.match(/from "(\/src\/game\/pixel\/renderer\.ts[^"]*)"/)[1];
 const {currentSceneFrame}=await import(url),{GLBackend}=await import('/src/game/gl/renderer.ts');
 const frame=structuredClone(currentSceneFrame()),gl=new GLBackend();frame.playing=true;frame.player.visible=true;
 gl.render(frame);await Promise.all([gl.props.ready,gl.paddles.ready]);await new Promise(r=>setTimeout(r,1500));
 const poses=await Promise.all(['before','after'].map(async phase=>(await(await fetch('/@fs/Users/artem/Desktop/Development/personal/MusicBeat-strokes/tools/out/strokes-'+phase+'-jasmine-motion.json')).json()).rows.map(r=>r.pose)));
 const batches=[[],[]];
 for(let b=0;b<104;b++)for(const phase of b%2?[1,0]:[0,1]){
  const start=performance.now();for(let i=0;i<60;i++){frame.player.pose=poses[phase][(b*60+i)%poses[phase].length];frame.timeMs=50000+(b*60+i)*1000/60;gl.render(frame)}
  if(b>=4)batches[phase].push((performance.now()-start)/60);
  await new Promise(r=>setTimeout(r,0));
 }
 gl.dispose();return {measurement:'GL CPU submission cost, alternating 60-frame batches in one browser; excludes GPU completion',results:batches.map((a,i)=>{a.sort((a,b)=>a-b);return {phase:i?'after':'before',median:a[50],p95:a[94]}})};
})()
