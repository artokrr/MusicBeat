// Rebuild lossless distribution copies after editing the Blender assets.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
const dir='client/public/models';
let original=0,packed=0;
for(const file of readdirSync(dir).filter(f=>f.endsWith('.glb'))){
  const bytes=readFileSync(`${dir}/${file}`),compressed=gzipSync(bytes,{level:9});
  if(!gunzipSync(compressed).equals(bytes))throw new Error(`Round trip failed: ${file}`);
  writeFileSync(`${dir}/${file}.gz`,compressed);
  original+=bytes.length;packed+=compressed.length;
  console.log(`${file}: ${bytes.length} -> ${compressed.length}`);
}
console.log(`Total: ${original} -> ${packed} (${(100*packed/original).toFixed(1)}%)`);
