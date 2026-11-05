import type { RGB, Vec3 } from '../pixel/engine3d';
import type { Look } from '../pixel/figures';
import type { JointPose } from '../rig/joints';
export interface FigureView {
  pose: JointPose;
  look: Look;
  visible: boolean;
}
export interface BallView {
  pos: Vec3;
  color: RGB;
  alpha: number;
  holdProgress: number;
}
export interface LaneView {
  x: number;
  pressed: boolean;
}
/** Reused storage. Backends must not retain a pose beyond this frame. */
export interface SceneFrame {
  player: FigureView;
  stranger: FigureView;
  balls: BallView[];
  ballCount: number;
  lanes: LaneView[];
  laneCount: number;
  flicker: boolean;
  shakeX: number;
  shakeY: number;
}
export interface SceneBackend {
  readonly kind: 'cpu' | 'gl';
  render(frame: SceneFrame): HTMLCanvasElement;
  dispose(): void;
}
