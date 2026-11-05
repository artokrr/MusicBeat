import { DataTexture, NearestFilter, RedFormat, UnsignedByteType } from 'three';
import type { JointPose, Vec3 } from '../rig/joints';
import type { SceneFrame } from '../scene/types';

const WIDTH = 192, HEIGHT = 256, STEP_X = 6 / WIDTH, STEP_Y = 8 / HEIGHT;
/** A 48KiB world-space accumulation map for the 6x8m patch around the table.
 * Stamp only on grounded steps; upload only on a stamp or slow 6-second decay. */
export class Footprints {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT);
  readonly texture = new DataTexture(this.pixels, WIDTH, HEIGHT, RedFormat, UnsignedByteType);
  stamps = 0;
  private readonly lastX = new Float64Array(4).fill(NaN);
  private readonly lastY = new Float64Array(4).fill(NaN);
  private readonly grounded = new Uint8Array(4);
  private wasPlaying = false;
  private lastDecay = 0;
  constructor() {
    this.texture.minFilter = this.texture.magFilter = NearestFilter;
    this.texture.needsUpdate = true;
  }
  private stamp(ankle: Vec3, toe: Vec3) {
    const x = (ankle[0] + toe[0]) * .5, y = (ankle[1] + toe[1]) * .5;
    const dx = toe[0] - ankle[0], dy = toe[1] - ankle[1], length = Math.hypot(dx, dy) || 1;
    const fx = dx / length, fy = dy / length;
    const cx = Math.floor((x + 3) / STEP_X), cy = Math.floor((y + 4) / STEP_Y);
    for (let iy = Math.max(0, cy - 5); iy <= Math.min(HEIGHT - 1, cy + 5); iy++) {
      for (let ix = Math.max(0, cx - 5); ix <= Math.min(WIDTH - 1, cx + 5); ix++) {
        const px = (ix + .5) * STEP_X - 3 - x, py = (iy + .5) * STEP_Y - 4 - y;
        const across = (px * fy - py * fx) / .058, along = (px * fx + py * fy) / .135;
        const r = across * across + along * along;
        if (r > 1) continue;
        const index = iy * WIDTH + ix;
        this.pixels[index] = Math.min(190, this.pixels[index] + (r < .55 ? 105 : 65));
      }
    }
    this.stamps++;
    this.texture.needsUpdate = true;
  }
  private foot(ankle: Vec3, toe: Vec3, i: number) {
    const planted = ankle[2] < .085 && toe[2] < .035;
    if (planted && (!this.grounded[i] || !Number.isFinite(this.lastX[i]) ||
      Math.hypot(ankle[0] - this.lastX[i], ankle[1] - this.lastY[i]) > .08)) {
      this.stamp(ankle, toe);
      this.lastX[i] = ankle[0]; this.lastY[i] = ankle[1];
    }
    this.grounded[i] = planted ? 1 : 0;
  }
  private figure(pose: JointPose, first: number) {
    const j = pose.joints;
    this.foot(j.ankleL, j.toeL, first);
    this.foot(j.ankleR, j.toeR, first + 1);
  }
  update(frame: SceneFrame) {
    const t = frame.timeMs / 1000;
    if ((frame.playing && !this.wasPlaying) || t < this.lastDecay) {
      this.pixels.fill(0); this.lastX.fill(NaN); this.grounded.fill(0);
      this.stamps = 0; this.lastDecay = t; this.texture.needsUpdate = true;
    }
    this.wasPlaying = frame.playing;
    const decay = Math.floor((t - this.lastDecay) / 6);
    if (decay > 0) {
      this.lastDecay += decay * 6;
      for (let i = 0; i < this.pixels.length; i++) this.pixels[i] = Math.max(0, this.pixels[i] - decay);
      this.texture.needsUpdate = true;
    }
    if (!frame.playing) return;
    if (frame.player.visible) this.figure(frame.player.pose, 0);
    if (frame.stranger.visible) this.figure(frame.stranger.pose, 2);
  }
  dispose() { this.texture.dispose(); }
}
