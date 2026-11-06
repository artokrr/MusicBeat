import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {basename} from 'node:path';
import {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping';
const dir=process.argv[2],dist=process.argv[3];
const s=JSON.parse(readFileSync(`${dir}/startup.json`)),t=JSON.parse(gunzipSync(readFileSync(`${dir}/startup-trace.json.gz`)));
const main=new Set(t.traceEvents.filter(e=>e.name==='thread_name'&&e.args.name==='CrRendererMain').map(e=>`${e.pid}:${e.tid}`));
const modules=t.traceEvents.filter(e=>e.name==='v8.compileModule'&&e.ph==='X'&&main.has(`${e.pid}:${e.tid}`));
const models=s.resources.filter(r=>r.name.includes('/models/'));
const js=s.resources.filter(r=>r.name.includes('/assets/')&&r.name.endsWith('.js')&&!r.name.includes('worker'));
const loading=s.phaseTimes.find(p=>p.screen==='loading'),mapped=s.phaseTimes.find(p=>p.beatmap),countdown=s.phaseTimes.find(p=>p.screen==='playing'),playing=s.phaseTimes.find(p=>p.phase==='playing');
const p=JSON.parse(readFileSync(`${dir}/startup.cpuprofile`)),maps=new Map();
for(const f of readdirSync(`${dist}/assets`))if(f.endsWith('.map'))maps.set(f.slice(0,-4),new TraceMap(JSON.parse(readFileSync(`${dist}/assets/${f}`))));
const nodes=new Map(p.nodes.map(n=>[n.id,n])),parents=new Map(),areas=new Map();
for(const n of p.nodes){for(const c of n.children??[])parents.set(c,n.id);const map=maps.get(basename(n.callFrame.url));const source=map?originalPositionFor(map,{line:n.callFrame.lineNumber+1,column:n.callFrame.columnNumber}).source:n.callFrame.url;areas.set(n.id,source??'');}
let generatorCPU=0,analysisSetupCPU=0;
for(let i=0;i<p.samples.length;i++){
  let n=nodes.get(p.samples[i]),generator=false,analysis=false;
  while(n){const src=areas.get(n.id);generator ||= /\/beatmap\/(BeatmapGenerator|debugReport)\.ts$/.test(src);analysis ||= /\/audio\/analyzeInBackground/.test(src);n=nodes.get(parents.get(n.id));}
  if(generator)generatorCPU+=Math.max(0,p.timeDeltas[i])/1000;
  if(analysis)analysisSetupCPU+=Math.max(0,p.timeDeltas[i])/1000;
}
const summary={firstContentfulPaintMs:s.paints.find(p=>p.name==='first-contentful-paint')?.startTime,firstSceneFrameMs:s.firstFrame,
  jsBytes:js.reduce((a,r)=>a+r.size,0),js:js.map(r=>({name:basename(r.name),start:r.start,end:r.start+r.duration,downloadMs:r.duration,bytes:r.size})),
  moduleCompileMs:modules.map(e=>({file:e.args.fileName,ms:e.dur/1000})),
  modelBytes:models.reduce((a,r)=>a+r.size,0),modelsFirstRequestMs:Math.min(...models.map(r=>r.start)),modelsLastResponseMs:Math.max(...models.map(r=>r.start+r.duration)),
  navigationToPlayingMs:playing.ms,selectedToPlayingMs:playing.ms-s.selected,decodeAndUploadMs:loading.ms-s.selected,workerWallMs:s.workers.map(w=>w.end-w.start),workerResultToMapMs:mapped.ms-s.workers.at(-1).end,
  generatorSampledMainThreadMs:generatorCPU,analysisSetupSampledMainThreadMs:analysisSetupCPU,mapToCountdownMs:countdown.ms-mapped.ms,countdownMs:playing.ms-countdown.ms};
writeFileSync(`${dir}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
