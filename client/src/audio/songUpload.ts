import { prepareSongInBackground } from './analyzeInBackground';
import type { PreparedSong } from './analyzeInBackground';

interface PendingUpload {
  abort: AbortController;
  result: Promise<PreparedSong & { audioBuffer: AudioBuffer }>;
}
export let pendingUpload: PendingUpload | null = null;

/** The accepted file owns decoding/preparation across the screen remount. */
export function prepareUpload(file: File): PendingUpload {
  const abort = new AbortController();
  const result = (async () => {
    const context = new AudioContext();
    try {
      const audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
      const prepared = await prepareSongInBackground(audioBuffer, abort.signal);
      return { audioBuffer, ...prepared };
    } finally { await context.close(); }
  })();
  // Loading attaches on its next effect; an immediate rejection is still handled.
  void result.catch(() => {});
  pendingUpload?.abort.abort();
  pendingUpload = { abort, result };
  return pendingUpload;
}
export function clearUpload(request: NonNullable<typeof pendingUpload>) {
  if (pendingUpload === request) pendingUpload = null;
}
