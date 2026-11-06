// Stateful, renderer-independent table-tennis animation. See README.md for the
// borrowed-output lifetime, contact timing and FrameState visibility limits.
import { JOINT_NAMES } from '../rig/joints';
import { clamp, set, smooth, solveTwoBone, Spring, Trajectory } from './motion';
import { incomingBall, BASKET, FEED_LEAD, RALLY_MIN_RETURN, RALLY_MAX_RETURN, DRILL_RETURN_SECONDS } from './flight';
import type { ReturnFlight } from './flight';

import type { JointPose, JointName, Vec3 } from '../rig/joints';
import type { FrameState, NoteView } from '../pixel/renderer';

// Keep these in step with pixel/renderer.ts's gameplay-to-courtyard mapping.
export const CONTACT = { playerY: -1.5, strangerY: 1.5, hitZ: 1.055, serveZ: 1.035, holdZ: 1.0 } as const;
export const courtX = (x: number) => (x - 400) * (0.45 / 80);

function makePose(): JointPose {
  const joints = {} as Record<JointName, Vec3>;
  for (const name of JOINT_NAMES) joints[name] = [0, 0, 0];
  return { joints, forward: [0, 1, 0], chestForward: [0, 1, 0],
    paddle: { center: [0, 0, 0], up: [0, 0, 1], normal: [0, 1, 0] },
    cloth: { swingForward: 0, swingSide: 0 } };
}

class Foot {
  x = 0; from = 0; goal = 0; phase = 1; lift = 0;
  /** Forward (+) or back (-) of the stance line, for lunges and step-backs. */
  y = 0; fromY = 0; goalY = 0;
  step(x: number, y = this.goalY) { this.from = this.x; this.goal = x; this.fromY = this.y; this.goalY = y; this.phase = 0; }
  update(dt: number, duration: number) {
    this.phase = Math.min(1, this.phase + dt / duration);
    const t = this.phase;
    // Zero vertical and horizontal speed at takeoff/landing: no heel popping.
    const ease = t * t * t * (10 + t * (-15 + 6 * t));
    this.x = this.from + (this.goal - this.from) * ease;
    this.y = this.fromY + (this.goalY - this.fromY) * ease;
    this.lift = 0.055 * Math.sin(Math.PI * t) ** 2;
  }
}

type StrokeMode = 'ready' | 'wind' | 'contact' | 'wait' | 'follow' | 'recover' | 'hold' | 'miss';

class Body {
  readonly pose = makePose();
  readonly x: Spring;
  readonly twist = new Spring();
  readonly load = new Spring();
  readonly slump = new Spring();
  /** Lean from the last stroke's timing: + jammed by a late ball, - reaching for an early one. */
  readonly strain = new Spring();
  leanGoal = 0;
  // Player-only secondary motion; the stranger never schedules these cues.
  stanceY = 0;
  splitContact = -Infinity;
  splitStart = -Infinity;
  splitSeen = -Infinity;
  releaseAt = -Infinity;
  readonly holding = new Spring();
  readonly armSwing = new Spring();
  readonly idleWeight = new Spring();
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
  eventY: number;
  eventZ: number = CONTACT.hitZ;
  /** Timing of the stroke in play: 0 on the beat, up to +1 late, down to -1 early. */
  timing = 0;
  /** The player's predicted stroke has met a pressed ball (rather than only its beat). */
  struck = false;
  contactAt = -Infinity;
  strokeSide = 1;
  held = false;
  tossUntil = -Infinity;
  lastBodyY: number;
  ambientTime = 0;
  readyX = 0; readyY = 0; readyZ = 1.08;
  constructor(readonly facing: 1 | -1, readonly feetY: number, x: number) {
    this.x = new Spring(x); this.lastBodyY = feetY;
    this.eventY = this.hitY;
    this.left.x = this.left.from = this.left.goal = x - facing * 0.23;
    this.right.x = this.right.from = this.right.goal = x + facing * 0.23;
    this.readyX = x + facing * 0.34; this.readyY = feetY + facing * 0.48;
    this.hand.reset(this.readyX, this.readyY, this.readyZ);
    this.balance.reset(x - facing * 0.28, feetY + facing * 0.36, 1.14);
  }
  get hitY() { return this.facing === 1 ? CONTACT.playerY : CONTACT.strangerY; }
  prepare(time: number, at: number, x: number, z: number, id: number, toss = false) {
    this.eventTime = id; this.contactAt = at; this.eventX = x; this.eventY = this.hitY; this.eventZ = z;
    this.timing = 0; this.struck = false; this.leanGoal = 0;
    this.settleFeet();
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
    this.hand.plan(time, this.contactAt - time, this.eventX, this.eventY, this.eventZ,
      soft ? 0 : -this.facing * this.strokeSide * 0.24, soft ? 0 : this.facing * 0.85, soft ? 0 : 0.12);
  }
  /**
   * Meet a pressed ball where it really is at `at`. On the beat this is the
   * usual drive. Early, the ball is still out over the table: a reaching poke
   * with little follow-through. Late, it has passed the hit line and dropped:
   * a jammed, cramped flick upward from close to the body.
   */
  strike(time: number, at: number, x: number, y: number, z: number, timing: number) {
    if (Math.abs(x - this.eventX) > 0.035) this.strokeSide = (x - this.x.value) * this.facing < 0.04 ? -1 : 1;
    this.mode = 'contact'; this.struck = true; this.timing = timing; this.leanGoal = timing;
    // The striking-side foot lunges toward an early ball or steps back from a late one.
    if (this.facing === 1) {
      // Queue the fore/aft step. Never restart an airborne foot or lift the
      // support foot while the lateral shuffle is still landing.
      this.stanceY = Math.abs(x - (this.x.value + 0.3)) < 0.20 && Math.abs(this.x.velocity) < 0.6
        ? timing < 0 ? -0.21 * timing : -0.18 * timing : 0;
    } else if (timing !== 0) {
      this.left.step(this.left.goal, this.facing * (timing < 0 ? -0.24 * timing : -0.2 * timing));
    }
    this.eventX = x; this.eventY = y; this.eventZ = z;
    const f = this.facing, early = Math.max(0, -timing), late = Math.max(0, timing);
    this.hand.plan(time, at - time, x, y, z,
      -f * this.strokeSide * 0.24 * (1 - 0.5 * (early + late)), f * (0.85 - 0.45 * early - 0.4 * late), 0.12 + 0.55 * late);
    this.contactAt = this.hand.end;
  }
  follow(time: number, push = false) {
    this.mode = 'follow';
    if (push && this.facing === 1) this.releaseAt = time;
    const f = this.facing, early = push ? 0 : Math.max(0, -this.timing), late = push ? 0 : Math.max(0, this.timing);
    const reach = push ? 0.025 : 0.09 * (1 - 0.6 * early - 0.3 * late);
    const forward = push ? 0.09 : 0.095 * (1 - 0.5 * early - 0.45 * late);
    const lift = push ? 0.02 : 0.065 - 0.03 * early + 0.11 * late;
    this.hand.plan(time, (push ? 0.12 : 0.095) + 0.03 * (early + late), this.eventX - f * this.strokeSide * reach,
      this.eventY + f * forward, this.eventZ + lift);
  }
  /** The beat arrived without a press: check the swing and let the ball come on. */
  wait(time: number) {
    this.mode = 'wait';
    this.hand.plan(time, 0.16, this.eventX - this.facing * this.strokeSide * 0.02, this.eventY - this.facing * 0.1, this.eventZ - 0.05);
  }
  settleFeet() {
    if (this.facing === 1) { this.stanceY = 0; return; }
    if (this.left.goalY !== 0) this.left.step(this.left.goal, 0);
    if (this.right.goalY !== 0) this.right.step(this.right.goal, 0);
  }
  recover(time: number) {
    this.mode = 'recover';
    this.settleFeet();
    this.hand.plan(time, 0.28 + 0.1 * Math.abs(this.timing), this.readyX, this.readyY, this.readyZ);
    this.timing = 0;
  }
  advance(time: number) {
    // Preserve the exact segment boundary even if a frame straddles contact.
    for (let i = 0; i < 4 && time >= this.hand.end; i++) {
      const end = this.hand.end;
      this.hand.sample(end);
      if (this.mode === 'wind') this.contact(end);
      else if (this.mode === 'contact') {
        if (this.held) { this.mode = 'hold'; set(this.hand.velocity, 0, 0, 0); break; }
        // Only the player can be late; the stranger's beat is its contact.
        if (this.facing === 1 && !this.struck) this.wait(end);
        else this.follow(end);
      } else if (this.mode === 'follow' || this.mode === 'miss' || this.mode === 'wait') this.recover(end);
      else if (this.mode === 'recover') { this.mode = 'ready'; this.leanGoal = 0; break; }
      else break;
    }
    this.hand.sample(time);
  }
  /** A toe-grounded split-step, keyed to the opponent's actual hand deadline. */
  splitStep(time: number, opponentContact: number, nextContact: number) {
    if (opponentContact === this.splitSeen) return;
    this.splitSeen = opponentContact;
    // Leave room to land before preparing another stroke. In dense streams,
    // a quiet base matters more than repeating a hop on every opponent ball.
    if (this.held || opponentContact < time + 0.025 || opponentContact > time + 0.32
      || opponentContact - this.contactAt < 0.32 || nextContact - opponentContact < 0.36
      || this.left.phase < 1 || this.right.phase < 1 || Math.abs(this.x.velocity) > 0.65
      || time < this.splitContact + 0.5 || this.mode === 'miss') return;
    this.splitContact = opponentContact;
    this.splitStart = Math.max(time, opponentContact - 0.12);
  }
  idle(time: number) {
    if (this.facing === 1) {
      this.splitContact = this.splitStart = this.splitSeen = this.releaseAt = -Infinity;
    }
    this.held = false;
    this.recover(time);
    const b = this.balance.position;
    this.balance.plan(time, 0.15, b[0], b[1], b[2]);
    this.eventTime = this.contactAt = this.tossUntil = -Infinity;
  }
  render(time: number, dt: number, targetX: number, gazeX: number, gazeZ: number, idle: boolean) {
    const f = this.facing, npc = f === -1, j = this.pose.joints;
    this.ambientTime += dt;
    const breath = Math.sin(this.ambientTime * (npc ? 1.15 : 1.65)) * (npc ? 0.003 : idle ? 0.012 : 0.006);
    const hold = npc ? 0 : this.holding.update(this.mode === 'hold' ? 1 : 0, 12, dt);
    const release = npc ? 0 : Math.sin(Math.PI * clamp((time - this.releaseAt) / 0.3, 0, 1)) ** 2;
    const rest = npc ? 0 : this.idleWeight.update(idle ? 1 : 0, 5, dt);
    const sway = rest * Math.sin(this.ambientTime * 0.72);
    let split = 0, heel = 0;
    if (!npc && time >= this.splitStart && time < this.splitContact + 0.22) {
      const since = time - this.splitContact;
      if (since < -0.025) split = -0.025 * smooth((time - this.splitStart) / (this.splitContact - 0.025 - this.splitStart));
      else if (since < 0.025) split = -0.025 + 0.063 * smooth((since + 0.025) / 0.05);
      else if (since < 0.085) split = 0.038 - 0.073 * smooth((since - 0.025) / 0.06);
      else split = -0.035 * (1 - smooth((since - 0.085) / 0.135));
      // Unweight through the ankles, with toes on the ground: no floating feet.
      heel = 0.025 * Math.sin(Math.PI * clamp((since + 0.025) / 0.11, 0, 1)) ** 2;
    }
    this.x.update(targetX + (idle ? Math.sin(this.ambientTime * 0.47) * (npc ? 0.002 : 0.012) : 0), npc ? 11 : 14, dt);
    const vx = this.x.velocity;
    const stroke = this.mode === 'contact' || this.mode === 'follow';
    const strokeTiming = stroke ? this.timing : 0;
    // The weight shift outlasts the swing: it eases off only once the stance is back.
    const strain = this.strain.update(this.leanGoal * (this.mode === 'recover' ? 0.5 : 1), 10, dt);
    const reaching = Math.max(0, -strain), jammed = Math.max(0, strain);
    const turn = this.mode === 'wind' ? -0.25 : stroke ? 0.23 * (1 - 0.45 * jammed) : this.mode === 'hold' ? 0.08 : this.mode === 'wait' ? -0.06 : 0;
    this.twist.update(turn * this.strokeSide + clamp(-vx * f * 0.06, -0.1, 0.1), 20, dt);
    this.load.update(npc ? (stroke ? 0.018 : this.mode === 'wind' ? -0.012 : 0)
      : (stroke ? 0.018 : this.mode === 'wind' ? -0.012 : 0) + hold * 0.045 - release * 0.04, 16, dt);
    // A stroke at the edge of the window ("ok") also costs a little balance.
    this.slump.update(this.mode === 'miss' ? 1 : Math.max(0, Math.abs(strokeTiming) - 0.7), 9, dt);
    this.readyX = this.x.value + f * 0.34;
    this.readyY = this.feetY + f * 0.48 - rest * 0.035;
    this.readyZ = 1.08 + breath - rest * 0.07;
    if (!npc && this.mode === 'recover' && this.hand.end - time > 0.09) {
      // Finish the recovery above the moving stance, not its old lane. Retain
      // both velocity and the original deadline so this cannot stall recovery.
      this.hand.plan(time, this.hand.end - time, this.readyX, this.readyY, this.readyZ);
    }
    if (this.mode === 'ready') {
      // Retarget the ready stance slowly; strokes are never low-pass filtered
      // after IK, which would make their paddles arrive late.
      this.hand.plan(time, 0.12, this.readyX, this.readyY, this.readyZ);
    }
    // Gather a trailing foot sooner only when a wide reversal is taking the
    // hips beyond its support. Ordinary shuffles keep their original cadence.
    const hurry = npc ? 0 : smooth((Math.max(Math.abs(this.x.value - 0.09 - this.left.x),
      Math.abs(this.x.value + 0.09 - this.right.x)) - 0.26) / 0.20);
    const stepDuration = npc ? 0.19 : 0.155 - hurry * 0.08;
    this.left.update(dt, stepDuration); this.right.update(dt, stepDuration);
    if (this.left.phase === 1 && this.right.phase === 1 && heel === 0) {
      const desired = this.x.value + clamp(vx * 0.10, -0.13, 0.13);
      const l = desired - f * 0.23, r = desired + f * 0.23;
      const le = Math.abs(l - this.left.x), re = Math.abs(r - this.right.x);
      // Only one foot lifts at a time. The support foot stays exactly planted.
      if (Math.max(le, re) > 0.10) {
        const leading = vx * f > 0 ? this.right : this.left;
        const foot = Math.abs(le - re) < 0.04 ? leading : le > re ? this.left : this.right;
        foot.step(foot === this.left ? l : r, npc ? foot.goalY : foot === this.right ? this.stanceY : 0);
      } else if (!npc && Math.abs(vx) < 0.25 && Math.max(le, re) < 0.07
        && Math.abs(this.right.y - this.stanceY) > 0.012) {
        this.right.step(this.right.x, this.stanceY);
      }
    }
    const pelvisZ = (npc ? 0.87 : 0.79) + breath - this.load.value - this.slump.value * 0.025 - 0.05 * reaching - 0.02 * jammed + split + rest * 0.018;
    const pelvisY = this.feetY + f * (0.065 + this.load.value + 0.10 * reaching - 0.07 * jammed + hold * 0.025 + release * 0.045);
    set(j.pelvis, this.x.value, pelvisY, pelvisZ);
    const hipTurn = -this.twist.value * 0.25;
    set(this.pose.forward, Math.sin(hipTurn) * f, Math.cos(hipTurn) * f, 0);
    const turnX = Math.sin(this.twist.value) * f, turnY = Math.cos(this.twist.value) * f;
    set(this.pose.chestForward, turnX, turnY, 0);
    set(j.hipL, this.x.value - f * 0.09, pelvisY, pelvisZ);
    set(j.hipR, this.x.value + f * 0.09, pelvisY, pelvisZ);
    set(j.ankleL, this.left.x, this.feetY + f * 0.065 + this.left.y, 0.075 + this.left.lift + heel);
    set(j.ankleR, this.right.x, this.feetY - f * 0.065 + this.right.y, 0.075 + this.right.lift + heel);
    set(j.toeL, this.left.x - f * 0.025, j.ankleL[1] + f * 0.16, 0.025 + this.left.lift);
    set(j.toeR, this.right.x + f * 0.025, j.ankleR[1] + f * 0.16, 0.025 + this.right.lift);
    solveTwoBone(j.hipL, j.ankleL, j.kneeL, 0.43, 0.43, -f * 0.12, f, 0);
    solveTwoBone(j.hipR, j.ankleR, j.kneeR, 0.43, 0.43, f * 0.12, f, 0);

    const p = this.hand.position;
    // A small waist lean gives the striking shoulder room for wide backhands;
    // it is continuous because it follows the C1 hand trajectory.
    const reachSide = clamp((p[0] - this.x.value - f * 0.2) * 0.38, -0.20, 0.20);
    const shoulderY = pelvisY + f * ((npc ? 0.16 : 0.23) + 0.10 * reaching - 0.08 * jammed);
    const shoulderZ = pelvisZ + 0.45 - this.slump.value * 0.045 - 0.03 * reaching - 0.03 * jammed;
    let shoulderX = this.x.value + reachSide + sway * 0.035;
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
    const lookSide = clamp((this.gazeX.value - shoulderX) * (npc ? 0.055 : 0.10), npc ? -0.035 : -0.055, npc ? 0.035 : 0.055);
    const lookDown = npc ? 0 : clamp(1.14 - this.gazeZ.value, -0.16, 0.5) * 0.09 + this.slump.value * 0.025;
    const tilt = npc ? Math.sin(this.ambientTime * 0.19) ** 9 * 0.018 : 0;
    set(j.head, j.neck[0] + lookSide + tilt, j.neck[1] + f * 0.035,
      j.neck[2] + 0.15 - clamp(1.1 - this.gazeZ.value, 0, 0.7) * 0.025);
    set(j.headTop, j.head[0] + tilt * 0.5, j.head[1] - f * (0.008 - lookDown), j.head[2] + 0.15);

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
    if (npc) {
      this.balance.plan(time, 0.15, shoulderX - f * (0.28 + clamp(vx * f * 0.025, -0.05, 0.05)),
        sy + f * (0.23 + toss * 0.12), 1.10 + toss * 0.16 - this.twist.value * 0.08);
    } else {
      // Let the off hand open against the stroke, then fold back in. Its
      // delayed response breaks the rigid "both elbows up" silhouette.
      const counter = this.armSwing.update(stroke ? this.strokeSide : this.mode === 'wind' ? -this.strokeSide * 0.45 : 0, 11, dt);
      this.balance.plan(time, 0.18, shoulderX - (0.29 + clamp(vx * 0.04, -0.065, 0.065)) - counter * 0.045,
        sy + 0.21 - counter * 0.09 + hold * 0.055 - rest * 0.045,
        1.06 + counter * 0.055 + hold * 0.035 - this.slump.value * 0.10 - rest * 0.09 + split * 0.5 + sway * 0.02);
    }
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

/** Stranger-only feed motion; keep the player's Body and stroke code independent. */
class Stranger extends Body {
  private readonly freeHand = new Trajectory();
  private readonly feedPosition: Vec3 = [0, 0, 0];
  private readonly release: Vec3 = [0, 0, 0];
  private readonly handTip: Vec3 = [0, 0, 0];
  feedAt = -Infinity;
  private pickupAt = -Infinity;
  private releaseAt = -Infinity;
  private feedX = 0;
  private feedStage = 0;
  constructor() {
    super(-1, 2.05, 0.28);
    this.freeHand.reset(BASKET[0], BASKET[1], BASKET[2]);
  }
  feed(time: number, at: number, x: number) {
    this.feedAt = at; this.feedX = x;
    this.pickupAt = Math.max(time + 0.025, at - 0.19);
    this.releaseAt = at - 0.075;
    this.feedStage = 1;
    this.freeHand.plan(time, this.pickupAt - time, BASKET[0], BASKET[1], BASKET[2]);
  }
  override render(time: number, dt: number, targetX: number, gazeX: number, gazeZ: number, idle: boolean) {
    super.render(time, dt, targetX, gazeX, gazeZ, idle);
    // Reach into the basket, bring one ball in front, release into a compact drive.
    for (let i = 0; i < 3 && time >= this.freeHand.end; i++) {
      const end = this.freeHand.end;
      this.freeHand.sample(end);
      if (this.feedStage === 1) {
        this.feedStage = 2;
        this.freeHand.plan(end, this.releaseAt - end, Math.max(0.22, this.feedX + 0.22), 1.62, 1.12);
      } else if (this.feedStage === 2) {
        this.feedStage = 3;
        const p = this.freeHand.position;
        set(this.release, p[0], p[1], p[2]);
        this.freeHand.plan(end, 0.19, BASKET[0], BASKET[1], BASKET[2] + 0.06);
      } else { this.feedStage = 0; break; }
    }
    this.freeHand.sample(time);
    const j = this.pose.joints, wanted = this.freeHand.position, p = this.handTip;
    const dx = wanted[0] - j.shoulderL[0], dy = wanted[1] - j.shoulderL[1], dz = wanted[2] - j.shoulderL[2];
    const reach = Math.min(1, 0.645 / (Math.hypot(dx, dy, dz) || 1));
    set(p, j.shoulderL[0] + dx * reach, j.shoulderL[1] + dy * reach, j.shoulderL[2] + dz * reach);
    // The free-hand tip is the ball carrier, with a continuous forearm/grip line.
    solveTwoBone(j.shoulderL, p, j.elbowL, 0.30, 0.35, 0.35, 0.08, -1);
    const len = Math.hypot(p[0] - j.elbowL[0], p[1] - j.elbowL[1], p[2] - j.elbowL[2]) || 1;
    set(j.wristL, p[0] - (p[0] - j.elbowL[0]) / len * 0.08,
      p[1] - (p[1] - j.elbowL[1]) / len * 0.08, p[2] - (p[2] - j.elbowL[2]) / len * 0.08);
    set(j.handL, p[0], p[1], p[2]);
  }
  ball(time: number): Vec3 | undefined {
    if (time < this.pickupAt || time >= this.feedAt) return undefined;
    const p = this.feedPosition;
    if (time < this.releaseAt) {
      const hand = this.handTip;
      set(p, hand[0], hand[1], hand[2]);
    } else {
      const q = clamp((time - this.releaseAt) / (this.feedAt - this.releaseAt), 0, 1);
      set(p, this.release[0] + (this.feedX - this.release[0]) * q,
        this.release[1] + (CONTACT.strangerY - this.release[1]) * q,
        this.release[2] + (CONTACT.serveZ - this.release[2]) * q + 0.04 * Math.sin(Math.PI * q));
    }
    return p;
  }
}

/** Mutated in place each update; copy it if retaining snapshots. No clock/RNG reads. */
export interface AnimatorOutput { player: JointPose; stranger: JointPose }
/** Where and when the player's paddle met a pressed ball; the ball leaves from here. */
export interface Strike { id: number; hitTime: number; at: number; pos: Vec3 }
export interface Animator {
  update(frame: FrameState): AnimatorOutput;
  /** The strike for the note with this time, once the player has pressed it. */
  strikeFor(noteTime: number): Strike | undefined;
  returnFor(noteTime: number): ReturnFlight | undefined;
  feedBall(): Vec3 | undefined;
  idle(nowMs: number, dt: number): AnimatorOutput;
  reset(): void;
}

export function createAnimator(): Animator {
  let player = new Body(1, -2.3, -0.3), stranger = new Stranger();
  const result: AnimatorOutput = { player: player.pose, stranger: stranger.pose };
  let lastSongTime = -Infinity, lastPress = -Infinity, lastMiss = -Infinity, inIdle = true;
  // Fixed queue doubles as recent-event history; returned notes disappear before
  // their arrival frame, so retain their known deadline rather than polling >.85.
  const events = Array.from({ length: 64 }, () => ({ id: -Infinity, kind: 0, at: 0, x: 0, z: 0, pending: false }));
  let eventCursor = 0;
  // Disposal stays visible longer than a stroke; keep contact history through dense feeds.
  const strikes: Strike[] = Array.from({ length: 64 }, () => ({ id: -Infinity, hitTime: 0, at: 0, pos: [0, 0, 0] }));
  let strikeCursor = 0;
  const ball: Vec3 = [0, 0, 0];
  const returns: ReturnFlight[] = Array.from({ length: 64 }, () => ({
    id: -Infinity, startAt: 0, endAt: 0, rallyTime: Infinity, endX: 0, from: [0, 0, 0],
  }));
  let returnCursor = 0;
  function returnFor(noteTime: number) {
    for (let i = 0; i < returns.length; i++) if (returns[i].id === noteTime) return returns[i];
    return undefined;
  }
  function rallyInto(noteTime: number) {
    for (let i = 0; i < returns.length; i++) if (returns[i].rallyTime === noteTime) return true;
    return false;
  }
  function strikeFor(noteTime: number) {
    for (let i = 0; i < strikes.length; i++) if (strikes[i].id === noteTime) return strikes[i];
    return undefined;
  }
  function enqueue(id: number, kind: number, at: number, x: number, z: number) {
    for (let i = 0; i < events.length; i++) if (events[i].id === id && events[i].kind === kind) return;
    const e = events[eventCursor]; eventCursor = (eventCursor + 1) % events.length;
    e.id = id; e.kind = kind; e.at = at; e.x = x; e.z = z; e.pending = true;
  }
  function reset() {
    player = new Body(1, -2.3, -0.3); stranger = new Stranger();
    result.player = player.pose; result.stranger = stranger.pose;
    lastSongTime = lastPress = lastMiss = -Infinity; inIdle = true;
    for (const e of events) { e.id = -Infinity; e.pending = false; }
    eventCursor = 0;
    for (const s of strikes) s.id = -Infinity;
    strikeCursor = returnCursor = 0;
    for (const r of returns) { r.id = -Infinity; r.rallyTime = Infinity; }
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

      }
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
    // A pressed ball: the paddle meets it where it is a moment after the press,
    // no faster than a forearm can get there, and the ball leaves from that point.
    let struck = false;
    for (let i = 0; i < frame.notes.length; i++) {
      const n = frame.notes[i];
      if (!n.returnPhase || n.hitTime === undefined || n.holdStartTime !== undefined || strikeFor(n.time)) continue;
      const late = n.hitTime - n.time;
      const grade = n.hitResult === 'perfect' ? 0 : n.hitResult === 'good' ? 0.6 : 1;
      const hand = player.hand.position;
      let reach = 0.016;
      for (let k = 0; k < 2; k++) {
        incomingBall(n, t + reach, frame.approachTime, ball);
        reach = clamp(Math.hypot(ball[0] - hand[0], ball[1] - hand[1], ball[2] - hand[2]) / 7, 0.016, 0.07);
      }
      incomingBall(n, t + reach, frame.approachTime, ball);
      player.eventTime = n.time;
      player.strike(t, t + reach, ball[0], ball[1], ball[2], grade * Math.sign(late));
      const s = strikes[strikeCursor]; strikeCursor = (strikeCursor + 1) % strikes.length;
      s.id = n.time; s.hitTime = n.hitTime; s.at = player.contactAt; set(s.pos, ball[0], ball[1], ball[2]);
      struck = true;
    }
    const press = frame.nowMs - frame.pressAgeMs;
    if (struck && Number.isFinite(press)) lastPress = press;
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
        player.leanGoal = 0;
        player.settleFeet();
        player.hand.plan(t, 0.19, courtX(missed.targetX), CONTACT.playerY - 0.13, 0.86);
      }
    }
    // Decide only after the player's strike is known. A miss never creates a
    // return, so the next note automatically remains a fresh basket feed.
    for (let i = 0; i < frame.notes.length; i++) {
      const n = frame.notes[i];
      if (!n.returnPhase || returnFor(n.time)) continue;
      const strike = strikeFor(n.time);
      const r = returns[returnCursor]; returnCursor = (returnCursor + 1) % returns.length;
      r.id = n.time;
      r.startAt = strike?.at ?? n.returnStartedAt ?? t - n.returnProgress * 0.4;
      const nextLaunch = (n.nextTime ?? Infinity) - frame.approachTime;
      const duration = nextLaunch - r.startAt;
      const rally = duration >= RALLY_MIN_RETURN && duration <= RALLY_MAX_RETURN;
      r.rallyTime = rally ? n.nextTime! : Infinity;
      r.endAt = rally ? nextLaunch : r.startAt + DRILL_RETURN_SECONDS;
      r.endX = rally ? courtX(n.nextStartX ?? 400) : -0.88;
      if (strike) set(r.from, strike.pos[0], strike.pos[1], strike.pos[2]);
      else set(r.from, courtX(n.returnStartX ?? n.targetX), CONTACT.playerY, CONTACT.holdZ);
      if (rally) enqueue(r.rallyTime, 1, r.endAt, r.endX, CONTACT.serveZ);
    }
    // Preview exists only for animation; Game still spawns every incoming at
    // note.time - approachTime. History makes launch/preview dedup allocation-free.
    const previews = frame.upcomingFeeds;
    if (previews) for (let i = 0; i < previews.length; i++) {
      const n = previews[i];
      if (!rallyInto(n.time)) enqueue(n.time, 0, n.time - frame.approachTime, courtX(n.startX), CONTACT.serveZ);
    }
    for (let i = 0; i < frame.notes.length; i++) {
      const n = frame.notes[i], launch = n.time - frame.approachTime;
      if (launch >= t - 0.12 && !rallyInto(n.time)) enqueue(n.time, 0, launch, courtX(n.startX), CONTACT.serveZ);
    }
    let event: typeof events[number] | undefined;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.pending && (!event || e.at < event.at)) event = e;
    }
    if (event && event.at - t <= FEED_LEAD && t >= stranger.contactAt - 0.001) {
      event.pending = false;
      stranger.prepare(t, Math.max(t + 0.025, event.at), event.x, event.z, event.id);
      if (event.kind === 0) stranger.feed(t, stranger.contactAt, event.x);
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
    // Read the stranger's scheduled contact without changing its event queue.
    player.splitStep(t, stranger.contactAt, held ? t : next?.time ?? Infinity);
    // Track the real incoming/held height, including a ball running past the
    // line. Keep the stranger's existing gaze calculation independent.
    if (look) incomingBall(look, t, frame.approachTime, ball);
    player.render(t, dt, bodyX, look ? ball[0] : gazeX,
      held ? CONTACT.holdZ : look ? ball[2] : gazeZ, false);
    const npcX = event && event.at - t < 0.4 ? event.x : stranger.eventX;
    stranger.render(t, dt, npcX + 0.28, gazeX, gazeZ, false);
    return result;
  }
  return { update, idle, reset, strikeFor, returnFor, feedBall: () => stranger.ball(lastSongTime) };
}
