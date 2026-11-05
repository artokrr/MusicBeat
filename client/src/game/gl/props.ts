import { BoxGeometry, Color, Group, Matrix4, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attributes } from './geometry';
import { hash } from '../pixel/engine3d';
import type { BufferGeometry, Material, MeshStandardMaterial, ShaderMaterial } from 'three';
import type { Vec3 } from '../rig/joints';

const PLACEMENTS: ReadonlyArray<readonly [string, Vec3]> = [
  ['table', [0, 0, 0]], ['bench', [-3, .6, 0]], ['lamppost', [2.25, .35, 0]],
  ['tree_bare_a', [-3.4, 3.6, 0]], ['tree_bare_b', [3.9, 3.9, 0]],
  // Entrance (door + canopy) off-screen right: from this camera its roof reads as a slab.
  ['building_facade', [7.5, 4.6, 0]],
];
// Sort a seeded random rank once, excluding the entrance's missing pane.
const LIT_WINDOWS = new Set(Array.from({ length: 75 }, (_, i) => i).filter(i => i !== 7)
  .sort((a, b) => hash(a, 19) - hash(b, 19)).slice(0, 18));
const CONVERSION = new Matrix4().makeRotationX(Math.PI / 2);

/** Convert glTF's linear base colours back to the display palette, then bake
 * its local transforms and semantic material attributes. No runtime traversal. */
export function propGeometry(root: Group, offset: Vec3 = [0, 0, 0]) {
  const parts: BufferGeometry[] = [];
  const transform = new Matrix4().makeTranslation(...offset).multiply(CONVERSION);
  const matrix = new Matrix4(), color = new Color();
  const base: Vec3 = [0, 0, 0];
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!(o instanceof Mesh)) return;
    // Subpixel polygon strands alias into a dashed band at 384px.
    if (!Array.isArray(o.material) && o.material.name === 'net_mesh') return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    g.applyMatrix4(matrix.multiplyMatrices(transform, o.matrixWorld));
    attributes(g, base);
    const positions = g.getAttribute('position');
    const colors = g.getAttribute('baseColor'), surface = g.getAttribute('surface');
    const materials: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: colors.count, materialIndex: 0 }];
    for (const group of groups) {
      const source = materials[group.materialIndex ?? 0] as MeshStandardMaterial;
      color.copy(source.color).convertLinearToSRGB();
      const name = source.name;
      let kind = 0, grain = 0, flags = 1;
      if (name.startsWith('window_') && (name === 'window_lit' || name === 'window_dark')) {
        const pane = /window_(\d+)_(\d+)/.exec(o.name);
        // Exactly 18 of the 74 panes (24.3%), scattered independently of row/column.
        const lit = pane && LIT_WINDOWS.has(Number(pane[1]) * 15 + Number(pane[2]));
        color.setRGB(lit ? 214 / 255 : 30 / 255, lit ? 172 / 255 : 32 / 255, lit ? 116 / 255 : 44 / 255);
        kind = 3;
      } else if (name === 'emissive_bulb') kind = 8;
      else if (name === 'table_green') { kind = 9; grain = 6; flags = 3; }
      else if (name === 'wood') grain = 8;
      else if (name === 'wall') grain = 2;
      else if (name === 'bark') kind = 1;
      for (let i = group.start; i < group.start + group.count; i++) {
        colors.setXYZ(i, color.r, color.g, color.b);
        surface.setXYZW(i, kind, grain, .25, flags);
        if (name === 'court_line' && positions.getZ(i) > .89) {
          // Give the tape a 1px minimum silhouette from the fixed camera.
          positions.setY(i, positions.getY(i) * 3);
          surface.setX(i, 11);
        }
      }
    }
    g.clearGroups();
    parts.push(g);
  });
  const merged = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  return merged;
}

export async function loadProp(name: string, signal: AbortSignal) {
  const response = await fetch(`/models/${name}.glb`, { signal });
  if (!response.ok) throw new Error(`${name}.glb: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 4 || new DataView(bytes).getUint32(0, true) !== 0x46546c67)
    throw new Error(`${name}.glb: expected binary glTF`);
  return (await new GLTFLoader().parseAsync(bytes, `${location.origin}/models/`)).scene;
}

export function disposeProp(root: Group) {
  root.traverse(o => {
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    if (Array.isArray(o.material)) for (const m of o.material) m.dispose();
    else o.material.dispose();
  });
}

/** Keep the complete procedural yard until all six assets are ready. Replace
 * only colour geometry; retain the deliberately soft original shadow proxies. */
export class AuthoredCourtyard {
  status: 'loading' | 'glb' | 'fallback' = 'loading';
  readonly ready: Promise<void>;
  private readonly abort = new AbortController();
  constructor(private readonly root: Group) { this.ready = this.load(); }
  private async load() {
    const parts: BufferGeometry[] = [];
    try {
      const results = await Promise.allSettled(PLACEMENTS.map(async ([name, offset]) => {
        const model = await loadProp(name, this.abort.signal);
        try { return propGeometry(model, offset); }
        finally { disposeProp(model); }
      }));
      for (const result of results) if (result.status === 'fulfilled') parts.push(result.value);
      if (this.abort.signal.aborted) return;
      const failed = results.find(r => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const net = new BoxGeometry(1.58, .004, .134).toNonIndexed().translate(0, 0, .832);
      attributes(net, [40, 42, 52], 10);
      (net.getAttribute('coverage').array as Float32Array).fill(.28);
      parts.push(net);
      const ground = new BoxGeometry(40, 30, .01).toNonIndexed().translate(0, -10.4, -.005);
      parts.push(attributes(ground, [174, 180, 200], 4, 0, 0, 2));
      const geometry = mergeGeometries(parts);
      if (!geometry) throw new Error('Incompatible courtyard geometry');
      const first = this.root.children[0] as Mesh, second = this.root.children[1] as Mesh;
      first.geometry.dispose(); second.geometry.dispose();
      first.geometry = geometry;
      this.root.remove(second);
      this.status = 'glb';
    } catch (error) {
      if (!this.abort.signal.aborted) console.warn('Could not load courtyard props; keeping procedural yard.', error);
      this.status = 'fallback';
    } finally { for (const g of parts) g.dispose(); }
  }
  get material() { return (this.root.children[0] as Mesh).material as ShaderMaterial; }
  dispose() { this.abort.abort(); }
}
