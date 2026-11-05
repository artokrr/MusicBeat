// Stateful, renderer-independent table-tennis animation. See README.md for the
// borrowed-output lifetime, contact timing and FrameState visibility limits.
import { JOINT_NAMES } from '../rig/joints';
import { clamp, set, smooth, solveTwoBone, Spring, Trajectory } from './motion';

import type { JointPose, JointName, Vec3 } from '../rig/joints';
import type { FrameState, NoteView } from '../pixel/renderer';

// Keep these in step with pixel/renderer.ts's gameplay-to-courtyard mapping.
export const CONTACT = { playerY: -1.5, strangerY: 1.5, hitZ: 1.055, serveZ: 1.035, holdZ: 1.0 } as const;
export const courtX = (x: number) => (x - 400) * (0.45 / 80);
const RETURN_SECONDS = 0.4;

function makePose(): JointPose {
  const joints = {} as Record<JointName, Vec3>;
  for (const name of JOINT_NAMES) joints[name] = [0, 0, 0];
  return { joints, forward: [0, 1, 0], chestForward: [0, 1, 0],
    paddle: { center: [0, 0, 0], up: [0, 0, 1], normal: [0, 1, 0] },
    cloth: { swingForward: 0, swingSide: 0 } };
}

class Foot {
  x = 0; from = 0; goal = 0; phase = 1; lift = 0;
  step(x: number) { this.from = this.x; this.goal = x; this.phase = 0; }
  update(dt: number, duration: number) {
    this.phase = Math.min(1, this.phase + dt / duration);
    const t = this.phase;
    // Zero vertical and horizontal speed at takeoff/landing: no heel popping.
    const ease = t * t * t * (10 + t * (-15 + 6 * t));
    this.x = this.from + (this.goal - this.from) * ease;
    this.lift = 0.055 * Math.sin(Math.PI * t) ** 2;
  }
}

type StrokeMode = 'ready' | 'wind' | 'contact' | 'follow' | 'recover' | 'hold' | 'miss';

class Body {
  readonly pose = makePose();
  readonly x: Spring;
  readonly twist = new Spring();
  readonly load = new Spring();
  readonly slump = new Spring();
  readonly gazeX = new Spring();
  readonly gazeZ = new Spring(1.05);
  readonly clothX = new Spring();
  readonly clothY = new Spring();
  readonly left = new Foot();
  readonly right = new Foot();
  readonly hand = new Trajectory();
  readonly balance = new Trajectory();
  mode: StrokeMode = 'ready';
  eventTime = -Infinity;
  eventX = 0;
  eventZ: number = CONTACT.hitZ;
  contactAt = -Infinity;
  strokeSide = 1;
  held = false;
  tossUntil = -Infinity;
  lastBodyY: number;
  ambientTime = 0;
  readyX = 0; readyY = 0; readyZ = 1.08;
  constructor(readonly facing: 1 | -1, readonly feetY: number, x: number) {
    this.x = new Spring(x); this.lastBodyY = feetY;
    this.left.x = this.left.from = this.left.goal = x - facing * 0.23;
    this.right.x = this.right.from = this.right.goal = x + facing * 0.23;
    this.readyX = x + facing * 0.34; this.readyY = feetY + facing * 0.48;
    this.hand.reset(this.readyX, this.readyY, this.readyZ);
    this.balance.reset(x - facing * 0.28, feetY + facing * 0.36, 1.14);
  }
  get hitY() { return this.facing === 1 ? CONTACT.playerY : CONTACT.strangerY; }
  prepare(time: number, at: number, x: number, z: number, id: number, toss = false) {
    this.eventTime = id; this.contactAt = at; this.eventX = x; this.eventZ = z;
    this.strokeSide = (x - this.x.value) * this.facing < 0.04 ? -1 : 1;
    if (toss) this.tossUntil = at + 0.09;
    const lead = at - time;
    // Reserve the full wind-up for a ball already on this stance's lane.
    // An outside-lane ball gets a direct, continuous preparation while the
    // lower body shuffles into range, rather than winding up at an empty lane.
    const onLane = Math.abs(x - (this.x.value + this.facing * 0.3)) < 0.20;
    if (lead > 0.19 && (this.facing === -1 || onLane)) {
      this.mode = 'wind';
      this.hand.plan(time, lead - 0.13, x + this.facing * this.strokeSide * 0.1,
        this.hitY - this.facing * 0.26, z - 0.05);
    } else this.contact(time);
  }
  contact(time: number) {
    this.mode = 'contact';
    const soft = this.eventZ === CONTACT.holdZ;
    this.hand.plan(time, this.contactAt - time, this.eventX, this.hitY, this.eventZ,
      soft ? 0 : -this.facing * this.strokeSide * 0.24, soft ? 0 : this.facing * 0.85, soft ? 0 : 0.12);
  }
  follow(time: number, push = false) {
    this.mode = 'follow';
    this.hand.plan(time, push ? 0.12 : 0.095, this.eventX - this.facing * this.strokeSide * (push ? 0.025 : 0.09),
      this.hitY + this.facing * (push ? 0.09 : 0.095), this.eventZ + (push ? 0.02 : 0.065));
  }
  recover(time: number) {
    this.mode = 'recover';
    this.hand.plan(time, 0.28, this.readyX, this.readyY, this.readyZ);
  }
  advance(time: number) {
    // Preserve the exact segment boundary even if a frame straddles contact.
    for (let i = 0; i < 4 && time >= this.hand.end; i++) {
      const end = this.hand.end;
      this.hand.sample(end);
      if (this.mode === 'wind') this.contact(end);
      else if (this.mode === 'contact') {
        if (this.held) { this.mode = 'hold'; set(this.hand.velocity, 0, 0, 0); break; }
        this.follow(end);
      } else if (this.mode === 'follow' || this.mode === 'miss') this.recover(end);
      else if (this.mode === 'recover') { this.mode = 'ready'; break; }
      else break;
    }
    this.hand.sample(time);
  }
  idle(time: number) {
    this.held = false;
    this.recover(time);
    const b = this.balance.position;
    this.balance.plan(time, 0.15, b[0], b[1], b[2]);
    this.eventTime = this.contactAt = this.tossUntil = -Infinity;
  }
  render(time: number, dt: number, targetX: number, gazeX: number, gazeZ: number, idle: boolean) {
    const f = this.facing, npc = f === -1, j = this.pose.joints;
    this.ambientTime += dt;
    const breath = Math.sin(this.ambientTime * (npc ? 1.15 : 1.65)) * (npc ? 0.003 : 0.006);
    this.x.update(targetX + (idle ? Math.sin(this.ambientTime * 0.47) * (npc ? 0.002 : 0.012) : 0), npc ? 11 : 14, dt);
    const vx = this.x.velocity;
    const stroke = this.mode === 'contact' || this.mode === 'follow';
    const turn = this.mode === 'wind' ? -0.25 : stroke ? 0.23 : this.mode === 'hold' ? 0.08 : 0;
    this.twist.update(turn * this.strokeSide + clamp(-vx * f * 0.06, -0.1, 0.1), 20, dt);
    this.load.update(stroke ? 0.018 : this.mode === 'wind' ? -0.012 : 0, 16, dt);
    this.slump.update(this.mode === 'miss' ? 1 : 0, 9, dt);
    this.readyX = this.x.value + f * 0.34;
    this.readyY = this.feetY + f * 0.48;
    this.readyZ = 1.08 + breath;
    if (this.mode === 'ready') {
      // Retarget the ready stance slowly; strokes are never low-pass filtered
      // after IK, which would make their paddles arrive late.
      this.hand.plan(time, 0.12, this.readyX, this.readyY, this.readyZ);
    }
    this.left.update(dt, npc ? 0.19 : 0.155); this.right.update(dt, npc ? 0.19 : 0.155);
    if (this.left.phase === 1 && this.right.phase === 1) {
      const desired = this.x.value + clamp(vx * 0.10, -0.13, 0.13);
      const l = desired - f * 0.23, r = desired + f * 0.23;
      const le = Math.abs(l - this.left.x), re = Math.abs(r - this.right.x);
      // Only one foot lifts at a time. The support foot stays exactly planted.
      if (Math.max(le, re) > 0.10) {
        const leading = vx * f > 0 ? this.right : this.left;
        const foot = Math.abs(le - re) < 0.04 ? leading : le > re ? this.left : this.right;
        foot.step(foot === this.left ? l : r);
      }
    }
    const pelvisZ = (npc ? 0.87 : 0.79) + breath - this.load.value - this.slump.value * 0.025;
    const pelvisY = this.feetY + f * (0.065 + this.load.value);
    set(j.pelvis, this.x.value, pelvisY, pelvisZ);
    const hipTurn = -this.twist.value * 0.25;
    set(this.pose.forward, Math.sin(hipTurn) * f, Math.cos(hipTurn) * f, 0);
    const turnX = Math.sin(this.twist.value) * f, turnY = Math.cos(this.twist.value) * f;
    set(this.pose.chestForward, turnX, turnY, 0);
    set(j.hipL, this.x.value - f * 0.09, pelvisY, pelvisZ);
    set(j.hipR, this.x.value + f * 0.09, pelvisY, pelvisZ);
    set(j.ankleL, this.left.x, this.feetY + f * 0.065, 0.075 + this.left.lift);
    set(j.ankleR, this.right.x, this.feetY - f * 0.065, 0.075 + this.right.lift);
    set(j.toeL, this.left.x - f * 0.025, j.ankleL[1] + f * 0.16, 0.025 + this.left.lift);
    set(j.toeR, this.right.x + f * 0.025, j.ankleR[1] + f * 0.16, 0.025 + this.right.lift);
    solveTwoBone(j.hipL, j.ankleL, j.kneeL, 0.43, 0.43, -f * 0.12, f, 0);
    solveTwoBone(j.hipR, j.ankleR, j.kneeR, 0.43, 0.43, f * 0.12, f, 0);

    const p = this.hand.position;
    // A small waist lean gives the striking shoulder room for wide backhands;
    // it is continuous because it follows the C1 hand trajectory.
    const reachSide = clamp((p[0] - this.x.value - f * 0.2) * 0.38, -0.20, 0.20);
    const shoulderY = pelvisY + f * (npc ? 0.16 : 0.23);
    const shoulderZ = pelvisZ + 0.45 - this.slump.value * 0.045;
    let shoulderX = this.x.value + reachSide;
    // Reach from the torso, never stretch an arm. Smooth radial compensation
    // is normally just a few cm; essential during 8 Hz cross-court streams.
    const rx = p[0] - (shoulderX + turnY * 0.2), ry = p[1] - (shoulderY - turnX * 0.2), rz = p[2] - shoulderZ;
    const distance = Math.hypot(rx, ry, rz);
    const excess = Math.max(0, distance - 0.715);
    shoulderX += rx / (distance || 1) * excess;
    const sy = shoulderY + ry / (distance || 1) * excess;
    const sz = shoulderZ + rz / (distance || 1) * excess;
    set(j.chest, shoulderX, sy - f * 0.035, sz - 0.1);
    set(j.neck, shoulderX, sy + f * 0.015, sz + 0.055);
    set(j.shoulderL, shoulderX - turnY * 0.2, sy + turnX * 0.2, sz);
    set(j.shoulderR, shoulderX + turnY * 0.2, sy - turnX * 0.2, sz);
    this.gazeX.update(gazeX, 7, dt); this.gazeZ.update(gazeZ, 7, dt);
    const lookSide = clamp((this.gazeX.value - shoulderX) * 0.055, -0.035, 0.035);
    const tilt = npc ? Math.sin(this.ambientTime * 0.19) ** 9 * 0.018 : 0;
    set(j.head, j.neck[0] + lookSide + tilt, j.neck[1] + f * 0.035,
      j.neck[2] + 0.15 - clamp(1.1 - this.gazeZ.value, 0, 0.7) * 0.025);
    set(j.headTop, j.head[0] + tilt * 0.5, j.head[1] - f * 0.008, j.head[2] + 0.15);

    // Treat forearm + grip + blade as one collinear IK link: the paddle centre
    // is the end effector, so its target is exact without a fake detached bat.
    solveTwoBone(j.shoulderR, p, j.elbowR, 0.30, 0.43, f * 0.45, -f * 0.08, -1);
    const up = this.pose.paddle.up;
    const length = Math.hypot(p[0] - j.elbowR[0], p[1] - j.elbowR[1], p[2] - j.elbowR[2]) || 1;
    set(up, (p[0] - j.elbowR[0]) / length, (p[1] - j.elbowR[1]) / length, (p[2] - j.elbowR[2]) / length);
    set(j.wristR, j.elbowR[0] + up[0] * 0.27, j.elbowR[1] + up[1] * 0.27, j.elbowR[2] + up[2] * 0.27);
    set(j.handR, j.wristR[0] + up[0] * 0.08, j.wristR[1] + up[1] * 0.08, j.wristR[2] + up[2] * 0.08);
    set(this.pose.paddle.center, p[0], p[1], p[2]);
    // Project the outgoing ball direction onto the plane perpendicular to the
    // handle. This keeps a real orthonormal paddle and a forward-facing rubber.
    const dot = f * up[1];
    const nx = -up[0] * dot, ny = f - up[1] * dot, nz = -up[2] * dot;
    const nl = Math.hypot(nx, ny, nz) || 1;
    set(this.pose.paddle.normal, nx / nl, ny / nl, nz / nl);

    const toss = npc ? smooth((this.tossUntil - time) / 0.12) : 0;
    this.balance.sample(time);
    this.balance.plan(time, 0.15, shoulderX - f * (0.28 + clamp(vx * f * 0.025, -0.05, 0.05)),
      sy + f * (0.23 + toss * 0.12), 1.10 + toss * 0.16 - this.twist.value * 0.08);
    set(j.wristL, this.balance.position[0], this.balance.position[1], this.balance.position[2]);
    solveTwoBone(j.shoulderL, j.wristL, j.elbowL, 0.30, 0.27, -f * 0.35, -f * 0.08, -1);
    const ll = Math.hypot(j.wristL[0] - j.elbowL[0], j.wristL[1] - j.elbowL[1], j.wristL[2] - j.elbowL[2]) || 1;
    set(j.handL, j.wristL[0] + (j.wristL[0] - j.elbowL[0]) / ll * 0.08,
      j.wristL[1] + (j.wristL[1] - j.elbowL[1]) / ll * 0.08, j.wristL[2] + (j.wristL[2] - j.elbowL[2]) / ll * 0.08);
    const vy = dt > 0 ? (pelvisY - this.lastBodyY) / dt : 0;
    this.lastBodyY = pelvisY;
    this.pose.cloth.swingSide = this.clothX.update(clamp(vx * f * 0.65, -1, 1), 6, dt);
    this.pose.cloth.swingForward = this.clothY.update(clamp(-vy * f * 1.8, -1, 1), 7, dt);
  }
}

/** Mutated in place each update; copy it if retaining snapshots. No clock/RNG reads. */
export interface AnimatorOutput { player: JointPose; stranger: JointPose }
export interface Animator {
  update(frame: FrameState): AnimatorOutput;
  idle(nowMs: number, dt: number): AnimatorOutput;
  reset(): void;
}

export function createAnimator(): Animator {
  let player = new Body(1, -2.3, -0.3), stranger = new Body(-1, 2.05, 0.28);
  const result: AnimatorOutput = { player: player.pose, stranger: stranger.pose };
  let lastSongTime = -Infinity, lastPress = -Infinity, lastMiss = -Infinity, inIdle = true;
  // Fixed queue doubles as recent-event history; returned notes disappear before
  // their arrival frame, so retain their known deadline rather than polling >.85.
  const events = Array.from({ length: 64 }, () => ({ id: -Infinity, kind: 0, at: 0, x: 0, z: 0, pending: false }));
  let eventCursor = 0;
  function enqueue(id: number, kind: number, at: number, x: number, z: number) {
    for (let i = 0; i < events.length; i++) if (events[i].id === id && events[i].kind === kind) return;
    const e = events[eventCursor]; eventCursor = (eventCursor + 1) % events.length;
    e.id = id; e.kind = kind; e.at = at; e.x = x; e.z = z; e.pending = true;
  }
  function reset() {
    player = new Body(1, -2.3, -0.3); stranger = new Body(-1, 2.05, 0.28);
    result.player = player.pose; result.stranger = stranger.pose;
    lastSongTime = lastPress = lastMiss = -Infinity; inIdle = true;
    for (const e of events) { e.id = -Infinity; e.pending = false; }
    eventCursor = 0;
  }
  function idle(nowMs: number, dt: number) {
    const t = nowMs / 1000, step = clamp(dt, 0, 0.05);
    if (!inIdle) { player.idle(t); stranger.idle(t); inIdle = true; }
    player.advance(t); stranger.advance(t);
    player.render(t, step, -0.3, 0, 1.05, true); stranger.render(t, step, 0.28, 0, 1.05, true);
    return result;
  }
  function update(frame: FrameState) {
    const t = frame.songTime, dt = clamp(frame.dt, 0, 0.05);
    if (t < lastSongTime - 0.15) reset();
    if (inIdle) {
      // Change time domains without carrying menu timestamps into the song.
      player.idle(t); stranger.idle(t); inIdle = false;
    }
    lastSongTime = t;
    stranger.advance(t);
    let next: NoteView | undefined, held: NoteView | undefined, missed: NoteView | undefined;
    let look: NoteView | undefined;
    for (let i = 0; i < frame.notes.length; i++) {
      const n = frame.notes[i];
      if (!n.hit && !n.returnPhase) {
        if (!look || n.time < look.time) look = n;
        if (n.type === 'hold' && n.holdStartTime !== undefined) held = n;
        else if (n.time >= t - 0.025 && (!next || n.time < next.time)) next = n;
        const spawn = n.time - frame.approachTime;
        if (spawn >= t - 0.12) enqueue(n.time, 0, Math.max(spawn, t + 0.065), courtX(n.startX), CONTACT.serveZ);
      }
      if (n.returnPhase) enqueue(n.time, 1, t + (1 - n.returnProgress) * RETURN_SECONDS, 0, CONTACT.hitZ);
      if (n.hitResult === 'miss' && n.missTime !== undefined && n.missTime > lastMiss && (!missed || n.missTime > missed.missTime!)) missed = n;
    }
    const wasHeld = player.held;
    player.held = !!held;
    player.advance(t);
    if (held) {
      if (player.mode !== 'hold' && player.mode !== 'contact') {
        player.prepare(t, t + 0.065, courtX(held.x), CONTACT.holdZ, held.time);
      }
    } else if (wasHeld) { player.follow(t, true); }
    const press = frame.nowMs - frame.pressAgeMs;
    if (frame.pressedLane !== null && Number.isFinite(press) && press > lastPress + 0.5) {
      lastPress = press;
      const x = courtX(frame.world.lanes[frame.pressedLane]);
      // A predicted stroke already meets the ball on its beat. Unexpected
      // inputs retarget from current velocity over 65ms, never teleport.
      if (Math.abs(x - player.eventX) > 0.035 || Math.abs(t - player.contactAt) > 0.09) {
        player.prepare(t, t + 0.065, x, held ? CONTACT.holdZ : CONTACT.hitZ, t);
      }
    }
    if (next && !held && next.time - t < 0.36 && next.time !== player.eventTime
      && (t >= player.contactAt - 0.001 || player.mode === 'ready' || player.mode === 'recover')) {
      player.prepare(t, Math.max(t + 0.025, next.time), courtX(next.targetX), next.type === 'hold' ? CONTACT.holdZ : CONTACT.hitZ, next.time);
    }
    if (missed) {
      lastMiss = missed.missTime!;
      if (!held && (!next || next.time - t > 0.18)) {
        player.mode = 'miss';
        player.hand.plan(t, 0.19, courtX(missed.targetX), CONTACT.playerY - 0.13, 0.86);
      }
    }
    let event: typeof events[number] | undefined;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.pending && (!event || e.at < event.at)) event = e;
    }
    if (event && event.at - t < 0.3 && t >= stranger.contactAt - 0.001) {
      event.pending = false;
      stranger.prepare(t, Math.max(t + 0.025, event.at), event.x, event.z, event.id, event.kind === 0);
    }
    let bodyX = courtX(frame.playerX) - 0.3;
    if (next && next.time - t < 0.3) {
      // Shift weight toward the approaching ball, but keep feet under the
      // player. Dense alternation becomes upper-body reach over a stable base.
      const preview = smooth((0.3 - (next.time - t)) / 0.2) * 0.65;
      bodyX += (courtX(next.targetX) - 0.3 - bodyX) * preview;
    }
    const flight = look ? clamp(1 - (look.time - t) / frame.approachTime, 0, 1) : 1;
    const a = flight <= 0.7 ? flight / 0.7 : (flight - 0.7) / 0.3;
    const height = flight <= 0.7 ? (1 - a) ** 2 * 0.22 + 2 * a * (1 - a) * 0.62
      : 2 * a * (1 - a) * 0.42 + a * a * 0.24;
    const gazeX = look ? courtX(look.type === 'switch' && look.switchControlX !== undefined
      ? (1 - flight) ** 2 * look.startX + 2 * flight * (1 - flight) * look.switchControlX + flight * flight * look.targetX
      : look.startX + (look.targetX - look.startX) * flight) : 0;
    const gazeZ = 0.815 + height;
    player.render(t, dt, bodyX, gazeX, gazeZ, false);
    const npcX = event && event.at - t < 0.4 ? event.x : stranger.eventX;
    stranger.render(t, dt, npcX + 0.28, gazeX, gazeZ, false);
    return result;
  }
  return { update, idle, reset };
}
