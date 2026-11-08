import { CPUBackend } from './cpu';
import type { GLBackend } from '../gl/renderer';
import type { SceneBackend, SceneFrame } from './types';
let backend: SceneBackend | null = null;
let software: CPUBackend | null = null;
let loading: Promise<void> | null = null;
let generation = 0;
let fallbackReason: string | null = null;
const samples = new Float64Array(600);
let count = 0;
function activeBackend() {
  if (!backend) {
    if (new URLSearchParams(location.search).get('renderer') === 'cpu')
      backend = new CPUBackend();
    else if (!loading) {
      const requestedGeneration = generation;
      // The menu can mount before Three.js is downloaded/parsed. Keep the
      // canvas empty until GL is ready, rather than flashing the CPU artwork.
      loading = import('../gl/renderer').then(({ GLBackend }) => {
        if (generation !== requestedGeneration) return;
        backend = new GLBackend();
      }).catch((error: unknown) => {
        if (generation !== requestedGeneration) return;
        fallbackReason = String(error);
        console.warn('WebGL unavailable; using CPU renderer.', error);
        backend = new CPUBackend();
      });
    }
  }
  if (backend?.kind === 'gl' && !(backend as GLBackend).available) {
    software ??= new CPUBackend();
    return software;
  }
  return backend;
}
export function presentScene(ctx: CanvasRenderingContext2D, frame: SceneFrame) {
  const renderer = activeBackend();
  if (!renderer) return null;
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
  const gl = backend?.kind === 'gl' ? backend as GLBackend : null;
  return {
    gpuTime: gl?.timing.stats() ?? null,
    backend: backend?.kind, fallbackReason, samples: sorted.length,
    medianMs: sorted[Math.floor(sorted.length * .5)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0,
    drawCalls: gl?.renderer.info.render.calls ?? null,
    triangles: gl?.renderer.info.render.triangles ?? null,
    props: gl?.props.status ?? null,
    paddles: gl?.paddles.status ?? null,
    footprintStamps: gl?.footprints.stamps ?? null,
    player: gl?.player.status ?? null,
    stranger: gl?.stranger.status ?? null,
  };
}
export function disposeRenderer() { generation++; backend?.dispose(); software?.dispose(); backend = null; software = null; loading = null; }
if (import.meta.hot)
  import.meta.hot.dispose(disposeRenderer);

/** Do not spend the opening hold looking at temporary procedural assets. */
export function openingReady(): boolean {
  const renderer = activeBackend();
  return !!renderer && (renderer.kind === 'cpu' || (renderer as GLBackend).props.status !== 'loading');
}
