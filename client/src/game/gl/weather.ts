import { BufferGeometry, Float32BufferAttribute, GLSL3, Points, ShaderMaterial } from 'three';
import { lampUniform } from './material';
import type { Scene } from 'three';

/** Reproducible seed, used only when constructing particle buffers. */
export function seed(index: number) {
  let n = Math.imul(index + 71, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Calm snow in metres. The GPU wraps and sways every flake; the CPU changes
 * one clock uniform. Real depth tests hide it behind walls, bodies and props. */
export class WorldSnow {
  readonly mesh: Points<BufferGeometry, ShaderMaterial>;
  private readonly opening = { value: 0 };
  private readonly time = { value: 0 };
  constructor(scene: Scene) {
    const count = 360, positions = new Float32Array(count * 3), motion = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.set([seed(i * 7) * 12, seed(i * 7 + 1) * 12, seed(i * 7 + 2) * 7], i * 3);
      motion.set([.18 + seed(i * 7 + 3) * .24, seed(i * 7 + 4) * Math.PI * 2, i % 13 === 0 ? 2 : 1], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('motion', new Float32BufferAttribute(motion, 3));
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: { time: this.time, opening: this.opening, lampLevel: lampUniform },
      vertexShader: /* glsl */ `
        uniform float time;
        uniform float opening;
        attribute vec3 motion;
        varying vec3 world;
        void main() {
          world=vec3(mod(position.x-time*.045+sin(time*.65+motion.y)*.16,12.)-6.,
            mod(position.y+sin(time*.4+motion.y)*.08,12.)-5., mod(position.z-time*motion.x,7.));
          // Expand only for the opening; keep the original particle math at zero.
          if(opening>0.) {
            world.x=world.x*(1.+opening)+4.*opening;
            world.z=world.z*(1.+opening*1.5);
          }
          gl_Position=projectionMatrix*modelViewMatrix*vec4(world,1.);
          gl_PointSize=motion.z;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float lampLevel;
        varying vec3 world;
        layout(location=0) out vec4 outColor;
        layout(location=1) out vec4 outSurface;
        void main() {
          vec3 l=vec3(1.95,.35,3.25)-world;
          float d=length(l);
          float glow=pow(max(0.,l.z/d),4.)/(1.+d*d*.18)*lampLevel;
          float band=floor(clamp(glow*5.,0.,3.));
          vec3 color=vec3(145.,153.,176.)/255.+band*vec3(.105,.075,.035);
          outColor=vec4(color,1.);
          // .75 identifies unoutlined effects, distinct from ground receivers.
          outSurface=vec4(.5,.5,1.,.75);
        }
      `,
      depthTest: true, depthWrite: true,
    });
    this.mesh = new Points(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(timeMs: number, progress?: number) {
    this.time.value = timeMs / 1000;
    const t = progress ?? 1;
    this.opening.value = 1 - t * t * t * (t * (t * 6 - 15) + 10);
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
