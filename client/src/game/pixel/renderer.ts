// Draws one frame of the match into the 384x216 low-res canvas. Game.tsx owns
// all gameplay state; this file only turns that state into pixels.
//
// The courtyard is a small 3D scene (see engine3d.ts and courtyard.ts). Its
// static part is rendered once; each frame adds the two players, the balls and
// their shadows, then 2D overlays (sparks, judgement text, HUD) on top.

import type { NoteType } from '../../types/beatmap';
import type { HitFeedback, HitResult } from '../../types/game';
import { clamp, lerp, type RGB, type Renderer3D, type Vec3 } from './engine3d';
import { createCourtyard, paintCourtyard, TABLE_HALF_L, TABLE_HALF_W, TABLE_Z } from './courtyard';
import { blendPose, drawFigure, type Look, type Pose, type ShadowSink } from './figures';
import { drawText } from './font';
import { drawHud, type HudState } from './hud';
import { LOW_H, LOW_W, PAL, WORLD_SCALE, makeCanvas } from './stage';

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
  if (p <= BOUNCE_AT) return bezier(0.22, 0.62, 0, p / BOUNCE_AT);
  if (p <= 1) return bezier(0, 0.42, 0.24, (p - BOUNCE_AT) / (1 - BOUNCE_AT));
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

/** The stroke after contact: strike, follow through, settle back to ready. */
function strokePose(ageMs: number, rest: Pose): Pose {
  const t = ageMs / 260;
  if (t < 0.3) return blendPose(STRIKE, FOLLOW, t / 0.3);
  if (t < 1) return blendPose(FOLLOW, rest, (t - 0.3) / 0.7);
  return rest;
}

function breathe(pose: Pose, beat: number, depth: number): Pose {
  const b = (Math.sin(beat * Math.PI) + 1) / 2;
  return { ...pose, crouch: pose.crouch + b * depth };
}

// ---------- Scene state ----------

let scene: Renderer3D | null = null;
let frameCanvas: HTMLCanvasElement | null = null;
let frameCtx: CanvasRenderingContext2D | null = null;
let strangerX = 0.28;
let lastServeMs = -Infinity;
let wasServing = false;
let lastReturnHitMs = -Infinity;
let lastReturnNote = -1;

function courtyard(): Renderer3D {
  if (!scene) {
    scene = createCourtyard();
    paintCourtyard(scene);
    [frameCanvas, frameCtx] = makeCanvas(LOW_W, LOW_H);
  }
  return scene;
}

function shadowSink(R: Renderer3D): ShadowSink {
  return (a, b, radius) => {
    const step = Math.min(0.1, radius * 0.7);
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      R.castShadow([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)], radius, 2);
    }
  };
}

function drawStranger(R: Renderer3D, x: number, pose: Pose, flicker: boolean) {
  const look = flicker ? { ...STRANGER, face: [70, 66, 76] as RGB } : STRANGER;
  const jitter = flicker ? 0.05 : 0;
  // Facing the camera, his right hand is on the screen's left: stand to the right of the ball.
  drawFigure(R, x + jitter, NPC_FEET_Y, -Math.PI / 2, pose, look, shadowSink(R));
}

function drawPlayerFigure(R: Renderer3D, x: number, pose: Pose) {
  drawFigure(R, x, PLAYER_FEET_Y, Math.PI / 2 + 0.05, pose, PLAYER, shadowSink(R));
}

/** A ball, its contact shadow on whatever is under it, and an optional faded trail. */
function drawBall(R: Renderer3D, p: Vec3, color: RGB, alpha = 1) {
  const overTable = Math.abs(p[0]) <= TABLE_HALF_W && Math.abs(p[1]) <= TABLE_HALF_L && p[2] >= TABLE_Z;
  R.dropShadow(p[0], p[1], overTable ? TABLE_Z : 0, BALL_R * 1.1);
  R.sphere(p, BALL_R, color, 'gloss', alpha);
}

/** Lane marks painted on the near end of the table; the pressed one lights up. */
function drawLaneMarks(R: Renderer3D, frame: FrameState) {
  const y = -TABLE_HALF_L + 0.16;
  frame.world.lanes.forEach((laneX, lane) => {
    const x = toX(laneX);
    const pressed = frame.pressedLane === lane && frame.pressAgeMs < 140;
    const color: RGB = pressed ? [236, 150, 166] : [178, 204, 198];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 20) {
      R.sphere([x + Math.cos(a) * 0.13, y + Math.sin(a) * 0.09, TABLE_Z + 0.002], 0.011, color, 'emissive');
    }
    if (pressed) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) R.sphere([x + Math.cos(a) * 0.07, y + Math.sin(a) * 0.045, TABLE_Z + 0.002], 0.03, color, 'emissive');
    }
  });
}

interface BallView {
  pos: Vec3;
  color: RGB;
  alpha: number;
  held?: { progress: number };
}

function noteToBall(note: NoteView, frame: FrameState): BallView | null {
  const color = NOTE_COLORS[note.type];
  const isMissed = note.hit && note.hitResult === 'miss';
  const isHeld = note.type === 'hold' && note.holdStartTime !== undefined && !note.hit;

  if (isMissed) {
    const age = note.missTime !== undefined ? Math.max(0, frame.songTime - note.missTime) : 0;
    const alpha = frame.phantomAlpha(age);
    if (alpha <= 0) return null;
    // Past the player and down to the snow, with a couple of bounces.
    let z = TABLE_Z + 0.1 - 4.9 * age * age;
    if (z < BALL_R) {
      const t0 = Math.sqrt((TABLE_Z + 0.1) / 4.9);
      const t = (age - t0) % 0.45;
      z = BALL_R + Math.max(0, 1.1 * t - 4.9 * t * t) * (age - t0 < 0.45 ? 1 : 0.35);
    }
    return { pos: [toX(note.x), PLAYER_HIT_Y - 0.3 - age * 1.6, z], color: [150, 154, 172], alpha };
  }
  if (isHeld) {
    return { pos: [toX(note.x), PLAYER_HIT_Y, TABLE_Z + 0.24], color, alpha: 1, held: { progress: note.holdProgress ?? 0 } };
  }
  if (note.returnPhase) {
    const p = note.returnProgress;
    const fromX = toX(note.returnStartX ?? note.targetX);
    return { pos: [lerp(fromX, toX(CENTER), p), lerp(PLAYER_HIT_Y, NPC_HIT_Y, p), TABLE_Z + BALL_R + flightHeight(p)], color, alpha: 1 };
  }
  if (!note.hit) {
    const p = Math.max(0, 1 - (note.time - frame.songTime) / frame.approachTime);
    const x = note.type === 'switch' && note.switchControlX !== undefined
      ? bezier(note.startX, note.switchControlX, note.targetX, Math.min(p, 1))
      : note.startX + (note.targetX - note.startX) * Math.min(p, 1);
    return { pos: [toX(x), lerp(NPC_HIT_Y, PLAYER_HIT_Y, p), TABLE_Z + BALL_R + flightHeight(p)], color, alpha: 1 };
  }
  return null;
}

/** Player pose: ready, a backswing as a ball closes in on their lane, the stroke after a press. */
function playerPose(frame: FrameState): Pose {
  const rest = breathe(READY, frame.beat, 0.03);
  if (frame.pressAgeMs < 260) return strokePose(frame.pressAgeMs, rest);
  let closest = 0;
  for (const note of frame.notes) {
    if (note.hit || note.returnPhase) continue;
    const p = 1 - (note.time - frame.songTime) / frame.approachTime;
    if (p < 1.05) closest = Math.max(closest, p);
  }
  const wind = clamp((closest - 0.75) / 0.2, 0, 1);
  return wind > 0 ? blendPose(rest, BACKSWING, wind * wind) : rest;
}

/** The stranger: serves each ball, hits back each return, otherwise waits. */
function strangerPose(frame: FrameState, nowMs: number): Pose {
  if (frame.serving && !wasServing) lastServeMs = nowMs;
  wasServing = frame.serving;
  const rest = breathe(READY, frame.beat * 0.5, 0.02);
  const returning = frame.notes.find((n) => n.returnPhase && n.returnProgress > 0.85);
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
    if (note.hit || note.returnPhase) continue;
    if (!newest || note.time > newest.time) newest = note;
  }
  return toX(newest ? newest.startX : CENTER) + 0.28;
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
  const R = courtyard();
  const p = R.project([toX(worldX), toY(worldY) < 0 ? PLAYER_HIT_Y : toY(worldY), TABLE_Z + 0.24]);
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
    if (s.life < 0.3 && Math.floor(nowMs / 40) % 2 === 0) continue;
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

function drawFeedback(ctx: CanvasRenderingContext2D, R: Renderer3D, feedbacks: HitFeedback[]) {
  const now = Date.now();
  // Only the latest judgement: lanes are closer together than the words are wide.
  let latest: HitFeedback | undefined;
  for (const fb of feedbacks) {
    if (!latest || fb.timestamp >= latest.timestamp) latest = fb;
  }
  if (!latest) return;
  const age = now - latest.timestamp;
  if (age > 500) return;
  if (age > 340 && Math.floor(age / 45) % 2 === 1) return;
  // Beside the near end of the table, clear of the lanes.
  const p = R.project([TABLE_HALF_W + 0.25, PLAYER_HIT_Y + 0.2, TABLE_Z]);
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
    if (flake.x < -2) flake.x += LOW_W + 4;
    if (flake.x > LOW_W + 2) flake.x -= LOW_W + 4;
    ctx.fillStyle = flake.size > 1 ? '#e2e4ee' : '#a9adc2';
    ctx.fillRect(Math.round(flake.x), Math.round(flake.y), flake.size, flake.size);
  }
}

function drawCountdown(ctx: CanvasRenderingContext2D, value: number) {
  ctx.fillStyle = 'rgba(10, 10, 16, 0.4)';
  ctx.fillRect(0, 0, LOW_W, LOW_H);
  drawText(ctx, value.toString(), LOW_W / 2, 84, PAL.text, { scale: 3, align: 'center', outline: PAL.void });
}

/** Copy the 3D picture to the canvas, offset by any shake, over an unshaken copy so edges never show. */
function present(ctx: CanvasRenderingContext2D, R: Renderer3D, shakeX: number, shakeY: number) {
  frameCtx!.putImageData(R.image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (shakeX || shakeY) ctx.drawImage(frameCanvas!, 0, 0);
  ctx.drawImage(frameCanvas!, shakeX, shakeY);
}

// ---------- Frame ----------

export function renderFrame(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const R = courtyard();
  R.restore();

  const nowWall = Date.now();
  const missRecently = frame.feedbacks.some((fb) => fb.result === 'miss' && nowWall - fb.timestamp < 320);
  const randomFlicker = Math.floor(frame.nowMs / 110) % 61 === 0;

  strangerX += (strangerTarget(frame) - strangerX) * Math.min(1, frame.dt * 6);
  drawStranger(R, strangerX, strangerPose(frame, frame.nowMs), missRecently || randomFlicker || frame.fade > 0.2);
  drawLaneMarks(R, frame);
  const balls = frame.notes.map((note) => noteToBall(note, frame)).filter((b): b is BallView => b !== null);
  for (const ball of balls) drawBall(R, ball.pos, ball.color, ball.alpha);
  // The player's right hand sits on the lane, so the body stands a little to the left of it.
  drawPlayerFigure(R, toX(frame.playerX) - 0.3, playerPose(frame));
  R.applyShadows();
  R.edges();

  present(ctx, R, Math.round(frame.shakeX * WORLD_SCALE), Math.round(frame.shakeY * WORLD_SCALE));

  for (const ball of balls) {
    if (!ball.held) continue;
    const p = R.project(ball.pos);
    drawHoldRing(ctx, Math.round(p.sx), Math.round(p.sy), ball.held.progress);
  }
  drawBursts(ctx, frame.nowMs, frame.dt);
  drawFeedback(ctx, R, frame.feedbacks);
  drawSnow(ctx, frame.nowMs, frame.dt);

  if (frame.fade > 0) {
    // Darken in hard steps rather than a smooth fade.
    ctx.fillStyle = `rgba(10, 10, 16, ${Math.floor(Math.min(1, frame.fade) * 5) / 5})`;
    ctx.fillRect(0, 0, LOW_W, LOW_H);
  }
  if (frame.countdown !== null && frame.countdown > 0) drawCountdown(ctx, frame.countdown);
  if (frame.hud) drawHud(ctx, frame.hud);
}

/** The yard with the stranger waiting, for menus. */
export function renderIdleScene(ctx: CanvasRenderingContext2D, nowMs: number, dt: number, options: { withPlayer?: boolean; flicker?: boolean } = {}) {
  const R = courtyard();
  R.restore();
  const beat = nowMs / 1800;
  drawStranger(R, 0.28, breathe(READY, beat, 0.02), options.flicker === true || Math.floor(nowMs / 110) % 61 === 0);
  if (options.withPlayer) drawPlayerFigure(R, -0.3, breathe(READY, beat, 0.03));
  R.applyShadows();
  R.edges();
  present(ctx, R, 0, 0);
  drawSnow(ctx, nowMs, dt);
}
