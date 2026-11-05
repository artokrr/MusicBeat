// Canvas text in DotGothic16, kept on the pixel grid.
//
// DotGothic16 is drawn on a 16-unit grid, so at 16px one font dot is one art
// pixel. Each string is rendered once into an offscreen canvas, every pixel is
// snapped to fully on or off, and the result is cached and blitted.

export const FONT_FAMILY = 'DotGothic16';
export const FONT_SIZE = 16;
/** Height of one line of text in art pixels. */
export const LINE_HEIGHT = 16;
const FONT = `${FONT_SIZE}px "${FONT_FAMILY}"`;
// Baseline sits 14 dots down the 16-dot cell (typo ascender 880/1000).
const BASELINE = 14;

interface Glyphs {
  canvas: HTMLCanvasElement;
  width: number;
}

const cache = new Map<string, Glyphs>();
const CACHE_LIMIT = 256;
const requested = new Set<string>();
let scratch: CanvasRenderingContext2D | null = null;

function scratchContext(): CanvasRenderingContext2D {
  if (!scratch) {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = LINE_HEIGHT;
    scratch = canvas.getContext('2d', { willReadFrequently: true })!;
  }
  return scratch;
}

/** True once the font faces needed for `text` are loaded; starts loading them if not. */
function fontReady(text: string): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true;
  if (document.fonts.check(FONT, text)) return true;
  if (!requested.has(text)) {
    requested.add(text);
    void document.fonts.load(FONT, text);
  }
  return false;
}

/** Starts loading the font early so the first frames already use it. */
export function preloadPixelFont() {
  fontReady('0123456789 abcdefghijklmnopqrstuvwxyz');
}

export function measureText(text: string, scale = 1): number {
  const ctx = scratchContext();
  ctx.font = FONT;
  return Math.ceil(ctx.measureText(text).width) * scale;
}

/** Cuts text to fit maxWidth, ending with an ellipsis. */
export function fitText(text: string, maxWidth: number): string {
  if (measureText(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 0 && measureText(cut + '…') > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut.trimEnd() + '…';
}

function render(text: string, color: string): Glyphs {
  const key = `${color}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) {
    // Refresh its place: the cache evicts the least recently used.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const width = Math.max(1, measureText(text));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = LINE_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, BASELINE);

  // Snap anti-aliased edges to hard pixels.
  const image = ctx.getImageData(0, 0, width, LINE_HEIGHT);
  const data = image.data;
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i]! >= 110 ? 255 : 0;
  }
  ctx.putImageData(image, 0, 0);

  const glyphs = { canvas, width };
  // Don't keep a rendering made with a fallback font while the real one loads.
  if (fontReady(text)) {
    cache.set(key, glyphs);
    // Scores and combos make a new string on every hit; keep the cache bounded.
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return glyphs;
}

type Align = 'left' | 'center' | 'right';

interface TextOptions {
  scale?: number;
  align?: Align;
  outline?: string;
  shadow?: string;
}

/** Draws pixel text with its top-left (or top-center/right) at x, y. Returns the drawn width. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  options: TextOptions = {},
): number {
  const scale = options.scale ?? 1;
  const main = render(text, color);
  const width = main.width * scale;
  let left = Math.round(x);
  if (options.align === 'center') left = Math.round(x - width / 2);
  if (options.align === 'right') left = Math.round(x - width);
  const top = Math.round(y);
  const height = LINE_HEIGHT * scale;

  ctx.imageSmoothingEnabled = false;
  if (options.shadow) {
    ctx.drawImage(render(text, options.shadow).canvas, left + scale, top + scale, width, height);
  }
  if (options.outline) {
    const outline = render(text, options.outline).canvas;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      ctx.drawImage(outline, left + dx * scale, top + dy * scale, width, height);
    }
  }
  ctx.drawImage(main.canvas, left, top, width, height);
  return width;
}
