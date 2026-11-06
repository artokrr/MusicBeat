// Draws one frame of the match into the 384x216 low-res canvas. Game.tsx owns
// all gameplay state; this file only turns that state into pixels.
//
// The courtyard is a small 3D scene (see engine3d.ts and courtyard.ts). Its
// static part is rendered once; each frame adds the two players, the balls and
// their shadows, then 2D overlays (sparks, judgement text, HUD) on top.
import type { NoteType } from '../../types/beatmap';
import type { HitFeedback, HitResult } from '../../types/game';
import type { RGB } from './engine3d';
import { TABLE_HALF_W, TABLE_Z } from './courtyard';
import { project } from '../scene/camera';
import { presentScene } from '../scene/backend';
import { createAnimator } from '../anim/animator';
import { incomingBall, returningBall, RETURN_FADE_SECONDS } from '../anim/flight';
import type { OpponentNote } from '../anim/flight';
import type { BallView, SceneFrame } from '../scene/types';
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
  /** Song time of the press that returned this ball. */
  hitTime?: number;
  returnStartedAt?: number;
  nextTime?: number;
  nextStartX?: number;
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
  upcomingFeeds?: readonly OpponentNote[];
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
const BALL_R = 0.055;
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
// ---------- Scene state ----------
const animator = createAnimator();
// The glitch only stirs the dark inside the hood: brighter, it dithers into two pixel "eyes".
const FLICKER_LOOK: Look = { ...STRANGER, face: [34, 32, 42] };
const initial = animator.idle(0, 0);
const sceneFrame: SceneFrame = {
  timeMs: 0, playerStrokeMs: -Infinity, playing: false,
  player: { pose: initial.player, look: PLAYER, visible: true },
  stranger: { pose: initial.stranger, look: STRANGER, visible: true },
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
    const flight = animator.returnFor(note.time);
    if (!flight) return false;
    if (frame.songTime < flight.startAt) {
      // Preserve the player's strikeFor contact: never launch from the hit line.
      incomingBall(note, frame.songTime, frame.approachTime, out.pos);
      return ballAt(out, out.pos[0], out.pos[1], out.pos[2], color);
    }
    if (Number.isFinite(flight.rallyTime) && frame.songTime >= flight.endAt) return false;
    const age = Math.max(0, frame.songTime - flight.endAt);
    if (age >= RETURN_FADE_SECONDS) return false;
    returningBall(flight, frame.songTime, out.pos);
    const alpha = age > 0.48 ? Math.max(0, 1 - (age - 0.48) / (RETURN_FADE_SECONDS - 0.48)) : 1;
    return ballAt(out, out.pos[0], out.pos[1], out.pos[2], age > 0.48 ? MISSED_COLOR : color, alpha);
  }

  if (!note.hit) {
    incomingBall(note, frame.songTime, frame.approachTime, out.pos);
    return ballAt(out, out.pos[0], out.pos[1], out.pos[2], color);
  }
  return false;
}
/** Compute once, consume synchronously. Exported for deterministic backend comparisons. */
export function describeFrame(frame: FrameState): SceneFrame {
  sceneFrame.timeMs = frame.nowMs;
  sceneFrame.playerStrokeMs = frame.pressedLane === null ? -Infinity : frame.nowMs - frame.pressAgeMs;
  sceneFrame.playing = frame.countdown === null;
  const nowWall = Date.now();
  let missRecently = false;
  for (const fb of frame.feedbacks)
    if (fb.result === 'miss' && nowWall - fb.timestamp < 320)
      missRecently = true;
  sceneFrame.flicker = missRecently || Math.floor(frame.nowMs / 110) % 61 === 0 || frame.fade > .2;
  const poses = animator.update(frame);
  sceneFrame.stranger.pose = poses.stranger;
  sceneFrame.stranger.look = sceneFrame.flicker ? FLICKER_LOOK : STRANGER;
  sceneFrame.stranger.visible = true;
  sceneFrame.player.pose = poses.player;
  sceneFrame.player.visible = true;
  sceneFrame.ballCount = 0;
  for (const note of frame.notes) {
    // Capacity growth only on a new peak note count, never an every-frame map/filter.
    if (sceneFrame.ballCount === sceneFrame.balls.length)
      sceneFrame.balls.push({ pos: [0, 0, 0], color: NOTE_COLORS.normal, alpha: 1, holdProgress: -1 });
    if (noteToBall(note, frame, sceneFrame.balls[sceneFrame.ballCount]))
      sceneFrame.ballCount++;
  }
  // The ball in the free hand becomes the feed at launch; rally strokes have none.
  const feed = animator.feedBall();
  if (feed && sceneFrame.ballCount < sceneFrame.balls.length) {
    ballAt(sceneFrame.balls[sceneFrame.ballCount++], feed[0], feed[1], feed[2], NOTE_COLORS.normal);
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
interface PendingBurst {
  worldX: number;
  worldY: number;
  color: string;
  count: number;
}
const pendingBursts: PendingBurst[] = [];
/** Spawn a burst at a gameplay-space point (same arguments the old particle system took). */
export function spawnBurst(worldX: number, worldY: number, color: string, count: number) {
  pendingBursts.push({ worldX, worldY, color, count });
}
/**
 * A pressed ball bursts where and when the paddle meets it, which can be a
 * few frames after the press and away from the hit line. Anything else (a
 * released hold) bursts at once where the game put it.
 */
function releaseBursts(frame: FrameState) {
  for (let i = pendingBursts.length - 1; i >= 0; i--) {
    const b = pendingBursts[i]!;
    let pressed: NoteView | undefined;
    for (const n of frame.notes)
      if (n.returnPhase && n.returnStartX === b.worldX && n.hitTime !== undefined && (!pressed || n.hitTime > pressed.hitTime!))
        pressed = n;
    const strike = pressed && animator.strikeFor(pressed.time);
    if (strike) {
      if (frame.songTime < strike.at)
        continue;
      burstAt(strike.pos, b.color, b.count);
    } else {
      burstAt([toX(b.worldX), toY(b.worldY) < 0 ? PLAYER_HIT_Y : toY(b.worldY), TABLE_Z + 0.24], b.color, b.count);
    }
    pendingBursts.splice(i, 1);
  }
}
function burstAt(pos: [number, number, number], color: string, count: number) {
  const p = project(pos);
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
  const backend = presentScene(ctx, description);
  if (backend === null) return;
  releaseBursts(frame);
  for (let i = 0; i < description.ballCount; i++) {
    const ball = description.balls[i];
    if (ball.holdProgress < 0)
      continue;
    const p = project(ball.pos);
    drawHoldRing(ctx, Math.round(p.sx), Math.round(p.sy), ball.holdProgress);
  }
  drawBursts(ctx, frame.nowMs, frame.dt);
  drawFeedback(ctx, frame.feedbacks);
  if (backend === 'cpu') drawSnow(ctx, frame.nowMs, frame.dt);
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
  sceneFrame.timeMs = nowMs;
  sceneFrame.playerStrokeMs = -Infinity;
  sceneFrame.playing = false;
  sceneFrame.flicker = options.flicker === true || Math.floor(nowMs / 110) % 61 === 0;
  const poses = animator.idle(nowMs, dt);
  sceneFrame.stranger.pose = poses.stranger;
  sceneFrame.stranger.look = sceneFrame.flicker ? FLICKER_LOOK : STRANGER;
  sceneFrame.stranger.visible = true;
  sceneFrame.player.visible = options.withPlayer === true;
  sceneFrame.player.pose = poses.player;
  sceneFrame.ballCount = sceneFrame.laneCount = 0;
  sceneFrame.shakeX = sceneFrame.shakeY = 0;
  const backend = presentScene(ctx, sceneFrame);
  if (backend === null) return;
  if (backend === 'cpu') drawSnow(ctx, nowMs, dt);
}
/** Read-only until the next render; use structuredClone for offline comparisons. */
export function currentSceneFrame(): Readonly<SceneFrame> { return sceneFrame; }
