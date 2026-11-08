import { bayer } from './engine3d';
import { project } from '../scene/camera';
import { NOTE_CAPACITY, NOTE_MASKS, NOTE_SIZE, RecorderNotes } from '../scene/recorder-notes';
import type { Renderer3D, Vec3 } from './engine3d';
import type { SceneFrame } from '../scene/types';

export class CPURecorderNotes {
  readonly pool = new RecorderNotes();
  private readonly point: Vec3 = [0, 0, 0];
  private readonly projected = { sx: 0, sy: 0, d: 0 };
  draw(R: Renderer3D, frame: SceneFrame) {
    this.pool.update(frame);
    for (let i = 0; i < NOTE_CAPACITY; i++) {
      const alpha = this.pool.opacity[i], at = i * 3;
      if (alpha <= 0) continue;
      for (let j = 0; j < 3; j++) this.point[j] = this.pool.positions[at + j];
      const p = project(this.point, this.projected);
      const left = Math.floor(p.sx - 3), top = Math.floor(p.sy - 3);
      for (let y = 0; y < NOTE_SIZE; y++) for (let x = 0; x < NOTE_SIZE; x++) {
        if (!(NOTE_MASKS[this.pool.shapes[i] * NOTE_SIZE + y] & (1 << x))) continue;
        const sx = left + x, sy = top + y, pixel = sy * 384 + sx;
        if (sx < 0 || sx >= 384 || sy < 0 || sy >= 216 || p.d <= R.zb[pixel] || bayer(sx, sy) >= alpha) continue;
        R.zb[pixel] = p.d;
        for (let j = 0; j < 3; j++) R.pix[pixel * 4 + j] = this.pool.colors[at + j] * 255;
        R.pix[pixel * 4 + 3] = 255;
      }
    }
  }
}
