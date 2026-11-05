import { Bone, CapsuleGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3, } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BONES, REST_JOINTS } from '../rig/joints';
import { attributes } from './geometry';
import type { Object3D } from 'three';
import type { BoneDef, JointPose, Vec3 } from '../rig/joints';
import type { Look } from '../pixel/figures';
const REST_FORWARD: Vec3 = [0, 1, 0];
/** Columns are right, bone direction, projected facing. Local Y aims down the bone. */
function aimFrame(a: Vec3, b: Vec3, forward: Vec3, matrix: Matrix4, x: Vector3, y: Vector3, z: Vector3) {
  y.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const length = y.length();
  if (length < 1e-7)
    y.set(0, 0, 1);
  else
    y.multiplyScalar(1 / length);
  z.set(...forward).addScaledVector(y, -y.dot(z));
  // Facing can coincide with a forearm/foot direction. A body-relative side
  // vector supplies a deterministic roll without NaNs or a random axis flip.
  if (z.lengthSq() < 1e-6)
    z.set(forward[1], -forward[0], 0).addScaledVector(y, -y.dot(z));
  if (z.lengthSq() < 1e-6)
    z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  x.crossVectors(y, z).normalize();
  z.crossVectors(x, y).normalize();
  matrix.makeBasis(x, y, z);
  return length;
}
interface Binding {
  def: BoneDef;
  bone: Bone;
  correction: Matrix4;
  restLength: number;
  scale: Vector3;
}
/**
* Pass a loaded glTF scene with its Y-up -> courtyard Z-up conversion already
* applied. Bind transforms (including authored bone roll) are captured once.
* Updates set desired world matrices, then invert the actual parent transform:
* disconnected hips/clavicles and nested armature objects are supported.
*/
export class PoseRetargeter {
  readonly bindings: Binding[];
  private readonly desired = new Matrix4();
  private readonly inverse = new Matrix4();
  private readonly frame = new Matrix4();
  private readonly x = new Vector3();
  private readonly y = new Vector3();
  private readonly z = new Vector3();
  private readonly stretch = new Vector3();
  constructor(readonly root: Object3D) {
    root.updateMatrixWorld(true);
    const bones = new Map<string, Bone>();
    root.traverse(o => { if (o instanceof Bone)
      bones.set(o.name, o); });
    this.bindings = BONES.map(def => {
      const bone = bones.get(def.name);
      if (!bone)
        throw new Error(`Model is missing BONES armature bone: ${def.name}`);
      const restLength = aimFrame(REST_JOINTS[def.from], REST_JOINTS[def.to], REST_FORWARD, this.frame, this.x, this.y, this.z);
      const rotation = new Matrix4().extractRotation(bone.matrixWorld);
      const correction = this.frame.clone().invert().multiply(rotation);
      const scale = new Vector3().setFromMatrixScale(bone.matrixWorld);
      bone.matrixAutoUpdate = false;
      return { def, bone, correction, restLength, scale };
    });
    const depth = (o: Object3D): number => o.parent ? 1 + depth(o.parent) : 0;
    this.bindings.sort((a, b) => depth(a.bone) - depth(b.bone));
  }
  update(pose: JointPose) {
    this.root.updateMatrixWorld(true);
    for (const binding of this.bindings) {
      const { def, bone, correction, restLength, scale } = binding;
      const a = pose.joints[def.from], b = pose.joints[def.to];
      const facing = def.name.startsWith('thigh') || def.name.startsWith('shin') || def.name.startsWith('foot') ? pose.forward : pose.chestForward;
      const length = aimFrame(a, b, facing, this.frame, this.x, this.y, this.z);
      this.desired.copy(this.frame).multiply(correction);
      this.stretch.copy(scale);
      this.stretch.y *= length / restLength;
      this.desired.scale(this.stretch).setPosition(a[0], a[1], a[2]);
      if (bone.parent)
        bone.matrix.multiplyMatrices(this.inverse.copy(bone.parent.matrixWorld).invert(), this.desired);
      else
        bone.matrix.copy(this.desired);
      bone.matrixWorld.copy(this.desired);
      // Non-bone intermediary nodes must also see their new parent transform.
      bone.updateMatrixWorld(true);
    }
  }
}
export function boneColor(name: string, look: Look): Vec3 {
  if (name.startsWith('thigh') || name.startsWith('shin'))
    return look.legs;
  if (name.startsWith('foot'))
    return look.shoes;
  if (name === 'neck' || name.startsWith('hand'))
    return look.skin;
  return look.top;
}
/** A true skinning proof, not the instance fallback: one mesh, 17 deform bones. */
export function createProceduralRig(look: Look) {
  const root = new Group(), bones: Bone[] = [], geometries = [];
  const frame = new Matrix4(), x = new Vector3(), y = new Vector3(), z = new Vector3();
  for (let i = 0; i < BONES.length; i++) {
    const def = BONES[i], a = REST_JOINTS[def.from], b = REST_JOINTS[def.to];
    const length = aimFrame(a, b, REST_FORWARD, frame, x, y, z);
    frame.setPosition(...a);
    const bone = new Bone();
    bone.name = def.name;
    const parentIndex = BONES.findIndex(d => d.name === def.parent);
    const parent = parentIndex < 0 ? root : bones[parentIndex];
    parent.add(bone);
    parent.updateWorldMatrix(true, false);
    bone.matrix.multiplyMatrices(new Matrix4().copy(parent.matrixWorld).invert(), frame);
    bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    bone.updateWorldMatrix(false, false);
    bones.push(bone);
    // Keep head geometry consistent with the capsule renderer's head sphere;
    // skinning the head bone is still verified by endpoint tests.
    if (def.name === 'head')
      continue;
    const radius = (def.radius[0] + def.radius[1]) / 2;
    const geometry = new CapsuleGeometry(radius, length, 4, 10);
    geometry.translate(0, length / 2, 0).applyMatrix4(frame);
    attributes(geometry, boneColor(def.name, look), 0, 0, .15, 0);
    const n = geometry.getAttribute('position').count;
    const indices = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    for (let j = 0; j < n; j++) {
      indices[j * 4] = i;
      weights[j * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
    geometries.push(geometry);
  }
  const geometry = mergeGeometries(geometries)!;
  for (const g of geometries)
    g.dispose();
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial({ color: new Color(1, 1, 1) }));
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return { root, mesh, retargeter: new PoseRetargeter(root) };
}
/** Read-only endpoint proof for an authored or procedural rig, in metres. */
export function retargetError(retargeter: PoseRetargeter, pose: JointPose) {
  retargeter.update(pose);
  let maxHead = 0, maxTail = 0;
  const head = new Vector3(), tail = new Vector3();
  for (const b of retargeter.bindings) {
    head.setFromMatrixPosition(b.bone.matrixWorld);
    tail.set(0, b.restLength / b.scale.y, 0).applyMatrix4(b.bone.matrixWorld);
    maxHead = Math.max(maxHead, head.distanceTo(new Vector3(...pose.joints[b.def.from])));
    maxTail = Math.max(maxTail, tail.distanceTo(new Vector3(...pose.joints[b.def.to])));
  }
  // Force a skinning evaluation as well as checking joint transforms.
  let finiteVertices = true, sampledVertices = 0;
  retargeter.root.traverse(o => {
    if (!(o instanceof SkinnedMesh))
      return;
    o.skeleton.update();
    const positions = o.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 7) {
      head.fromBufferAttribute(positions, i);
      o.applyBoneTransform(i, head);
      finiteVertices &&= Number.isFinite(head.x + head.y + head.z);
      sampledVertices++;
    }
  });
  return { maxHead, maxTail, finiteVertices, sampledVertices };
}
export function disposeRig(root: Object3D) {
  root.traverse(o => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      if (Array.isArray(o.material))
        for (const m of o.material)
          m.dispose();
      else
        o.material.dispose();
      if (o instanceof SkinnedMesh)
        o.skeleton.dispose();
    }
  });
}
// Exported for a future authored cloth/paddle adapter, separate from bone aiming.
export const GLTF_TO_WORLD = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
