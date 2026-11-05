#!/usr/bin/env node
// Run from repository root: node tools/anim-sheet.mjs
// Bundles game TS before importing; outputs are deliberately gitignored.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

mkdirSync('tools/out', { recursive: true });
execFileSync('node_modules/esbuild/bin/esbuild', ['client/src/game/anim/animator.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=tools/out/animator.mjs'], { stdio: 'inherit' });
const { createAnimator, CONTACT, courtX } = await import('./out/animator.mjs');
const lanes = [320, 400, 480];
const world = { lanes, centerX: 400, npcY: 140, playerY: 540, npcHitY: 200, playerHitY: 480 };
const base = () => ({ nowMs: 0, dt: 0.005, songTime: 0, beat: 0, approachTime: 0.8, notes: [], world,
  playerX: 400, serving: false, swinging: false, pressedLane: null, pressAgeMs: Infinity,
  shakeX: 0, shakeY: 0, feedbacks: [], phantomAlpha: () => 1, hud: null, countdown: null, fade: 0 });
const note = (time, lane = 1, type = 'normal', miss = false, end = time + 0.8) => ({ time, lane, type, miss, end,
  x: 400, y: 200, startX: lane === 0 ? 380 : 420, targetX: lanes[lane], hit: false, returnPhase: false, returnProgress: 0 });
const scenarios = [
  { name: 'idle', duration: 4, notes: [], idle: true, samples: [0, .5, 1, 1.5, 2, 2.5, 3, 3.5] },
  { name: 'single', duration: 2.3, notes: [note(1.2)], samples: [.7, .9, 1.05, 1.15, 1.2, 1.25, 1.4, 1.8] },
  { name: 'dense', duration: 3, notes: Array.from({ length: 12 }, (_, i) => note(1 + i * .125, i % 2 ? 2 : 0, i % 3 === 0 ? 'echo' : 'normal')), samples: [.8, 1, 1.06, 1.125, 1.19, 1.25, 1.375, 1.5] },
  { name: 'lane-change', duration: 2.5, notes: [], shuffle: true, samples: [.95, 1.05, 1.1, 1.15, 1.2, 1.3, 1.45, 1.8] },
  { name: 'hold', duration: 3.2, notes: [note(1.2, 1, 'hold', false, 2.2)], samples: [.9, 1.15, 1.2, 1.35, 1.8, 2.2, 2.3, 2.6] },
  { name: 'miss', duration: 2.6, notes: [note(1.2, 0, 'normal', true)], samples: [1, 1.15, 1.25, 1.4, 1.5, 1.6, 1.8, 2.2] },
  { name: 'stranger', duration: 3.2, notes: [note(1.2), note(2.7, 2, 'switch')], samples: [.4, .465, .53, .7, 1.4, 1.6, 1.695, 1.9] },
];
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const clone = x => JSON.parse(JSON.stringify(x));
const outputs = [];
for (const scenario of scenarios) {
  const animator = createAnimator(), frame = base(), snapshots = [], trajectory = [];
  let prev, prevVelocity, playerX = 400, lastPressTime = -Infinity, lastLane = null;
  let maxJointSpeed = 0, maxPaddleSpeed = 0, maxPaddleAcceleration = 0, maxContactError = 0, maxArmLengthError = 0, maxPlantedDrift = 0;
  let worstSpeed, worstAcceleration, sampleIndex = 0;
  let maxLegLengthError = 0;
  const contacts = [];
  for (let k = 0; k <= scenario.duration * 200; k++) {
    const t = k / 200;
    let lane = scenario.shuffle && t >= 1 ? 2 : 1;
    for (const n of scenario.notes) if (!n.miss && t + 1e-8 >= n.time) { lane = n.lane; lastLane = lane; lastPressTime = n.time; }
    playerX += (lanes[lane] - playerX) * .15;
    frame.songTime = t; frame.nowMs = t * 1000; frame.beat = t * 2; frame.playerX = playerX;
    frame.pressedLane = lastLane; frame.pressAgeMs = (t - lastPressTime) * 1000;
    frame.notes = scenario.notes.filter(n => t + 1e-8 >= n.time - .8 && t < (n.miss ? n.time + 1 : (n.type === 'hold' ? n.end : n.time) + .4)).map(n => {
      const p = Math.max(0, Math.min(1, (t - n.time + .8) / .8));
      n.x = n.startX + (n.targetX - n.startX) * p;
      n.y = 200 + 280 * p;
      const hit = !n.miss && t + 1e-8 >= n.time;
      n.holdStartTime = n.type === 'hold' && hit ? n.time : undefined;
      n.holdProgress = hit ? (t - n.time) / (n.end - n.time) : 0;
      n.hit = n.miss ? t + 1e-8 >= n.time + .2 : hit && (n.type !== 'hold' || t + 1e-8 >= n.end);
      n.hitResult = n.hit ? n.miss ? 'miss' : 'perfect' : undefined;
      n.missTime = n.hit && n.miss ? n.time + .2 : undefined;
      n.returnPhase = n.hit && !n.miss;
      n.returnProgress = n.returnPhase ? (t - (n.type === 'hold' ? n.end : n.time)) / .4 : 0;
      return n;
    });
    const pose = scenario.idle ? animator.idle(t * 1000, .005) : animator.update(frame);
    for (const actor of ['player', 'stranger']) {
      const a = pose[actor], j = a.joints;
      for (const value of Object.values(j).flat()) assert(Number.isFinite(value));
      for (const side of ['L', 'R']) {
        maxArmLengthError = Math.max(maxArmLengthError, Math.abs(distance(j['shoulder' + side], j['elbow' + side]) - .3), Math.abs(distance(j['elbow' + side], j['wrist' + side]) - .27));
      }
      for (const side of ['L', 'R']) maxLegLengthError = Math.max(maxLegLengthError, Math.abs(distance(j['hip' + side], j['knee' + side]) - .43), Math.abs(distance(j['knee' + side], j['ankle' + side]) - .43));
      assert(Math.abs(a.paddle.up.reduce((s, v, i) => s + v * a.paddle.normal[i], 0)) < 1e-6);
      assert(Math.abs(Math.hypot(...a.paddle.normal) - 1) < 1e-6);
      assert(Math.abs(Math.hypot(...a.paddle.up) - 1) < 1e-6);
      assert(a.paddle.normal[1] * (actor === 'player' ? 1 : -1) > 0);
      if (prev) {
        for (const key of Object.keys(j)) {
          const speed = distance(j[key], prev[actor].joints[key]) / .005;
          if (speed > maxJointSpeed) { maxJointSpeed = speed; worstSpeed = { actor, joint: key, t }; }
        }
        for (const foot of ['ankleL', 'ankleR']) if (j[foot][2] < .075001 && prev[actor].joints[foot][2] < .075001) {
          maxPlantedDrift = Math.max(maxPlantedDrift, Math.abs(j[foot][0] - prev[actor].joints[foot][0]));
        }
      }
    }
    if (prev) {
      const velocity = pose.player.paddle.center.map((x, i) => (x - prev.player.paddle.center[i]) / .005);
      maxPaddleSpeed = Math.max(maxPaddleSpeed, Math.hypot(...velocity));
      if (prevVelocity) {
        const acceleration = distance(velocity, prevVelocity) / .005;
        if (acceleration > maxPaddleAcceleration) { maxPaddleAcceleration = acceleration; worstAcceleration = t; }
      }
      prevVelocity = velocity;
    }
    for (const n of scenario.notes) if (!n.miss && Math.abs(n.time - t) < 1e-7) {
      const error = distance(pose.player.paddle.center, [courtX(n.targetX), CONTACT.playerY, n.type === 'hold' ? CONTACT.holdZ : CONTACT.hitZ]);
      maxContactError = Math.max(maxContactError, error); contacts.push({ actor: 'player', t, error });
    }
    if (scenario.name === 'stranger') for (const n of scenario.notes) {
      if (Math.abs(n.time + .4 - t) < 1e-7) contacts.push({ actor: 'stranger-return', t, error: distance(pose.stranger.paddle.center, [0, CONTACT.strangerY, CONTACT.hitZ]) });
      if (Math.abs(n.time - .8 + .065 - t) < 1e-7) contacts.push({ actor: 'stranger-serve', t, error: distance(pose.stranger.paddle.center, [courtX(n.startX), CONTACT.strangerY, CONTACT.serveZ]) });
    }
    if (k % 4 === 0) trajectory.push({ t, player: [...pose.player.paddle.center], stranger: [...pose.stranger.paddle.center], pelvis: [...pose.player.joints.pelvis], left: [...pose.player.joints.ankleL], right: [...pose.player.joints.ankleR] });
    if (sampleIndex < scenario.samples.length && t + 1e-8 >= scenario.samples[sampleIndex]) {
      snapshots.push({ t, ...clone(pose) }); sampleIndex++;
    }
    prev = clone(pose);
  }
  const metrics = { maxJointSpeed, worstSpeed, maxPaddleSpeed, maxPaddleAcceleration, worstAcceleration, maxContactError, maxArmLengthError, maxPlantedDrift, maxLegLengthError, contacts };
  outputs.push({ name: scenario.name, snapshots, trajectory, metrics });
  console.log(scenario.name, JSON.stringify(metrics));
}
// Identical input streams must replay bit-for-bit, and output identity is stable.
function replay() {
  const a = createAnimator(), f = base(), hash = createHash('sha256');
  const out = a.update(f), joints = out.player.joints;
  for (let k = 1; k < 400; k++) {
    f.songTime = k / 60; f.nowMs = k / 60 * 1000; f.dt = 1 / 60; f.playerX = 400 + Math.sin(k / 30) * 80;
    assert.equal(a.update(f), out); assert.equal(out.player.joints, joints);
    hash.update(JSON.stringify(out));
  }
  return hash.digest('hex');
}
assert.equal(replay(), replay());
// A return is culled before arrival in Game.tsx. Its queued deadline must
// survive removal, including an interrupted wind-up and an intervening idle.
{
  const a = createAnimator(), f = base();
  for (let k = 0; k <= 100; k++) { f.songTime = k / 100; f.nowMs = k * 10; f.dt = .01; a.update(f); }
  const returned = note(.7); returned.hit = true; returned.returnPhase = true; returned.returnProgress = .25;
  f.notes = [returned]; a.update(f);
  f.notes = [];
  for (let k = 101; k <= 130; k++) { f.songTime = k / 100; f.nowMs = k * 10; a.update(f); }
  assert(distance(a.update(f).stranger.paddle.center, [0, CONTACT.strangerY, CONTACT.hitZ]) < .001);
  const before = clone(a.update(f).player.paddle.center);
  const idle = a.idle(100000, 0);
  assert(distance(idle.player.paddle.center, before) < 1e-8, 'menu entry jumped');
  a.idle(100016, .016);
  f.songTime = 0; f.nowMs = 100032; f.dt = .016;
  const restarted = a.update(f);
  assert(Object.values(restarted.player.joints).flat().every(Number.isFinite));
}
// Unanticipated cross-lane input preserves the existing position on its first
// frame, then meets the requested contact in 65ms rather than teleporting.
{
  const a = createAnimator(), f = base();
  for (let k = 0; k <= 200; k++) { f.songTime = k / 200; f.nowMs = k * 5; a.update(f); }
  const before = clone(a.update(f).player.paddle.center);
  f.pressedLane = 2; f.pressAgeMs = 0;
  assert(distance(a.update(f).player.paddle.center, before) < 1e-8);
  for (let k = 201; k <= 213; k++) { f.songTime = k / 200; f.nowMs = k * 5; f.pressAgeMs = (k - 200) * 5; a.update(f); }
  assert(distance(a.update(f).player.paddle.center, [.45, CONTACT.playerY, CONTACT.hitZ]) < .001);
}
const bench = createAnimator(), f = base();
f.notes = Array.from({ length: 16 }, (_, i) => note(1 + i * .125, i % 3));
const timings = [];
for (let batch = 0; batch < 30; batch++) {
  const start = performance.now();
  for (let i = 0; i < 2000; i++) {
    f.songTime += 1 / 120; f.nowMs += 1000 / 120;
    // A live 8 Hz window, including flight, contact and return work (not idle).
    const beat = Math.floor(f.songTime * 8);
    for (let j = 0; j < f.notes.length; j++) {
      const n = f.notes[j]; n.time = (beat + j - 3) / 8;
      n.hit = n.time <= f.songTime; n.returnPhase = n.hit;
      n.returnProgress = n.hit ? (f.songTime - n.time) / .4 : 0;
    }
    f.playerX = lanes[beat % 3]; f.pressedLane = beat % 3;
    f.pressAgeMs = (f.songTime - beat / 8) * 1000;
    bench.update(f);
  }
  timings.push((performance.now() - start) / 2000);
}
timings.sort((a, b) => a - b);
const timing = { medianMs: timings[15], p95BatchMs: timings[28], worstBatchMs: timings[29] };
console.log('timing', timing);
writeFileSync('tools/out/animation.json', JSON.stringify({ scenarios: outputs, timing }, null, 2));
execFileSync('python3', ['tools/anim-draw.py'], { stdio: 'inherit' });
for (const s of outputs) {
  assert(s.metrics.maxJointSpeed < 16, `${s.name}: joint velocity spike`);
  assert(s.metrics.maxPaddleAcceleration < 500, `${s.name}: paddle velocity discontinuity`);
  assert(s.metrics.maxLegLengthError < .02, `${s.name}: stretched legs`);
  for (const contact of s.metrics.contacts) assert(contact.error < .03, `${s.name}: ${contact.actor} missed contact`);
  assert(s.metrics.maxContactError < .03, `${s.name}: player contact error >3cm`);
  assert(s.metrics.maxArmLengthError < .02, `${s.name}: stretched arms`);
  assert(s.metrics.maxPlantedDrift < .001, `${s.name}: planted feet drifted`);
}
assert(timing.medianMs < .1, 'animation exceeds budget');
