import { RECORDER_X, RECORDER_Y } from '../anim/recorder';
import { LIGHT, VIEW_FORWARD } from './camera';
import type { SceneFrame } from './types';

export const NOTE_CAPACITY = 2;
// Top-to-bottom five-pixel rows. Narrow quaver / occasional paired quavers.
export const NOTE_MASKS = new Int32Array([6, 10, 2, 14, 12, 15, 9, 9, 27, 18]);
const RANDOM = Float64Array.from({ length: 256 }, (_, n) => ((Math.imul(n + 71, 0x45d9f3b) >>> 0) % 65536) / 65536);
// Lighting/haze sampled once at the grille: the 27 cm plume stays in this pool of light.
const X = RECORDER_X - .16, Y = RECORDER_Y - .13, Z = .285;
const dx = LIGHT.lamps[0].pos[0] - X, dy = LIGHT.lamps[0].pos[1] - Y, dz = LIGHT.lamps[0].pos[2] - Z;
const distance = Math.hypot(dx, dy, dz);
const warmth = Math.min(1, (dz / distance) ** 4 / (1 + distance * distance * .18));
const depth = -((X - .1) * VIEW_FORWARD[0] + (Y - .1) * VIEW_FORWARD[1] + (Z - .6) * VIEW_FORWARD[2]);
const near = -(-.1 * VIEW_FORWARD[0] - 3.1 * VIEW_FORWARD[1] - .6 * VIEW_FORWARD[2]);
const far = -(-.1 * VIEW_FORWARD[0] + 4.5 * VIEW_FORWARD[1] - .6 * VIEW_FORWARD[2]);
const haze = Math.max(0, Math.min(1, (near - depth) / (near - far))) ** 2 * .55;
const RED = ((146 + warmth * 22) * (1 - haze) + 34 * haze) / 255;
const GREEN = ((143 + warmth * 16) * (1 - haze) + 38 * haze) / 255;
const BLUE = ((131 + warmth * 8) * (1 - haze) + 58 * haze) / 255;
/** Shared world-space simulation. Fixed storage, including colour and draw data.
 * Beatmap timestamps, not successful hits, trigger notes; silence stays silent. */
export class RecorderNotes {
  readonly positions = new Float32Array(NOTE_CAPACITY * 3);
  readonly opacity = new Float32Array(NOTE_CAPACITY);
  readonly shapes = new Float32Array(NOTE_CAPACITY);
  readonly colors = new Float32Array(NOTE_CAPACITY * 3);
  private readonly born = new Float64Array(NOTE_CAPACITY).fill(-Infinity);
  private readonly drift = new Float64Array(NOTE_CAPACITY);
  // Typed clocks avoid boxing changing floating-point class properties in V8.
  // Slots: last beatmap onset, previous presentation time, next allowed emission.
  private readonly clock = new Float64Array(3).fill(-Infinity);
  private sequence = 0;
  constructor() {
    for (let i = 0; i < NOTE_CAPACITY; i++) {
      this.colors[i * 3] = RED; this.colors[i * 3 + 1] = GREEN; this.colors[i * 3 + 2] = BLUE;
    }
  }
  update(frame: SceneFrame) {
    const t = frame.timeMs / 1000;
    if (!frame.playing || !frame.recorder.playing || t < this.clock[1]) {
      this.born.fill(-Infinity);
      this.opacity.fill(0);
      this.clock[0] = frame.musicNoteTime[0];
      this.clock[2] = t + .55;
      this.clock[1] = t;
      return;
    }
    this.clock[1] = t;
    if (frame.musicNoteTime[0] > this.clock[0]) {
      this.clock[0] = frame.musicNoteTime[0];
      const r = RANDOM[this.sequence++ & 255];
      if (t >= this.clock[2] && r > .28) {
        for (let i = 0; i < NOTE_CAPACITY; i++) {
          if (t - this.born[i] < 1.65) continue;
          this.born[i] = t;
          this.drift[i] = r;
          this.shapes[i] = r > .8 ? 1 : 0;
          this.clock[2] = t + .65 + r * .65;
          break;
        }
      }
    }
    for (let i = 0; i < NOTE_CAPACITY; i++) {
      const age = t - this.born[i];
      if (age < 0 || age >= 1.65) { this.opacity[i] = 0; continue; }
      const r = this.drift[i], p = i * 3;
      const x = X - age * (.025 + r * .025);
      const y = Y + Math.sin(age * 2 + r * 6) * .015;
      const z = Z + age / 1.65 * .27;
      this.positions[p] = x; this.positions[p + 1] = y; this.positions[p + 2] = z;
      // Hold the tiny silhouette briefly, then evaporate in the scene's Bayer pattern.
      this.opacity[i] = .86 * Math.min(1, age / .12) * Math.min(1, (1.65 - age) / .85);
    }
  }
}
