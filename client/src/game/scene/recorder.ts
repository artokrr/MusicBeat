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
  update(s: RecorderState) {
    for (let i = 0; i < movingParts.length; i++) {
      const p = movingParts[i], group = p.group, old = group >= 6;
      let x = RECORDER_X, y = RECORDER_Y, z = 0, tilt = 0, roll = 0, yaw = 0, scale = 1;
      let cx = p.center[0], cy = p.center[1], cz = p.center[2], spin = 0;
      const tape = group === 2 || group === 3 || group === 4 || old;
      this.visible[i] = !tape || (old ? s.oldVisible : s.loaded || s.inserting) ? 1 : 0;
      if (group === 1) { x += .08; y -= .061; z = .063; tilt = s.door * 1.05; }
      else if (group === 5) z = -s.key * .013;
      else if (tape) {
        x = old ? s.oldX : s.tapeX; y = old ? s.oldY : s.tapeY; z = old ? s.oldZ : s.tapeZ;
        tilt = old ? s.oldTilt : s.tapeTilt; roll = old ? 0 : s.tapeRoll; yaw = old ? -.25 : s.tapeYaw;
        scale = old ? 1 : s.tapeScale;
        if (group === 3 || group === 4 || group === 7 || group === 8) {
          spin = old ? 0 : s.reel * (group === 3 ? 1 : .83);
          const rx = cx * Math.cos(spin) + cz * Math.sin(spin);
          cz = -cx * Math.sin(spin) + cz * Math.cos(spin);
          cx = rx + (group === 3 || group === 7 ? -.027 : .027);
        }
      }
      // Rz * Ry * Rx: a small tumble, with the front of the tape facing camera.
      const a = Math.cos(tilt), b = Math.sin(tilt), c = Math.cos(roll), d = Math.sin(roll), e = Math.cos(yaw), f = Math.sin(yaw);
      const r0=e*c, r1=f*c, r2=-d, r3=e*d*b-f*a, r4=f*d*b+e*a, r5=c*b, r6=e*d*a+f*b, r7=f*d*a-e*b, r8=c*a;
      const cs=Math.cos(spin), sn=Math.sin(spin), at=i*16, m=this.matrices;
      const sx=p.size[0]*scale, sy=p.size[1]*scale, sz=p.size[2]*scale;
      m[at]=(r0*cs-r6*sn)*sx; m[at+1]=(r1*cs-r7*sn)*sx; m[at+2]=(r2*cs-r8*sn)*sx; m[at+3]=0;
      m[at+4]=r3*sy; m[at+5]=r4*sy; m[at+6]=r5*sy; m[at+7]=0;
      m[at+8]=(r0*sn+r6*cs)*sz; m[at+9]=(r1*sn+r7*cs)*sz; m[at+10]=(r2*sn+r8*cs)*sz; m[at+11]=0;
      m[at+12]=x+(r0*cx+r3*cy+r6*cz)*scale; m[at+13]=y+(r1*cx+r4*cy+r7*cz)*scale;
      m[at+14]=this.visible[i] ? z+(r2*cx+r5*cy+r8*cz)*scale : -100; m[at+15]=1;
    }
  }
}
