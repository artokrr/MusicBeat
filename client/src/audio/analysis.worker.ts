// Runs song analysis off the main thread.
import { analyzeBeatmap } from './BeatDetector';
import { generateBeatmap } from '../beatmap/BeatmapGenerator';

interface AnalysisRequest {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  length: number;
  debug: boolean;
  leadInSec?: number;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = async (event) => {
  const { channels, sampleRate, length, debug, leadInSec } = event.data;
  try {
    const analysis = await analyzeBeatmap({
      numberOfChannels: channels.length,
      sampleRate,
      length,
      duration: length / sampleRate,
      getChannelData: (index: number) => channels[index]!,
    });
    const beatmap = generateBeatmap(analysis, { debug, leadInSec });
    scope.postMessage({ ok: true, beatmap, usedFallback: analysis.usedFallback });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
