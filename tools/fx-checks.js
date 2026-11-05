// Run with tools/shot.mjs --after tools/fx-checks.js (a gameplay frame).
// All allocations/readbacks here are verification-only, outside production.
(async () => {
  const game = await (await fetch('/src/game/Game.tsx')).text();
  const renderingUrl = game.match(/from "(\/src\/game\/pixel\/renderer\.ts[^"]*)"/)[1];
  const renderingSource = await (await fetch(renderingUrl)).text();
  const backendUrl = renderingSource.match(/from "(\/src\/game\/scene\/backend\.ts[^"]*)"/)[1];
  const [{ currentSceneFrame }, { rendererDiagnostics }, { GLBackend }, { lampLevel }, { Footprints }] = await Promise.all([
    import(renderingUrl), import(backendUrl), import('/src/game/gl/renderer.ts'),
    import('/src/game/gl/lamp.ts'), import('/src/game/gl/footprints.ts'),
  ]);
  const live = rendererDiagnostics(), frame = structuredClone(currentSceneFrame());
  const gl = new GLBackend(), files = [];
  const c = document.createElement('canvas'); c.width = 384; c.height = 216;
  const ctx = c.getContext('2d');
  function pixels() { ctx.drawImage(gl.render(frame), 0, 0); return ctx.getImageData(0, 0, 384, 216).data; }
  function capture(name) {
    const large = document.createElement('canvas'); large.width = 1152; large.height = 648;
    const out = large.getContext('2d'); out.imageSmoothingEnabled = false;
    out.drawImage(gl.render(frame), 0, 0, 1152, 648);
    files.push({ name, dataUrl: large.toDataURL() });
  }
  function difference(a, b) { let count = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) count++; return count; }
  function assert(ok, message) { if (!ok) throw new Error(message); }
  try {
    gl.render(frame);
    await Promise.all([gl.props.ready, gl.paddles.ready]);
    for (let i = 0; i < 100 && (gl.player.status !== 'glb' || gl.stranger.status !== 'glb'); i++) await new Promise(r => setTimeout(r, 20));
    assert(gl.props.status === 'glb' && gl.paddles.status === 'glb' && gl.player.status === 'glb' && gl.stranger.status === 'glb', 'An authored asset did not load');
    const loaded = { props: gl.props.status, paddles: gl.paddles.status, player: gl.player.status, stranger: gl.stranger.status };
    capture('fx-frozen-gameplay.png');

    // Matrix-level attachment proof: asset blade centre, +Z and red +Y face.
    const threeUrl = (await (await fetch('/src/game/gl/paddles.ts')).text()).match(/from "([^"]*three[^\"]*)"/)[1];
    const { Matrix4, Vector3 } = await import(threeUrl);
    const { poseJoints } = await import('/src/game/anim/pose.ts');
    let paddleError = 0;
    const m = new Matrix4(), v = new Vector3(), target = new Vector3();
    for (let i = 0; i < 48; i++) {
      const pose = poseJoints(Math.sin(i), -2.3, i*.37, { crouch: .6, lean: .3, stance: .22, twist: Math.sin(i)*.7, armR: { swing: i*.15, bend: .8, spread: .5 }, armL: { swing: .4, bend: .9, spread: .3 } });
      gl.paddles.begin(); gl.paddles.add(pose.paddle); gl.paddles.mesh.getMatrixAt(0, m);
      paddleError = Math.max(paddleError, v.set(0, 0, .145).applyMatrix4(m).distanceTo(target.set(...pose.paddle.center)),
        v.set(0, 0, 1).transformDirection(m).distanceTo(target.set(...pose.paddle.up)),
        v.set(0, 1, 0).transformDirection(m).distanceTo(target.set(...pose.paddle.normal)));
    }
    assert(paddleError < 1e-5, 'Paddle orientation/centre mismatch');

    // Point depth test: a 2px flake on the same camera ray in front of / behind a head.
    const positions = gl.snow.mesh.geometry.getAttribute('position'), motion = gl.snow.mesh.geometry.getAttribute('motion');
    const savedPosition = Array.from(positions.array.slice(0, 3)), savedMotion = Array.from(motion.array.slice(0, 3));
    const originalTime = frame.timeMs; frame.timeMs = 0;
    gl.breath.mesh.visible = false; gl.snow.mesh.visible = false;
    const clean = pixels();
    const { VIEW_FORWARD } = await import('/src/game/scene/camera.ts');
    const head = frame.player.pose.joints.head;
    motion.setXYZ(0, 0, 0, 2); motion.needsUpdate = true;
    gl.snow.mesh.geometry.setDrawRange(0, 1); gl.snow.mesh.visible = true;
    function flakeOnRay(distance) {
      positions.setXYZ(0, head[0]+VIEW_FORWARD[0]*distance+6, head[1]+VIEW_FORWARD[1]*distance+5, head[2]+.045+VIEW_FORWARD[2]*distance);
      positions.needsUpdate = true;
      return pixels();
    }
    const behind = difference(clean, flakeOnRay(.5)), inFront = difference(clean, flakeOnRay(-.5));
    assert(behind === 0 && inFront > 0 && inFront <= 4, `Snow depth test failed (${behind}/${inFront})`);
    positions.setXYZ(0, ...savedPosition); motion.setXYZ(0, ...savedMotion); positions.needsUpdate = motion.needsUpdate = true;
    gl.snow.mesh.geometry.setDrawRange(0, 360); gl.breath.mesh.visible = true;
    frame.timeMs = originalTime;

    // Lamp event lengths and interval range, sampled at 60Hz over 10 minutes.
    const starts = [], lengths = []; let run = 0;
    for (let tick = 0; tick < 600*60; tick++) {
      if (lampLevel(tick/60*1000) < 1) { if (!run) starts.push(tick/60); run++; }
      else if (run) { lengths.push(run); run = 0; }
    }
    const intervals = starts.slice(1).map((v, i) => v-starts[i]);
    assert(lengths.every(n => n >= 1 && n <= 2) && intervals.every(t => t >= 20 && t <= 40), 'Lamp flicker cadence invalid');

    // Grounded contact only; standing still must not accumulate repeatedly.
    const feet = new Footprints(), stepFrame = structuredClone(frame); stepFrame.timeMs = 0; stepFrame.playing = true;
    for (const body of [stepFrame.player, stepFrame.stranger]) {
      body.pose.joints.ankleL[2] = body.pose.joints.ankleR[2] = .075;
      body.pose.joints.toeL[2] = body.pose.joints.toeR[2] = .025;
    }
    feet.update(stepFrame); const firstStamps = feet.stamps;
    for (let i = 0; i < 60; i++) { stepFrame.timeMs = i*16; feet.update(stepFrame); }
    assert(feet.stamps === firstStamps && firstStamps === 4, 'Standing feet stamped each frame');
    stepFrame.player.pose.joints.ankleL[2] = .13; stepFrame.player.pose.joints.toeL[2] = .08;
    feet.update(stepFrame); assert(feet.stamps === 4, 'Airborne foot stamped');
    stepFrame.player.pose.joints.ankleL[0] += .25; stepFrame.player.pose.joints.toeL[0] += .25;
    stepFrame.player.pose.joints.ankleL[2] = .075; stepFrame.player.pose.joints.toeL[2] = .025;
    feet.update(stepFrame); assert(feet.stamps === 5, 'Landing did not stamp');
    const peak = Math.max(...feet.pixels); stepFrame.playing = false; stepFrame.timeMs = 180000; feet.update(stepFrame);
    assert(Math.max(...feet.pixels) >= peak-30 && Math.max(...feet.pixels) > 0, 'Footprints faded too fast'); feet.dispose();

    // Warm then time normal render+copy. Hold every buffer identity and GPU
    // resource count stable; the authored update paths contain no new/map/etc.
    const storage = [gl.snow.mesh.geometry.attributes.position.array, gl.breath.mesh.geometry.attributes.position.array,
      gl.breath.mesh.geometry.attributes.life.array, gl.paddles.mesh.instanceMatrix.array, gl.footprints.pixels];
    const samples = [], submissions = []; let memory;
    for (let i = 0; i < 240; i++) {
      await new Promise(requestAnimationFrame);
      frame.timeMs = originalTime+i*1000/60;
      if (i%24 === 0) frame.playerStrokeMs = frame.timeMs;
      const start = performance.now();
      const canvas = gl.render(frame), submitted = performance.now()-start;
      ctx.drawImage(canvas, 0, 0);
      if (i >= 60) { samples.push(performance.now()-start); submissions.push(submitted); }
      if (i === 59) memory = { ...gl.renderer.info.memory };
    }
    assert(storage[0] === gl.snow.mesh.geometry.attributes.position.array && storage[1] === gl.breath.mesh.geometry.attributes.position.array &&
      storage[2] === gl.breath.mesh.geometry.attributes.life.array && storage[3] === gl.paddles.mesh.instanceMatrix.array && storage[4] === gl.footprints.pixels, 'Effect buffers replaced');
    assert(JSON.stringify(memory) === JSON.stringify(gl.renderer.info.memory), 'GPU resource count grew in hot path');
    samples.sort((a,b)=>a-b); submissions.sort((a,b)=>a-b);
    const timing = { submission: { samples: submissions.length, medianMs: submissions[90], p95Ms: submissions[171] }, submissionAndCopy: { samples: samples.length, medianMs: samples[90], p95Ms: samples[171] }, execution: gl.timing.stats(), drawCalls: gl.renderer.info.render.calls, triangles: gl.renderer.info.render.triangles, memory, stableBuffers: true };
    const context = gl.renderer.getContext(), debug = context.getExtension('WEBGL_debug_renderer_info');
    const hardware = debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
    assert(context.getError() === context.NO_ERROR, 'WebGL error');

    // Verification camera only: show all 74 windows and both tree crowns.
    gl.snow.mesh.visible = gl.breath.mesh.visible = false;
    frame.player.visible = frame.stranger.visible = false; frame.ballCount = frame.laneCount = 0;
    gl.camera.zoom = .28; gl.camera.position.set(0,-20,13); gl.camera.lookAt(0,4.6,5); gl.camera.updateProjectionMatrix();
    gl.outputScene.children[0].material.uniforms.lampScreen.value.set(-1000,-1000,1);
    capture('fx-facade-overview.png');
    return { files, live, loaded, timing, hardware, paddleErrorMetres: paddleError,
      snowDepth: { behindChangedPixels: behind, frontChangedPixels: inFront },
      lamp: { events: starts.length, framesPerDip: [...new Set(lengths)], minInterval: Math.min(...intervals), maxInterval: Math.max(...intervals) },
      footprints: { standingStamps: firstStamps, landingStamps: 5, fadePer180Seconds: 30 } };
  } finally { gl.dispose(); }
})()
