import { GLBackend } from '../gl/renderer';
import { CPUBackend } from './cpu';
import type { SceneBackend, SceneFrame } from './types';
let backend: SceneBackend | null = null;
let software: CPUBackend | null = null;
let fallbackReason: string | null = null;
const samples = new Float64Array(600);
let count = 0;
function activeBackend() {
  if (!backend) {
    if (new URLSearchParams(location.search).get('renderer') === 'cpu')
      backend = new CPUBackend();
    else {
      try {
        backend = new GLBackend();
      }
      catch (error) {
        fallbackReason = String(error);
        console.warn('WebGL unavailable; using CPU renderer.', error);
        backend = new CPUBackend();
      }
    }
  }
  if (backend instanceof GLBackend && !backend.available) {
    software ??= new CPUBackend();
    return software;
  }
  return backend;
}
export function presentScene(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
  const renderer = activeBackend();
  const start = performance.now();
  const canvas = renderer.render(frame);
  ctx.imageSmoothingEnabled = false;
  if (frame.shakeX || frame.shakeY)
    ctx.drawImage(canvas, 0, 0);
  ctx.drawImage(canvas, frame.shakeX, frame.shakeY);
  samples[count++ % samples.length] = performance.now() - start;
  return renderer.kind;
}
/** On-demand diagnostics; collection uses a fixed ring, no allocations per frame. */
export function rendererDiagnostics() {
  const sorted = Array.from(samples.subarray(0, Math.min(count, samples.length))).sort((a, b) => a - b);
  return {
    gpuTime: backend instanceof GLBackend ? backend.timing.stats() : null,
    backend: backend?.kind, fallbackReason, samples: sorted.length,
    medianMs: sorted[Math.floor(sorted.length * .5)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0,
    drawCalls: backend instanceof GLBackend ? backend.renderer.info.render.calls : null,
    triangles: backend instanceof GLBackend ? backend.renderer.info.render.triangles : null,
    props: backend instanceof GLBackend ? backend.props.status : null,
    paddles: backend instanceof GLBackend ? backend.paddles.status : null,
    footprintStamps: backend instanceof GLBackend ? backend.footprints.stamps : null,
    player: backend instanceof GLBackend ? backend.player.status : null,
    stranger: backend instanceof GLBackend ? backend.stranger.status : null,
  };
}
export function disposeRenderer() { backend?.dispose(); software?.dispose(); backend = null; software = null; }
if (import.meta.hot)
  import.meta.hot.dispose(disposeRenderer);
