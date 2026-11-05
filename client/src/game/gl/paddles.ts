import { BufferGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, MeshDepthMaterial, RGBADepthPacking, Vector3 } from 'three';
import { pixelMaterial } from './material';
import { disposeProp, loadProp, propGeometry } from './props';
import type { Scene } from 'three';
import type { PaddlePose } from '../rig/joints';

/** Two authored paddles in one draw. Geometry is baked to game Z-up, so local
 * +Y is the red face and +Z runs from grip to blade. JointPose gives blade centre. */
export class PaddleBatch {
  readonly mesh = new InstancedMesh(new BufferGeometry(), pixelMaterial(), 2);
  readonly ready: Promise<void>;
  status: 'loading' | 'glb' | 'fallback' = 'loading';
  private readonly abort = new AbortController();
  private readonly matrix = new Matrix4();
  private readonly x = new Vector3();
  private readonly normal = new Vector3();
  private readonly up = new Vector3();
  private readonly grip = new Vector3();
  private count = 0;
  constructor(scene: Scene) {
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.mesh);
    this.ready = this.load();
  }
  private async load() {
    try {
      const model = await loadProp('paddle', this.abort.signal);
      try {
        if (this.abort.signal.aborted) return;
        const geometry = propGeometry(model);
        const surfaces = geometry.getAttribute('surface');
        for (let i = 0; i < surfaces.count; i++) surfaces.setW(i, 0);
        this.mesh.geometry.dispose();
        this.mesh.geometry = geometry;
        this.status = 'glb';
      } finally { disposeProp(model); }
    } catch (error) {
      if (!this.abort.signal.aborted) console.warn('Could not load paddle.glb; keeping procedural paddles.', error);
      this.status = 'fallback';
    }
  }
  begin() { this.count = 0; }
  add(pose: PaddlePose) {
    if (this.status !== 'glb') return false;
    this.up.set(pose.up[0], pose.up[1], pose.up[2]).normalize();
    this.normal.set(pose.normal[0], pose.normal[1], pose.normal[2]).addScaledVector(this.up, -this.normal.dot(this.up)).normalize();
    this.x.crossVectors(this.normal, this.up).normalize();
    this.grip.set(pose.center[0], pose.center[1], pose.center[2]).addScaledVector(this.up, -.145);
    this.matrix.makeBasis(this.x, this.normal, this.up).setPosition(this.grip);
    this.mesh.setMatrixAt(this.count++, this.matrix);
    return true;
  }
  flush() {
    this.mesh.visible = this.count > 0;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.abort.abort();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.dispose();
  }
}
