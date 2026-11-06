// Local, immutable before/after production builds on the assigned port.
// /before/ and /after/ use their own entry; hashed chunks are served by name.
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
const roots=['tools/out/perf/after-dist','tools/out/perf/before-dist'].map(p=>resolve(p));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.gz':'application/gzip','.woff2':'font/woff2','.svg':'image/svg+xml'};
createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  let file;
  if(path==='/before/'||path==='/after/')file=roots[path==='/before/'?1:0]+'/index.html';
  else for(const root of roots){const candidate=resolve(root,'.'+decodeURIComponent(path));if(candidate.startsWith(root+'/')&&existsSync(candidate)){file=candidate;break;}}
  if(!file){res.writeHead(404);res.end();return;}
  try{const bytes=readFileSync(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes)}catch{res.writeHead(404);res.end()}
}).listen(3101,'::1',()=>console.log('Immutable before/after builds: http://localhost:3101/{before,after}/'));
