import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, GLSL3, Points, ShaderMaterial } from 'three';
import { pixelNoise } from './material';
import { seed } from './weather';
import type { Scene } from 'three';
import type { JointPose } from '../rig/joints';
import type { SceneFrame } from '../scene/types';

const CAPACITY = 64;
/** A fixed particle ring. Spawning rewrites existing attributes; motion and
 * ordered-dither evaporation happen entirely in the low-resolution shader. */
export class Breath {
  readonly mesh: Points<BufferGeometry, ShaderMaterial>;
  private readonly positions = new Float32BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  private readonly velocities = new Float32BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  private readonly life = new Float32BufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(DynamicDrawUsage);
  private readonly time = { value: 0 };
  private cursor = 0;
  private sequence = 0;
  private nextPlayer = -Infinity;
  private nextStranger = -Infinity;
  private lastStroke = -Infinity;
  private pendingStroke = Infinity;
  private lastTime = -Infinity;
  constructor(scene: Scene) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('velocity', this.velocities);
    geometry.setAttribute('life', this.life);
    const material = new ShaderMaterial({
      glslVersion: GLSL3, uniforms: { time: this.time },
      vertexShader: /* glsl */ `
        uniform float time;
        attribute vec3 velocity;
        attribute vec4 life;
        varying float opacity;
        void main() {
          float age=time-life.x, t=age/max(.01,life.y);
          vec3 p=position+velocity*age+vec3(-.018*age*age,0.,.06*age*age);
          opacity=life.w*max(0.,1.-t);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
          gl_PointSize=min(3.,floor(life.z+max(0.,t)*2.));
          if(age<0. || t>=1. || life.y==0.) gl_Position=vec4(2.,2.,2.,1.);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float opacity;
        layout(location=0) out vec4 outColor;
        layout(location=1) out vec4 outSurface;
        ${pixelNoise}
        void main() {
          if(bayer(floor(gl_FragCoord.xy))>=opacity) discard;
          outColor=vec4(vec3(177,187,205)/255.,1.);
          outSurface=vec4(.5,.5,1.,.75);
        }
      `,
      depthTest: true, depthWrite: true,
    });
    this.mesh = new Points(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  private emit(pose: JointPose, t: number, stranger: boolean, stroke: boolean) {
    const head = pose.joints.head, forward = pose.chestForward;
    const n = stranger ? 4 : stroke ? 4 : 6;
    for (let k = 0; k < n; k++) {
      const i = this.cursor++ % CAPACITY, r = seed(this.sequence++);
      this.positions.setXYZ(i, head[0] + forward[0] * .13 + (r - .5) * .035,
        head[1] + forward[1] * .13, head[2] - .035 + (r - .5) * .02);
      this.velocities.setXYZ(i, forward[0] * (.16 + r * .08) + (r - .5) * .08,
        forward[1] * (.16 + r * .08), .06 + r * .07);
      this.life.setXYZW(i, t + k * .028, stroke ? .65 : 1.05, 1 + (k % 3 === 0 ? 1 : 0), stranger ? .27 : .48);
    }
    this.positions.needsUpdate = this.velocities.needsUpdate = this.life.needsUpdate = true;
  }
  update(frame: SceneFrame) {
    const t = frame.timeMs / 1000;
    this.time.value = t;
    if (!Number.isFinite(this.lastTime) || t < this.lastTime) {
      this.life.array.fill(0); this.life.needsUpdate = true;
      this.cursor = this.sequence = 0;
      this.nextPlayer = t + .6; this.nextStranger = t + 1.6;
      this.lastStroke = -Infinity; this.pendingStroke = Infinity;
    }
    this.lastTime = t;
    if (!frame.player.visible) this.nextPlayer = t + .6;
    else {
      if (Number.isFinite(frame.playerStrokeMs) && frame.playerStrokeMs > this.lastStroke + .5) {
        this.lastStroke = frame.playerStrokeMs;
        this.pendingStroke = frame.playerStrokeMs / 1000 + .075;
      }
      if (t >= this.pendingStroke) {
        if (t - this.pendingStroke < .25) this.emit(frame.player.pose, t, false, true);
        this.pendingStroke = Infinity;
        this.nextPlayer = t + 2.6 + seed(this.sequence) * .9;
      } else if (t >= this.nextPlayer) {
        this.emit(frame.player.pose, t, false, false);
        this.nextPlayer = t + 2.6 + seed(this.sequence) * .9;
      }
    }
    if (!frame.stranger.visible) this.nextStranger = t + 1.6;
    else if (t >= this.nextStranger) {
      this.emit(frame.stranger.pose, t, true, false);
      this.nextStranger = t + 3.6 + seed(this.sequence) * .4;
    }
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
