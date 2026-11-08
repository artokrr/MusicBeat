// Baseline shader strings, extracted from the immutable review head. No checkout edits.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const source=file=>execFileSync('git',['show',`573b8f1:client/src/game/gl/${file}.ts`],{encoding:'utf8'});
const glsl=(s,name)=>s.match(new RegExp('(?:export )?const '+name+' = /\\* glsl \\*/ `([\\s\\S]*?)`;'))[1];
const noise=glsl(source('material'),'pixelNoise');
const fragment=glsl(source('material'),'fragment').replace('${pixelNoise}',noise);
const atmosphere=source('atmosphere');
const outline=glsl(source('renderer'),'outlineFragment').replace('${pixelNoise}',noise)
 .replace("${PREMIUM_LOOK ? atmosphereUniforms : ''}",glsl(atmosphere,'atmosphereUniforms'))
 .replace("${PREMIUM_LOOK ? atmosphereFragment : ''}",glsl(atmosphere,'atmosphereFragment'));
mkdirSync('tools/out',{recursive:true});
writeFileSync('tools/out/look3-baseline-shaders.json',JSON.stringify({fragment,outline}));
