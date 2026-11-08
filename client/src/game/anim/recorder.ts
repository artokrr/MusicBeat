/** Presentation only. One lifetime across keyed Upload/Loading/Game screens.
 * All output storage is borrowed; sampling never allocates or reads a clock. */
export const RECORDER_X = 2;
export const RECORDER_Y = -1.6;
/** One insert, in ms from insertCassette(). Sounds are scheduled from these. */
export const DOOR_OPEN_MS = 230;        // the door swings open 0..DOOR_OPEN_MS
export const EJECT_START_MS = 100;      // a previous tape is pushed out...
export const EJECT_END_MS = 470;        // ...and comes to rest on the snow
export const FLIGHT_START_MS = 120;     // the new tape appears near the camera...
export const FLIGHT_END_MS = 1150;      // ...and is seated in the deck
export const DOOR_SHUT_START_MS = 1180; // the door swings shut, closed at INSERT_MS
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
type TapePose = Pick<typeof recorder, 'tapeX' | 'tapeY' | 'tapeZ' | 'tapeScale' | 'tapeTilt' | 'tapeRoll' | 'tapeYaw'>;
type OldTapePose = Pick<typeof recorder, 'oldX' | 'oldY' | 'oldZ' | 'oldTilt'>;
/** How open the door is (0 shut, 1 open) at ms into an insert. */
export function doorAt(ms: number) {
  return ease(ms / DOOR_OPEN_MS) * (1 - ease((ms - DOOR_SHUT_START_MS) / (INSERT_MS - DOOR_SHUT_START_MS)));
}
/** The flying tape at ms into an insert, written into out. */
export function tapeAt(ms: number, out: TapePose) {
  const t = ease((ms - FLIGHT_START_MS) / (FLIGHT_END_MS - FLIGHT_START_MS));
  out.tapeX = -.35 + (RECORDER_X + .08 + .35) * t;
  out.tapeY = -2.1 + (RECORDER_Y - .068 + 2.1) * t;
  out.tapeZ = 2.8 + (.125 - 2.8) * t + .55 * Math.sin(Math.PI * t);
  out.tapeScale = 1 + 6.5 * (1 - t) ** 1.5;
  out.tapeTilt = -.65 * (1 - t);
  out.tapeRoll = .22 * Math.sin(t * Math.PI * 2) * (1 - t);
  out.tapeYaw = -.18 * (1 - t);
  return out;
}
/** The ejected tape at ms into a replacing insert, written into out. */
export function oldTapeAt(ms: number, out: OldTapePose) {
  const e = ease((ms - EJECT_START_MS) / (EJECT_END_MS - EJECT_START_MS));
  out.oldX = RECORDER_X + .08 - .29 * e;
  out.oldY = RECORDER_Y - .068 - .25 * e;
  out.oldZ = .125 + .14 * Math.sin(e * Math.PI) - .108 * e;
  out.oldTilt = -e * Math.PI / 2;
  return out;
}
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
  recorder.door = doorAt(ms);
  tapeAt(ms, recorder);
  if (replacing) oldTapeAt(ms, recorder);
  if (ms >= INSERT_MS) {
    recorder.inserting = false;
    recorder.loaded = true;
    recorder.door = 0;
  }
  return recorder;
}
