/** Presentation only. One lifetime across keyed Upload/Loading/Game screens.
 * All output storage is borrowed; sampling never allocates or reads a clock. */
export const RECORDER_X = 2;
export const RECORDER_Y = -1.6;
export const INSERT_MS = 1450;
export const recorder = {
  startedMs: -Infinity, seatedAtMs: -Infinity, inserting: false, loaded: false,
  playing: false, door: 0, key: 0, reel: 0,
  tapeX: 0, tapeY: 0, tapeZ: 0, tapeScale: 1, tapeTilt: 0, tapeRoll: 0, tapeYaw: 0,
  oldVisible: false, oldX: 0, oldY: 0, oldZ: 0, oldTilt: 0,
};
let previousMs = 0;
let replacing = false;
const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
export function insertCassette(nowMs: number) {
  replacing = recorder.loaded;
  recorder.startedMs = nowMs;
  recorder.seatedAtMs = nowMs + INSERT_MS;
  recorder.inserting = true;
  recorder.loaded = false;
  recorder.playing = false;
  recorder.key = 0;
  recorder.reel = 0;
  recorder.oldVisible = replacing;
  previousMs = nowMs;
  sampleRecorder(nowMs);
}
export function cancelCassette() {
  recorder.inserting = recorder.loaded = recorder.playing = false;
  recorder.door = recorder.key = 0;
  recorder.seatedAtMs = -Infinity;
}
export function playRecorder(playing: boolean, nowMs: number) {
  sampleRecorder(nowMs);
  recorder.playing = playing && recorder.loaded;
  recorder.key = recorder.playing ? 1 : 0;
}
export function sampleRecorder(nowMs: number) {
  const dt = Math.max(0, nowMs - previousMs) / 1000;
  previousMs = nowMs;
  if (recorder.playing) recorder.reel = (recorder.reel + dt * 3.3) % (Math.PI * 2);
  if (!recorder.inserting) return recorder;
  const ms = nowMs - recorder.startedMs;
  const t = ease((ms - 120) / 1030);
  recorder.door = ease(ms / 230) * (1 - ease((ms - 1180) / 270));
  recorder.tapeX = -.35 + (RECORDER_X + .08 + .35) * t;
  recorder.tapeY = -2.1 + (RECORDER_Y - .068 + 2.1) * t;
  recorder.tapeZ = 2.8 + (.125 - 2.8) * t + .55 * Math.sin(Math.PI * t);
  recorder.tapeScale = 1 + 6.5 * (1 - t) ** 1.5;
  recorder.tapeTilt = -.65 * (1 - t);
  recorder.tapeRoll = .22 * Math.sin(t * Math.PI * 2) * (1 - t);
  recorder.tapeYaw = -.18 * (1 - t);
  if (replacing) {
    const e = ease((ms - 100) / 370);
    recorder.oldX = RECORDER_X + .08 - .29 * e;
    recorder.oldY = RECORDER_Y - .068 - .25 * e;
    recorder.oldZ = .125 + .14 * Math.sin(e * Math.PI) - .108 * e;
    recorder.oldTilt = -e * Math.PI / 2;
  }
  if (ms >= INSERT_MS) {
    recorder.inserting = false;
    recorder.loaded = true;
    recorder.door = 0;
  }
  return recorder;
}
