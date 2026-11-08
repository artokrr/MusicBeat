// Browser-only keyboard bot, injected with tools/shot.mjs --eval. Never changes score/timing.
// It presses on the game's own song clock (window.__songClock, dev builds), which in
// The default (ambush) start already runs during the 3-2-1 countdown, so countdown balls get hit too.
// Optional: window.__botEarly = { count: 1, sec: 0.09 } presses the first `count` notes
// `sec` early instead of 12 ms late (to check judging before PLAY).
(async()=>{
  const app=await (await fetch('/src/App.tsx')).text();
  const url=app.match(/from "(\/src\/store\/gameStore\.ts[^"]*)"/)[1];
  const {useGameStore:store}=await import(url);
  window.__bot={ready:true,notes:0,hit:0,elapsed:0,done:false,failures:[],presses:[]};
  let timer,notes,index=0,releases=[];
  const early=window.__botEarly??{count:0,sec:0};
  const codes=['ArrowLeft','ArrowUp','ArrowRight'];
  function key(type,lane){window.dispatchEvent(new KeyboardEvent(type,{code:codes[lane],key:codes[lane],bubbles:true}));}
  store.subscribe((state,prev)=>{
    if(state.screen==='playing' && prev.screen!=='playing') {
      index=0;releases=[];
      timer=setInterval(()=>{
        const clock=window.__songClock;if(!clock)return;
        const s=store.getState();if(!s.beatmap)return;
        if(!notes){notes=s.beatmap.notes;window.__bot.notes=notes.length;window.__bot.duration=s.audioBuffer.duration;}
        const t=clock();window.__bot.elapsed=t;
        for(let i=releases.length-1;i>=0;i--) if(t>=releases[i].time){key('keyup',releases[i].lane);releases.splice(i,1);}
        while(index<notes.length && t>=notes[index].time+(index<early.count?-early.sec:.012)) {
          const n=notes[index++];key('keydown',n.laneIndex);
          if(window.__bot.presses.length<8) window.__bot.presses.push({note:n.time,at:t,phase:s.phase});
          releases.push({lane:n.laneIndex,time:n.type==='hold'?(n.holdEndTime??n.time+1)+.045:t+.035});
          window.__bot.hit=index;
        }
      },4);
    }
    if(state.score.missCount>prev.score.missCount || state.score.okCount>prev.score.okCount || state.score.goodCount>prev.score.goodCount) window.__bot.failures.push({elapsed:window.__bot.elapsed,phase:state.phase,index,score:state.score,note:notes?.[Math.max(0,index-1)]});
    if(state.screen==='results' && prev.screen!=='results') {
      clearInterval(timer);window.__bot.done=true;window.__bot.score=state.score;window.__bot.outcome=state.runOutcome;
    }
  });
  return {ready:true,url};
})()
