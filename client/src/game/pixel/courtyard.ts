// The courtyard at night: camera, light, and everything that never moves.
// World units are metres: x to the right, y away from the camera along the
// table, z up. The table is centred on the origin.

import { Renderer3D, bayer, clamp, hash, lerp, noise, type RGB, type Vec3 } from './engine3d';
import { CAMERA, LIGHT } from '../scene/camera';

export type CourtyardPainter = Pick<Renderer3D, 'box' | 'capsule' | 'castShadow'>;

export const TABLE_HALF_W = 0.7625;
export const TABLE_HALF_L = 1.37;
export const TABLE_Z = 0.76;

export const LAMP_POS: Vec3 = [1.95, 0.35, 3.25];

const SNOW_TONES: RGB[] = [[150, 156, 178], [162, 168, 190], [174, 180, 200], [186, 191, 210]];
const SNOW: RGB = [196, 202, 220];
const TABLE_GREEN: RGB = [42, 88, 84];
const LINE: RGB = [214, 218, 226];
const METAL: RGB = [58, 60, 70];
const WALL: RGB = [104, 106, 118];
const BARK: RGB = [52, 48, 50];
const WOOD: RGB = [96, 78, 66];
const SKY: RGB = [12, 13, 22];
const BUILDING_Y = 4.6;

export function createCourtyard(): Renderer3D {
  return new Renderer3D(CAMERA, LIGHT);
}

/** Paints the static scene into the renderer and keeps it as the backdrop. */
export function paintCourtyard(R: Renderer3D) {
  paintGround(R);
  paintCourtyardGeometry(R);
  R.applyShadows();
  fog(R);
  R.bake();
}

/** Shared geometry recipe; GPU batches it once instead of sampling box faces. */
export function paintCourtyardGeometry(R: CourtyardPainter) {
  paintBuilding(R);
  paintTable(R);
  paintLampPost(R);
  paintBench(R);
  paintBallBasket(R);
  paintTree(R, [-3.4, 3.6, 0], 1.9, 0.13, 11);
  paintTree(R, [3.9, 3.9, 0], 1.7, 0.11, 23);
}

function paintGround(R: Renderer3D) {
  R.ground((p, ix, iy) => {
    const [x, y] = p;
    if (y > BUILDING_Y) return null;
    const fine = hash(ix, iy);
    const v = 0.55 + (noise(x * 0.9 + 3, y * 0.9) - 0.5) * 0.6 + (fine - 0.5) * 0.25;
    // Close tones, so the dither reads as texture rather than a checkerboard.
    const base = SNOW_TONES[clamp(Math.floor(v * 4 + (bayer(ix, iy) - 0.5) * 0.6), 0, 3)]!;
    const [l, warm] = R.lightAt(p, [0, 0, 1]);
    const k = clamp(l / 0.75, 0.35, 1.6);
    const w = Math.min(0.5, warm * 0.7);
    return [lerp(base[0] * k, 255 * k * 0.9, w), lerp(base[1] * k, 196 * k * 0.9, w), lerp(base[2] * k, 140 * k * 0.9, w)];
  }, SKY);
}

function paintBuilding(R: CourtyardPainter) {
  R.box(-12, BUILDING_Y, 0, 12, BUILDING_Y + 0.6, 9, WALL, {
    surface: 'wall',
    grain: 2,
    paint: (wp, n) => {
      if (n[1] !== -1) return WALL;
      const col = Math.floor((wp[0] + 12) / 1.6);
      const row = Math.floor(wp[2] / 2.4);
      const lx = ((wp[0] + 12) % 1.6) / 1.6;
      const lz = (wp[2] % 2.4) / 2.4;
      if (wp[2] < 0.4) return [70, 70, 80];
      if (lx > 0.28 && lx < 0.72 && lz > 0.35 && lz < 0.75) {
        if (hash(col, row) < 0.22) return { solid: hash(col + 3, row) < 0.6 ? [214, 172, 116] : [190, 140, 128] };
        return { solid: [30, 32, 44] };
      }
      if (col === 7 && wp[2] < 2.2 && lx > 0.2 && lx < 0.8) return { solid: [24, 22, 26] };
      return WALL;
    },
  });
}

function paintTable(R: CourtyardPainter) {
  const legs: Array<[number, number]> = [[-0.6, -1.0], [0.6, -1.0], [-0.6, 1.0], [0.6, 1.0]];
  for (const [lx, ly] of legs) {
    R.box(lx - 0.025, ly - 0.025, 0, lx + 0.025, ly + 0.025, TABLE_Z - 0.04, METAL);
    for (let z = 0.1; z < TABLE_Z; z += 0.2) R.castShadow([lx, ly, z], 0.05, 2);
  }
  R.box(-0.04, -0.4, 0, 0.04, 0.4, 0.06, METAL);
  R.box(-TABLE_HALF_W, -TABLE_HALF_L, TABLE_Z - 0.04, TABLE_HALF_W, TABLE_HALF_L, TABLE_Z, TABLE_GREEN, {
    surface: 'table',
    receiver: true,
    grain: 6,
    dither: 0.4,
    paint: (wp, n) => {
      if (n[2] !== 1) return [30, 60, 58];
      const edge = Math.abs(Math.abs(wp[0]) - TABLE_HALF_W) < 0.025 || Math.abs(Math.abs(wp[1]) - TABLE_HALF_L) < 0.025;
      if (edge || Math.abs(wp[0]) < 0.01) return LINE;
      return TABLE_GREEN;
    },
  });
  // The net: a white tape over a dark mesh.
  R.box(-TABLE_HALF_W - 0.05, -0.01, TABLE_Z, TABLE_HALF_W + 0.05, 0.01, TABLE_Z + 0.15, [150, 154, 168], {
    surface: 'net',
    paint: (wp) => {
      if (wp[2] > TABLE_Z + 0.13) return [220, 222, 230];
      if (Math.abs(Math.abs(wp[0]) - TABLE_HALF_W - 0.03) < 0.02) return METAL;
      return (Math.floor(wp[0] * 60) + Math.floor(wp[2] * 60)) % 2 ? null : [40, 42, 52];
    },
  });
  for (let x = -TABLE_HALF_W; x <= TABLE_HALF_W; x += 0.2) {
    for (let y = -TABLE_HALF_L; y <= TABLE_HALF_L; y += 0.2) R.castShadow([x, y, TABLE_Z], 0.16, 2);
  }
}

function paintLampPost(R: CourtyardPainter) {
  const [x, y] = [LAMP_POS[0] + 0.3, LAMP_POS[1]];
  R.capsule([x, y, 0], [x, y, 3.3], 0.05, 0.04, METAL);
  R.capsule([x, y, 3.3], [x - 0.3, y, 3.36], 0.035, 0.03, METAL);
  R.box(x - 0.42, y - 0.08, 3.28, x - 0.18, y + 0.08, 3.36, METAL);
  for (let z = 0.1; z < 3.3; z += 0.03) R.castShadow([x, y, z], 0.06, 2);
}

function paintBench(R: CourtyardPainter) {
  const bx = -3.0;
  const by = 0.6;
  R.box(bx - 0.25, by - 0.9, 0.42, bx + 0.25, by + 0.9, 0.48, WOOD, { grain: 8 });
  R.box(bx - 0.32, by - 0.9, 0.55, bx - 0.26, by + 0.9, 0.85, WOOD, { grain: 8 });
  for (const dy of [-0.8, 0.8]) R.box(bx - 0.2, by + dy - 0.03, 0, bx + 0.2, by + dy + 0.03, 0.42, METAL);
  R.box(bx - 0.24, by - 0.88, 0.48, bx + 0.24, by + 0.88, 0.5, SNOW);
  for (let y = -0.8; y <= 0.8; y += 0.2) R.castShadow([bx, by + y, 0.45], 0.22, 2);
}

function paintTree(R: CourtyardPainter, root: Vec3, length: number, radius: number, seed: number) {
  const branch = (a: Vec3, dir: Vec3, len: number, rad: number, depth: number, s: number) => {
    const b: Vec3 = [a[0] + dir[0] * len, a[1] + dir[1] * len, a[2] + dir[2] * len];
    R.capsule(a, b, rad, rad * 0.7, BARK, 'rough');
    if (depth === 0) return;
    const n = depth > 2 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const h = hash(s * 13 + k, depth * 7);
      const ang = (h - 0.5) * 2.2 + (k - (n - 1) / 2) * 0.9;
      const tilt = 0.35 + hash(s + k, 3) * 0.5;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      let d: Vec3 = [
        dir[0] * ca - dir[1] * sa * 0.5 + (hash(k, s) - 0.5) * tilt,
        dir[1] * ca + dir[0] * sa * 0.5 + (hash(s, k) - 0.5) * tilt,
        dir[2] * 0.8 + 0.25,
      ];
      const l = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / l, d[1] / l, d[2] / l];
      branch(b, d, len * (0.62 + h * 0.15), rad * 0.62, depth - 1, s * 3 + k + 1);
    }
  };
  branch(root, [0.05, 0, 1], length, radius, 5, seed);
  for (let z = 0.1; z < length; z += radius) R.castShadow([root[0], root[1], z], radius, 2);
}

/** Distance haze towards the building, and the night sky above it. */
function fog(R: Renderer3D) {
  const far = R.project([0, BUILDING_Y, 0]).d;
  const near = R.project([0, -3, 0]).d;
  const haze: RGB = [34, 38, 58];
  for (let i = 0; i < R.W * R.H; i++) {
    const d = R.zb[i]!;
    if (d === -Infinity) continue;
    const t = clamp((near - d) / (near - far), 0, 1);
    const k = t * t * 0.55;
    const o = i * 4;
    R.pix[o] = lerp(R.pix[o]!, haze[0], k);
    R.pix[o + 1] = lerp(R.pix[o + 1]!, haze[1], k);
    R.pix[o + 2] = lerp(R.pix[o + 2]!, haze[2], k);
  }
}


/** Static low-cost basket for CPU and the GL asset-loading fallback. */
function paintBallBasket(R: CourtyardPainter) {
  const x = 0.78, y = 1.95;
  for (const dx of [-0.16, 0.16]) for (const dy of [-0.14, 0.14])
    R.box(x + dx - .012, y + dy - .012, .02, x + dx + .012, y + dy + .012, .76, METAL);
  R.box(x - .2, y - .17, .74, x + .2, y + .17, .77, METAL);
  for (const z of [.78, .87, .98]) {
    R.box(x - .21, y - .18, z - .01, x + .21, y - .16, z + .01, METAL);
    R.box(x - .21, y + .16, z - .01, x + .21, y + .18, z + .01, METAL);
    R.box(x - .21, y - .17, z - .01, x - .19, y + .17, z + .01, METAL);
    R.box(x + .19, y - .17, z - .01, x + .21, y + .17, z + .01, METAL);
  }
  for (const dx of [-.16, -.08, 0, .08, .16]) for (const dy of [-.17, .17])
    R.box(x + dx - .006, y + dy - .006, .77, x + dx + .006, y + dy + .006, .98, METAL);
  for (const dx of [-.12, 0, .12]) for (const dy of [-.07, .07])
    R.capsule([x + dx, y + dy, .93], [x + dx, y + dy, .94], .043, .043, LINE);
  R.castShadow([x, y, .85], .23, 2);
}
