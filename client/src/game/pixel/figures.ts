// People for the CPU renderer: capsules along the bones of a JointPose
// (see rig/joints.ts), plus a coat, a hood and a paddle.

import { BONES } from '../rig/joints';

import type { RGB, Renderer3D } from './engine3d';
import type { JointPose, Vec3 } from '../rig/joints';

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

/** Collects shadow casters while a figure is drawn, so they can be stamped afterwards. */
export type ShadowSink = (a: Vec3, b: Vec3, radius: number) => void;

const WOOD: RGB = [96, 78, 66];

function boneColor(name: string, look: Look): RGB {
  if (name.startsWith('thigh') || name.startsWith('shin')) return look.legs;
  if (name.startsWith('foot')) return look.shoes;
  if (name === 'neck' || name.startsWith('hand')) return look.skin;
  return look.top;
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function drawFigure(R: Renderer3D, pose: JointPose, look: Look, shadows: ShadowSink) {
  const j = pose.joints;
  const f = pose.forward;
  for (const bone of BONES) {
    if (bone.name === 'head') continue;
    const a = j[bone.from];
    const b = j[bone.to];
    const color = boneColor(bone.name, look);
    R.capsule(a, b, bone.radius[0], bone.radius[1], color);
    shadows(a, b, (bone.radius[0] + bone.radius[1]) / 2);
  }

  if (look.coat) {
    // A long coat: one smooth cone from the chest to just below the knee, its hem swinging a little.
    const hem: Vec3 = [
      j.pelvis[0] - f[0] * 0.02 + f[0] * pose.cloth.swingForward * 0.06,
      j.pelvis[1] - f[1] * 0.02 + f[1] * pose.cloth.swingForward * 0.06,
      0.42,
    ];
    const top: Vec3 = [j.chest[0], j.chest[1], j.chest[2] + 0.02];
    R.capsule(top, hem, 0.155, 0.2, look.top);
    shadows(top, hem, 0.18);
  }

  const headC = j.head;
  const back = sub(j.head, add(j.head, f, 1));
  if (look.hood) {
    R.sphere(add(j.neck, back, 0.04), 0.13, look.top);
    R.sphere(add(add(headC, back, 0.03), [0, 0, 0.015]), 0.13, look.top);
    R.sphere(add(add(headC, f, 0.05), [0, 0, -0.01]), 0.085, look.face ?? [14, 14, 20]);
  } else {
    R.sphere(headC, 0.105, look.skin);
    R.sphere(add(add(headC, back, 0.025), [0, 0, 0.03]), 0.1, look.hair);
    if (look.hoodDown) R.sphere(add(j.neck, back, 0.1), 0.12, look.top);
  }
  shadows(headC, headC, 0.12);

  // Paddle: a short handle, then a flat blade.
  const { center, up, normal } = pose.paddle;
  const wrist = j.wristR;
  R.capsule(wrist, add(wrist, up, 0.06), 0.02, 0.02, WOOD);
  const e: Vec3 = [up[1] * normal[2] - up[2] * normal[1], up[2] * normal[0] - up[0] * normal[2], up[0] * normal[1] - up[1] * normal[0]];
  for (let a = -0.08; a <= 0.08; a += 0.014) {
    for (let b = -0.075; b <= 0.075; b += 0.014) {
      if ((a / 0.08) ** 2 + (b / 0.075) ** 2 > 1) continue;
      R.sphere(add(add(center, up, a), e, b), 0.014, look.paddle);
    }
  }
  shadows(center, center, 0.07);
}

