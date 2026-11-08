// Contact, basis, return-endpoint, determinism and allocation-identity contracts.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
execFileSync('node_modules/vite/node_modules/esbuild/bin/esbuild',['client/src/game/anim/animator.ts','--bundle','--platform=node','--format=esm','--outfile=tools/out/strokes-current.mjs']);
execFileSync('node_modules/vite/node_modules/esbuild/bin/esbuild',['client/src/game/anim/flight.ts','--bundle','--platform=node','--format=esm','--outfile=tools/out/strokes-flight.mjs']);
const {createAnimator}=await import('./out/strokes-current.mjs');
const {returningBall}=await import('./out/strokes-flight.mjs');
const {Spring}=await import('./out/strokes-motion.mjs').catch(async()=>{
 execFileSync('node_modules/vite/node_modules/esbuild/bin/esbuild',['client/src/game/anim/motion.ts','--bundle','--platform=node','--format=esm','--outfile=tools/out/strokes-motion.mjs']); return import('./out/strokes-motion.mjs');
});
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function replay(create,offset=0,smash=false,hold=false){
 const a=create(),f={nowMs:0,dt:.001,songTime:0,beat:0,approachTime:.8,notes:[],world:{lanes:[320,400,480]},playerX:400,pressedLane:null,pressAgeMs:Infinity,feedbacks:[],hud:{combo:smash?24:0}};
 const n={time:1,type:hold?'hold':'normal',x:400,startX:400,targetX:400,hit:false,returnPhase:false,returnProgress:0,smash};
 let gap=0,sample,identity,maxLegError=0;const poses=[];
 for(let i=0;i<2300;i++){
  const t=i/1000;f.songTime=t;f.nowMs=i;f.notes=t>.2?[n]:[];
  if(t>=1+offset){n.hit=!hold||t>=1.6;n.hitResult=Math.abs(offset)>.08?'ok':Math.abs(offset)>.03?'good':'perfect';n.hitTime=1+offset;n.returnPhase=n.hit;n.returnProgress=Math.max(0,(t-1-offset)/.4);if(hold)n.holdStartTime=1+offset;f.hud.combo=smash?25:1;}
  const o=a.update(f);if(!identity)identity=o;assert.equal(o,identity);
  const p=o.player; for(const v of Object.values(p.joints).flat())assert(Number.isFinite(v));
  assert(Math.abs(p.paddle.up.reduce((s,v,i)=>s+v*p.paddle.normal[i],0))<1e-8);
  for(const side of ['L','R'])maxLegError=Math.max(maxLegError,Math.abs(distance(p.joints['knee'+side],p.joints['ankle'+side])-.43));
  const strike=a.strikeFor(1);if(strike&&!sample&&t>=strike.at){gap=distance(p.paddle.center,strike.pos);sample=true;}
  if(i%20===0)poses.push(structuredClone(p));
 }
 assert(hold||sample);assert(gap<.03,`contact ${gap}`);assert(maxLegError<.005,`leg ${maxLegError}`);
 return {gap,poses};
}
const contacts=[];for(const offset of [-.12,-.06,0,.06,.12])for(const smash of [false,true])contacts.push({offset,smash,gap:replay(createAnimator,offset,smash).gap});
assert.deepEqual(replay(createAnimator),replay(createAnimator));replay(createAnimator,0,false,true);
// Fast cross-court stream through actual strike()/returnFor(), including rewards.
{
 const a=createAnimator(),notes=Array.from({length:50},(_,i)=>({time:1+i*.13,type:'normal',x:i%2?480:320,startX:400,targetX:i%2?480:320,hit:false,returnPhase:false,returnProgress:0,smash:(i+1)%25===0}));
 const f={songTime:0,nowMs:0,dt:.001,approachTime:.8,notes:[],world:{lanes:[320,400,480]},playerX:400,pressedLane:null,pressAgeMs:Infinity,hud:{combo:0}};
 let maxGap=0,maxLegError=0,checked=0;
 const seen=new Set();
 for(let i=0;i<8000;i++){
  const t=i/1000;f.songTime=t;f.nowMs=i;f.notes=notes.filter(n=>t>n.time-.8&&t<n.time+1);
  for(const n of f.notes){if(t>=n.time+.012){n.hit=n.returnPhase=true;n.hitTime=n.time+.012;n.returnProgress=(t-n.hitTime)/.4;f.playerX=n.targetX;}}
  const p=a.update(f).player,j=p.joints;
  assert(!(j.ankleL[2]>.076 && j.ankleR[2]>.076),'both feet lifted');
  for(const side of ['L','R'])maxLegError=Math.max(maxLegError,Math.abs(distance(j['knee'+side],j['ankle'+side])-.43));
  for(const n of f.notes){const strike=a.strikeFor(n.time);if(strike&&t>=strike.at&&!seen.has(n.time)){seen.add(n.time);checked++;maxGap=Math.max(maxGap,distance(p.paddle.center,strike.pos));}}
 }
 assert.equal(checked,50);assert(maxGap<.03,`dense contact ${maxGap}`);assert(maxLegError<.02,`dense leg ${maxLegError}`);
 contacts.push({dense50:true,maxGap,maxLegError});
}
const out=[0,0,0],normal=[0,0,0];
for(const rallyTime of [Infinity,2])for(const smash of [false,true]){
 const f={id:1,startAt:1,endAt:1.7,endX:.45,rallyTime,from:[-.45,-1.55,1.04],smash};
 assert(distance(returningBall(f,1,out),f.from)<1e-10);
 assert(distance(returningBall(f,1.7,out),[.45,1.5,1.035])<1e-10);
 if(smash){returningBall(f,1.2,out);returningBall({...f,smash:false},1.2,normal);assert(out[1]>normal[1]);assert(out[2]<normal[2]);}
}
// A low reward return still clears the 15 cm net with the 5.5 cm ball radius.
for(const z of [.85,1,1.055,1.15]){
 const f={from:[0,-1.6,z],endX:0,startAt:0,endAt:1,rallyTime:2,smash:true};
 for(let i=0;i<=10000;i++){returningBall(f,i/10000,out);if(Math.abs(out[1])<.01)assert(out[2]>=.965,`smash clips net: ${out[2]}`);}
}
let overshoot=0,crossings=0;const spring=new Spring();let prev=-1;
for(let i=0;i<3000;i++){spring.update(1,10,1/1000);overshoot=Math.max(overshoot,spring.value-1);if((spring.value-1)*prev<0)crossings++;prev=spring.value-1;}
assert.equal(overshoot,0);assert.equal(crossings,0);
const report={contacts,spring:{overshoot,crossings},deterministic:true,stableOutputIdentity:true};
writeFileSync('tools/out/strokes-checks.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
