// Draws one frame of the match into the 384x216 low-res canvas. Game.tsx owns
// all gameplay state; this file only turns that state into pixels.
//
// The courtyard is a small 3D scene (see engine3d.ts and courtyard.ts). Its
// static part is rendered once; each frame adds the two players, the balls and
// their shadows, then 2D overlays (sparks, judgement text, HUD) on top.
import type { NoteType } from '../../types/beatmap';
import type { HitFeedback, HitResult } from '../../types/game';
import { clamp, lerp, type RGB } from './engine3d';
import { TABLE_HALF_W, TABLE_Z } from './courtyard';
import { project } from '../scene/camera';
import { presentScene } from '../scene/backend';
import type { BallView, SceneFrame } from '../scene/types';
import type { JointPose } from '../rig/joints';
import { blendPose, poseJoints, type Pose } from '../anim/pose';
import type { Look } from './figures';
import { drawText } from './font';
import { drawHud, type HudState } from './hud';
import { LOW_H, LOW_W, PAL, WORLD_SCALE } from './stage';
/** The subset of Game.tsx's ActiveNote the renderer reads. */
export interface NoteView {
  x: number;
  y: number;
  time: number;
  type: NoteType;
  hit: boolean;
  hitResult?: HitResult;
  returnPhase: boolean;
  returnProgress: number;
  returnStartX?: number;
  returnStartY?: number;
  startX: number;
  targetX: number;
  switchControlX?: number;
  holdStartTime?: number;
  holdProgress?: number;
  missTime?: number;
}
export interface FrameWorld {
  npcHitY: number;
  playerHitY: number;
  playerY: number;
  npcY: number;
  centerX: number;
  lanes: number[];
}
export interface FrameState {
  nowMs: number;
  dt: number;
  songTime: number;
  beat: number; // song beats elapsed, for breathing
  approachTime: number;
  notes: NoteView[];
  world: FrameWorld;
  playerX: number; // world x, already smoothed
  serving: boolean;
  swinging: boolean;
  pressedLane: number | null;
  pressAgeMs: number;
  shakeX: number; // world units
  shakeY: number;
  feedbacks: HitFeedback[];
  phantomAlpha: (missAgeSec: number) => number;
  hud: HudState | null;
  countdown: number | null;
  fade: number; // 0..1 darkness over the scene (fail sequence)
}
// ---------- Gameplay space -> courtyard ----------
// Gameplay runs on an 800x600 board: lanes at x 320/400/480, the opponent hits
// at y 200 and the player at y 480. Those hit lines sit just past each end of
// the table; the lanes are 45 cm apart.
const CENTER = 400;
const NET_LINE = 340;
const METRES_PER_UNIT_X = 0.45 / 80;
const METRES_PER_UNIT_Y = 3.0 / 280;
const toX = (x: number) => (x - CENTER) * METRES_PER_UNIT_X;
const toY = (y: number) => (NET_LINE - y) * METRES_PER_UNIT_Y;
const PLAYER_HIT_Y = -1.5;
const NPC_HIT_Y = 1.5;
const PLAYER_FEET_Y = -2.3;
const NPC_FEET_Y = 2.05;
/** Where the ball bounces on the receiver's half, as a fraction of the flight. */
const BOUNCE_AT = 0.7;
const BALL_R = 0.055;
function bezier(a: number, b: number, c: number, t: number) {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}
/** Height above the table top along a rally shot: over the net, one bounce, up to the hitter. */
function flightHeight(p: number): number {
  if (p <= BOUNCE_AT)
    return bezier(0.22, 0.62, 0, p / BOUNCE_AT);
  if (p <= 1)
    return bezier(0, 0.42, 0.24, (p - BOUNCE_AT) / (1 - BOUNCE_AT));
  return 0.24 - (p - 1) * 0.8;
}
// ---------- Look ----------
const NOTE_COLORS: Record<NoteType, RGB> = {
  normal: [244, 242, 236],
  hold: [148, 196, 220],
  echo: [182, 168, 220],
  switch: [222, 132, 148],
};
const STRANGER: Look = {
  top: [40, 40, 48],
  legs: [30, 30, 38],
  shoes: [26, 26, 30],
  skin: [190, 160, 146],
  hair: [20, 20, 24],
  face: [14, 14, 20],
  paddle: [150, 46, 50],
  hood: true,
  coat: true,
};
const PLAYER: Look = {
  top: [52, 62, 82],
  legs: [36, 38, 46],
  shoes: [190, 190, 196],
  skin: [206, 170, 150],
  hair: [30, 26, 26],
  paddle: [150, 46, 50],
  hoodDown: true,
};
const READY: Pose = {
  crouch: 0.35, lean: 0.22, stance: 0.22, twist: -0.05,
  armR: { swing: 0.6, bend: 0.9, spread: 0.55 },
  armL: { swing: 0.45, bend: 0.8, spread: 0.25 },
};
const BACKSWING: Pose = { ...READY, twist: -0.45, armR: { swing: 0.45, bend: 0.5, spread: 1.0 } };
const STRIKE: Pose = { ...READY, crouch: 0.4, twist: 0.3, armR: { swing: 1.15, bend: 0.35, spread: 0.45 } };
const FOLLOW: Pose = { ...READY, crouch: 0.32, twist: 0.6, armR: { swing: 1.55, bend: 0.75, spread: -0.05 } };
const restAngles = blendPose(READY, READY, 0);
const strokeAngles = blendPose(READY, READY, 0);
/** The stroke after contact: strike, follow through, settle back to ready. */
function strokePose(ageMs: number, rest: Pose): Pose {
  const t = ageMs / 260;
  if (t < 0.3)
    return blendPose(STRIKE, FOLLOW, t / 0.3, strokeAngles);
  if (t < 1)
    return blendPose(FOLLOW, rest, (t - 0.3) / 0.7, strokeAngles);
  return rest;
}
function breathe(pose: Pose, beat: number, depth: number): Pose {
  const b = (Math.sin(beat * Math.PI) + 1) / 2;
  blendPose(pose, pose, 0, restAngles);
  restAngles.crouch = pose.crouch + b * depth;
  return restAngles;
}
// ---------- Scene state ----------
let strangerX = 0.28;
let lastServeMs = -Infinity;
let wasServing = false;
let lastReturnHitMs = -Infinity;
let lastReturnNote = -1;
const FLICKER_LOOK: Look = { ...STRANGER, face: [70, 66, 76] };
const sceneFrame: SceneFrame = {
  player: { pose: poseJoints(-.3, PLAYER_FEET_Y, Math.PI / 2 + .05, READY), look: PLAYER, visible: true },
  stranger: { pose: poseJoints(.28, NPC_FEET_Y, -Math.PI / 2, READY), look: STRANGER, visible: true },
  balls: Array.from({ length: 128 }, () => ({ pos: [0, 0, 0], color: NOTE_COLORS.normal, alpha: 1, holdProgress: -1 })),
  ballCount: 0, lanes: [{ x: -.45, pressed: false }, { x: 0, pressed: false }, { x: .45, pressed: false }], laneCount: 0,
  flicker: false, shakeX: 0, shakeY: 0,
};
const MISSED_COLOR: RGB = [150, 154, 172];
function ballAt(out: BallView, x: number, y: number, z: number, color: RGB, alpha = 1, holdProgress = -1): boolean {
  out.pos[0] = x;
  out.pos[1] = y;
  out.pos[2] = z;
  out.color = color;
  out.alpha = alpha;
  out.holdProgress = holdProgress;
  return true;
}
function noteToBall(note: NoteView, frame: FrameState, out: BallView): boolean {
  const color = NOTE_COLORS[note.type];
  const isMissed = note.hit && note.hitResult === 'miss';
  const isHeld = note.type === 'hold' && note.holdStartTime !== undefined && !note.hit;
  if (isMissed) {
    const age = note.missTime !== undefined ? Math.max(0, frame.songTime - note.missTime) : 0;
    const alpha = frame.phantomAlpha(age);
    if (alpha <= 0)
      return false;
    // Past the player and down to the snow, with a couple of bounces.
    let z = TABLE_Z + 0.1 - 4.9 * age * age;
    if (z < BALL_R) {
      const t0 = Math.sqrt((TABLE_Z + 0.1) / 4.9);
      const t = (age - t0) % 0.45;
      z = BALL_R + Math.max(0, 1.1 * t - 4.9 * t * t) * (age - t0 < 0.45 ? 1 : 0.35);
    }
    return ballAt(out, toX(note.x), PLAYER_HIT_Y - .3 - age * 1.6, z, MISSED_COLOR, alpha);
  }
  if (isHeld) {
    return ballAt(out, toX(note.x), PLAYER_HIT_Y, TABLE_Z + .24, color, 1, note.holdProgress ?? 0);
  }
  if (note.returnPhase) {
    const p = note.returnProgress;
    const fromX = toX(note.returnStartX ?? note.targetX);
    return ballAt(out, lerp(fromX, toX(CENTER), p), lerp(PLAYER_HIT_Y, NPC_HIT_Y, p), TABLE_Z + BALL_R + flightHeight(p), color);
  }
  if (!note.hit) {
    const p = Math.max(0, 1 - (note.time - frame.songTime) / frame.approachTime);
    const x = note.type === 'switch' && note.switchControlX !== undefined
      ? bezier(note.startX, note.switchControlX, note.targetX, Math.min(p, 1))
      : note.startX + (note.targetX - note.startX) * Math.min(p, 1);
    return ballAt(out, toX(x), lerp(NPC_HIT_Y, PLAYER_HIT_Y, p), TABLE_Z + BALL_R + flightHeight(p), color);
  }
  return false;
}
/** Player pose: ready, a backswing as a ball closes in on their lane, the stroke after a press. */
function playerAngles(frame: FrameState): Pose {
  const rest = breathe(READY, frame.beat, 0.03);
  if (frame.pressAgeMs < 260)
    return strokePose(frame.pressAgeMs, rest);
  let closest = 0;
  for (const note of frame.notes) {
    if (note.hit || note.returnPhase)
      continue;
    const p = 1 - (note.time - frame.songTime) / frame.approachTime;
    if (p < 1.05)
      closest = Math.max(closest, p);
  }
  const wind = clamp((closest - 0.75) / 0.2, 0, 1);
  return wind > 0 ? blendPose(rest, BACKSWING, wind * wind, strokeAngles) : rest;
}
/** The stranger: serves each ball, hits back each return, otherwise waits. */
function strangerAngles(frame: FrameState, nowMs: number): Pose {
  if (frame.serving && !wasServing)
    lastServeMs = nowMs;
  wasServing = frame.serving;
  const rest = breathe(READY, frame.beat * 0.5, 0.02);
  let returning: NoteView | undefined;
  for (const note of frame.notes)
    if (note.returnPhase && note.returnProgress > .85) {
      returning = note;
      break;
    }
  if (returning && returning.time !== lastReturnNote) {
    lastReturnNote = returning.time;
    lastReturnHitMs = nowMs;
  }
  const age = Math.min(nowMs - lastServeMs, nowMs - lastReturnHitMs);
  return strokePose(age, rest);
}
function strangerTarget(frame: FrameState): number {
  // Step towards the newest ball's starting point (the one being served).
  let newest: NoteView | null = null;
  for (const note of frame.notes) {
    if (note.hit || note.returnPhase)
      continue;
    if (!newest || note.time > newest.time)
      newest = note;
  }
  return toX(newest ? newest.startX : CENTER) + 0.28;
}
/** Replaceable animation entry points. Both backends receive these same JointPoses. */
export function playerPose(frame: FrameState, x: number): JointPose {
  return poseJoints(x, PLAYER_FEET_Y, Math.PI / 2 + .05, playerAngles(frame), undefined, sceneFrame.player.pose);
}
export function strangerPose(frame: FrameState, x: number, flicker: boolean): JointPose {
  return poseJoints(x + (flicker ? .05 : 0), NPC_FEET_Y, -Math.PI / 2, strangerAngles(frame, frame.nowMs), undefined, sceneFrame.stranger.pose);
}
/** Compute once, consume synchronously. Exported for deterministic backend comparisons. */
export function describeFrame(frame: FrameState): SceneFrame {
  const nowWall = Date.now();
  let missRecently = false;
  for (const fb of frame.feedbacks)
    if (fb.result === 'miss' && nowWall - fb.timestamp < 320)
      missRecently = true;
  sceneFrame.flicker = missRecently || Math.floor(frame.nowMs / 110) % 61 === 0 || frame.fade > .2;
  strangerX += (strangerTarget(frame) - strangerX) * Math.min(1, frame.dt * 6);
  sceneFrame.stranger.pose = strangerPose(frame, strangerX, sceneFrame.flicker);
  sceneFrame.stranger.look = sceneFrame.flicker ? FLICKER_LOOK : STRANGER;
  sceneFrame.stranger.visible = true;
  sceneFrame.player.pose = playerPose(frame, toX(frame.playerX) - .3);
  sceneFrame.player.visible = true;
  sceneFrame.ballCount = 0;
  for (const note of frame.notes) {
    // Capacity growth only on a new peak note count, never an every-frame map/filter.
    if (sceneFrame.ballCount === sceneFrame.balls.length)
      sceneFrame.balls.push({ pos: [0, 0, 0], color: NOTE_COLORS.normal, alpha: 1, holdProgress: -1 });
    if (noteToBall(note, frame, sceneFrame.balls[sceneFrame.ballCount]))
      sceneFrame.ballCount++;
  }
  sceneFrame.laneCount = frame.world.lanes.length;
  for (let i = 0; i < sceneFrame.laneCount; i++) {
    sceneFrame.lanes[i] ??= { x: 0, pressed: false };
    sceneFrame.lanes[i].x = toX(frame.world.lanes[i]);
    sceneFrame.lanes[i].pressed = frame.pressedLane === i && frame.pressAgeMs < 140;
  }
  sceneFrame.shakeX = Math.round(frame.shakeX * WORLD_SCALE);
  sceneFrame.shakeY = Math.round(frame.shakeY * WORLD_SCALE);
  return sceneFrame;
}
// ---------- 2D overlays ----------
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
}
interface Flash {
  x: number;
  y: number;
  bornMs: number;
  color: string;
}
const sparks: Spark[] = [];
const flashes: Flash[] = [];
/** Spawn a burst at a gameplay-space point (same arguments the old particle system took). */
export function spawnBurst(worldX: number, worldY: number, color: string, count: number) {
  const p = project([toX(worldX), toY(worldY) < 0 ? PLAYER_HIT_Y : toY(worldY), TABLE_Z + 0.24]);
  const x = Math.round(p.sx);
  const y = Math.round(p.sy);
  flashes.push({ x, y, bornMs: performance.now(), color });
  const n = Math.max(3, Math.round(count * 0.35));
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 14 + Math.random() * 26;
    sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 10, life: 1, decay: 2.2 + Math.random() * 1.6, color: i % 2 ? color : PAL.ball });
  }
}
function drawBursts(ctx: CanvasRenderingContext2D, nowMs: number, dt: number) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]!;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 60 * dt;
    s.life -= s.decay * dt;
    if (s.life <= 0) {
      sparks.splice(i, 1);
      continue;
    }
    if (s.life < 0.3 && Math.floor(nowMs / 40) % 2 === 0)
      continue;
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]!;
    const age = nowMs - f.bornMs;
    if (age > 160) {
      flashes.splice(i, 1);
      continue;
    }
    const arm = age < 60 ? 3 : 1;
    ctx.fillStyle = PAL.ball;
    ctx.fillRect(f.x - arm, f.y, arm * 2 + 1, 1);
    ctx.fillRect(f.x, f.y - arm, 1, arm * 2 + 1);
  }
}
function drawHoldRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, progress: number) {
  const radius = 7;
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    ctx.fillStyle = i / steps < progress ? PAL.hold : PAL.hudLine;
    ctx.fillRect(Math.round(cx + Math.cos(a) * radius), Math.round(cy + Math.sin(a) * radius * 0.8), 1, 1);
  }
}
const FEEDBACK_LABEL: Record<HitResult, string> = { perfect: 'perfect', good: 'good', ok: 'ok', miss: 'miss' };
const FEEDBACK_COLOR: Record<HitResult, string> = { perfect: PAL.perfect, good: PAL.good, ok: PAL.ok, miss: PAL.miss };
function drawFeedback(ctx: CanvasRenderingContext2D, feedbacks: HitFeedback[]) {
  const now = Date.now();
  // Only the latest judgement: lanes are closer together than the words are wide.
  let latest: HitFeedback | undefined;
  for (const fb of feedbacks) {
    if (!latest || fb.timestamp >= latest.timestamp)
      latest = fb;
  }
  if (!latest)
    return;
  const age = now - latest.timestamp;
  if (age > 500)
    return;
  if (age > 340 && Math.floor(age / 45) % 2 === 1)
    return;
  // Beside the near end of the table, clear of the lanes.
  const p = project([TABLE_HALF_W + 0.25, PLAYER_HIT_Y + 0.2, TABLE_Z]);
  drawText(ctx, FEEDBACK_LABEL[latest.result], Math.round(p.sx), Math.round(p.sy) - 4 - Math.floor(age / 55), FEEDBACK_COLOR[latest.result], { align: 'left', outline: PAL.void });
}
// Falling snow, in screen space.
interface Flake {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
}
const flakes: Flake[] = Array.from({ length: 110 }, (_, i) => ({
  x: Math.random() * LOW_W,
  y: Math.random() * LOW_H,
  speed: i % 9 === 0 ? 26 + Math.random() * 8 : 8 + Math.random() * 9,
  size: i % 9 === 0 ? 2 : 1,
  phase: Math.random() * Math.PI * 2,
}));
function drawSnow(ctx: CanvasRenderingContext2D, nowMs: number, dt: number) {
  const t = nowMs / 1000;
  for (const flake of flakes) {
    flake.y += flake.speed * dt;
    flake.x += (-3 + Math.sin(t * 0.9 + flake.phase) * 5) * dt;
    if (flake.y > LOW_H + 2) {
      flake.y = -2;
      flake.x = Math.random() * LOW_W;
    }
    if (flake.x < -2)
      flake.x += LOW_W + 4;
    if (flake.x > LOW_W + 2)
      flake.x -= LOW_W + 4;
    ctx.fillStyle = flake.size > 1 ? '#e2e4ee' : '#a9adc2';
    ctx.fillRect(Math.round(flake.x), Math.round(flake.y), flake.size, flake.size);
  }
}
function drawCountdown(ctx: CanvasRenderingContext2D, value: number) {
  ctx.fillStyle = 'rgba(10, 10, 16, 0.4)';
  ctx.fillRect(0, 0, LOW_W, LOW_H);
  drawText(ctx, value.toString(), LOW_W / 2, 84, PAL.text, { scale: 3, align: 'center', outline: PAL.void });
}
// ---------- Frame ----------
export function renderFrame(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const description = describeFrame(frame);
  presentScene(ctx, description);
  for (let i = 0; i < description.ballCount; i++) {
    const ball = description.balls[i];
    if (ball.holdProgress < 0)
      continue;
    const p = project(ball.pos);
    drawHoldRing(ctx, Math.round(p.sx), Math.round(p.sy), ball.holdProgress);
  }
  drawBursts(ctx, frame.nowMs, frame.dt);
  drawFeedback(ctx, frame.feedbacks);
  drawSnow(ctx, frame.nowMs, frame.dt);
  if (frame.fade > 0) {
    // Darken in hard steps rather than a smooth fade.
    ctx.fillStyle = `rgba(10, 10, 16, ${Math.floor(Math.min(1, frame.fade) * 5) / 5})`;
    ctx.fillRect(0, 0, LOW_W, LOW_H);
  }
  if (frame.countdown !== null && frame.countdown > 0)
    drawCountdown(ctx, frame.countdown);
  if (frame.hud)
    drawHud(ctx, frame.hud);
}
/** The yard with the stranger waiting, for menus. */
export function renderIdleScene(ctx: CanvasRenderingContext2D, nowMs: number, dt: number, options: {
  withPlayer?: boolean;
  flicker?: boolean;
} = {}) {
  const beat = nowMs / 1800;
  sceneFrame.flicker = options.flicker === true || Math.floor(nowMs / 110) % 61 === 0;
  sceneFrame.stranger.pose = poseJoints(.28 + (sceneFrame.flicker ? .05 : 0), NPC_FEET_Y, -Math.PI / 2, breathe(READY, beat, .02), undefined, sceneFrame.stranger.pose);
  sceneFrame.stranger.look = sceneFrame.flicker ? FLICKER_LOOK : STRANGER;
  sceneFrame.stranger.visible = true;
  sceneFrame.player.visible = options.withPlayer === true;
  if (sceneFrame.player.visible)
    sceneFrame.player.pose = poseJoints(-.3, PLAYER_FEET_Y, Math.PI / 2 + .05, breathe(READY, beat, .03), undefined, sceneFrame.player.pose);
  sceneFrame.ballCount = sceneFrame.laneCount = 0;
  sceneFrame.shakeX = sceneFrame.shakeY = 0;
  presentScene(ctx, sceneFrame);
  drawSnow(ctx, nowMs, dt);
}
/** Read-only until the next render; use structuredClone for offline comparisons. */
export function currentSceneFrame(): Readonly<SceneFrame> { return sceneFrame; }
