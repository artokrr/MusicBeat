import parts from './recorder-parts.json';
import { RECORDER_X, RECORDER_Y } from '../anim/recorder';
import type { recorder } from '../anim/recorder';
import type { RGB } from '../pixel/engine3d';

export const recorderParts = parts;
export type RecorderState = typeof recorder;
export interface RecorderBox { center: number[]; size: number[]; color: number[]; group: number }
const moving = parts.filter(p => p.group !== 0);
// A second shell (without turning hubs) is the previously ejected cassette.
export const movingParts: RecorderBox[] = [...moving, ...parts.filter(p => p.group >= 2 && p.group <= 4).map(p => ({ ...p, group: p.group + 4 }))];

/** Same authored silhouette for the CPU and asset-loading fallback. */
export function paintRecorderBody(R: { box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: RGB): void }) {
  for (const p of parts) {
    if (p.group !== 0) continue;
    const c = p.center, s = p.size;
    R.box(RECORDER_X+c[0]-s[0]/2, RECORDER_Y+c[1]-s[1]/2, c[2]-s[2]/2,
      RECORDER_X+c[0]+s[0]/2, RECORDER_Y+c[1]+s[1]/2, c[2]+s[2]/2, p.color as RGB);
  }
}

/** Fixed instance matrices, also consumed by the CPU rasterizer. */
export class RecorderBoxes {
  readonly matrices = new Float32Array(movingParts.length * 16);
  readonly visible = new Uint8Array(movingParts.length);
  private readonly shape = new Float64Array(movingParts.length * 7);
  constructor() {
    for (let i = 0; i < movingParts.length; i++) {
      const p = movingParts[i], at = i * 7;
      for (let j = 0; j < 3; j++) {
        this.shape[at + j] = p.center[j];
        this.shape[at + 3 + j] = p.size[j];
      }
      this.shape[at + 6] = p.group;
    }
  }
  private settled = false;
  private lastStart = -Infinity;
  private lastKey = -1;
  private baseX = 0;
  private baseZ = 0;
  /** Once seated, only the two hubs move. Avoid repeatedly transforming the
   * door, shell and hidden old tape (and V8 boxing of their mixed JSON data). */
  private spin(angle: number) {
    const shape = this.shape, m = this.matrices;
    const c1 = Math.cos(angle), s1 = Math.sin(angle);
    const c2 = Math.cos(angle * .83), s2 = Math.sin(angle * .83);
    for (let i = 0; i < movingParts.length; i++) {
      const offset = i * 7, group = shape[offset + 6];
      if (group !== 3 && group !== 4) continue;
      const c = group === 3 ? c1 : c2, s = group === 3 ? s1 : s2, at = i * 16;
      m[at] = c * shape[offset + 3];
      m[at + 2] = -s * shape[offset + 3];
      m[at + 8] = s * shape[offset + 5];
      m[at + 10] = c * shape[offset + 5];
      m[at + 12] = this.baseX + shape[offset] * c + shape[offset + 2] * s + (group === 3 ? -.0405 : .0405);
      m[at + 14] = this.baseZ - shape[offset] * s + shape[offset + 2] * c;
    }
  }
  update(s: RecorderState) {
    if (!s.inserting && s.loaded && this.settled && s.startedMs === this.lastStart && s.key === this.lastKey && s.door === 0) {
      this.spin(s.reel);
      return;
    }
    this.transform(s);
  }
  private transform(s: RecorderState) {
    const shape = this.shape;
    for (let i = 0; i < movingParts.length; i++) {
      const offset = i * 7, group = shape[offset + 6], old = group >= 6;
      let x = RECORDER_X, y = RECORDER_Y, z = 0, tilt = 0, roll = 0, yaw = 0, scale = 1;
      let cx = shape[offset], cy = shape[offset + 1], cz = shape[offset + 2], spin = 0;
      const tape = group === 2 || group === 3 || group === 4 || old;
      this.visible[i] = !tape || (old ? s.oldVisible : s.loaded || s.inserting) ? 1 : 0;
      if (group === 1) { x += .12; y -= .0915; z = .0945; tilt = s.door * 1.05; }
      else if (group === 5) z = -s.key * .0195;
      else if (tape) {
        x = old ? s.oldX : s.tapeX; y = old ? s.oldY : s.tapeY; z = old ? s.oldZ : s.tapeZ;
        tilt = old ? s.oldTilt : s.tapeTilt; roll = old ? 0 : s.tapeRoll; yaw = old ? -.25 : s.tapeYaw;
        scale = old ? 1 : s.tapeScale;
        if (group === 3 || group === 4 || group === 7 || group === 8) {
          spin = old ? 0 : s.reel * (group === 3 ? 1 : .83);
          const rx = cx * Math.cos(spin) + cz * Math.sin(spin);
          cz = -cx * Math.sin(spin) + cz * Math.cos(spin);
          cx = rx + (group === 3 || group === 7 ? -.0405 : .0405);
        }
      }
      // Rz * Ry * Rx: a small tumble, with the front of the tape facing camera.
      const a = Math.cos(tilt), b = Math.sin(tilt), c = Math.cos(roll), d = Math.sin(roll), e = Math.cos(yaw), f = Math.sin(yaw);
      const r0=e*c, r1=f*c, r2=-d, r3=e*d*b-f*a, r4=f*d*b+e*a, r5=c*b, r6=e*d*a+f*b, r7=f*d*a-e*b, r8=c*a;
      const cs=Math.cos(spin), sn=Math.sin(spin), at=i*16, m=this.matrices;
      const sx=shape[offset+3]*scale, sy=shape[offset+4]*scale, sz=shape[offset+5]*scale;
      m[at]=(r0*cs-r6*sn)*sx; m[at+1]=(r1*cs-r7*sn)*sx; m[at+2]=(r2*cs-r8*sn)*sx; m[at+3]=0;
      m[at+4]=r3*sy; m[at+5]=r4*sy; m[at+6]=r5*sy; m[at+7]=0;
      m[at+8]=(r0*sn+r6*cs)*sz; m[at+9]=(r1*sn+r7*cs)*sz; m[at+10]=(r2*sn+r8*cs)*sz; m[at+11]=0;
      m[at+12]=x+(r0*cx+r3*cy+r6*cz)*scale; m[at+13]=y+(r1*cx+r4*cy+r7*cz)*scale;
      m[at+14]=this.visible[i] ? z+(r2*cx+r5*cy+r8*cz)*scale : -100; m[at+15]=1;
    }
    this.settled = !s.inserting && s.loaded && s.door === 0 && s.tapeTilt === 0 && s.tapeRoll === 0 && s.tapeYaw === 0 && s.tapeScale === 1;
    this.lastStart = s.startedMs;
    this.lastKey = s.key;
    this.baseX = s.tapeX;
    this.baseZ = s.tapeZ;
  }
}
