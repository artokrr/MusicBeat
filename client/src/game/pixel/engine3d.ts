// A tiny 3D renderer that draws straight into the low-res pixel buffer.
//
// Orthographic camera, a depth buffer, and three primitives: spheres (and
// capsules made of spheres), axis-aligned boxes, and the ground plane. Every
// surface is lit by the moon and the street lamp, then posterized into five
// tones per material with an ordered dither: shadows drift towards a cold
// blue, light towards warm. Shadows are cast onto "receivers" (the ground and
// the table top), and outlines come from depth breaks.

import { LOW_H, LOW_W } from './stage';

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];

const W = LOW_W;
const H = LOW_H;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (ix: number, iy: number) => BAYER[(iy & 3) * 4 + (ix & 3)]!;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

export function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = ease(x - ix);
  const fy = ease(y - iy);
  return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), fx), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface Lamp {
  pos: Vec3;
  strength: number;
  radius: number;
}

export interface CameraOptions {
  scale: number; // pixels per metre
  yaw: number;
  pitch: number;
  target: Vec3;
  offsetX?: number;
  offsetY?: number;
}

export interface LightOptions {
  moon: Vec3; // direction towards the moon
  moonStrength: number;
  ambient: number;
  cool: RGB;
  warm: RGB;
  lamps: Lamp[];
}

/** 'solid' figures get flat bands, 'rough' adds grain (bark), 'gloss' a hard highlight (balls). */
export type SurfaceMode = 'solid' | 'rough' | 'gloss' | 'emissive';

export interface BoxPaint {
  /** Base colour for a point on a face, a fixed colour (`solid`), or null to leave a hole. */
  (point: Vec3, normal: Vec3): RGB | { solid: RGB } | null;
}

export interface BoxOptions {
  paint?: BoxPaint;
  grain?: number;
  dither?: number;
  /** Mark the top face as a shadow receiver (the table top). */
  receiver?: boolean;
}

const SHADOW_SOFT = [0.8, 0.8, 0.87] as const;
const SHADOW_HARD = [0.64, 0.65, 0.76] as const;

export class Renderer3D {
  readonly W = W;
  readonly H = H;
  /** RGBA pixels, ready for putImageData. */
  readonly image: ImageData;
  readonly pix: Uint8ClampedArray;
  readonly zb = new Float32Array(W * H);
  /** Depth of the receiving surface (ground or table top) at each pixel, or -Infinity. */
  readonly recvZ = new Float32Array(W * H);
  private readonly shadow = new Uint8Array(W * H);

  private readonly bakedPix: Uint8ClampedArray;
  private readonly bakedZ = new Float32Array(W * H);

  readonly S: number;
  private readonly f: Vec3;
  private readonly r: Vec3;
  private readonly u: Vec3;
  private readonly ox: number;
  private readonly oy: number;
  private readonly target: Vec3;
  readonly pitch: number;
  readonly light: LightOptions;
  private readonly moon: Vec3;

  constructor(camera: CameraOptions, light: LightOptions) {
    this.image = new ImageData(W, H);
    this.pix = this.image.data;
    this.bakedPix = new Uint8ClampedArray(W * H * 4);
    this.S = camera.scale;
    this.pitch = camera.pitch;
    this.f = normalize([Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch), -Math.sin(camera.pitch)]);
    this.r = normalize(cross(this.f, [0, 0, 1]));
    this.u = cross(this.r, this.f);
    this.ox = W / 2 + (camera.offsetX ?? 0);
    this.oy = H / 2 + (camera.offsetY ?? 0);
    this.target = camera.target;
    this.light = light;
    this.moon = normalize(light.moon);
    this.zb.fill(-Infinity);
    this.recvZ.fill(-Infinity);
  }

  // ---------- camera ----------

  project(p: Vec3): { sx: number; sy: number; d: number } {
    const q: Vec3 = [p[0] - this.target[0], p[1] - this.target[1], p[2] - this.target[2]];
    return { sx: this.ox + dot(q, this.r) * this.S, sy: this.oy - dot(q, this.u) * this.S, d: -dot(q, this.f) };
  }

  /** The point on the ground (z = 0) under a screen pixel. */
  unprojectGround(sx: number, sy: number): Vec3 {
    const a = (sx - this.ox) / this.S;
    const b = -(sy - this.oy) / this.S;
    const { r, u, f, target } = this;
    const t = -(target[2] + r[2] * a + u[2] * b) / f[2];
    return [target[0] + r[0] * a + u[0] * b + f[0] * t, target[1] + r[1] * a + u[1] * b + f[1] * t, 0];
  }

  // ---------- light and colour ----------

  /** Light reaching a point with a normal: [intensity, warm part of it]. */
  lightAt(p: Vec3, n: Vec3): [number, number] {
    const { ambient, moonStrength, lamps } = this.light;
    let l = ambient + Math.max(0, dot(n, this.moon)) * moonStrength;
    let warm = 0;
    for (const lamp of lamps) {
      const vx = lamp.pos[0] - p[0];
      const vy = lamp.pos[1] - p[1];
      const vz = lamp.pos[2] - p[2];
      const dist = Math.hypot(vx, vy, vz);
      const ndl = Math.max(0, (n[0] * vx + n[1] * vy + n[2] * vz) / dist);
      // A street lamp throws its light down, not sideways.
      const down = Math.max(0, vz / dist);
      const c = (ndl * lamp.strength * down ** 6) / (1 + (dist / lamp.radius) ** 2);
      l += c;
      warm += c;
    }
    return [l, clamp(warm, 0, 1)];
  }

  /** Posterize a lit colour into one of five tones, cool in the dark and warm in lamp light. */
  shade(base: RGB, l: number, warm: number, ix: number, iy: number, ditherAmt: number): RGB {
    const k = clamp(Math.floor(l * 4.2 + 0.3 + (bayer(ix, iy) - 0.5) * ditherAmt), 0, 4);
    const m = TONE_SCALE[k]!;
    const coolMix = TONE_COOL[k]!;
    const { cool, warm: warmColor } = this.light;
    let r = lerp(base[0] * m, cool[0], coolMix);
    let g = lerp(base[1] * m, cool[1], coolMix);
    let b = lerp(base[2] * m, cool[2], coolMix);
    if (warm > 0.12 + (bayer(ix, iy) - 0.5) * 0.15) {
      const w = Math.min(0.45, warm * 0.7);
      r = lerp(r, warmColor[0] * m, w);
      g = lerp(g, warmColor[1] * m, w);
      b = lerp(b, warmColor[2] * m, w);
    }
    return [r, g, b];
  }

  put(i: number, c: RGB) {
    const o = i * 4;
    this.pix[o] = c[0];
    this.pix[o + 1] = c[1];
    this.pix[o + 2] = c[2];
    this.pix[o + 3] = 255;
  }

  private tint(i: number, k: readonly [number, number, number]) {
    const o = i * 4;
    this.pix[o] *= k[0];
    this.pix[o + 1] *= k[1];
    this.pix[o + 2] *= k[2];
  }

  // ---------- primitives ----------

  /** Fill every pixel showing ground with `colorAt` (which may return null for sky). */
  ground(colorAt: (p: Vec3, ix: number, iy: number) => RGB | null, sky: RGB) {
    for (let iy = 0; iy < H; iy++) {
      for (let ix = 0; ix < W; ix++) {
        const i = iy * W + ix;
        const p = this.unprojectGround(ix + 0.5, iy + 0.5);
        const c = colorAt(p, ix, iy);
        if (!c) {
          this.put(i, sky);
          continue;
        }
        this.put(i, c);
        const d = this.project(p).d;
        this.zb[i] = d;
        this.recvZ[i] = d;
      }
    }
  }

  sphere(c: Vec3, rad: number, base: RGB, mode: SurfaceMode = 'solid', alpha = 1) {
    const p = this.project(c);
    const rp = Math.max(rad * this.S, 0.6);
    const y0 = Math.max(0, Math.floor(p.sy - rp));
    const y1 = Math.min(H - 1, Math.ceil(p.sy + rp));
    const x0 = Math.max(0, Math.floor(p.sx - rp));
    const x1 = Math.min(W - 1, Math.ceil(p.sx + rp));
    const { r, u, f } = this;
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const dx = (ix + 0.5 - p.sx) / rp;
        const dy = (iy + 0.5 - p.sy) / rp;
        const nn = dx * dx + dy * dy;
        if (nn > 1) continue;
        if (alpha < 1 && bayer(ix, iy) >= alpha) continue;
        const nz = Math.sqrt(1 - nn);
        const d = p.d + rad * nz;
        const i = iy * W + ix;
        if (d <= this.zb[i]!) continue;
        this.zb[i] = d;
        if (mode === 'emissive') {
          this.put(i, base);
          continue;
        }
        const n: Vec3 = [r[0] * dx - u[0] * dy - f[0] * nz, r[1] * dx - u[1] * dy - f[1] * nz, r[2] * dx - u[2] * dy - f[2] * nz];
        const wp: Vec3 = [c[0] + n[0] * rad, c[1] + n[1] * rad, c[2] + n[2] * rad];
        let [l, warm] = this.lightAt(wp, n);
        if (mode === 'rough') l += (hash(ix, iy) - 0.5) * 0.4;
        if (mode === 'gloss' && l > 0.85) {
          this.put(i, [252, 250, 244]);
          continue;
        }
        this.put(i, this.shade(base, l, warm, ix, iy, mode === 'solid' ? 0.15 : 0.7));
      }
    }
  }

  capsule(a: Vec3, b: Vec3, r0: number, r1: number, base: RGB, mode: SurfaceMode = 'solid') {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len / (Math.min(r0, r1) * 0.4)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      this.sphere([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)], lerp(r0, r1, t), base, mode);
    }
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, base: RGB, opt: BoxOptions = {}) {
    const step = 0.6 / this.S;
    const faces: Array<[Vec3, (a: number, b: number) => Vec3, number, number]> = [
      [[0, 0, 1], (a, b) => [lerp(x0, x1, a), lerp(y0, y1, b), z1], x1 - x0, y1 - y0],
      [[0, -1, 0], (a, b) => [lerp(x0, x1, a), y0, lerp(z0, z1, b)], x1 - x0, z1 - z0],
      [[0, 1, 0], (a, b) => [lerp(x0, x1, a), y1, lerp(z0, z1, b)], x1 - x0, z1 - z0],
      [[-1, 0, 0], (a, b) => [x0, lerp(y0, y1, a), lerp(z0, z1, b)], y1 - y0, z1 - z0],
      [[1, 0, 0], (a, b) => [x1, lerp(y0, y1, a), lerp(z0, z1, b)], y1 - y0, z1 - z0],
    ];
    for (const [n, at, la, lb] of faces) {
      if (dot(n, this.f) >= 0) continue; // facing away from the camera
      const isTop = n[2] === 1;
      const na = Math.max(1, Math.ceil(la / step));
      const nb = Math.max(1, Math.ceil(lb / step));
      for (let ka = 0; ka <= na; ka++) {
        for (let kb = 0; kb <= nb; kb++) {
          const wp = at(ka / na, kb / nb);
          const p = this.project(wp);
          const ix = Math.floor(p.sx);
          const iy = Math.floor(p.sy);
          if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
          const i = iy * W + ix;
          if (p.d <= this.zb[i]! + 1e-4) continue;
          const col = opt.paint ? opt.paint(wp, n) : base;
          if (!col) continue;
          this.zb[i] = p.d;
          if (opt.receiver && isTop) this.recvZ[i] = p.d;
          else if (this.recvZ[i]! > -Infinity) this.recvZ[i] = -Infinity;
          if ('solid' in col) {
            this.put(i, col.solid);
            continue;
          }
          let [l, warm] = this.lightAt(wp, n);
          if (opt.grain) l += (noise(wp[0] * opt.grain + wp[2] * 3, wp[1] * opt.grain + wp[2] * 9) - 0.5) * 0.35;
          this.put(i, this.shade(col, l, warm, ix, iy, opt.dither ?? 0.25));
        }
      }
    }
  }

  /** Mark where a sphere's shadow falls, from the moon and from nearby lamps. 1 = soft, 2 = hard. */
  castShadow(c: Vec3, rad: number, strength: 1 | 2 = 2, surfaceZ = 0) {
    const h = c[2] - surfaceZ;
    if (h < -0.01) return;
    const m = this.moon;
    this.markShadow(c[0] - (m[0] * h) / m[2], c[1] - (m[1] * h) / m[2], surfaceZ, rad, strength === 2 ? 1 : 2);
    for (const lamp of this.light.lamps) {
      const lh = lamp.pos[2] - surfaceZ;
      if (h >= lh - 0.05) continue;
      if (Math.hypot(c[0] - lamp.pos[0], c[1] - lamp.pos[1]) > lamp.radius * 1.3) continue;
      const t = lh / (lh - h);
      this.markShadow(lamp.pos[0] + (c[0] - lamp.pos[0]) * t, lamp.pos[1] + (c[1] - lamp.pos[1]) * t, surfaceZ, rad * Math.min(t, 1.3), strength);
    }
  }

  /** A contact shadow straight below a point (for the ball over the table). */
  dropShadow(x: number, y: number, surfaceZ: number, rad: number) {
    this.markShadow(x, y, surfaceZ, rad, 2);
  }

  private markShadow(gx: number, gy: number, gz: number, rad: number, strength: 1 | 2) {
    const p = this.project([gx, gy, gz]);
    const rx = rad * this.S * 1.05;
    const ry = rx * Math.sin(this.pitch) + 0.5;
    const y0 = Math.max(0, Math.floor(p.sy - ry));
    const y1 = Math.min(H - 1, Math.ceil(p.sy + ry));
    const x0 = Math.max(0, Math.floor(p.sx - rx));
    const x1 = Math.min(W - 1, Math.ceil(p.sx + rx));
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const dx = (ix + 0.5 - p.sx) / rx;
        const dy = (iy + 0.5 - p.sy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const i = iy * W + ix;
        if (this.shadow[i]! < strength) this.shadow[i] = strength;
      }
    }
  }

  /** Darken marked receiver pixels that nothing else covers, then clear the marks. */
  applyShadows() {
    for (let i = 0; i < W * H; i++) {
      const s = this.shadow[i]!;
      if (!s) continue;
      this.shadow[i] = 0;
      if (this.recvZ[i] === -Infinity || this.zb[i] !== this.recvZ[i]) continue;
      if (s === 1 && bayer(i % W, (i / W) | 0) > 0.5) this.tint(i, SHADOW_SOFT);
      else this.tint(i, SHADOW_HARD);
    }
  }

  /** Outlines from depth: silhouettes darken against what's behind them. */
  edges() {
    const { zb, recvZ } = this;
    const background = (j: number) => zb[j] === recvZ[j] || zb[j] === -Infinity;
    for (let iy = 1; iy < H - 1; iy++) {
      for (let ix = 1; ix < W - 1; ix++) {
        const i = iy * W + ix;
        const d = zb[i]!;
        if (d === -Infinity || d === recvZ[i]) continue;
        if (background(i - W) || background(i + W) || background(i - 1) || background(i + 1)) {
          this.tint(i, EDGE_DARK);
        } else if (d - zb[i - W]! > 0.35 || d - zb[i - 1]! > 0.35 || d - zb[i + 1]! > 0.35) {
          this.tint(i, EDGE_SOFT);
        }
      }
    }
  }

  // ---------- frames ----------

  /** Remember the current picture as the static backdrop. */
  bake() {
    this.bakedPix.set(this.pix);
    this.bakedZ.set(this.zb);
  }

  /** Start a frame from the static backdrop. */
  restore() {
    this.pix.set(this.bakedPix);
    this.zb.set(this.bakedZ);
  }
}

const TONE_SCALE = [0.32, 0.52, 0.74, 0.95, 1.15];
const TONE_COOL = [0.45, 0.3, 0.15, 0.05, 0];
const EDGE_DARK = [0.62, 0.62, 0.74] as const;
const EDGE_SOFT = [0.82, 0.82, 0.9] as const;
