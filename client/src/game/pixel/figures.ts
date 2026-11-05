// People, built from capsules on a simple skeleton and posed with a handful of
// angles. Slim adult proportions: about 1.78 m tall, 7.5 heads.

import { lerp, type RGB, type Renderer3D, type Vec3 } from './engine3d';

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

export interface Look {
  top: RGB;
  legs: RGB;
  shoes: RGB;
  skin: RGB;
  hair: RGB;
  paddle: RGB;
  /** Hood up with the face lost in its shadow. */
  hood?: boolean;
  face?: RGB;
  /** A long coat down past the knees. */
  coat?: boolean;
  /** A hood lying on the shoulders. */
  hoodDown?: boolean;
}

const WOOD: RGB = [96, 78, 66];

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

/** Collects shadow casters while a figure is drawn, so they can be stamped afterwards. */
export type ShadowSink = (a: Vec3, b: Vec3, radius: number) => void;

/**
 * Draws a person standing at (x, y) and facing `yaw` (0 = +x, pi/2 = +y).
 * Returns the centre of the paddle blade.
 */
export function drawFigure(R: Renderer3D, x: number, y: number, yaw: number, pose: Pose, look: Look, shadows: ShadowSink): Vec3 {
  const fx = Math.cos(yaw);
  const fy = Math.sin(yaw);
  const sx = -fy;
  const sy = fx;
  // Local frame: a = forward, b = to the figure's left, z = up.
  const P = (a: number, b: number, z: number): Vec3 => [x + fx * a + sx * b, y + fy * a + sy * b, z];
  const ct = Math.cos(pose.twist);
  const st = Math.sin(pose.twist);
  const T = (a: number, b: number, z: number): Vec3 => P(a * ct - b * st, a * st + b * ct, z);
  const bone = (a: Vec3, b: Vec3, r0: number, r1: number, color: RGB) => {
    R.capsule(a, b, r0, r1, color);
    shadows(a, b, (r0 + r1) / 2);
  };

  const { crouch, lean, stance } = pose;
  const hipZ = 0.93 - crouch * 0.12;
  const shZ = hipZ + 0.5 * Math.cos(lean);
  const shA = 0.5 * Math.sin(lean);

  // Legs
  const footL = P(0.08, stance, 0.05);
  const footR = P(-0.06, -stance, 0.05);
  const kneeL = P(0.13 + crouch * 0.1, stance * 0.8, 0.5 - crouch * 0.04);
  const kneeR = P(0.06 + crouch * 0.1, -stance * 0.8, 0.5 - crouch * 0.04);
  bone(P(0, 0.09, hipZ), kneeL, 0.075, 0.058, look.legs);
  bone(kneeL, footL, 0.055, 0.042, look.legs);
  bone(P(0, -0.09, hipZ), kneeR, 0.075, 0.058, look.legs);
  bone(kneeR, footR, 0.055, 0.042, look.legs);
  bone(footL, P(0.2, stance, 0.04), 0.045, 0.04, look.shoes);
  bone(footR, P(0.06, -stance, 0.04), 0.045, 0.04, look.shoes);

  // Torso
  const chest = T(shA * 0.8, 0, shZ - 0.12);
  const neck = T(shA, 0, shZ + 0.04);
  bone(P(0, 0, hipZ), chest, 0.14, 0.16, look.top);
  if (look.coat) bone(T(shA * 0.8, 0, shZ - 0.1), P(-0.02, 0, 0.42), 0.155, 0.2, look.top);

  // Head
  const headC = T(shA + Math.sin(lean) * 0.12, 0, shZ + 0.2);
  bone(neck, headC, 0.045, 0.05, look.skin);
  if (look.hood) {
    R.sphere(T(shA - 0.04, 0, shZ + 0.04), 0.13, look.top);
    R.sphere([headC[0] - fx * 0.03, headC[1] - fy * 0.03, headC[2] + 0.015], 0.13, look.top);
    R.sphere([headC[0] + fx * 0.05, headC[1] + fy * 0.05, headC[2] - 0.01], 0.085, look.face ?? [14, 14, 20]);
  } else {
    R.sphere(headC, 0.105, look.skin);
    R.sphere([headC[0] - fx * 0.025, headC[1] - fy * 0.025, headC[2] + 0.03], 0.1, look.hair);
    if (look.hoodDown) R.sphere(T(shA - 0.1, 0, shZ + 0.02), 0.12, look.top);
  }
  shadows(headC, headC, 0.12);

  // Arms
  const arm = (side: 1 | -1, a: ArmPose): [Vec3, Vec3] => {
    const upper = 0.3;
    const lower = 0.27;
    const shoulder = T(shA, side * 0.2, shZ - 0.02);
    const outward = Math.sin(a.spread) * upper;
    const elbow = T(shA + Math.sin(a.swing) * upper, side * (0.2 + outward), shZ - 0.02 - Math.cos(a.swing) * upper * Math.cos(a.spread));
    const fore = a.swing + a.bend;
    const hand = T(shA + Math.sin(a.swing) * upper + Math.sin(fore) * lower, side * (0.2 + outward), elbow[2] - Math.cos(fore) * lower);
    bone(shoulder, elbow, 0.055, 0.048, look.top);
    bone(elbow, hand, 0.045, 0.038, look.top);
    R.sphere(hand, 0.038, look.skin);
    return [elbow, hand];
  };
  arm(1, pose.armL);
  const [elbowR, handR] = arm(-1, pose.armR);

  // Paddle: a short handle, then a flat blade turned to the side of the hand.
  const dx = handR[0] - elbowR[0];
  const dy = handR[1] - elbowR[1];
  const dz = handR[2] - elbowR[2];
  const dl = Math.hypot(dx, dy, dz);
  const d: Vec3 = [dx / dl, dy / dl, dz / dl];
  const blade: Vec3 = [handR[0] + d[0] * 0.14, handR[1] + d[1] * 0.14, handR[2] + d[2] * 0.14];
  R.capsule(handR, [handR[0] + d[0] * 0.06, handR[1] + d[1] * 0.06, handR[2] + d[2] * 0.06], 0.02, 0.02, WOOD);
  const e: Vec3 = [d[1] * 0 - d[2] * sy, d[2] * sx - d[0] * 0, d[0] * sy - d[1] * sx];
  for (let a = -0.08; a <= 0.08; a += 0.014) {
    for (let b = -0.075; b <= 0.075; b += 0.014) {
      if ((a / 0.08) ** 2 + (b / 0.075) ** 2 > 1) continue;
      R.sphere([blade[0] + d[0] * a + e[0] * b, blade[1] + d[1] * a + e[1] * b, blade[2] + d[2] * a + e[2] * b], 0.014, look.paddle);
    }
  }
  shadows(blade, blade, 0.07);
  return blade;
}
