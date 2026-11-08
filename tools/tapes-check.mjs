// Isolated presentation tests: no song clock, renderer, or audio device.
import {build} from '../node_modules/vite/node_modules/esbuild/lib/main.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('tools/out',{recursive:true});
await build({stdin:{contents:`export * from './client/src/game/anim/recorder';export * from './client/src/game/scene/recorder';`,resolveDir:process.cwd()},define:{'import.meta.env.DEV':'false'},bundle:true,platform:'node',format:'esm',outfile:'tools/out/tapes-fixture.mjs'});
const m=await import('./out/tapes-fixture.mjs');
const {recorder:r,insertCassette:insert,sampleRecorder:sample,RecorderBoxes,TAPE_SPOTS,EJECT_START_MS,EJECT_END_MS,EJECT_REST_MS}=m;
const boxes=new RecorderBoxes(),storage=boxes.matrices,pool=r.tapes;
insert(0);sample(1450);
for(let load=1;load<=9;load++) {
 const start=load*2000;insert(start);
 const tape=r.tapes.find(t=>t.startedMs===start);
 sample(start+EJECT_START_MS);assert.equal(tape.z,.1875);
 sample(start+EJECT_START_MS+1);assert.ok(tape.z>.1875,'pop is first movement');
 sample(start+450);assert.ok(tape.z>.5,'readable rise');
 sample(start+EJECT_END_MS-1);assert.equal(tape.landed,false);
 sample(start+EJECT_END_MS);assert.equal(tape.landed,true);assert.ok(Math.abs(tape.z-.021)<1e-10);
 const contactX=tape.x;sample(start+EJECT_REST_MS);assert.notEqual(contactX,tape.x,'slide follows contact');
 assert.equal(tape.tilt,-Math.PI/2);assert.ok(Math.abs(tape.roll)<1e-15);
 sample(start+1450);boxes.update(r);
 if(load>=7){assert.equal(r.tapes.filter(t=>t.active).length,7);const retiring=r.tapes.find(t=>t.retireMs!==-Infinity&&t.active);assert.ok(retiring.z<.021);}
 sample(start+1600);boxes.update(r);assert.equal(r.tapes.filter(t=>t.active).length,Math.min(load,6));
 for(let i=0;i<TAPE_SPOTS.length;i++) for(let j=0;j<i;j++) assert.ok(Math.hypot(TAPE_SPOTS[i][0]-TAPE_SPOTS[j][0],TAPE_SPOTS[i][1]-TAPE_SPOTS[j][1])>.35);
 for(let i=0;i<r.tapes.length;i++) assert.ok(!r.tapes[i].active||r.tapes[i].x>1.5,'outside player movement');
 const fresh=new RecorderBoxes();fresh.update(r);
 for(let j=0;j<storage.length;j++)assert.ok(!boxes.visible[Math.floor(j/16)]||Math.abs(storage[j]-fresh.matrices[j])<1e-5,`cache matches fresh transform ${j}`);
}
// Cancellation and menu sampling must retain the pile and keep snow accumulating.
m.cancelCassette();const last=r.tapes.find(t=>t.serial===8);
sample(18000+EJECT_END_MS+540000);assert.ok(last.snow>.99);assert.equal(last.active,true);assert.ok(last.z>0,'edge still above snow at nine minutes');
sample(18000+EJECT_END_MS+650000);boxes.update(r);
const fresh=new RecorderBoxes();fresh.update(r);
for(let j=0;j<storage.length;j++)assert.ok(!boxes.visible[Math.floor(j/16)]||Math.abs(storage[j]-fresh.matrices[j])<1e-5,`sinking cache ${j}`);
sample(18000+EJECT_END_MS+780000);assert.equal(r.tapes.some(t=>t.active),false);
assert.equal(boxes.matrices,storage);assert.equal(r.tapes,pool);
// Production ignores the test-only acceleration hook.
m.setTapeBurialTimeScale(3600);insert(900000);sample(901450);insert(902000);sample(903600);assert.ok(r.tapes.find(t=>t.startedMs===902000).snow<.01);
const report={passed:true,checks:['9 consecutive replacements','first movement/contact/slide timings','separated destinations outside player area','six resting plus smooth retiring slot','9-minute white face and 13-minute burial','burial continues after cancel','cache matches full transforms including sinking','stable pool and matrix identity','production ignores time-scale override']};
writeFileSync('tools/out/tapes-invariants.json',JSON.stringify(report,null,2));console.log(report);
