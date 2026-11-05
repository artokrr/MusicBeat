// Shared frame size, palette and canvas helper for the pixel renderer.
//
// Everything is drawn into a 384x216 low-res frame, then scaled up by a whole
// number. Game logic runs in its own 800x600 space; renderer.ts maps it into
// the 3D courtyard.

export const LOW_W = 384;
export const LOW_H = 216;

/** Gameplay units (800x600) to frame pixels, for screen shake. */
export const WORLD_SCALE = 0.32;

// Clickable icons in the bottom-right corner, in frame pixels. The HTML buttons
// that sit over them read these so the hit areas line up with the drawing.
export const HUD_PAUSE_RECT = { x: LOW_W - 30, y: LOW_H - 15, w: 12, h: 12 };
export const HUD_VOLUME_RECT = { x: LOW_W - 17, y: LOW_H - 15, w: 14, h: 12 };

/** Interface colours: cold, desaturated, warm only for highlights. */
export const PAL = {
  void: '#0a0a10',
  hudLine: '#2a2b38',
  text: '#e6e4ec',
  textDim: '#9a9bb0',
  rose: '#d47f8f',
  roseDeep: '#9a4e60',
  ball: '#f4f2f8',
  hold: '#94c4dc',
  switch: '#d47f8f',
  perfect: '#f1d79e',
  good: '#94c4dc',
  ok: '#b6a8dc',
  miss: '#d4657c',
} as const;

export function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}
