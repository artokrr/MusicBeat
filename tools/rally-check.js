// Browser probe: shot.mjs --after tools/rally-check.js (no gameplay mutation).
(async () => {
  const { describeFrame } = await import('/src/game/pixel/renderer.ts');
  const { createAnimator } = await import('/src/game/anim/animator.ts');
  const cases = [
    { name: 'sparse', times: [2, 3.8, 5.6, 7.4], delta: 0 },
    { name: 'fast-feed', times: Array.from({length:24},(_,i)=>2+i*.13), delta: 0 },
    { name: 'dense', times: [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5], delta: 0 },
    { name: 'miss-break', times: [2, 3.8, 5.6, 7.4], delta: 0, miss: 1 },
    { name: 'early-boundary', times: [2, 3.6, 5.2], delta: -.09 },
    { name: 'late-boundary', times: [2, 3.6, 5.2], delta: .09 },
    { name: 'long-pause', times: [2, 6], delta: 0 },
  ];
  const results = [], failures = [];
  for (const test of cases) {
    const animator = createAnimator();
    const notes = test.times.map((time, i) => ({
      time, x: [320, 400, 480][i % 3], y: 0, startX: [380, 480, 320, 400][i % 4],
      targetX: [320, 400, 480][i % 3], type: i % 3 === 1 ? 'switch' : 'normal',
      hit: false, returnPhase: false, returnProgress: 0,
      nextTime: test.times[i + 1], nextStartX: [380, 480, 320, 400][(i + 1) % 4],
    }));
    const contacts = [], returns = [], seen = new Set();
    let spuriousFeeds = 0;
    let maxLeftForearm = 0, maxLeftUpper = 0, minAlphaAtGround = 1, disposalGround = false, maxHandoffCm = 0, maxPlayerContactCm = 0;
    const frame = {nowMs:0,dt:.005,songTime:0,beat:0,approachTime:1.2,notes:[],upcomingFeeds:[],world:{npcHitY:200,playerHitY:480,playerY:520,npcY:160,centerX:400,lanes:[320,400,480]},playerX:400,serving:false,swinging:false,pressedLane:null,pressAgeMs:Infinity,shakeX:0,shakeY:0,feedbacks:[],phantomAlpha:()=>1,hud:null,countdown:null,fade:0};
    const lastTime = test.times.at(-1) + 2;
    for (let step = 0; step <= lastTime * 200; step++) {
      const t = step / 200;
      frame.songTime=t;frame.nowMs=100000+t*1000;frame.beat=t*2;
      frame.notes.length=frame.upcomingFeeds.length=0;
      for (let i=0;i<notes.length;i++) {
        const n=notes[i];
        if (t >= n.time + test.delta - 1e-6 && !n.hit && i !== test.miss) {
          n.hit=true;n.hitResult=Math.abs(test.delta)<.05?'perfect':'good';n.hitTime=t;n.returnStartedAt=t;n.returnPhase=true;n.returnStartX=n.targetX;
        }
        if (i===test.miss && t >= n.time+.15 && !n.hit) {n.hit=true;n.hitResult='miss';n.missTime=t;}
        if(n.returnPhase)n.returnProgress=(t-n.hitTime)/.4;
        if(t >= n.time-1.2-1e-6 && t < n.time+2.5)frame.notes.push(n);
        else if(n.time-1.2-t <= .32+1e-6 && n.time-1.2>t)frame.upcomingFeeds.push(n);
      }
      const check=animator.update(frame), scene=describeFrame(frame);
      for(const r of returns) if(r.rallyTo!==null && t>r.rallyTo-1.2-.15 && t<r.rallyTo-1.2 && animator.feedBall())spuriousFeeds++;
      const j=scene.stranger.pose.joints;
      const d=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
      maxLeftForearm=Math.max(maxLeftForearm,d(j.elbowL,j.wristL));
      maxLeftUpper=Math.max(maxLeftUpper,d(j.shoulderL,j.elbowL));
      for(let i=0;i<notes.length;i++) {
        const n=notes[i],r=animator.returnFor(n.time),s=animator.strikeFor(n.time);
        if(r && seen.has(n.time) && Math.abs(r.startAt-(returns.find(v=>v.note===n.time)?.startAt??r.startAt))>1e-9)failures.push(test.name+': return changed after contact');
        if(r && !seen.has(n.time)){seen.add(n.time);returns.push({note:n.time,startAt:r.startAt,rallyTo:Number.isFinite(r.rallyTime)?r.rallyTime:null,flightSeconds:r.endAt-r.startAt});}
        if(s && r && Math.abs(s.at-r.startAt)>1e-9)failures.push(test.name+': lost retained player contact');
        if(s && Math.abs(t-s.at)<.0026) {
          // The independent animator and real renderer follow the same frame input.
          const p=check.player.paddle.center;
          maxPlayerContactCm=Math.max(maxPlayerContactCm,Math.hypot(...p.map((v,k)=>v-s.pos[k]))*100);
        }
        if(Math.abs(t-(n.time-1.2))<1e-6) {
          const expected=[(n.startX-400)*.45/80,1.5,1.035];
          const p=scene.stranger.pose.paddle.center;
          contacts.push({note:n.time,errorCm:Math.hypot(...p.map((v,k)=>v-expected[k]))*100,balls:scene.ballCount});
          const actual=scene.balls.slice(0,scene.ballCount).find(b=>Math.abs(b.pos[1]-1.5)<.001);
          if(!actual)failures.push(test.name+': no ball at launch '+n.time);
          else maxHandoffCm=Math.max(maxHandoffCm,Math.hypot(...actual.pos.map((v,k)=>v-expected[k]))*100);
        }
      }
      for(let i=0;i<scene.ballCount;i++){const b=scene.balls[i];if(b.pos[1]>1.5 && b.pos[2]<.08){disposalGround=true;minAlphaAtGround=Math.min(minAlphaAtGround,b.alpha);}}
    }
    const maxContactCm=Math.max(...contacts.map(c=>c.errorCm));
    if(spuriousFeeds)failures.push(test.name+': feed during a rally');
    if(maxLeftForearm>.2701 || maxLeftUpper>.3001)failures.push(test.name+': free arm stretches');
    if(maxContactCm>.1)failures.push(test.name+': stranger contact '+maxContactCm);
    if(maxHandoffCm>.01)failures.push(test.name+': discontinuous handoff '+maxHandoffCm);
    if(test.name==='sparse' && returns.filter(r=>r.rallyTo!==null).length!==3)failures.push('sparse chain');
    if(test.name==='dense' && returns.some(r=>r.rallyTo!==null))failures.push('dense rally');
    if(test.name==='miss-break' && returns.some(r=>r.note===3.8))failures.push('miss continued');
    if(!disposalGround)failures.push(test.name+': disposal never reached snow');
    results.push({name:test.name,spuriousFeeds,maxLeftForearm,maxLeftUpper,maxContactCm,maxHandoffCm,maxPlayerContactCm,disposalGround,minAlphaAtGround,contacts,returns});
  }
  // Net-tape widening must not transform the basket's white practice balls.
  const { loadProp, propGeometry, disposeProp } = await import('/src/game/gl/props.ts');
  const basket = await loadProp('ball_basket', new AbortController().signal);
  const geometry = propGeometry(basket, [.78,1.95,0]);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const basketBounds = {min:bounds.min.toArray(),max:bounds.max.toArray()};
  if(bounds.min.y<1.7 || bounds.max.y>2.2 || bounds.max.z>1.05)failures.push('basket geometry escaped placement');
  geometry.dispose();disposeProp(basket);
  if (failures.length) throw new Error(JSON.stringify({failures,results,basketBounds}));
  return {failures,results,basketBounds};
})()
