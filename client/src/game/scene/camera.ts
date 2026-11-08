// Shared projection, independent of the software framebuffer and Three.js.
import { LOW_H, LOW_W } from '../pixel/stage';
import type { CameraOptions, LightOptions, Vec3 } from '../pixel/engine3d';
export const CAMERA: CameraOptions = { scale: 44, yaw: 0.2, pitch: 0.75, target: [0.1, 0.1, 0.6], offsetY: 6 };
export const LIGHT: LightOptions = {
  moon: [-0.45, 0.55, 0.7], moonStrength: 0.42, ambient: 0.34,
  cool: [18, 20, 40], warm: [255, 190, 116],
  lamps: [{ pos: [1.95, 0.35, 3.25], strength: 3.2, radius: 2.2 }],
};
const sy = Math.sin(CAMERA.yaw), cy = Math.cos(CAMERA.yaw);
const sp = Math.sin(CAMERA.pitch), cp = Math.cos(CAMERA.pitch);
export const VIEW_FORWARD: Vec3 = [sy * cp, cy * cp, -sp];
export interface Projected {
  sx: number;
  sy: number;
  d: number;
}
/** Pass a reusable output in the render loop. */
export function project(p: Vec3, out: Projected = { sx: 0, sy: 0, d: 0 }): Projected {
  const x = p[0] - CAMERA.target[0], y = p[1] - CAMERA.target[1], z = p[2] - CAMERA.target[2];
  out.sx = LOW_W / 2 + (CAMERA.offsetX ?? 0) + (x * cy - y * sy) * CAMERA.scale;
  out.sy = LOW_H / 2 + (CAMERA.offsetY ?? 0) - (x * sy * sp + y * cy * sp + z * cp) * CAMERA.scale;
  out.d = -(x * VIEW_FORWARD[0] + y * VIEW_FORWARD[1] + z * VIEW_FORWARD[2]);
  return out;
}

/** Opening-only camera. CAMERA and the gameplay projection never change. */
export const INTRO_HOLD_MS = 2000;
export const INTRO_MOVE_MS = 4500;
const introCamera: CameraOptions = { ...CAMERA, target: [0, 0, 0] };
export function openingCamera(progress: number): CameraOptions {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  const remaining = 1 - eased;
  introCamera.scale = CAMERA.scale + (24 - CAMERA.scale) * remaining;
  introCamera.yaw = CAMERA.yaw + (.08 - CAMERA.yaw) * remaining;
  introCamera.pitch = CAMERA.pitch + (-.12 - CAMERA.pitch) * remaining;
  introCamera.target[0] = CAMERA.target[0] + (4 - CAMERA.target[0]) * remaining;
  introCamera.target[1] = CAMERA.target[1] + (4.6 - CAMERA.target[1]) * remaining;
  introCamera.target[2] = CAMERA.target[2] + (9 - CAMERA.target[2]) * remaining;
  return introCamera;
}
