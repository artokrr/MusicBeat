// Poses as a handful of angles, and the forward kinematics that turns them
// into joint positions (see rig/joints.ts) for any renderer to draw.
import { JOINT_NAMES } from '../rig/joints';
import type { JointName, JointPose, Vec3 } from '../rig/joints';
export interface ArmPose {
  /** Upper arm raised forward from hanging (radians). */
  swing: number;
  /** Elbow bend, added to `swing` for the forearm. */
  bend: number;
  /** Upper arm raised out to the side. */
  spread: number;
}
export interface Pose {
  crouch: number;
  lean: number;
  stance: number;
  /** Upper body turned left (+) or right (-), radians. */
  twist: number;
  armR: ArmPose;
  armL: ArmPose;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Optional outputs let renderer adapters keep their hot path allocation-free. */
export function blendPose(a: Pose, b: Pose, t: number, out?: Pose): Pose {
  out ??= { crouch: 0, lean: 0, stance: 0, twist: 0, armR: { swing: 0, bend: 0, spread: 0 }, armL: { swing: 0, bend: 0, spread: 0 } };
  out.crouch = lerp(a.crouch, b.crouch, t);
  out.lean = lerp(a.lean, b.lean, t);
  out.stance = lerp(a.stance, b.stance, t);
  out.twist = lerp(a.twist, b.twist, t);
  out.armR.swing = lerp(a.armR.swing, b.armR.swing, t);
  out.armR.bend = lerp(a.armR.bend, b.armR.bend, t);
  out.armR.spread = lerp(a.armR.spread, b.armR.spread, t);
  out.armL.swing = lerp(a.armL.swing, b.armL.swing, t);
  out.armL.bend = lerp(a.armL.bend, b.armL.bend, t);
  out.armL.spread = lerp(a.armL.spread, b.armL.spread, t);
  return out;
}
export function createJointPose(): JointPose {
  const joints = {} as Record<JointName, Vec3>;
  for (const name of JOINT_NAMES)
    joints[name] = [0, 0, 0];
  return { joints, forward: [0, 0, 0], chestForward: [0, 0, 0], paddle: { center: [0, 0, 0], up: [0, 0, 0], normal: [0, 0, 0] }, cloth: { swingForward: 0, swingSide: 0 } };
}
function point(out: Vec3, a: number, b: number, z: number, x: number, y: number, fx: number, fy: number, sx: number, sy: number) {
  out[0] = x + fx * a + sx * b;
  out[1] = y + fy * a + sy * b;
  out[2] = z;
}
function arm(j: JointPose['joints'], side: 1 | -1, a: ArmPose, x: number, y: number, fx: number, fy: number, sx: number, sy: number, shA: number, shZ: number) {
  const shoulder = side === 1 ? j.shoulderL : j.shoulderR, elbow = side === 1 ? j.elbowL : j.elbowR;
  const wrist = side === 1 ? j.wristL : j.wristR, hand = side === 1 ? j.handL : j.handR;
  const outward = Math.sin(a.spread) * .3;
  point(shoulder, shA, side * .2, shZ - .02, x, y, fx, fy, sx, sy);
  point(elbow, shA + Math.sin(a.swing) * .3, side * (.2 + outward), shZ - .02 - Math.cos(a.swing) * .3 * Math.cos(a.spread), x, y, fx, fy, sx, sy);
  const fore = a.swing + a.bend;
  point(wrist, shA + Math.sin(a.swing) * .3 + Math.sin(fore) * .27, side * (.2 + outward), elbow[2] - Math.cos(fore) * .27, x, y, fx, fy, sx, sy);
  const dx = wrist[0] - elbow[0], dy = wrist[1] - elbow[1], dz = wrist[2] - elbow[2], len = Math.hypot(dx, dy, dz) || 1;
  hand[0] = wrist[0] + dx / len * .08;
  hand[1] = wrist[1] + dy / len * .08;
  hand[2] = wrist[2] + dz / len * .08;
}
const STILL_CLOTH = { swingForward: 0, swingSide: 0 };
/** Same forward kinematics; an optional reusable output avoids transient vectors. */
export function poseJoints(x: number, y: number, yaw: number, pose: Pose, cloth = STILL_CLOTH, out = createJointPose()): JointPose {
  const fx = Math.cos(yaw), fy = Math.sin(yaw), sx = -fy, sy = fx;
  const ct = Math.cos(pose.twist), st = Math.sin(pose.twist);
  const tx = fx * ct + sx * st, ty = fy * ct + sy * st, ux = -fx * st + sx * ct, uy = -fy * st + sy * ct;
  const { crouch, lean, stance } = pose;
  const hipZ = .93 - crouch * .12, shZ = hipZ + .5 * Math.cos(lean), shA = .5 * Math.sin(lean), j = out.joints;
  point(j.pelvis, 0, 0, hipZ, x, y, fx, fy, sx, sy);
  point(j.hipL, 0, .09, hipZ, x, y, fx, fy, sx, sy);
  point(j.hipR, 0, -.09, hipZ, x, y, fx, fy, sx, sy);
  point(j.kneeL, .13 + crouch * .1, stance * .8, .5 - crouch * .04, x, y, fx, fy, sx, sy);
  point(j.kneeR, .06 + crouch * .1, -stance * .8, .5 - crouch * .04, x, y, fx, fy, sx, sy);
  point(j.ankleL, .08, stance, .07, x, y, fx, fy, sx, sy);
  point(j.ankleR, -.06, -stance, .07, x, y, fx, fy, sx, sy);
  point(j.toeL, .22, stance, .03, x, y, fx, fy, sx, sy);
  point(j.toeR, .08, -stance, .03, x, y, fx, fy, sx, sy);
  point(j.chest, shA * .8, 0, shZ - .12, x, y, tx, ty, ux, uy);
  point(j.neck, shA, 0, shZ + .04, x, y, tx, ty, ux, uy);
  point(j.head, shA + Math.sin(lean) * .12, 0, shZ + .2, x, y, tx, ty, ux, uy);
  point(j.headTop, shA + Math.sin(lean) * .16, 0, shZ + .35, x, y, tx, ty, ux, uy);
  arm(j, 1, pose.armL, x, y, tx, ty, ux, uy, shA, shZ);
  arm(j, -1, pose.armR, x, y, tx, ty, ux, uy, shA, shZ);
  const wrist = j.wristR, elbow = j.elbowR, d = out.paddle.up;
  const dx = wrist[0] - elbow[0], dy = wrist[1] - elbow[1], dz = wrist[2] - elbow[2], len = Math.hypot(dx, dy, dz) || 1;
  d[0] = dx / len;
  d[1] = dy / len;
  d[2] = dz / len;
  const along = d[0] * sx + d[1] * sy, n = out.paddle.normal;
  n[0] = sx - d[0] * along;
  n[1] = sy - d[1] * along;
  n[2] = -d[2] * along;
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  n[0] /= nl;
  n[1] /= nl;
  n[2] /= nl;
  const center = out.paddle.center;
  center[0] = wrist[0] + d[0] * .16;
  center[1] = wrist[1] + d[1] * .16;
  center[2] = wrist[2] + d[2] * .16;
  out.forward[0] = fx;
  out.forward[1] = fy;
  out.forward[2] = 0;
  out.chestForward[0] = tx;
  out.chestForward[1] = ty;
  out.chestForward[2] = 0;
  out.cloth.swingForward = cloth.swingForward;
  out.cloth.swingSide = cloth.swingSide;
  return out;
}
