// Keep tools/out/strokes-baseline.mjs from the pre-change revision.
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
const modules=await Promise.all(['baseline','current'].map(x=>import('./out/strokes-'+x+'.mjs')));
const animators=modules.map(m=>m.createAnimator()),samples=[[],[]];
const n={time:1,type:'normal',x:400,startX:400,targetX:400,hit:false,returnPhase:false,returnProgress:0};
const f={songTime:0,nowMs:0,dt:1/60,approachTime:.8,notes:[n],world:{lanes:[320,400,480]},playerX:400,pressedLane:null,pressAgeMs:Infinity,hud:{combo:24}};
for(let b=0;b<60;b++)for(const phase of b%2?[1,0]:[0,1]){
 const start=performance.now();for(let i=0;i<600;i++){
  const t=(b*600+i)/60,cycle=Math.floor(t/2);n.time=cycle*2+1;n.targetX=320+cycle%3*80;n.x=n.targetX;
  n.hit=t>=n.time;n.returnPhase=n.hit;n.hitTime=n.hit?n.time:undefined;n.smash=cycle%25===0;f.hud.combo=cycle%25;f.songTime=t;f.nowMs=t*1000;animators[phase].update(f);
 }
 if(b>9)samples[phase].push((performance.now()-start)/600);
}
const result=samples.map((a,i)=>{a.sort((a,b)=>a-b);return {phase:i?'after':'before',median:a[25],p95:a[47]}});
writeFileSync('tools/out/strokes-animator-cost.json',JSON.stringify(result,null,2));console.log(result);
