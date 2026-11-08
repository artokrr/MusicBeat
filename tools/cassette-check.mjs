// Deterministic presentation invariants; no DOM, song clock or score mutation.
import {build} from '../node_modules/vite/node_modules/esbuild/lib/main.js';
import {writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('tools/out',{recursive:true});
await build({stdin:{contents:`export * from './client/src/game/anim/recorder';export * from './client/src/game/scene/recorder';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'tools/out/cassette-fixture.mjs'});
const {recorder:r,insertCassette,sampleRecorder,playRecorder,cancelCassette,RecorderBoxes,rewindRecorder,cancelRewind,rewindSpeedAt,REWIND_LATCH_MS,REWIND_STOP_MS,REWIND_END_MS,REWIND_RAD_S}=await import('./out/cassette-fixture.mjs');
const boxes=new RecorderBoxes(),matrices=boxes.matrices,visible=boxes.visible;
insertCassette(1000);
assert.equal(r.loaded,false);
assert.equal(sampleRecorder(1000),r);
assert.ok(r.tapeScale>7);
for(let t=1000;t<2450;t+=5){sampleRecorder(t);boxes.update(r);assert.equal(r.loaded,false);assert.ok(boxes.matrices.every(Number.isFinite));}
sampleRecorder(2450);assert.equal(r.loaded,true);assert.equal(r.inserting,false);assert.equal(r.door,0);assert.equal(r.tapeScale,1);
assert.ok(Math.abs(r.tapeZ-.125)<1e-12);
playRecorder(true,2500);sampleRecorder(3000);const turning=r.reel;assert.ok(turning>0);assert.equal(r.key,1);
playRecorder(false,3000);sampleRecorder(9000);assert.equal(r.reel,turning);assert.equal(r.key,0);
playRecorder(true,9000);sampleRecorder(9500);assert.notEqual(r.reel,turning);
insertCassette(10000);assert.equal(r.oldVisible,true);assert.equal(r.playing,false);
sampleRecorder(11450);assert.equal(r.loaded,true);assert.ok(r.oldZ<.02);assert.ok(r.oldY<r.tapeY);
for(let i=0;i<10000;i++){sampleRecorder(11450+i*16.67);boxes.update(r);}
assert.equal(boxes.matrices,matrices);assert.equal(boxes.visible,visible);
// The seated fast path must match a fresh full transform, including both hubs.
playRecorder(true,190000);
for(let i=0;i<128;i++) {
 sampleRecorder(190000+i*13);boxes.update(r);
 const reference=new RecorderBoxes();reference.update(r);
 for(let j=0;j<matrices.length;j++)assert.ok(Math.abs(matrices[j]-reference.matrices[j])<1e-6,`matrix ${j}`);
}
cancelCassette();assert.equal(r.loaded,false);assert.equal(r.inserting,false);
// Countdown rewind: only with a tape in; reels turn backwards from the latch, stop by the end, and PLAY takes over.
rewindRecorder(195000);assert.equal(r.rewindStartedMs,-Infinity);
insertCassette(196000);sampleRecorder(197450);assert.equal(r.loaded,true);
const rewindAt=200000;rewindRecorder(rewindAt);assert.equal(r.rewindStartedMs,rewindAt);
let angle=r.reel,turned=0,lastMove=-1,firstMove=-1,biggest=0;
for(let ms=0;ms<=3000;ms+=1000/60){
 sampleRecorder(rewindAt+ms);boxes.update(r);
 const step=((angle-r.reel)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);angle=r.reel;
 if(step>1e-9){turned+=step;lastMove=ms;if(firstMove<0)firstMove=ms;}
 biggest=Math.max(biggest,step);assert.ok(matrices.every(Number.isFinite));
}
assert.ok(firstMove>=REWIND_LATCH_MS&&firstMove<=REWIND_LATCH_MS+1000/60,`reels start on the first frame after the latch (${firstMove})`);
assert.ok(lastMove>REWIND_STOP_MS&&lastMove<=REWIND_END_MS+17,`reels stop by the end (${lastMove})`);
assert.ok(biggest<Math.PI/8,`a frame's turn stays under half the hub's 8-fold spacing (${biggest})`);
assert.ok(turned>REWIND_RAD_S*1.5,`about two seconds at speed (${turned} rad)`);
assert.equal(r.rewindStartedMs,-Infinity);assert.equal(rewindSpeedAt(REWIND_END_MS),0);assert.equal(rewindSpeedAt(REWIND_LATCH_MS),0);
rewindRecorder(210000);sampleRecorder(210800);cancelRewind();const held=r.reel;sampleRecorder(211500);assert.equal(r.reel,held);
rewindRecorder(220000);sampleRecorder(220800);playRecorder(true,221000);assert.equal(r.rewindStartedMs,-Infinity);
const before=r.reel;sampleRecorder(221100);assert.ok(((r.reel-before)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)<.5,'PLAY turns forwards');
const report={passed:true,checks:['1450 ms seating gate','finite transforms throughout flight','final position and scale','PLAY and pause/resume','replacement ejects before seating','10000 updates retain matrix and visibility buffers','128 seated fast-path poses match full transforms','cancel clears playback','rewind needs a tape, starts at the latch, stops by its end, never aliases, cancels, yields to PLAY']};
writeFileSync('tools/out/cassette-invariants.json',JSON.stringify(report,null,2));console.log(report);
