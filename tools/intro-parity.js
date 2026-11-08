// Deterministic describeFrame + production drawing path, including HUD/overlays.
// shot.mjs --after tools/perf-frames.js (repeat with ?renderer=cpu).
(async () => {
  window.requestAnimationFrame = () => 0;
  await new Promise(r => setTimeout(r, 100));
  const random = Math.random, wall = Date.now;
  let seed = 713;
  Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const backend = await import('/src/game/scene/backend.ts');
  backend.disposeRenderer();
  const { renderFrame, describeFrame, renderIdleScene } = await import('/src/game/pixel/renderer.ts?perf-fixture=fixed');
  const simulationSeed = seed;
  const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 216;
  const ctx = canvas.getContext('2d'), files = [], descriptions = [], failures = [];
  const frame = {
    nowMs:5000,dt:0,songTime:0,beat:0,approachTime:1.2,notes:[],
    world:{npcHitY:200,playerHitY:480,playerY:565,npcY:95,centerX:400,lanes:[320,400,480]},
    playerX:400,serving:false,swinging:false,pressedLane:null,pressAgeMs:Infinity,
    shakeX:0,shakeY:0,feedbacks:[],phantomAlpha:()=>.4,countdown:null,fade:0,
    hud:{score:12345,combo:24,health:.72,missStreak:0,missStreakFail:5,songTitle:'fixture',time:0,duration:120,volume:.6,nowMs:5000},
  };
  try {
    renderFrame(ctx,frame);
    for(let i=0;i<200;i++){
      const d=backend.rendererDiagnostics();
      if(d.backend==='cpu'||(d.props==='glb'&&d.paddles==='glb'&&d.player==='glb'&&d.stranger==='glb'))break;
      await new Promise(r=>setTimeout(r,25));renderFrame(ctx,frame);
    }
    // Exercise the moving camera on this very backend, then rewind the clock
    // so breath/animation starts in the same state as the baseline fixture.
    renderIdleScene(ctx, 6000, 0, { introProgress: 0 });
    renderIdleScene(ctx, 6200, 0, { introProgress: .5 });
    renderIdleScene(ctx, 6400, 0, { introProgress: .999 });
    renderFrame(ctx, frame);
    // Three's UUID generation during a failed context attempt must not change
    // CPU snow respawn randomness in the deterministic comparison.
    seed = simulationSeed;
    // A backward song-time jump resets the independent fixture animator.
    frame.songTime=-1;renderFrame(ctx,frame);
    for(let i=0;i<=240;i++){
      const t=i/60;frame.songTime=t;frame.nowMs=5000+i*1000/60;frame.dt=1/60;frame.beat=t*2;
      Date.now=()=>100000+frame.nowMs;
      frame.notes=[];
      for(let n=0;n<12;n++){
        const time=1.8+n*.19,age=t-time,type=['normal','strong','echo','switch','hold'][n%5];
        if(age < -1.2 || age>.4)continue;
        const miss=n===9&&age>0;
        frame.notes.push({time,type:type==='strong'?'normal':type,x:320+n%3*80,y:480,startX:400,targetX:320+n%3*80,
          hit:age>=0,hitResult:miss?'miss':'perfect',hitTime:age>=0?time:undefined,returnPhase:age>=0&&!miss,
          returnProgress:Math.max(0,age/.4),returnStartX:320+n%3*80,returnStartY:480,
          holdStartTime:type==='hold'&&age>-.15?time-.15:undefined,holdProgress:type==='hold'?.5:undefined,
          missTime:miss?time:undefined,switchControlX:440});
      }
      frame.playerX=400+Math.sin(t*3)*80;
      frame.pressedLane=i%40<8?i%3:null;frame.pressAgeMs=i%40*1000/60;
      frame.feedbacks=i>120?[{id:'fixed',result:i>220?'miss':'perfect',timestamp:100000+5000+Math.floor(i/30)*500,x:400,y:480}]:[];
      frame.hud.time=t;frame.hud.nowMs=frame.nowMs;frame.hud.health=i>220?.24:.72;
      frame.countdown=i<30?3:null;frame.fade=i>230?.4:0;
      renderFrame(ctx,frame);
      if([0,60,108,133,150,180,220,240].includes(i)){
        files.push({name:`fixed-${i}.png`,dataUrl:canvas.toDataURL()});
        descriptions.push(JSON.parse(JSON.stringify(describeFrame({...frame,dt:0}))));
      }
    }
    return {files,failures,diagnostics:backend.rendererDiagnostics(),descriptions};
  } finally {Math.random=random;Date.now=wall;backend.disposeRenderer();}
})()
