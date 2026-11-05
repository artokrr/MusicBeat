// Poses as a handful of angles, and the forward kinematics that turns them
// into joint positions (see rig/joints.ts) for any renderer to draw.

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

const blendArm = (a: ArmPose, b: ArmPose, t: number): ArmPose => ({
  swing: lerp(a.swing, b.swing, t),
  bend: lerp(a.bend, b.bend, t),
  spread: lerp(a.spread, b.spread, t),
});

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return {
    crouch: lerp(a.crouch, b.crouch, t),
    lean: lerp(a.lean, b.lean, t),
    stance: lerp(a.stance, b.stance, t),
    twist: lerp(a.twist, b.twist, t),
    armR: blendArm(a.armR, b.armR, t),
    armL: blendArm(a.armL, b.armL, t),
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Joint positions for a person standing at (x, y) facing `yaw` (0 = +x,
 * pi/2 = +y) in `pose`. Slim adult proportions, about 1.78 m tall.
 */
export function poseJoints(x: number, y: number, yaw: number, pose: Pose, cloth = { swingForward: 0, swingSide: 0 }): JointPose {
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const sx = -fy;
  const sy = fx;
  // Local frame: a = forward, b = to the figure's left, z = up.
  const P = (a: number, b: number, z: number): Vec3 => [x + fx * a + sx * b, y + fy * a + sy * b, z];
  const ct = Math.cos(pose.twist);
  const st = Math.sin(pose.twist);
  const T = (a: number, b: number, z: number): Vec3 => P(a * ct - b * st, a * st + b * ct, z);

  const { crouch, lean, stance } = pose;
  const hipZ = 0.93 - crouch * 0.12;
  const shZ = hipZ + 0.5 * Math.cos(lean);
  const shA = 0.5 * Math.sin(lean);

  const j = {} as Record<JointName, Vec3>;
  j.pelvis = P(0, 0, hipZ);
  j.hipL = P(0, 0.09, hipZ);
  j.hipR = P(0, -0.09, hipZ);
  j.kneeL = P(0.13 + crouch * 0.1, stance * 0.8, 0.5 - crouch * 0.04);
  j.kneeR = P(0.06 + crouch * 0.1, -stance * 0.8, 0.5 - crouch * 0.04);
  j.ankleL = P(0.08, stance, 0.07);
  j.ankleR = P(-0.06, -stance, 0.07);
  j.toeL = P(0.22, stance, 0.03);
  j.toeR = P(0.08, -stance, 0.03);
  j.chest = T(shA * 0.8, 0, shZ - 0.12);
  j.neck = T(shA, 0, shZ + 0.04);
  j.head = T(shA + Math.sin(lean) * 0.12, 0, shZ + 0.2);
  j.headTop = T(shA + Math.sin(lean) * 0.16, 0, shZ + 0.35);

  const arm = (side: 1 | -1, a: ArmPose) => {
    const upper = 0.3;
    const lower = 0.27;
    const outward = Math.sin(a.spread) * upper;
    const shoulder = T(shA, side * 0.2, shZ - 0.02);
    const elbow = T(shA + Math.sin(a.swing) * upper, side * (0.2 + outward), shZ - 0.02 - Math.cos(a.swing) * upper * Math.cos(a.spread));
    const fore = a.swing + a.bend;
    const wrist = T(shA + Math.sin(a.swing) * upper + Math.sin(fore) * lower, side * (0.2 + outward), elbow[2] - Math.cos(fore) * lower);
    const d = norm(sub(wrist, elbow));
    const hand: Vec3 = [wrist[0] + d[0] * 0.08, wrist[1] + d[1] * 0.08, wrist[2] + d[2] * 0.08];
    return { shoulder, elbow, wrist, hand, d };
  };
  const left = arm(1, pose.armL);
  const right = arm(-1, pose.armR);
  j.shoulderL = left.shoulder;
  j.elbowL = left.elbow;
  j.wristL = left.wrist;
  j.handL = left.hand;
  j.shoulderR = right.shoulder;
  j.elbowR = right.elbow;
  j.wristR = right.wrist;
  j.handR = right.hand;

  // The paddle continues the forearm; its face turns to the figure's side.
  const d = right.d;
  const along = d[0] * sx + d[1] * sy;
  const face = norm([sx - d[0] * along, sy - d[1] * along, -d[2] * along]);
  const center: Vec3 = [right.wrist[0] + d[0] * 0.16, right.wrist[1] + d[1] * 0.16, right.wrist[2] + d[2] * 0.16];

  return {
    joints: j,
    forward: [fx, fy, 0],
    chestForward: [fx * ct + sx * st, fy * ct + sy * st, 0],
    paddle: { center, up: d, normal: face },
    cloth,
  };
}
