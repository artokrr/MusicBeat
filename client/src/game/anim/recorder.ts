/** Presentation only. One lifetime across keyed Upload/Loading/Game screens.
 * All output storage is borrowed; sampling never allocates or reads a clock. */
export const RECORDER_X = 2.35;
export const RECORDER_Y = -1.85;
/** One insert, in ms from insertCassette(). Sounds are scheduled from these. */
export const DOOR_OPEN_MS = 230;        // the door swings open 0..DOOR_OPEN_MS
export const EJECT_START_MS = 100;      // a previous tape is pushed out...
export const EJECT_END_MS = 820;        // ...first snow contact (crunch), before the slide
export const EJECT_REST_MS = 1080;      // slide stops before the incoming tape seats
export const FLIGHT_START_MS = 120;     // the new tape appears near the camera...
export const FLIGHT_END_MS = 1150;      // ...and is seated in the deck
export const DOOR_SHUT_START_MS = 1180; // the door swings shut, closed at INSERT_MS
export const INSERT_MS = 1450;
/** The rewind during the 3-2-1 countdown, in ms from rewindRecorder() (the frame "3" shows).
 * Sounds are scheduled from these and from rewindSpeedAt, so pitch and reels move together. */
export const REWIND_LATCH_MS = 60;      // the REWIND key latches and the motor takes the reels...
export const REWIND_FULL_MS = 360;      // ...up to full speed
export const REWIND_CATCH_MS = 1000;    // on "2" the tape pack catches for a moment
export const REWIND_SLOW_MS = 2000;     // from "1" the wind slows...
export const REWIND_STOP_MS = 2350;     // ...until it stops with a clunk...
export const REWIND_END_MS = 2410;      // ...and the reels stand still, quiet until PLAY at 3000
/** Reel speed at full rewind (rad/s, backwards); PLAY turns them forwards at 3.3. */
export const REWIND_RAD_S = 14;
const REWIND_SLOWED = .72;
export const recorder = {
  startedMs: -Infinity, seatedAtMs: -Infinity, inserting: false, loaded: false,
  playing: false, door: 0, key: 0, reel: 0, rewindStartedMs: -Infinity,
  tapeX: 0, tapeY: 0, tapeZ: 0, tapeScale: 1, tapeTilt: 0, tapeRoll: 0, tapeYaw: 0,
  oldVisible: false, // whether this insert replaces a seated tape (audio event contract)
  tapes: Array.from({ length: 7 }, () => ({
    active: false, serial: -1, startedMs: -Infinity, ageMs: 0, retireMs: -Infinity,
    landed: false, x: 0, y: 0, z: 0, tilt: 0, roll: 0, yaw: 0, scale: 1, snow: 0,
  })),
};
let previousMs = 0;
export const TAPE_CAP = 6;
export const TAPE_SNOW_MS = 540_000; // nine minutes: white face, a dark edge remains
export const TAPE_BURIED_MS = 780_000;
export const TAPE_RETIRE_MS = 700;
// Seven separated destinations allow six resting tapes plus one sinking away.
// Every centre stays well outside the player's +/- .6m lane and below judgement text.
export const TAPE_SPOTS = [
  [1.72, -2.48, -.32], [2.17, -2.78, .24], [2.66, -2.62, -.58],
  [3.08, -2.42, .38], [3.04, -1.94, -.17], [1.75, -1.97, .63],
  [3.49, -2.08, -.08],
] as const;
let serial = 0;
let burialTimeScale = 1;
/** Capture tools only. Vite removes the override in production builds. */
export function setTapeBurialTimeScale(scale: number) {
  if (import.meta.env.DEV) burialTimeScale = Math.max(0, Math.min(3600, Number.isFinite(scale) ? scale : 1));
}
const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
type TapePose = Pick<typeof recorder, 'tapeX' | 'tapeY' | 'tapeZ' | 'tapeScale' | 'tapeTilt' | 'tapeRoll' | 'tapeYaw'>;
export type EjectedTape = typeof recorder.tapes[number];
/** How open the door is (0 shut, 1 open) at ms into an insert. */
export function doorAt(ms: number) {
  return ease(ms / DOOR_OPEN_MS) * (1 - ease((ms - DOOR_SHUT_START_MS) / (INSERT_MS - DOOR_SHUT_START_MS)));
}
/** How fast the reels rewind (0 still, 1 full speed) at ms into a rewind. */
export function rewindSpeedAt(ms: number) {
  if (ms <= REWIND_LATCH_MS || ms >= REWIND_END_MS) return 0;
  if (ms < REWIND_FULL_MS) return 1 - (1 - (ms - REWIND_LATCH_MS) / (REWIND_FULL_MS - REWIND_LATCH_MS)) ** 4;
  if (ms >= REWIND_STOP_MS) return REWIND_SLOWED * (1 - (ms - REWIND_STOP_MS) / (REWIND_END_MS - REWIND_STOP_MS)) ** 2;
  const slow = Math.max(0, (ms - REWIND_SLOW_MS) / (REWIND_STOP_MS - REWIND_SLOW_MS));
  const c = (ms - REWIND_CATCH_MS) / 80;
  return (1 - (1 - REWIND_SLOWED) * slow * slow) * (Math.abs(c) < 1 ? 1 - .03 * (1 + Math.cos(Math.PI * c)) : 1);
}
/** The flying tape at ms into an insert, written into out. */
export function tapeAt(ms: number, out: TapePose) {
  const t = ease((ms - FLIGHT_START_MS) / (FLIGHT_END_MS - FLIGHT_START_MS));
  out.tapeX = -.35 + (RECORDER_X + .12 + .35) * t;
  out.tapeY = -2.1 + (RECORDER_Y - .102 + 2.1) * t;
  out.tapeZ = 2.8 + (.1875 - 2.8) * t + .55 * Math.sin(Math.PI * t);
  out.tapeScale = 1 + 6.5 * (1 - t) ** 1.5;
  out.tapeTilt = -.65 * (1 - t);
  out.tapeRoll = .22 * Math.sin(t * Math.PI * 2) * (1 - t);
  out.tapeYaw = -.18 * (1 - t);
  return out;
}
/** Ballistic rise, a half-turn onto the labelled face, then a short decelerating slide.
 * EJECT_END_MS is first contact, not the end of horizontal movement. */
export function oldTapeAt(ms: number, out: Pick<EjectedTape, 'serial' | 'x' | 'y' | 'z' | 'tilt' | 'roll' | 'yaw' | 'scale'>) {
  const spot = TAPE_SPOTS[out.serial % TAPE_SPOTS.length];
  const t = Math.max(0, Math.min(1, (ms - EJECT_START_MS) / (EJECT_END_MS - EJECT_START_MS)));
  const slide = 1 - (1 - Math.max(0, Math.min(1, (ms - EJECT_END_MS) / (EJECT_REST_MS - EJECT_END_MS)))) ** 3;
  const travel = t * .87 + slide * .13;
  out.x = RECORDER_X + .12 + (spot[0] - RECORDER_X - .12) * travel;
  out.y = RECORDER_Y - .102 + (spot[1] - RECORDER_Y + .102) * travel;
  out.z = .1875 * (1 - t) + .021 * t + 1.65 * t * (1 - t);
  out.tilt = -Math.PI / 2 * ease(t) - .3 * Math.sin(Math.PI * t);
  out.roll = .5 * Math.sin(Math.PI * t);
  out.yaw = spot[2] * ease(t) + .6 * Math.sin(Math.PI * t);
  out.scale = 1 + .65 * ease(t * 3);
  return out;
}
function sampleTapes(nowMs: number, dtMs: number) {
  const tapes = recorder.tapes;
  for (let i = 0; i < tapes.length; i++) {
    const tape = tapes[i];
    if (!tape.active) continue;
    const elapsed = nowMs - tape.startedMs;
    if (!tape.landed && elapsed >= EJECT_END_MS) {
      tape.landed = true;
      let count = 0, oldest = tape;
      for (let j = 0; j < tapes.length; j++) {
        const candidate = tapes[j];
        if (candidate.active && candidate.retireMs === -Infinity) {
          count++;
          if (candidate.serial < oldest.serial) oldest = candidate;
        }
      }
      if (count > TAPE_CAP) oldest.retireMs = nowMs;
    }
    if (tape.landed) tape.ageMs += Math.min(dtMs, Math.max(0, elapsed - EJECT_END_MS)) * burialTimeScale;
    if (elapsed < EJECT_REST_MS || nowMs - dtMs - tape.startedMs < EJECT_REST_MS) oldTapeAt(elapsed, tape);
    const retiring = tape.retireMs === -Infinity ? 0 : ease((nowMs - tape.retireMs) / TAPE_RETIRE_MS);
    tape.snow = Math.max(Math.min(1, tape.ageMs / TAPE_SNOW_MS), retiring);
    const sinking = Math.max(ease((tape.ageMs - TAPE_SNOW_MS) / (TAPE_BURIED_MS - TAPE_SNOW_MS)), retiring);
    if (elapsed >= EJECT_REST_MS) tape.z = .021 - .085 * sinking;
    if (sinking >= 1) tape.active = false; // all geometry is already below the ground
  }
}
export function insertCassette(nowMs: number) {
  sampleRecorder(nowMs);
  recorder.oldVisible = recorder.loaded;
  if (recorder.loaded) {
    const tape = recorder.tapes[serial % recorder.tapes.length];
    tape.active = true; tape.serial = serial++; tape.startedMs = nowMs;
    tape.ageMs = 0; tape.retireMs = -Infinity; tape.landed = false; tape.snow = 0;
  }
  recorder.startedMs = nowMs;
  recorder.seatedAtMs = nowMs + INSERT_MS;
  recorder.inserting = true;
  recorder.loaded = false;
  recorder.playing = false;
  recorder.key = 0;
  recorder.reel = 0;
  recorder.rewindStartedMs = -Infinity;
  previousMs = nowMs;
  sampleRecorder(nowMs);
}
export function cancelCassette() {
  recorder.inserting = recorder.loaded = recorder.playing = false;
  recorder.door = recorder.key = 0;
  recorder.seatedAtMs = -Infinity;
  recorder.rewindStartedMs = -Infinity;
}
/** The countdown's rewind starts at nowMs (a loaded deck only); cancelRewind stops the reels where they are. */
export function rewindRecorder(nowMs: number) {
  sampleRecorder(nowMs);
  recorder.rewindStartedMs = recorder.loaded && !recorder.playing ? nowMs : -Infinity;
}
export function cancelRewind() {
  recorder.rewindStartedMs = -Infinity;
}
export function playRecorder(playing: boolean, nowMs: number) {
  sampleRecorder(nowMs);
  recorder.playing = playing && recorder.loaded;
  recorder.key = recorder.playing ? 1 : 0;
  if (recorder.playing) recorder.rewindStartedMs = -Infinity;
}
export function sampleRecorder(nowMs: number) {
  const dt = Math.max(0, nowMs - previousMs) / 1000;
  previousMs = nowMs;
  sampleTapes(nowMs, dt * 1000);
  if (recorder.playing) recorder.reel = (recorder.reel + dt * 3.3) % (Math.PI * 2);
  else if (recorder.rewindStartedMs > -Infinity) {
    // Mean speed over the step (four samples), so the spin-up and the stop show
    // on the frame they happen rather than a frame late.
    const ms = nowMs - recorder.rewindStartedMs, step = dt * 1000;
    const speed = rewindSpeedAt(ms - step * .875) + rewindSpeedAt(ms - step * .625) + rewindSpeedAt(ms - step * .375) + rewindSpeedAt(ms - step * .125);
    const turn = Math.PI * 2;
    recorder.reel = ((recorder.reel - dt * REWIND_RAD_S * speed / 4) % turn + turn) % turn;
    if (ms >= REWIND_END_MS) recorder.rewindStartedMs = -Infinity;
  }
  if (!recorder.inserting) return recorder;
  const ms = nowMs - recorder.startedMs;
  recorder.door = doorAt(ms);
  tapeAt(ms, recorder);
  if (ms >= INSERT_MS) {
    recorder.inserting = false;
    recorder.loaded = true;
    recorder.door = 0;
  }
  return recorder;
}
