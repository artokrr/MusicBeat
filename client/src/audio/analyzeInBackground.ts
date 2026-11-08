import { exposeBeatmapDebug, isBeatmapDebugEnabled } from '../beatmap/beatmapDebug';
import { isAmbush } from '../game/ambush';

import type { Beatmap } from '../types/beatmap';

export interface PreparedSong {
  beatmap: Beatmap;
  usedFallback: boolean;
}

/** Both analysis and map generation run off the UI thread. Keep decoding's
 * AudioBuffer intact for playback; transfer copies of its PCM to the worker. */
export async function prepareSongInBackground(audioBuffer: AudioBuffer, signal?: AbortSignal): Promise<PreparedSong> {
  const checkCancelled = () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Preparation cancelled', 'AbortError');
  };
  checkCancelled();
  const debug = isBeatmapDebugEnabled();
  // An ambush's first ball is served during the countdown, so its map has no lead-in.
  const leadInSec = isAmbush() ? 0 : undefined;
  const fallback = async () => {
    // Worker-less browsers retain the same algorithms without putting their
    // code in the entry bundle for everyone else.
    const [{ analyzeBeatmap }, { generateBeatmap }] = await Promise.all([
      import('./BeatDetector'), import('../beatmap/BeatmapGenerator'),
    ]);
    checkCancelled();
    const analysis = await analyzeBeatmap(audioBuffer);
    checkCancelled();
    return { beatmap: generateBeatmap(analysis, { debug, leadInSec }), usedFallback: analysis.usedFallback };
  };
  if (typeof Worker === 'undefined') return fallback();
  try {
    return await new Promise<PreparedSong>((resolve, reject) => {
      const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
      const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Preparation cancelled', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<PreparedSong & { ok: boolean; error?: string }>) => {
        cleanup();
        if (event.data.ok && event.data.beatmap) {
          if (event.data.beatmap.debug) exposeBeatmapDebug(event.data.beatmap.debug);
          resolve({ beatmap: event.data.beatmap, usedFallback: event.data.usedFallback });
        } else reject(new Error(event.data.error ?? 'Song preparation failed'));
      };
      worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'Preparation worker crashed')); };
      try {
        const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i).slice());
        worker.postMessage({ channels, sampleRate: audioBuffer.sampleRate, length: audioBuffer.length, debug, leadInSec }, channels.map(c => c.buffer));
      } catch (error) { cleanup(); reject(error); }
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('Background preparation failed; preparing on the main thread.', error);
    return fallback();
  }
}
