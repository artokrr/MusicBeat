import { BufferGeometry, BufferAttribute, DynamicDrawUsage, GLSL3, Points, ShaderMaterial } from 'three';
import { pixelNoise } from './material';
import { NOTE_MASKS, NOTE_SIZE, RecorderNotes } from '../scene/recorder-notes';
import type { Scene } from 'three';
import type { SceneFrame } from '../scene/types';

/** NOTE_SIZE native pixels, in the same depth buffer as the courtyard and snow. */
export class WorldRecorderNotes {
  readonly pool = new RecorderNotes();
  readonly mesh: Points<BufferGeometry, ShaderMaterial>;
  constructor(scene: Scene) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.pool.positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('opacity', new BufferAttribute(this.pool.opacity, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('shape', new BufferAttribute(this.pool.shapes, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('color', new BufferAttribute(this.pool.colors, 3).setUsage(DynamicDrawUsage));
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: `
        attribute float opacity;
        attribute float shape;
        attribute vec3 color;
        varying float alpha;
        flat varying int glyph;
        varying vec3 ink;
        void main() {
          alpha=opacity; glyph=int(shape); ink=color;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
          gl_PointSize=${NOTE_SIZE}.;
          if(alpha<=0.) gl_Position=vec4(2.,2.,2.,1.);
        }`,
      fragmentShader: `
        varying float alpha;
        flat varying int glyph;
        varying vec3 ink;
        layout(location=0) out vec4 outColor;
        layout(location=1) out vec4 outSurface;
        ${pixelNoise}
        void main() {
          ivec2 p=ivec2(floor(gl_PointCoord*${NOTE_SIZE}.));
          const int rows[${NOTE_MASKS.length}]=int[${NOTE_MASKS.length}](${Array.from(NOTE_MASKS).join(',')});
          if((rows[glyph*${NOTE_SIZE}+p.y] & (1<<p.x))==0) discard;
          if(bayer(vec2(floor(gl_FragCoord.x),215.-floor(gl_FragCoord.y)))>=alpha) discard;
          outColor=vec4(ink,1.);
          outSurface=vec4(.5,.5,1.,.75);
        }`,
      depthTest: true, depthWrite: true,
    });
    this.mesh = new Points(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(frame: SceneFrame) {
    this.pool.update(frame);
    const a = this.mesh.geometry.attributes;
    a.position.needsUpdate = a.opacity.needsUpdate = a.shape.needsUpdate = a.color.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
