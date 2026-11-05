// Runs song analysis off the main thread.
import { analyzeBeatmap } from './BeatDetector';

interface AnalysisRequest {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
  length: number;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = async (event) => {
  const { channels, sampleRate, length } = event.data;
  try {
    const analysis = await analyzeBeatmap({
      numberOfChannels: channels.length,
      sampleRate,
      length,
      duration: length / sampleRate,
      getChannelData: (index: number) => channels[index]!,
    });
    scope.postMessage({ ok: true, analysis });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
