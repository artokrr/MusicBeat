// Browser-only keyboard bot, injected with tools/shot.mjs --eval. Never changes score/timing.
(async()=>{
  const app=await (await fetch('/src/App.tsx')).text();
  const url=app.match(/from "(\/src\/store\/gameStore\.ts[^"]*)"/)[1];
  const {useGameStore:store}=await import(url);
  const contexts=[];
  window.AudioContext=new Proxy(window.AudioContext,{construct(Target,args){const ctx=new Target(...args);contexts.push(ctx);return ctx;}});
  window.__bot={ready:true,notes:0,hit:0,elapsed:0,done:false,failures:[]};
  let timer,clock,origin,notes,index=0,releases=[];
  const codes=['ArrowLeft','ArrowUp','ArrowRight'];
  function key(type,lane){window.dispatchEvent(new KeyboardEvent(type,{code:codes[lane],key:codes[lane],bubbles:true}));}
  store.subscribe((state,prev)=>{
    if(state.phase==='playing' && prev.phase!=='playing') {
      clock=contexts[contexts.length-1];origin=clock.currentTime;
      notes=state.beatmap.notes;
      window.__bot.notes=notes.length;window.__bot.duration=state.audioBuffer.duration;
      timer=setInterval(()=>{
        const t=clock.currentTime-origin;window.__bot.elapsed=t;
        for(let i=releases.length-1;i>=0;i--) if(t>=releases[i].time){key('keyup',releases[i].lane);releases.splice(i,1);}
        while(index<notes.length && t>=notes[index].time+.012) {
          const n=notes[index++];key('keydown',n.laneIndex);
          releases.push({lane:n.laneIndex,time:n.type==='hold'?(n.holdEndTime??n.time+1)+.045:t+.035});
          window.__bot.hit=index;
        }
      },4);
    }
    if(state.score.missCount>prev.score.missCount || state.score.okCount>prev.score.okCount || state.score.goodCount>prev.score.goodCount) window.__bot.failures.push({elapsed:window.__bot.elapsed,index,score:state.score,note:notes?.[Math.max(0,index-1)]});
    if(state.screen==='results') {
      clearInterval(timer);window.__bot.done=true;window.__bot.score=state.score;window.__bot.outcome=state.runOutcome;
    }
  });
  return {ready:true,url};
})()
