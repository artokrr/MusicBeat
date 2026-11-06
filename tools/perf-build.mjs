// Production benchmark build. The only probe exposes the existing store to CDP;
// no timing, renderer, audio, or gameplay code is replaced.
import { build } from 'vite';
import { resolve } from 'node:path';
await build({
  root: resolve('client'),
  plugins: [{name:'cdp-store-probe',transform(code,id){
    if(id.endsWith('/src/store/gameStore.ts')){
      // Existing lines are unchanged; a line map keeps store frames attributable.
      return {code:code+'\n;globalThis.__perfStore = useGameStore;\n',map:{
        version:3,sources:[id],sourcesContent:[code],names:[],
        mappings:code.split('\n').map((_,i)=>i?'AACA':'AAAA').join(';'),
      }};
    }
  }}],
  build:{outDir:resolve(process.argv[2]??'tools/out/perf/prod'),emptyOutDir:true,sourcemap:true},
});
