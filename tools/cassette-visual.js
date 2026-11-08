(async()=>{
 const app=await(await fetch('/src/game/Game.tsx')).text();
 const url=app.match(/from "(\/src\/game\/pixel\/renderer\.ts[^"]*)"/)[1];
 const {currentSceneFrame}=await import(url);
 const {GLBackend}=await import('/src/game/gl/renderer.ts');
 const {sampleRecorder,insertCassette}=await import('/src/game/anim/recorder.ts');
 const gl=new GLBackend(),frame=structuredClone(currentSceneFrame()),files=[],changes=[];
 frame.timeMs=5000;frame.player.visible=true;
 insertCassette(0);frame.recorder=structuredClone(sampleRecorder(1450));
 await Promise.all([gl.props.ready,gl.paddles.ready]);await new Promise(r=>setTimeout(r,500));
 const c=document.createElement('canvas');c.width=384;c.height=216;const ctx=c.getContext('2d');
 const crop=document.createElement('canvas');crop.width=32*3;crop.height=24*3;const x=crop.getContext('2d');x.imageSmoothingEnabled=false;
 const render=name=>{ctx.drawImage(gl.render(frame),0,0);x.clearRect(0,0,96,72);x.drawImage(c,274,151,32,24,0,0,96,72);files.push({name:`cassette-detail-${name}.png`,dataUrl:crop.toDataURL()});return ctx.getImageData(274,151,32,24).data;};
 const first=render('stopped');
 frame.recorder.key=1;const play=render('play');
 const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])n++;return n;};
 const keyPixels=diff(first,play);
 for(let i=1;i<=8;i++){frame.recorder.reel=i*Math.PI/4;const next=render(`reel-${i}`);changes.push(diff(play,next));}
 frame.recorder.door=1;render('door-open');
 gl.dispose();return {files,keyPixels,reelPixels:changes,failures:[...(keyPixels===0?['PLAY invisible at native resolution']:[]),...(changes.every(n=>n===0)?['Reels invisible at native resolution']:[])]};
})()
