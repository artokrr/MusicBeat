import { BoxGeometry, BufferAttribute, CapsuleGeometry, Color, DataTexture, Float32BufferAttribute, DoubleSide, Group, Matrix4, Mesh, MeshDepthMaterial, NearestFilter, Quaternion, RGBADepthPacking, RGBAFormat, ShaderMaterial, SphereGeometry, UnsignedByteType, Vector3, } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintCourtyardGeometry } from '../pixel/courtyard';
import { bayer, clamp, hash, noise } from '../pixel/engine3d';
import { CAMERA, VIEW_FORWARD } from '../scene/camera';
import { LOW_W, LOW_H } from '../pixel/stage';
import { pixelMaterial } from './material';
import type { BufferGeometry } from 'three';
import type { BoxOptions, RGB, SurfaceMode, Vec3 } from '../pixel/engine3d';
const axis = new Vector3(0, 1, 0);
export function attributes(g: BufferGeometry, base: RGB, kind = 0, grain = 0, dither = .25, flags = 1) {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3), s = new Float32Array(n * 4), a = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    c.set([base[0] / 255, base[1] / 255, base[2] / 255], i * 3);
    s.set([kind, grain, dither, flags], i * 4);
  }
  g.setAttribute('baseColor', new BufferAttribute(c, 3));
  g.setAttribute('surface', new BufferAttribute(s, 4));
  g.setAttribute('coverage', new BufferAttribute(a, 1));
  g.deleteAttribute('uv');
  return g;
}
export function windowTexture() {
  const data = new Uint8Array(15 * 4 * 4);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 15; x++) {
      const c = hash(x, y) < .22 ? (hash(x + 3, y) < .6 ? [214, 172, 116] : [190, 140, 128]) : [30, 32, 44];
      data.set([...c, 255], (y * 15 + x) * 4);
    }
  const texture = new DataTexture(data, 15, 4, RGBAFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
/** Batched colour geometry plus the original scene's deliberate shadow casters. */
export function buildCourtyard() {
  const parts: BufferGeometry[] = [];
  const nonCasters: BufferGeometry[] = [];
  const casters: BufferGeometry[] = [];
  const matrix = new Matrix4(), q = new Quaternion(), dir = new Vector3(), mid = new Vector3();
  const painter = {
    box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, base: RGB, opt: BoxOptions = {}) {
      const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      (opt.surface === 'wall' ? nonCasters : parts).push(attributes(g, base, opt.surface === 'wall' ? 5 : opt.surface === 'table' ? 6 : opt.surface === 'net' ? 7 : 0, opt.grain ?? 0, opt.dither ?? .25));
    },
    capsule(a: Vec3, b: Vec3, r0: number, r1: number, base: RGB, mode: SurfaceMode = 'solid') {
      dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const length = dir.length();
      const g = new CapsuleGeometry(1, 1, 3, 8);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), sign = y < 0 ? -1 : 1, r = sign < 0 ? r0 : r1;
        p.setXYZ(i, p.getX(i) * r, sign * length / 2 + (y - sign * .5) * r, p.getZ(i) * r);
      }
      q.setFromUnitVectors(axis, dir.normalize());
      mid.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      matrix.compose(mid, q, new Vector3(1, 1, 1));
      g.applyMatrix4(matrix);
      parts.push(attributes(g, base, mode === 'rough' ? 1 : 0, 0, mode === 'rough' ? .7 : .15));
    },
    castShadow(center: Vec3, radius: number) {
      // Preserve the original scene's deliberate caster set: the wall and
      // branches never cast, and the table/bench have rounded shadow contours.
      // These volumes are rasterized into real light-space depth maps.
      const g = new SphereGeometry(radius * 1.05, 10, 6).translate(...center);
      const centers = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 0; i < centers.length; i += 3)
        centers.set(center, i);
      g.setAttribute('shadowCenter', new BufferAttribute(centers, 3));
      casters.push(g);
    },
  };
  paintCourtyardGeometry(painter);
  // Finite snow plane ends at the building. Its top is the only ground face.
  const ground = new BoxGeometry(40, 30, .01).translate(0, -10.4, -.005);
  nonCasters.push(attributes(ground, [174, 180, 200], 4, 0, 0, 2));
  const root = new Group();
  const material = pixelMaterial();
  material.uniforms.windowPattern.value = windowTexture();
  material.uniforms.snowPattern.value = snowTexture();
  for (const batch of [parts, nonCasters]) {
    const geometry = mergeGeometries(batch)!;
    for (const g of batch)
      g.dispose();
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
  const shadowGeometry = mergeGeometries(casters)!;
  for (const g of casters)
    g.dispose();
  const shadowMaterial = new ShaderMaterial({
    vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'void main(){discard;}', depthWrite: false, colorWrite: false,
  });
  const shadowMesh = new Mesh(shadowGeometry, shadowMaterial);
  const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide });
  depthMaterial.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec3 shadowCenter;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
   #include <begin_vertex>
   // Original shadow stamps are horizontal disks at the caster height.
   // Rendering these into the real shadow maps preserves the soft round
   // contours without a table proxy casting onto its own top surface.
   vec3 delta=position-shadowCenter;delta.z=0.;
   if(projectionMatrix[3][3]==0.) {
    float h=3.25-shadowCenter.z;
    delta*=min(1.,1.3*h/3.25);
    if(h<.05 || distance(shadowCenter.xy,vec2(1.95,.35))>2.86) delta=vec3(1.e6);
   }
   transformed=shadowCenter+delta;
  `);
  };
  depthMaterial.customProgramCacheKey = () => 'pixel-static-shadow-v1';
  shadowMesh.customDepthMaterial = depthMaterial;
  shadowMesh.castShadow = true;
  shadowMesh.matrixAutoUpdate = false;
  root.add(shadowMesh);
  return root;
}
/** Populate missing attributes on imported/procedural meshes without changing the rig. */
export function prepareMeshGeometry(g: BufferGeometry, color: Color) {
  const n = g.getAttribute('position').count;
  if (!g.hasAttribute('baseColor'))
    g.setAttribute('baseColor', new Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => i % 3 === 0 ? color.r : i % 3 === 1 ? color.g : color.b), 3));
  g.setAttribute('surface', new Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => i % 4 === 2 ? .15 : 0), 4));
  g.setAttribute('coverage', new Float32BufferAttribute(new Float32Array(n).fill(1), 1));
}
/** Fixed-camera material grain, precomputed once to match JS hash precision.
* Lighting, surfaces, occlusion and all rasterization still run on the GPU. */
function snowTexture() {
  const data = new Uint8Array(LOW_W * LOW_H * 4);
  const sy = Math.sin(CAMERA.yaw), cy = Math.cos(CAMERA.yaw), sp = Math.sin(CAMERA.pitch), cp = Math.cos(CAMERA.pitch);
  const tones = [[150, 156, 178], [162, 168, 190], [174, 180, 200], [186, 191, 210]];
  for (let iy = 0; iy < LOW_H; iy++)
    for (let ix = 0; ix < LOW_W; ix++) {
      const a = (ix + .5 - LOW_W / 2) / CAMERA.scale, b = -(iy + .5 - LOW_H / 2 - (CAMERA.offsetY ?? 0)) / CAMERA.scale;
      const t = -(CAMERA.target[2] + cp * b) / VIEW_FORWARD[2];
      const x = CAMERA.target[0] + cy * a + sy * sp * b + VIEW_FORWARD[0] * t;
      const y = CAMERA.target[1] - sy * a + cy * sp * b + VIEW_FORWARD[1] * t;
      const v = .55 + (noise(x * .9 + 3, y * .9) - .5) * .6 + (hash(ix, iy) - .5) * .25;
      const tone = tones[clamp(Math.floor(v * 4 + (bayer(ix, iy) - .5) * .6), 0, 3)];
      data.set([...tone, 255], (iy * LOW_W + ix) * 4);
    }
  const texture = new DataTexture(data, LOW_W, LOW_H, RGBAFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
