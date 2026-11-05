// Deterministic, production-renderer checks. Inject with shot.mjs --after.
// Reports failures alongside PNGs so a broken baseline remains inspectable.
(async () => {
  const game = await (await fetch('/src/game/Game.tsx')).text();
  const renderingUrl = game.match(/from "(\/src\/game\/pixel\/renderer\.ts[^\"]*)"/)[1];
  const figureSource = await (await fetch('/src/game/gl/figures.ts')).text();
  const loaderUrl = figureSource.match(/from "([^"]*GLTFLoader[^"]*)"/)[1];
  const threeUrl = figureSource.match(/from "([^"]*three[^"]*)"/)[1];
  const [{ currentSceneFrame }, { GLBackend }, { createAnimator }, { Vector3, Matrix4 }, { GLTFLoader }] = await Promise.all([
    import(renderingUrl), import('/src/game/gl/renderer.ts'), import('/src/game/anim/animator.ts'),
    import(threeUrl), import(loaderUrl),
  ]);
  const frame = structuredClone(currentSceneFrame()), files = [], failures = [];
  const poses = createAnimator().idle(5000, 0);
  frame.player.pose = structuredClone(poses.player); frame.stranger.pose = structuredClone(poses.stranger);
  frame.player.visible = frame.stranger.visible = true;
  frame.timeMs = 5000; frame.playing = false; frame.playerStrokeMs = -Infinity;
  frame.ballCount = frame.laneCount = 0; frame.shakeX = frame.shakeY = 0; frame.flicker = false;
  frame.stranger.look.face = [14, 14, 20];
  const gl = new GLBackend(), canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 216;
  const ctx = canvas.getContext('2d');
  const capture = name => {
    ctx.drawImage(gl.render(frame), 0, 0);
    const pixels = ctx.getImageData(0, 0, 384, 216).data;
    if (name) files.push({ name: name+'.png', dataUrl: canvas.toDataURL() });
    return pixels;
  };
  const difference = (a, b) => {
    const points = [];
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) points.push([i/4%384, Math.floor(i/4/384)]);
    return { pixels: points.length, bounds: points.length ? [Math.min(...points.map(p=>p[0])), Math.min(...points.map(p=>p[1])), Math.max(...points.map(p=>p[0])), Math.max(...points.map(p=>p[1]))] : null };
  };
  const check = (ok, message) => { if (!ok) failures.push(message); };
  try {
    gl.render(frame); await Promise.all([gl.props.ready, gl.paddles.ready]);
    for (let i=0; i<100 && (gl.player.status!=='glb' || gl.stranger.status!=='glb'); i++) await new Promise(r=>setTimeout(r,20));
    check(gl.player.status==='glb' && gl.stranger.status==='glb', 'Authored characters failed to load');
    gl.snow.mesh.visible = gl.breath.mesh.visible = false;
    const normal = capture('frozen-normal');
    const savedCamera = { position: gl.camera.position.clone(), quaternion: gl.camera.quaternion.clone(), zoom: gl.camera.zoom };
    for (const actor of ['player','stranger']) {
      const target = new Vector3(...frame[actor].pose.joints.wristR);
      gl.camera.position.copy(target).add(new Vector3(2,-4,2)); gl.camera.lookAt(target);
      gl.camera.zoom = 5; gl.camera.updateProjectionMatrix(); capture(actor+'-grip-detail');
    }
    gl.camera.position.copy(savedCamera.position); gl.camera.quaternion.copy(savedCamera.quaternion);
    gl.camera.zoom = savedCamera.zoom; gl.camera.updateProjectionMatrix();
    const staticRepeat = difference(normal, capture());
    check(staticRepeat.pixels === 0, 'Static render changed');
    let staticTimeChanges = 0;
    for(let i=1;i<=60;i++){frame.timeMs=5000+i*1000/60;staticTimeChanges=Math.max(staticTimeChanges,difference(normal,capture()).pixels);}
    frame.timeMs=5000;
    check(staticTimeChanges === 0, 'Static objects crawl as presentation time advances');
    frame.flicker = true; frame.stranger.look.face = [70,66,76];
    const flicker = difference(normal, capture('frozen-flicker'));
    check(flicker.pixels > 0 && flicker.pixels < 150, 'GLB face flicker absent or affects too much of scene');
    frame.flicker = false; frame.stranger.look.face = [14,14,20];
    const restored = difference(normal, capture('frozen-restored'));
    check(restored.pixels === 0, 'Flicker did not restore original appearance');

    const grips = {};
    const { poseJoints } = await import('/src/game/anim/pose.ts');
    // Recover each authored grip in bone-local coordinates from a fresh bind pose.
    for (const actor of ['player', 'stranger']) {
      const asset = (await new GLTFLoader().loadAsync('/models/'+actor+'.glb')).scene;
      asset.updateMatrixWorld(true);
      let metadata, hand;
      asset.traverse(o=>{ if(o.userData.right_hand_grip_center_zup) metadata=o.userData; if(o.isBone && o.name==='handR') hand=o; });
      const fromZup = a => new Vector3(a[0], a[2], -a[1]);
      const grip = fromZup(metadata.right_hand_grip_center_zup).applyMatrix4(new Matrix4().copy(hand.matrixWorld).invert());
      const direction = fromZup(metadata.right_hand_grip_up_zup).transformDirection(new Matrix4().copy(hand.matrixWorld).invert());
      const rig = gl[actor].rig, binding = rig.bindings.find(b=>b.def.name==='handR');
      const forearm = rig.bindings.find(b=>b.def.name==='foreArmR');
      const localNormal = fromZup(metadata.right_hand_grip_normal_zup).transformDirection(new Matrix4().copy(hand.matrixWorld).invert());
      let gap = 0, angle = 0, normalAngle = 0, wristGap = 0, finite = true;
      const samples = [frame[actor].pose];
      for (let i=0;i<48;i++) samples.push(poseJoints(Math.sin(i), actor==='player'?-2.3:2.1, i*.13, {
        crouch:.6,lean:.3,stance:.22,twist:Math.sin(i)*.7,
        armR:{swing:i*.15,bend:.8,spread:.5},armL:{swing:.4,bend:.9,spread:.3},
      }));
      for (const pose of samples) {
        const original = JSON.stringify(pose);
        rig.update(pose);
        const actual = grip.clone().applyMatrix4(binding.bone.matrixWorld);
        const target = new Vector3(...pose.paddle.center).addScaledVector(new Vector3(...pose.paddle.up), -.145);
        gap = Math.max(gap, actual.distanceTo(target));
        angle = Math.max(angle, direction.clone().transformDirection(binding.bone.matrixWorld).angleTo(new Vector3(...pose.paddle.up))*180/Math.PI);
        normalAngle = Math.max(normalAngle, localNormal.clone().transformDirection(binding.bone.matrixWorld).angleTo(new Vector3(...pose.paddle.normal))*180/Math.PI);
        wristGap = Math.max(wristGap, new Vector3(0,forearm.restLength/forearm.scale.y,0).applyMatrix4(forearm.bone.matrixWorld).distanceTo(new Vector3().setFromMatrixPosition(binding.bone.matrixWorld)));
        rig.root.traverse(o=>{
          if (!o.isSkinnedMesh) return;
          o.skeleton.update();
          const positions=o.geometry.getAttribute('position');
          for(let i=0;i<positions.count;i+=7){const p=new Vector3().fromBufferAttribute(positions,i);o.applyBoneTransform(i,p);finite &&= Number.isFinite(p.x+p.y+p.z);}
        });
        check(original === JSON.stringify(pose), actor+' retargeter mutated the animator output');
      }
      grips[actor] = { poses:samples.length, maxGapMetres:gap, maxShaftAngleDegrees:angle, maxFaceAngleDegrees:normalAngle, maxSleeveWristGapMetres:wristGap, finiteSkinnedVertices:finite };
      check(gap < 1e-5 && angle < .001 && normalAngle < .001, actor+' paddle does not follow authored hand bore');
      check(wristGap < 1e-5 && finite, actor+' corrected hand separates from sleeve or has invalid skinning');
      asset.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();if(o.isSkinnedMesh)o.skeleton.dispose();}});
    }
    const hardware = gl.renderer.getContext(); const debug=hardware.getExtension('WEBGL_debug_renderer_info');
    return { files, failures, staticRepeat, staticTimeChanges, flicker, restored, grips, hardware:debug?hardware.getParameter(debug.UNMASKED_RENDERER_WEBGL):hardware.getParameter(hardware.RENDERER) };
  } finally { gl.dispose(); }
})()
