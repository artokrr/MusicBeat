import { CAMERA, openingCamera } from '../scene/camera';
import { hash } from './engine3d';

// The software fallback uses a flat panel elevation. The existing courtyard is
// revealed underneath as the camera lowers; no extra 3D scene or frame buffers.
const lit = new Set(Array.from({ length: 75 }, (_, i) => i).filter(i => i !== 7)
  .sort((a, b) => hash(a, 19) - hash(b, 19)).slice(0, 18));
export class CPUOpening {
  private view = CAMERA;
  private sy = 0;
  private cy = 1;
  private sp = 0;
  private cp = 1;
  private corner(ctx: CanvasRenderingContext2D, x: number, z: number, first = false) {
    const v = this.view, dx = x - v.target[0], dy = 4.6 - v.target[1];
    const sx = 192 + (dx * this.cy - dy * this.sy) * v.scale;
    const y = 108 + (v.offsetY ?? 0) - (dx * this.sy * this.sp + dy * this.cy * this.sp + (z - v.target[2]) * this.cp) * v.scale;
    if (first) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
  }
  private panel(ctx: CanvasRenderingContext2D, x: number, z: number, w: number, h: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    this.corner(ctx, x, z, true); this.corner(ctx, x + w, z);
    this.corner(ctx, x + w, z + h); this.corner(ctx, x, z + h);
    ctx.closePath(); ctx.fill();
  }
  draw(ctx: CanvasRenderingContext2D, progress: number) {
    this.view = openingCamera(progress);
    this.sy = Math.sin(this.view.yaw); this.cy = Math.cos(this.view.yaw);
    this.sp = Math.sin(this.view.pitch); this.cp = Math.cos(this.view.pitch);
    ctx.globalAlpha = 1 - Math.max(0, Math.min(1, (progress - .45) / .55));
    ctx.fillStyle = '#0c0d16'; ctx.fillRect(0, 0, 384, 216);
    this.panel(ctx, -4.5, 0, 24, 12, '#363849');
    for (let r = 0; r < 5; r++) {
      this.panel(ctx, -4.5, r * 2.4, 24, .04, '#242837');
      for (let c = 0; c < 15; c++) {
        const x = -4.5 + c * 1.6;
        this.panel(ctx, x, 0, .035, 12, '#2b2e3e');
        if (r === 0 && c === 7) continue;
        this.panel(ctx, x + .4, r * 2.4 + .8, .8, 1, '#20222e');
        this.panel(ctx, x + .45, r * 2.4 + .85, .7, .9, lit.has(r * 15 + c) ? '#b39972' : '#252939');
        this.panel(ctx, x + .78, r * 2.4 + .85, .035, .9, '#393947');
      }
    }
    this.panel(ctx, -4.6, 11.95, 24.2, .08, '#727686');
    ctx.globalAlpha = 1;
  }
}
