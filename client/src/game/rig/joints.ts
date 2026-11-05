// The shared skeleton: named joints in world space, and the bones between them.
//
// Animation code produces a JointPose (where every joint is this frame). Any
// renderer draws from it: the CPU renderer as capsules, the GPU renderer by
// aiming the bones of a skinned model at these joints.
//
// World space is the courtyard's: metres, x to the right, y away from the
// camera along the table, z up. A person stands on z = 0.

export type Vec3 = [number, number, number];

export const JOINT_NAMES = [
  'pelvis',
  'chest',
  'neck',
  'head',
  'headTop',
  'shoulderL',
  'elbowL',
  'wristL',
  'handL',
  'shoulderR',
  'elbowR',
  'wristR',
  'handR',
  'hipL',
  'kneeL',
  'ankleL',
  'toeL',
  'hipR',
  'kneeR',
  'ankleR',
  'toeR',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/** The paddle held in the right hand: blade centre, the handle direction and the blade's face normal. */
export interface PaddlePose {
  center: Vec3;
  /** Unit vector from the grip towards the top of the blade. */
  up: Vec3;
  /** Unit vector out of the red rubber face. */
  normal: Vec3;
}

export interface JointPose {
  joints: Record<JointName, Vec3>;
  /** Unit vector the hips face (horizontal). Gives bones their twist. */
  forward: Vec3;
  /** Unit vector the chest faces; differs from `forward` when the upper body turns. */
  chestForward: Vec3;
  paddle: PaddlePose;
  /**
   * Secondary motion for loose cloth, -1..1: how far a coat hem or hood swings
   * forward (+) or back (-), and to the figure's left (+) or right (-).
   */
  cloth: { swingForward: number; swingSide: number };
}

/** A bone runs from its `from` joint to its `to` joint; `parent` is the bone it hangs off. */
export interface BoneDef {
  name: string;
  from: JointName;
  to: JointName;
  parent: string | null;
  /** Radius of the limb at `from` and `to`, metres: used by the capsule fallback renderer. */
  radius: [number, number];
}

/**
 * Bones of the humanoid rig. A Blender rig for this game uses exactly these
 * bone names, with each bone's head on `from` and tail on `to` in the rest pose.
 */
export const BONES: BoneDef[] = [
  { name: 'spine', from: 'pelvis', to: 'chest', parent: null, radius: [0.14, 0.16] },
  { name: 'neck', from: 'neck', to: 'head', parent: 'spine', radius: [0.045, 0.05] },
  { name: 'head', from: 'head', to: 'headTop', parent: 'neck', radius: [0.105, 0.105] },
  { name: 'clavicleL', from: 'chest', to: 'shoulderL', parent: 'spine', radius: [0.07, 0.06] },
  { name: 'upperArmL', from: 'shoulderL', to: 'elbowL', parent: 'clavicleL', radius: [0.055, 0.048] },
  { name: 'foreArmL', from: 'elbowL', to: 'wristL', parent: 'upperArmL', radius: [0.045, 0.038] },
  { name: 'handL', from: 'wristL', to: 'handL', parent: 'foreArmL', radius: [0.038, 0.03] },
  { name: 'clavicleR', from: 'chest', to: 'shoulderR', parent: 'spine', radius: [0.07, 0.06] },
  { name: 'upperArmR', from: 'shoulderR', to: 'elbowR', parent: 'clavicleR', radius: [0.055, 0.048] },
  { name: 'foreArmR', from: 'elbowR', to: 'wristR', parent: 'upperArmR', radius: [0.045, 0.038] },
  { name: 'handR', from: 'wristR', to: 'handR', parent: 'foreArmR', radius: [0.038, 0.03] },
  { name: 'thighL', from: 'hipL', to: 'kneeL', parent: 'spine', radius: [0.075, 0.058] },
  { name: 'shinL', from: 'kneeL', to: 'ankleL', parent: 'thighL', radius: [0.055, 0.042] },
  { name: 'footL', from: 'ankleL', to: 'toeL', parent: 'shinL', radius: [0.045, 0.04] },
  { name: 'thighR', from: 'hipR', to: 'kneeR', parent: 'spine', radius: [0.075, 0.058] },
  { name: 'shinR', from: 'kneeR', to: 'ankleR', parent: 'thighR', radius: [0.055, 0.042] },
  { name: 'footR', from: 'ankleR', to: 'toeR', parent: 'shinR', radius: [0.045, 0.04] },
];

/**
 * The rest pose a model is built in: standing straight at the origin, facing
 * +y (away from the camera), arms hanging slightly away from the body
 * ("A-pose"). Adult proportions, about 1.78 m tall, roughly 7.5 heads.
 */
export const REST_JOINTS: Record<JointName, Vec3> = {
  pelvis: [0, 0, 0.93],
  chest: [0, 0, 1.31],
  neck: [0, 0, 1.47],
  head: [0, 0.01, 1.63],
  headTop: [0, 0.01, 1.78],
  shoulderL: [-0.2, 0, 1.41],
  elbowL: [-0.27, 0, 1.12],
  wristL: [-0.31, 0.02, 0.86],
  handL: [-0.32, 0.03, 0.78],
  shoulderR: [0.2, 0, 1.41],
  elbowR: [0.27, 0, 1.12],
  wristR: [0.31, 0.02, 0.86],
  handR: [0.32, 0.03, 0.78],
  hipL: [-0.09, 0, 0.93],
  kneeL: [-0.1, 0.02, 0.5],
  ankleL: [-0.1, 0, 0.07],
  toeL: [-0.1, 0.15, 0.03],
  hipR: [0.09, 0, 0.93],
  kneeR: [0.1, 0.02, 0.5],
  ankleR: [0.1, 0, 0.07],
  toeR: [0.1, 0.15, 0.03],
};
