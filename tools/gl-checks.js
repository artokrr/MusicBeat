// Inject using tools/shot.mjs --after tools/gl-checks.js, after an actual gameplay frame.
(async () => {
  const gameSource=await (await fetch('/src/game/Game.tsx')).text();
  const renderingUrl=gameSource.match(/from "(\/src\/game\/pixel\/renderer\.ts[^"]*)"/)[1];
  const [{ CPUBackend }, { GLBackend }, rendering, retarget, animation, rigContract] = await Promise.all([
    import('/src/game/scene/cpu.ts'), import('/src/game/gl/renderer.ts'),
    import(renderingUrl), import('/src/game/gl/retarget.ts'),
    import('/src/game/anim/pose.ts'), import('/src/game/rig/joints.ts'),
  ]);
  const scene = structuredClone(rendering.currentSceneFrame());
  const snapshot={balls:scene.ballCount,player:scene.player.visible};
  scene.shakeX = scene.shakeY = 0;
  const cpu = new CPUBackend(), gl = new GLBackend();
  gl.render(scene);
  await Promise.all([gl.props.ready, gl.paddles.ready]);
  for(let i=0;i<100 && (gl.player.status!=='glb' || gl.stranger.status!=='glb');i++) await new Promise(r=>setTimeout(r,20));
  const files = [];
  const makeCanvas = () => { const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 216; return canvas; };
  const a = makeCanvas(), b = makeCanvas(), ca = a.getContext('2d'), cb = b.getContext('2d');
  const capture = name => {
    ca.drawImage(cpu.render(scene), 0, 0); cb.drawImage(gl.render(scene), 0, 0);
    const output = document.createElement('canvas'); output.width = 2304; output.height = 684;
    const ctx = output.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0c0d16'; ctx.fillRect(0,0,output.width,output.height);
    ctx.fillStyle = '#e6e4ec'; ctx.font = '20px monospace';
    ctx.fillText('CPU — same scene snapshot', 12, 26); ctx.fillText('GPU — same scene snapshot', 1164, 26);
    ctx.drawImage(a,0,36,1152,648); ctx.drawImage(b,1152,36,1152,648);
    files.push({name,dataUrl:output.toDataURL('image/png')});
    const ac=ca.getImageData(0,0,384,216).data,bc=cb.getImageData(0,0,384,216).data;
    let error=0;for(let i=0;i<ac.length;i++) if(i%4!==3) error+=Math.abs(ac[i]-bc[i]);
    return error/(384*216*3);
  };
  const sceneError=capture('gameplay-side-by-side.png');
  const samples={cpu:[],gl:[]};
  for(let i=0;i<210;i++) {
    await new Promise(requestAnimationFrame);
    let start=performance.now();ca.drawImage(cpu.render(scene),0,0);let elapsed=performance.now()-start;
    if(i>=30) samples.cpu.push(elapsed);
    start=performance.now();cb.drawImage(gl.render(scene),0,0);elapsed=performance.now()-start;
    if(i>=30) samples.gl.push(elapsed);
  }
  const stats = xs => {xs.sort((a,b)=>a-b);return {samples:xs.length,medianMs:xs[Math.floor(xs.length*.5)],p95Ms:xs[Math.floor(xs.length*.95)]};};
  const timing={cpu:stats(samples.cpu),gpuSubmissionAndCopy:stats(samples.gl),gpuExecution:gl.timing.stats(),drawCalls:gl.renderer.info.render.calls,triangles:gl.renderer.info.render.triangles};
  // Fixed idle-menu moment, shared by both backends (including the breath pose).
  rendering.renderIdleScene(makeCanvas().getContext('2d'),5000,0);
  scene.stranger=structuredClone(rendering.currentSceneFrame().stranger);
  scene.player.visible=false;scene.ballCount=scene.laneCount=0;
  const menuError=capture('menu-side-by-side.png');
  const rig=retarget.createProceduralRig(scene.player.look);
  const proofs=[];
  const pose={crouch:.6,lean:.3,stance:.22,twist:.2,armR:{swing:1,bend:.8,spread:.5},armL:{swing:.4,bend:.9,spread:.3}};
  for(let i=0;i<48;i++) {
    pose.twist=Math.sin(i)*.7;pose.armR.swing=i*.15;
    proofs.push(retarget.retargetError(rig.retargeter,animation.poseJoints(Math.sin(i),-2.3,i*.37,pose)));
  }
  // Rest pose and facing parallel to a limb are also finite.
  const rest={joints:structuredClone(rigContract.REST_JOINTS),forward:[0,1,0],chestForward:[0,1,0],paddle:{center:[0,0,0],up:[0,0,1],normal:[1,0,0]},cloth:{swingForward:0,swingSide:0}};
  proofs.push(retarget.retargetError(rig.retargeter,rest));
  const retargeting={maxHeadErrorMetres:Math.max(...proofs.map(x=>x.maxHead)),maxTailErrorMetres:Math.max(...proofs.map(x=>x.maxTail)),finiteVertices:proofs.every(x=>x.finiteVertices),sampledVertices:proofs.reduce((a,x)=>a+x.sampledVertices,0),poses:proofs.length};
  retarget.disposeRig(rig.root);
  // Round-trip an actual binary glTF through the production optional-model
  // fetch/loader path, including the Blender Z-up -> glTF Y-up conversion.
  const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
  const exported=retarget.createProceduralRig(scene.player.look);
  exported.root.quaternion.copy(retarget.GLTF_TO_WORLD).invert();exported.root.updateMatrixWorld(true);
  const binary=await new GLTFExporter().parseAsync(exported.root,{binary:true});
  const originalFetch=window.fetch;
  const fixtureGPU=new GLBackend();
  let gltfProof;
  try {
    window.fetch=(url,options)=>String(url).startsWith('/models/')?Promise.resolve(new Response(binary,{headers:{'Content-Type':'model/gltf-binary'}})):originalFetch(url,options);
    scene.player.visible=true;
    fixtureGPU.render(scene);
    for(let i=0;i<100 && (fixtureGPU.player.status!=='glb' || fixtureGPU.stranger.status!=='glb');i++) await new Promise(r=>setTimeout(r,20));
    fixtureGPU.render(scene);
    gltfProof={player:fixtureGPU.player.status,stranger:fixtureGPU.stranger.status};
    if(gltfProof.player!=='glb' || gltfProof.stranger!=='glb') throw new Error('Binary glTF fixture did not load');
    gltfProof.endpoints=retarget.retargetError(fixtureGPU.player.rig,scene.player.pose);
    cb.drawImage(fixtureGPU.render(scene),0,0);
    files.push({name:'gltf-roundtrip.png',dataUrl:b.toDataURL('image/png')});
  } finally {window.fetch=originalFetch;fixtureGPU.dispose();retarget.disposeRig(exported.root);}
  const context=gl.renderer.getContext(),debug=context.getExtension('WEBGL_debug_renderer_info');
  const hardware=debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER);
  const errors=[];let error;while((error=context.getError())!==context.NO_ERROR) errors.push(error);
  cpu.dispose();gl.dispose();
  if(retargeting.maxHeadErrorMetres>1e-5 || retargeting.maxTailErrorMetres>1e-5 || !retargeting.finiteVertices || errors.length) throw new Error('Rendering verification failed: '+JSON.stringify({retargeting,errors}));
  return {files,timing,retargeting,gltfProof,hardware,errors,meanAbsoluteChannelError:{gameplay:sceneError,menu:menuError},snapshot};
})()
