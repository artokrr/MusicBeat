(async()=>{
 window.requestAnimationFrame=()=>0;await new Promise(r=>setTimeout(r,80));
 const {renderFrame}=await import('/src/game/pixel/renderer.ts?strokes-cpu');
 const {rendererDiagnostics}=await import('/src/game/scene/backend.ts');
 const canvas=document.createElement('canvas');canvas.width=384;canvas.height=216;const ctx=canvas.getContext('2d');
 const f={songTime:0,nowMs:0,dt:1/60,approachTime:.8,beat:0,notes:[],world:{lanes:[320,400,480],npcHitY:200,playerHitY:480,playerY:565,npcY:95,centerX:400},playerX:400,pressedLane:null,pressAgeMs:Infinity,feedbacks:[],hud:null,countdown:null,fade:0,shakeX:0,shakeY:0,phantomAlpha:()=>1};
 const n={time:1,type:'normal',x:320,startX:400,targetX:320,hit:false,returnPhase:false,returnProgress:0,smash:true};
 for(let i=0;i<90;i++){f.songTime=i/60;f.nowMs=i/60*1000;f.notes=i>12?[n]:[];if(i>=61){n.hit=n.returnPhase=true;n.hitTime=61/60;n.returnProgress=(i-61)/24;}renderFrame(ctx,f)}
 const diagnostics=rendererDiagnostics();if(diagnostics.backend!=='cpu')throw Error('CPU fallback not active');
 return {diagnostics,files:[{name:'strokes-cpu-frame.png',dataUrl:canvas.toDataURL()}]};
})()
