// Allocation-free motion primitives. Seconds and world metres throughout.
import type { Vec3 } from '../rig/joints';

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export function set(v: Vec3, x: number, y: number, z: number) { v[0] = x; v[1] = y; v[2] = z; }

export class Spring {
  value: number;
  velocity = 0;
  constructor(value = 0) { this.value = value; }
  /** Exact critically damped solution; stable even on a slow frame. */
  update(goal: number, frequency: number, dt: number) {
    const offset = this.value - goal;
    const c = this.velocity + frequency * offset;
    const decay = Math.exp(-frequency * dt);
    this.value = goal + (offset + c * dt) * decay;
    this.velocity = (this.velocity - frequency * c * dt) * decay;
    return this.value;
  }
}

/** A retargetable cubic: both position AND velocity survive interrupted strokes. */
export class Trajectory {
  readonly position: Vec3 = [0, 0, 0];
  readonly velocity: Vec3 = [0, 0, 0];
  private readonly from: Vec3 = [0, 0, 0];
  private readonly fromVelocity: Vec3 = [0, 0, 0];
  private readonly to: Vec3 = [0, 0, 0];
  private readonly toVelocity: Vec3 = [0, 0, 0];
  start = 0;
  end = 0;
  reset(x: number, y: number, z: number) {
    set(this.position, x, y, z); set(this.velocity, 0, 0, 0);
    set(this.to, x, y, z); set(this.toVelocity, 0, 0, 0);
    this.start = this.end = -Infinity;
  }
  plan(time: number, duration: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0) {
    for (let i = 0; i < 3; i++) { this.from[i] = this.position[i]; this.fromVelocity[i] = this.velocity[i]; }
    set(this.to, x, y, z); set(this.toVelocity, vx, vy, vz);
    this.start = time; this.end = time + Math.max(0.025, duration);
  }
  sample(time: number) {
    if (time >= this.end) {
      for (let i = 0; i < 3; i++) { this.position[i] = this.to[i]; this.velocity[i] = this.toVelocity[i]; }
      return;
    }
    const d = this.end - this.start;
    const t = clamp((time - this.start) / d, 0, 1), t2 = t * t, t3 = t2 * t;
    for (let i = 0; i < 3; i++) {
      this.position[i] = (2 * t3 - 3 * t2 + 1) * this.from[i] + (t3 - 2 * t2 + t) * d * this.fromVelocity[i]
        + (-2 * t3 + 3 * t2) * this.to[i] + (t3 - t2) * d * this.toVelocity[i];
      this.velocity[i] = (6 * t2 - 6 * t) / d * (this.from[i] - this.to[i])
        + (3 * t2 - 4 * t + 1) * this.fromVelocity[i] + (3 * t2 - 2 * t) * this.toVelocity[i];
    }
  }
}

/** Two-bone IK, with an explicit pole direction to keep elbows/knees on one side. */
export function solveTwoBone(root: Vec3, tip: Vec3, joint: Vec3, upper: number, lower: number, px: number, py: number, pz: number) {
  let dx = tip[0] - root[0], dy = tip[1] - root[1], dz = tip[2] - root[2];
  const distance = Math.hypot(dx, dy, dz) || 1e-8;
  dx /= distance; dy /= distance; dz /= distance;
  const d = clamp(distance, Math.abs(upper - lower) + 0.0001, upper + lower - 0.0001);
  const along = (upper * upper + d * d - lower * lower) / (2 * d);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const dot = px * dx + py * dy + pz * dz;
  px -= dot * dx; py -= dot * dy; pz -= dot * dz;
  let length = Math.hypot(px, py, pz);
  if (length < 1e-6) { px = -dy; py = dx; pz = 0; length = Math.hypot(px, py) || 1; }
  set(joint, root[0] + dx * along + px / length * height,
    root[1] + dy * along + py / length * height, root[2] + dz * along + pz / length * height);
}
