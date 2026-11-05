import { CapsuleGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, SphereGeometry, Vector3, } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BONES } from '../rig/joints';
import { prepareMeshGeometry } from './geometry';
import { capsuleDepthMaterial, pixelMaterial } from './material';
import { boneColor, createProceduralRig, disposeRig, GLTF_TO_WORLD, PoseRetargeter } from './retarget';
import type { BufferGeometry, Scene, ShaderMaterial } from 'three';
import type { Look } from '../pixel/figures';
import type { JointPose, Vec3 } from '../rig/joints';
const Y = new Vector3(0, 1, 0), WOOD: Vec3 = [96, 78, 66], BLACK: Vec3 = [14, 14, 20];
/** Reused instance attributes; colour/deformation and both shadows share matrices. */
export class PrimitiveBatch {
  readonly mesh: InstancedMesh;
  private readonly colors: InstancedBufferAttribute;
  private readonly surfaces: InstancedBufferAttribute;
  private readonly coverages: InstancedBufferAttribute;
  private readonly capsules: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly dir = new Vector3();
  private count = 0;
  constructor(scene: Scene, capsule: boolean, private readonly capacity: number) {
    const geometry: BufferGeometry = capsule ? new CapsuleGeometry(1, 1, 4, 12) : new SphereGeometry(1, 16, 10);
    this.colors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.surfaces = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    this.coverages = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
    this.capsules = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('baseColor', this.colors);
    geometry.setAttribute('surface', this.surfaces);
    geometry.setAttribute('coverage', this.coverages);
    if (capsule)
      geometry.setAttribute('capsule', this.capsules);
    this.mesh = new InstancedMesh(geometry, pixelMaterial(capsule), capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    if (capsule)
      this.mesh.customDepthMaterial = capsuleDepthMaterial();
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  begin() { this.count = 0; }
  private put(color: Vec3, kind = 0, alpha = 1) {
    if (this.count >= this.capacity)
      throw new Error('Pixel primitive instance capacity exceeded');
    const i = this.count++;
    this.mesh.setMatrixAt(i, this.matrix);
    this.colors.setXYZ(i, color[0] / 255, color[1] / 255, color[2] / 255);
    this.surfaces.setXYZW(i, kind, 0, kind === 2 ? .7 : .15, 0);
    this.coverages.setX(i, alpha);
    return i;
  }
  capsule(a: Vec3, b: Vec3, r0: number, r1: number, color: Vec3) {
    this.dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const length = this.dir.length();
    if (length > 1e-7)
      this.q.setFromUnitVectors(Y, this.dir.multiplyScalar(1 / length));
    else
      this.q.identity();
    this.pos.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.scale.set(1, 1, 1);
    this.matrix.compose(this.pos, this.q, this.scale);
    this.capsules.setXYZ(this.put(color), r0, r1, length);
  }
  sphere(p: Vec3, r: number, color: Vec3, kind = 0, alpha = 1) {
    this.pos.set(...p);
    this.q.identity();
    this.scale.setScalar(r);
    this.matrix.compose(this.pos, this.q, this.scale);
    this.put(color, kind, alpha);
  }
  paddle(pose: JointPose, color: Vec3) {
    const { center, normal, up } = pose.paddle;
    this.dir.set(...up);
    this.scale.set(...normal);
    this.pos.crossVectors(this.dir, this.scale).normalize();
    this.matrix.makeBasis(this.pos, this.dir, this.scale);
    this.scale.set(.085, .09, .014);
    this.matrix.scale(this.scale).setPosition(...center);
    this.put(color);
  }
  flush() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colors.needsUpdate = this.surfaces.needsUpdate = this.coverages.needsUpdate = this.capsules.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.dispose();
  }
}
export class Figure {
  readonly root = new Group();
  status: 'capsules' | 'procedural' | 'glb' = 'capsules';
  private rig: PoseRetargeter | null = null;
  private readonly a: Vec3 = [0, 0, 0];
  private readonly b: Vec3 = [0, 0, 0];
  private readonly abort = new AbortController();
  private disposed = false;
  private requested = false;
  constructor(scene: Scene, private readonly name: 'player' | 'stranger', private readonly procedural: boolean) { scene.add(this.root); }
  private install(root: Group, rig: PoseRetargeter) {
    root.traverse(o => {
      if (!(o instanceof Mesh))
        return;
      const old = Array.isArray(o.material) ? o.material : [o.material];
      // Preserve per-face material colours on multi-material glTF meshes.
      const geometry = o.geometry.clone();
      const colors = new Float32Array(geometry.getAttribute('position').count * 3);
      const index = geometry.getIndex();
      for (const group of geometry.groups.length ? geometry.groups : [{ start: 0, count: index?.count ?? colors.length / 3, materialIndex: 0 }]) {
        const source = old[group.materialIndex ?? 0];
        const color = 'color' in source ? (source.color as Color).clone().convertLinearToSRGB() : new Color(.2, .2, .25);
        for (let k = group.start; k < group.start + group.count; k++) {
          const v = index ? index.getX(k) : k;
          colors[v * 3] = color.r;
          colors[v * 3 + 1] = color.g;
          colors[v * 3 + 2] = color.b;
        }
      }
      if (!geometry.hasAttribute('baseColor'))
        geometry.setAttribute('baseColor', new Float32BufferAttribute(colors, 3));
      prepareMeshGeometry(geometry, new Color(1, 1, 1));
      o.geometry.dispose();
      o.geometry = geometry;
      for (const m of old)
        m.dispose();
      geometry.clearGroups();
      o.material = pixelMaterial();
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false;
    });
    this.root.add(root);
    this.rig = rig;
  }
  private async load() {
    try {
      const response = await fetch(`/models/${this.name}.glb`, { signal: this.abort.signal });
      if (!response.ok)
        return;
      const data = await response.arrayBuffer();
      if (data.byteLength < 4 || new DataView(data).getUint32(0, true) !== 0x46546c67)
        return; // Vite HTML fallback
      const gltf = await new GLTFLoader().parseAsync(data, `${location.origin}/models/`);
      const converted = new Group();
      converted.quaternion.copy(GLTF_TO_WORLD);
      converted.add(gltf.scene);
      if (this.disposed) {
        disposeRig(converted);
        return;
      }
      try {
        this.install(converted, new PoseRetargeter(converted));
        this.status = 'glb';
      }
      catch (error) {
        disposeRig(converted);
        throw error;
      }
    }
    catch (error) {
      if (!this.abort.signal.aborted)
        console.warn(`Could not use ${this.name}.glb; keeping capsules.`, error);
    }
  }
  update(pose: JointPose, look: Look, visible: boolean, caps: PrimitiveBatch, spheres: PrimitiveBatch) {
    if (!this.requested) {
      this.requested = true;
      if (this.procedural) {
        const rig = createProceduralRig(look);
        this.install(rig.root, rig.retargeter);
        this.status = 'procedural';
      }
      else
        void this.load();
    }
    this.root.visible = visible;
    if (!visible)
      return;
    this.rig?.update(pose);
    const j = pose.joints, f = pose.forward;
    if (!this.rig)
      for (const bone of BONES) {
        if (bone.name !== 'head')
          caps.capsule(j[bone.from], j[bone.to], bone.radius[0], bone.radius[1], boneColor(bone.name, look));
      }
    if (this.status !== 'glb') {
      if (look.coat) {
        this.a[0] = j.chest[0];
        this.a[1] = j.chest[1];
        this.a[2] = j.chest[2] + .02;
        this.b[0] = j.pelvis[0] - f[0] * .02 + f[0] * pose.cloth.swingForward * .06;
        this.b[1] = j.pelvis[1] - f[1] * .02 + f[1] * pose.cloth.swingForward * .06;
        this.b[2] = .42;
        caps.capsule(this.a, this.b, .155, .2, look.top);
      }
      if (look.hood) {
        this.offset(j.neck, f, -.04, 0);
        spheres.sphere(this.a, .13, look.top);
        this.offset(j.head, f, -.03, .015);
        spheres.sphere(this.a, .13, look.top);
        this.offset(j.head, f, .05, -.01);
        spheres.sphere(this.a, .085, look.face ?? BLACK);
      }
      else {
        spheres.sphere(j.head, .105, look.skin);
        this.offset(j.head, f, -.025, .03);
        spheres.sphere(this.a, .1, look.hair);
        if (look.hoodDown) {
          this.offset(j.neck, f, -.1, 0);
          spheres.sphere(this.a, .12, look.top);
        }
      }
    }
    this.offset(j.wristR, pose.paddle.up, .06, 0);
    caps.capsule(j.wristR, this.a, .02, .02, WOOD);
    spheres.paddle(pose, look.paddle);
  }
  private offset(p: Vec3, f: Vec3, t: number, z: number) {
    this.a[0] = p[0] + f[0] * t;
    this.a[1] = p[1] + f[1] * t;
    this.a[2] = p[2] + f[2] * t + z;
  }
  dispose() { this.disposed = true; this.abort.abort(); disposeRig(this.root); }
}
