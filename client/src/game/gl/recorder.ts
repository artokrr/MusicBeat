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
    geometry.setAttribute('tapeSnow', new InstancedBufferAttribute(this.boxes.snow, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('baseColor', new InstancedBufferAttribute(colors, 3));
    this.mesh = new InstancedMesh(geometry, pixelMaterial(), movingParts.length);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // Recorder-only snow: keep the normal five-tone/Bayer/outline pipeline.
    const material = this.mesh.material;
    material.vertexShader = material.vertexShader.replace('varying vec3 vBase;', 'attribute float tapeSnow; varying float vTapeSnow; varying vec3 vBase;')
      .replace('vBase=baseColor;', 'vBase=baseColor; vTapeSnow=tapeSnow;');
    material.fragmentShader = material.fragmentShader.replace('varying vec3 vBase;', 'varying float vTapeSnow; varying vec3 vBase;')
      .replace('bool receiver=', 'if(p.z<0.) discard; if(n.z>.5 && dither<vTapeSnow) base=vec3(200,207,218)/255.; bool receiver=');
    // The small moving parts do not need their own additional shadow draws.
    scene.add(this.mesh);
  }
  update(state: RecorderState) {
    this.boxes.update(state);
    (this.mesh.instanceMatrix.array as Float32Array).set(this.boxes.matrices);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.getAttribute('tapeSnow').needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}
