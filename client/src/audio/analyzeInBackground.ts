import { analyzeBeatmap } from './BeatDetector';

import type { BeatAnalysis } from '../types/beatmap';

/**
 * Analyzes a decoded song in a Web Worker so the page stays responsive.
 * Falls back to the main thread if workers aren't available or the worker fails.
 */
export async function analyzeInBackground(audioBuffer: AudioBuffer): Promise<BeatAnalysis> {
  if (typeof Worker === 'undefined') return analyzeBeatmap(audioBuffer);
  try {
    return await new Promise<BeatAnalysis>((resolve, reject) => {
      const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i).slice());
      worker.onmessage = (event: MessageEvent<{ ok: boolean; analysis?: BeatAnalysis; error?: string }>) => {
        worker.terminate();
        if (event.data.ok && event.data.analysis) resolve(event.data.analysis);
        else reject(new Error(event.data.error ?? 'Analysis failed'));
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || 'Analysis worker crashed'));
      };
      worker.postMessage(
        { channels, sampleRate: audioBuffer.sampleRate, length: audioBuffer.length },
        channels.map((c) => c.buffer),
      );
    });
  } catch (error) {
    console.warn('Background analysis failed; analyzing on the main thread.', error);
    return analyzeBeatmap(audioBuffer);
  }
}
