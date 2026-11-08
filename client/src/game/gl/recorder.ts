import { BoxGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh } from 'three';
import { attributes } from './geometry';
import { pixelMaterial } from './material';
import { movingParts, RecorderBoxes } from '../scene/recorder';
import type { RecorderState } from '../scene/recorder';
import type { Scene } from 'three';

/** Door, tape, reels and PLAY key share one small draw and fixed GPU storage. */
export class CassetteRecorder {
  readonly boxes = new RecorderBoxes();
  readonly mesh: InstancedMesh<BoxGeometry, ReturnType<typeof pixelMaterial>>;
  constructor(scene: Scene) {
    const geometry = new BoxGeometry(1, 1, 1);
    attributes(geometry, [0, 0, 0]);
    const colors = new Float32Array(movingParts.length * 3);
    for (let i = 0; i < movingParts.length; i++) for (let j = 0; j < 3; j++) colors[i*3+j] = movingParts[i].color[j]/255;
    geometry.setAttribute('baseColor', new InstancedBufferAttribute(colors, 3));
    this.mesh = new InstancedMesh(geometry, pixelMaterial(), movingParts.length);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // At this size the baked contact shadow is sufficient; no extra shadow draws.
    scene.add(this.mesh);
  }
  update(state: RecorderState) {
    this.boxes.update(state);
    (this.mesh.instanceMatrix.array as Float32Array).set(this.boxes.matrices);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}
