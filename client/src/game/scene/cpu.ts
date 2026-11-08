import { CPURecorderNotes } from '../pixel/recorder-notes';
import { CPURecorder } from '../pixel/recorder';
import { createCourtyard, paintCourtyard, TABLE_HALF_L, TABLE_HALF_W, TABLE_Z } from '../pixel/courtyard';
import { drawFigure } from '../pixel/figures';
import { makeCanvas, LOW_H, LOW_W } from '../pixel/stage';
import type { Vec3 } from '../pixel/engine3d';
import type { ShadowSink } from '../pixel/figures';
import type { SceneBackend, SceneFrame } from './types';
export class CPUBackend implements SceneBackend {
  readonly kind = 'cpu' as const;
  private readonly musicNotes = new CPURecorderNotes();
  private readonly recorder = new CPURecorder();
  private readonly renderer = createCourtyard();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly point: Vec3 = [0, 0, 0];
  private readonly shadow: ShadowSink = (a, b, radius) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / Math.min(0.1, radius * 0.7)));
    for (let k = 0; k <= n; k++) {
      for (let c = 0; c < 3; c++)
        this.point[c] = a[c] + (b[c] - a[c]) * k / n;
      this.renderer.castShadow(this.point, radius, 2);
    }
  };
  constructor() {
    paintCourtyard(this.renderer);
    [this.canvas, this.ctx] = makeCanvas(LOW_W, LOW_H);
  }
  render(frame: SceneFrame) {
    const R = this.renderer;
    R.restore();
    this.recorder.draw(R, frame.recorder);
    if (frame.stranger.visible)
      drawFigure(R, frame.stranger.pose, frame.stranger.look, this.shadow);
    for (let i = 0; i < frame.laneCount; i++) {
      const lane = frame.lanes[i];
      const color: Vec3 = lane.pressed ? PRESSED : UNPRESSED;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 20) {
        this.point[0] = lane.x + Math.cos(a) * 0.13;
        this.point[1] = -TABLE_HALF_L + 0.16 + Math.sin(a) * 0.09;
        this.point[2] = TABLE_Z + 0.002;
        R.sphere(this.point, 0.011, color, 'emissive');
      }
      if (lane.pressed)
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
          this.point[0] = lane.x + Math.cos(a) * 0.07;
          this.point[1] = -TABLE_HALF_L + 0.16 + Math.sin(a) * 0.045;
          R.sphere(this.point, 0.03, color, 'emissive');
        }
    }
    for (let i = 0; i < frame.ballCount; i++) {
      const ball = frame.balls[i], p = ball.pos;
      const overTable = Math.abs(p[0]) <= TABLE_HALF_W && Math.abs(p[1]) <= TABLE_HALF_L && p[2] >= TABLE_Z;
      R.dropShadow(p[0], p[1], overTable ? TABLE_Z : 0, 0.055 * 1.1);
      R.sphere(p, 0.055, ball.color, 'gloss', ball.alpha);
    }
    if (frame.player.visible)
      drawFigure(R, frame.player.pose, frame.player.look, this.shadow);
    R.applyShadows();
    R.edges();
    this.musicNotes.draw(R, frame);
    this.ctx.putImageData(R.image, 0, 0);
    return this.canvas;
  }
  dispose() { this.canvas.width = this.canvas.height = 0; }
}
const PRESSED: Vec3 = [236, 150, 166];
const UNPRESSED: Vec3 = [178, 204, 198];
