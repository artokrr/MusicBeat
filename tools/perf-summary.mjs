import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { basename } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
const dir=process.argv[2], dist=process.argv[3];
const raw=existsSync(`${dir}/raw.json`)?JSON.parse(readFileSync(`${dir}/raw.json`)):null;
const maps=new Map(),overlayRanges=new Map();
if(dist)for(const file of readdirSync(`${dist}/assets`))if(file.endsWith('.map'))maps.set(file.slice(0,-4),new TraceMap(JSON.parse(readFileSync(`${dist}/assets/${file}`))));
function frame(f){
  const map=maps.get(basename(f.url));
  if(!map)return f;
  const original=originalPositionFor(map,{line:f.lineNumber+1,column:f.columnNumber});
  const lineNumber=(original.line??0)-1;
  let range;
  if(original.source?.includes('/pixel/renderer.ts')){
    range=overlayRanges.get(original.source);
    if(!range){
      const content=map.sourcesContent[map.resolvedSources.indexOf(original.source)];
      range=[content.split('// ---------- 2D overlays ----------')[0].split('\n').length,content.split('// ---------- Frame ----------')[0].split('\n').length];
      overlayRanges.set(original.source,range);
    }
  }
  return {...f,url:original.source??f.url,originalName:original.name,lineNumber,overlay:!!range&&lineNumber>=range[0]&&lineNumber<range[1]};
}
function area(stack){
  for(const f of [...stack].reverse()){
    const u=f.url,n=f.functionName;
    if(u.includes('/anim/'))return 'animator';
    if(/\/pixel\/(font|hud)\.ts/.test(u))return 'HUD/text';
    if(u.includes('/pixel/renderer.ts')&&(f.overlay||/draw|Bursts/.test(n)))return '2D overlays';
    if(u.includes('/gl/weather.ts'))return 'snow';
    if(u.includes('/gl/'))return 'Three + GL';
    if(u.includes('/scene/backend.ts'))return 'Three + GL';
    if(u.includes('/pixel/renderer.ts'))return 'describeFrame/rest';
    if(u.includes('/Game.tsx'))return 'Game loop/input';
    if(u.includes('/components/GameScreen.tsx'))return 'Game loop/input';
    if(/react|scheduler/.test(u))return 'React';
  }
  return ['(idle)','(program)','(garbage collector)'].includes(stack.at(-1)?.functionName)?stack.at(-1).functionName:'other';
}
const p=JSON.parse(readFileSync(`${dir}/cpu.cpuprofile`));
const nodes=new Map(p.nodes.map(n=>[n.id,n])),parent=new Map(),stacks=new Map();
for(const n of p.nodes)for(const c of n.children??[])parent.set(c,n.id);
for(const n of p.nodes){let cur=n,s=[];while(cur){s.unshift(frame(cur.callFrame));cur=nodes.get(parent.get(cur.id))}stacks.set(n.id,s)}
const cpu={},top=new Map();
for(let i=0;i<p.samples.length;i++){
  const s=stacks.get(p.samples[i]),ms=Math.max(0,p.timeDeltas[i])/1000,k=area(s),leaf=s.at(-1);
  cpu[k]=(cpu[k]??0)+ms;
  const name=`${leaf.originalName??leaf.functionName} ${leaf.url}:${leaf.lineNumber+1}`;
  top.set(name,(top.get(name)??0)+ms);
}
const h=JSON.parse(readFileSync(`${dir}/heap.heapprofile`)),allocation={};
function walk(n,s){s=[...s,frame(n.callFrame)];const k=area(s);allocation[k]=(allocation[k]??0)+n.selfSize;for(const c of n.children??[])walk(c,s)}walk(h.head,[]);
const trace=JSON.parse(gunzipSync(readFileSync(`${dir}/trace.json.gz`)));
const gcEvents=trace.traceEvents.filter(e=>/^(MinorGC|MajorGC)$/.test(e.name)&&e.ph==='X');
const mainThreads=new Set(trace.traceEvents.filter(e=>e.name==='thread_name'&&e.args.name==='CrRendererMain').map(e=>`${e.pid}:${e.tid}`));
const from=raw?.metricsStart.metrics.find(m=>m.name==='Timestamp')?.value*1e6;
const until=raw?.metricsEnd.metrics.find(m=>m.name==='Timestamp')?.value*1e6;
const gc=gcEvents.filter(e=>mainThreads.has(`${e.pid}:${e.tid}`)&&(!raw||(e.ts>=from&&e.ts<=until)));
const quantile=(a,q)=>{const s=[...a].sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)]??0};
const stats=a=>({n:a.length,p50:quantile(a,.5),p95:quantile(a,.95),p99:quantile(a,.99),max:Math.max(0,...a),over20:a.filter(x=>x>20).length});
const summary={cpuSampleMs:cpu,allocationBytes:allocation,topSelfMs:[...top].sort((a,b)=>b[1]-a[1]).slice(0,25),gc:{count:gc.length,totalMs:gc.reduce((s,e)=>s+e.dur/1000,0),pauses:stats(gc.map(e=>e.dur/1000))}};
if(raw){
  const start=Object.fromEntries(raw.metricsStart.metrics.map(m=>[m.name,m.value])),end=Object.fromEntries(raw.metricsEnd.metrics.map(m=>[m.name,m.value]));
  const frames=raw.measured.raf.length;
  Object.assign(summary,{frames:stats(raw.measured.raf),rafCallback:stats(raw.measured.costs.map(c=>c.ms)),commits:raw.measured.commits,sceneCopies:raw.measured.sceneDraws,measuredMs:raw.measured.ms,
    mainThreadTaskMs:(end.TaskDuration-start.TaskDuration)*1000,scriptMs:(end.ScriptDuration-start.ScriptDuration)*1000,
    cpuMsPerDisplayFrame:Object.fromEntries(Object.entries(cpu).map(([k,v])=>[k,v/frames])),
    memory:{start:raw.heapStart,end:raw.heapEnd,peakUsed:Math.max(...raw.memory.map(m=>m.usedSize)),samples:raw.memory},bot:raw.bot,errors:raw.errors});
}
writeFileSync(`${dir}/summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,(k,v)=>['samples','bot','topSelfMs','errors'].includes(k)?undefined:v,2));
