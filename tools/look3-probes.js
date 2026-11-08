// Causal receiver comparisons: same pixel, texture, pose and clock; only visibility changes.
(async()=>{
 window.requestAnimationFrame=()=>0;await new Promise(r=>setTimeout(r,100));
 const {GLBackend}=await import('/src/game/gl/renderer.ts');
 const frame=await(await fetch('/@fs/Users/artem/Desktop/Development/personal/MusicBeat-look/tools/look-fixture.json')).json();
 frame.playerStrokeMs=-Infinity;frame.musicNoteTime=new Float64Array([-Infinity]);frame.timeMs=2500;
 const gl=new GLBackend(),files=[];
 const c=document.createElement('canvas');c.width=384;c.height=216;const ctx=c.getContext('2d');
 try{
 gl.render(frame);await Promise.all([gl.props.ready,gl.paddles.ready]);
 for(let i=0;i<200&&(gl.player.status!=='glb'||gl.stranger.status!=='glb');i++)await new Promise(r=>setTimeout(r,20));
 if(new URLSearchParams(location.search).has('probeBaseline')) {
  const baseline=await(await fetch('/@fs/Users/artem/Desktop/Development/personal/MusicBeat-look/tools/out/look3-baseline-shaders.json')).json();
  gl.scene.traverse(o=>{if(o.material?.fragmentShader?.includes('contactBalls')){o.material.fragmentShader=baseline.fragment;o.material.needsUpdate=true}
   if(o.isLight&&o.shadow){o.shadow.mapSize.set(1024,1024);o.shadow.map?.dispose();o.shadow.map=null}});
  const depth=gl.spheres.mesh.customDepthMaterial;depth.onBeforeCompile=()=>{};depth.customProgramCacheKey=()=> 'baseline-depth';depth.needsUpdate=true;
  gl.outputScene.children[0].material.fragmentShader=baseline.outline;gl.outputScene.children[0].material.needsUpdate=true;
 }
 const mats=new Map();gl.scene.traverse(o=>{if(o.material?.fragmentShader?.includes('contactBalls'))mats.set(o.material,o.material.fragmentShader)});
 const set=fn=>{for(const [m,s] of mats){m.fragmentShader=fn(s);m.needsUpdate=true}};
 const shot=name=>{ctx.drawImage(gl.render(frame),0,0);files.push({name:name+'.png',dataUrl:c.toDataURL()})};
 // No balls so their real projected silhouettes cannot contaminate the moon test.
 frame.ballCount=0;shot('shadows');
 set(s=>s.replaceAll('t*t*.55','0.'));shot('pre-haze');
 const noShadow=s=>s.replace('float light=.34','moonVisibility=1.;lampVisibility=1.;\n float light=.34').replace('warm*=lampVisibility','lampVisibility=1.;warm*=lampVisibility').replace('if(lamp<.5) color','lamp=1.;moon=1.;if(lamp<.5) color');
 set(noShadow);shot('lit');
 // A ground mask excludes all props and silhouettes from numeric comparisons.
 set(s=>s.replace('outColor=vec4(color,1.);','outColor=vec4(vec3(kind==4.?1.:0.),1.);'));shot('snow-mask');
 // A low airborne ball in the pool, and two heights over the table.
 const positions=[[2.6,-.5,.25],[0,-.6,.82],[0,-.6,1.5],[2.6,-.5,2.5]];
 const points=[];
 for(let i=0;i<positions.length;i++){
  frame.ballCount=1;frame.balls[0]={pos:positions[i],color:[244,242,236],alpha:1,holdProgress:-1};
  set(s=>s);shot('ball-'+i);
  set(s=>s.replace('if(receiver) for(int i=0;i<64;i++)','if(false) for(int i=0;i<64;i++)'));shot('ball-lit-'+i);
  const surfaceZ=i===1||i===2?.76:0;
  const p=new gl.camera.position.constructor(positions[i][0],positions[i][1],surfaceZ).project(gl.camera);
  points.push({position:positions[i],pixel:[(p.x+1)*192,(1-p.y)*108]});
 }
 return {files,points};
 }finally{gl.dispose()}
})()
