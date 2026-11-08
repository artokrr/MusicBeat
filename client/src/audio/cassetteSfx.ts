// Sounds of the cassette recorder on the snow: the whole insert (door, flying
// tape, eject, seat, door shut), the rewind during the 3-2-1 countdown and the
// PLAY / STOP keys. Recorded takes are CC0 (see public/sfx/CREDITS.txt, rebuilt
// by tools/cassette-sfx-build.sh).
//
// The insert is scheduled on the audio clock the moment it starts, against the
// same timeline the animation samples (anim/recorder.ts), so each hit lands on
// the frame of its visual event rather than on whenever a timer happens to
// fire. Stereo position comes from where the tape and the deck are on screen.

import {
  DOOR_SHUT_START_MS, EJECT_END_MS, EJECT_START_MS, FLIGHT_END_MS, FLIGHT_START_MS, INSERT_MS,
  RECORDER_X, RECORDER_Y, REWIND_END_MS, REWIND_LATCH_MS, REWIND_STOP_MS,
  doorAt, oldTapeAt, rewindSpeedAt, tapeAt, recorder,
} from '../game/anim/recorder';
import { project } from '../game/scene/camera';
import { LOW_W } from '../game/pixel/stage';
import { sfxOutput } from './sfx';
import { airNoise, cassetteThump } from './sfxSynth';

type Take = 'doorOpen' | 'eject' | 'snow' | 'seat' | 'doorShut' | 'play' | 'stop' | 'rewindKey' | 'rewind' | 'rewindStop';

/** Each take, and where inside it the hit that meets the picture sits (s). */
const TAKES: Record<Take, { url: string; sync: number }> = {
  doorOpen: { url: '/sfx/cassette-door-open.wav', sync: 0.026 },
  eject: { url: '/sfx/cassette-eject.wav', sync: 0.003 },
  snow: { url: '/sfx/cassette-snow.wav', sync: 0.050 },
  seat: { url: '/sfx/cassette-seat.wav', sync: 0.140 },
  doorShut: { url: '/sfx/cassette-door-shut.wav', sync: 0.023 },
  play: { url: '/sfx/cassette-play.wav', sync: 0.040 },
  stop: { url: '/sfx/cassette-stop.wav', sync: 0.015 },
  rewindKey: { url: '/sfx/cassette-rewind-key.wav', sync: 0.035 },
  rewind: { url: '/sfx/cassette-rewind.wav', sync: 0 },
  rewindStop: { url: '/sfx/cassette-rewind-stop.wav', sync: 0.002 },
};

/**
 * A hit whose moment has passed by up to this much plays at once (it starts as
 * the insert starts, so its first hit is always output-latency late); one
 * later than this is dropped rather than heard out of step with the picture.
 */
const LATE_S = 0.08;

// Fetch the files right away so the first insert never waits on the network;
// decoding needs the context, which only exists after the first gesture.
const files: Partial<Record<Take, Promise<ArrayBuffer>>> = {};
if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
  for (const take of Object.keys(TAKES) as Take[]) {
    files[take] = fetch(TAKES[take].url).then(r => r.arrayBuffer());
    files[take]!.catch(() => undefined);
  }
}
let decoded: Promise<Partial<Record<Take, AudioBuffer>>> | null = null;
let decodedFor: AudioContext | null = null;
const buffers: Partial<Record<Take, AudioBuffer>> = {};
let synth: { air: AudioBuffer; thump: AudioBuffer } | null = null;

function load(c: AudioContext) {
  if (decoded && decodedFor === c) return decoded;
  decodedFor = c;
  const make = (data: Float32Array) => {
    const b = c.createBuffer(1, data.length, c.sampleRate);
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    return b;
  };
  synth = { air: make(airNoise(c.sampleRate, 1.3)), thump: make(cassetteThump(c.sampleRate)) };
  decoded = Promise.all((Object.keys(TAKES) as Take[]).map(async take => {
    try {
      // decodeAudioData detaches its input, so decode a copy of the fetched bytes.
      buffers[take] = await c.decodeAudioData((await files[take]!).slice(0));
    } catch (error) {
      console.warn(`Cassette sound "${take}" failed to load.`, error);
    }
  })).then(() => buffers);
  return decoded;
}

/** The context time at which audio reaches the speakers at a performance.now() time. */
function audioTimeAt(c: AudioContext, perfMs: number): number {
  const stamp = c.getOutputTimestamp?.();
  if (stamp?.performanceTime && stamp.contextTime !== undefined) {
    return stamp.contextTime + (perfMs - stamp.performanceTime) / 1000;
  }
  return c.currentTime + (perfMs - performance.now()) / 1000 - (c.outputLatency || c.baseLatency || 0);
}

const projected = { sx: 0, sy: 0, d: 0 };
/** Stereo position of a point in the courtyard: where it is across the picture. */
function panOf(x: number, y: number, z: number): number {
  project([x, y, z], projected);
  return Math.max(-1, Math.min(1, (projected.sx - LOW_W / 2) / (LOW_W / 2)));
}

interface Hit {
  gain: number;
  pan: number;
  rate?: number;
  /** Low-pass cutoff in Hz. */
  lowpass?: number;
  /** Playback rate at the start, gliding to `rate` over `glide` seconds: a motor coming up to speed. */
  from?: number;
  glide?: number;
}

/**
 * Plays a buffer so that its sync point leaves the speakers at perfMs, or as
 * soon as possible when perfMs is null (a key pressed this frame). Lead-in
 * before the sync point is trimmed when there's no time left for it.
 */
function playAt(c: AudioContext, out: AudioNode, buffer: AudioBuffer | undefined, sync: number, perfMs: number | null, hit: Hit, live?: Set<AudioScheduledSourceNode>) {
  if (!buffer) return;
  const rate = hit.rate ?? 1;
  const now = c.currentTime;
  const due = perfMs === null ? -Infinity : audioTimeAt(c, perfMs);
  if (now - due > LATE_S && perfMs !== null) return;
  let start = due - sync / rate, offset = 0;
  if (start < now) {
    start = now;
    // Keep the lead-in that still fits; at the latest, start just before the hit.
    offset = Math.min(Math.max(0, (now - (due - sync / rate)) * rate), Math.max(0, sync - 0.003));
  }
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  if (hit.from !== undefined && hit.glide) {
    source.playbackRate.setValueAtTime(hit.from, start);
    source.playbackRate.linearRampToValueAtTime(rate, start + hit.glide);
  }
  const gain = c.createGain();
  gain.gain.value = hit.gain;
  const panner = c.createStereoPanner();
  panner.pan.value = hit.pan;
  let node: AudioNode = source;
  if (hit.lowpass) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = hit.lowpass;
    node.connect(filter);
    node = filter;
  }
  node.connect(gain);
  gain.connect(panner);
  panner.connect(out);
  source.start(start, offset);
  if (live) {
    live.add(source);
    source.onended = () => live.delete(source);
  }
}

const pose = { tapeX: 0, tapeY: 0, tapeZ: 0, tapeScale: 1, tapeTilt: 0, tapeRoll: 0, tapeYaw: 0 };
const oldPose = { serial: 0, x: 0, y: 0, z: 0, tilt: 0, roll: 0, yaw: 0, scale: 1 };

/**
 * When something easing to a stop stops visibly moving: within a quarter pixel
 * of where it ends up on screen (the rasteriser still flips pixels for moves
 * under half a pixel). The animation eases in, so this comes a little before
 * the timeline's end, and it's the moment the eye reads as "it landed".
 */
function settledMs(from: number, to: number, at: (ms: number) => [number, number, number]): number {
  project(at(to), projected);
  const ex = projected.sx, ey = projected.sy;
  for (let ms = from; ms <= to; ms += 2) {
    project(at(ms), projected);
    if (Math.hypot(projected.sx - ex, projected.sy - ey) < 0.25) return ms;
  }
  return to;
}
const seatedMs = () => settledMs(FLIGHT_START_MS, FLIGHT_END_MS, ms => (tapeAt(ms, pose), [pose.tapeX, pose.tapeY, pose.tapeZ]));
// The crunch is first contact, while the shell still slides horizontally.
const landedMs = () => EJECT_END_MS;

/** Likewise for the door: shut to within about two degrees of its swing. */
function doorShutMs(): number {
  for (let ms = DOOR_SHUT_START_MS; ms <= INSERT_MS; ms += 2) if (doorAt(ms) < 0.03) return ms;
  return INSERT_MS;
}

/** The flying tape's air at fraction u of its flight: level, band centre and top cutoff (Hz), pan. */
const air = { level: 0, band: 0, top: 0, pan: 0 };
function airAt(u: number) {
  const nearest = tapeAt(FLIGHT_START_MS, pose).tapeScale;
  tapeAt(FLIGHT_START_MS + u * (FLIGHT_END_MS - FLIGHT_START_MS), pose);
  const speed = 4 * u * (1 - u);                     // eased flight: still at both ends, fastest midway
  const near = (pose.tapeScale - 1) / (nearest - 1); // 1 beside the camera, 0 in the deck
  air.level = speed ** 1.3 * (0.25 + 0.75 * near) * Math.min(1, (1 - u) / 0.12);
  air.band = 380 + 2300 * speed * (0.35 + 0.65 * near);
  air.top = 1400 + 9000 * near ** 1.5;
  air.pan = panOf(pose.tapeX, pose.tapeY, pose.tapeZ);
  return air;
}
let loudestAir = 0;
function airPeak() {
  if (!loudestAir) for (let i = 0; i <= 200; i++) loudestAir = Math.max(loudestAir, airAt(i / 200).level);
  return loudestAir;
}

/**
 * The air the tape pushes as it flies from beside the camera down into the
 * deck: loudest while it's both close and fast, darker and lower as it goes
 * away, panned along its path.
 */
function whoosh(c: AudioContext, out: AudioNode, startedMs: number, live: Set<AudioScheduledSourceNode>) {
  if (!synth) return;
  const flight = (FLIGHT_END_MS - FLIGHT_START_MS) / 1000;
  const begin = audioTimeAt(c, startedMs + FLIGHT_START_MS);
  const now = c.currentTime;
  const skip = Math.max(0, now - begin);
  if (skip >= flight) return;
  const length = flight - skip, steps = Math.max(2, Math.round(length * 200));
  const gain = new Float32Array(steps), band = new Float32Array(steps), top = new Float32Array(steps), pan = new Float32Array(steps);
  const scale = 0.16 / airPeak();
  for (let i = 0; i < steps; i++) {
    const a = airAt((skip + length * (i / (steps - 1))) / flight);
    gain[i] = a.level * scale;
    band[i] = a.band;
    top[i] = a.top;
    pan[i] = a.pan;
  }
  const at = Math.max(now, begin);
  const source = c.createBufferSource();
  source.buffer = synth.air;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueCurveAtTime(band, at, length);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueCurveAtTime(top, at, length);
  const g = c.createGain();
  g.gain.setValueCurveAtTime(gain, at, length);
  const p = c.createStereoPanner();
  p.pan.setValueCurveAtTime(pan, at, length);
  source.connect(bp);
  bp.connect(lp);
  lp.connect(g);
  g.connect(p);
  p.connect(out);
  source.start(at, skip);
  source.stop(at + length + 0.02);
  live.add(source);
  source.onended = () => live.delete(source);
}

/**
 * The tape winding: one steady recorded run whose playback rate (pitch, and
 * the rate of the reel ticks) and level follow rewindSpeedAt, the same curve
 * the reels turn by. Joins late by skipping as much tape as already went past.
 */
function wind(c: AudioContext, out: AudioNode, startedMs: number, pan: number, live: Set<AudioScheduledSourceNode>) {
  const buffer = buffers.rewind;
  if (!buffer) return;
  const total = (REWIND_END_MS - REWIND_LATCH_MS) / 1000;
  const begin = audioTimeAt(c, startedMs + REWIND_LATCH_MS);
  const now = c.currentTime;
  const skip = Math.max(0, now - begin);
  if (skip >= total) return;
  const rateAt = (ms: number) => 0.15 + 0.85 * rewindSpeedAt(ms);
  let offset = 0;
  for (let ms = 0; ms < skip * 1000; ms++) offset += rateAt(REWIND_LATCH_MS + ms + 0.5) / 1000;
  const length = total - skip, steps = Math.max(2, Math.round(length * 200));
  const rate = new Float32Array(steps), level = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const ms = REWIND_LATCH_MS + (skip + length * (i / (steps - 1))) * 1000;
    rate[i] = rateAt(ms);
    level[i] = WIND_GAIN * rewindSpeedAt(ms) ** 1.3;
  }
  const at = Math.max(now, begin);
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.setValueCurveAtTime(rate, at, length);
  const g = c.createGain();
  g.gain.setValueCurveAtTime(level, at, length);
  const p = c.createStereoPanner();
  p.pan.value = pan;
  source.connect(g);
  g.connect(p);
  p.connect(out);
  source.start(at, offset);
  source.stop(at + length + 0.01);
  live.add(source);
  source.onended = () => live.delete(source);
}
/** Gain of the winding at full speed. */
const WIND_GAIN = 1.55;

interface Run { startedMs: number; out: GainNode | null; live: Set<AudioScheduledSourceNode> }
let sequence: Run | null = null;
let rewinding: Run | null = null;

/** Silences what a run still has to play, quickly but without a click. */
function silence(run: Run | null) {
  if (!run?.out) return;
  const c = run.out.context;
  run.out.gain.setTargetAtTime(0, c.currentTime, 0.01);
  for (const source of run.live) {
    try { source.stop(c.currentTime + 0.06); } catch { /* already stopped */ }
  }
}

/** Starts a run once its sounds are decoded and the context's clock is running. */
function begin(startedMs: number, schedule: (c: AudioContext, out: GainNode, run: Run) => void): Run | null {
  const output = sfxOutput();
  if (!output) return null;
  const { context: c, bus } = output;
  const run: Run = { startedMs, out: null, live: new Set() };
  const ready = load(c);
  // A context that is still starting up has no clock to schedule against yet.
  const running = c.state === 'running' ? Promise.resolve() : c.resume();
  void Promise.all([ready, running]).then(() => {
    if (sequence !== run && rewinding !== run) return;
    const out = c.createGain();
    out.connect(bus);
    run.out = out;
    schedule(c, out, run);
  });
  return run;
}

function scheduleInsert(c: AudioContext, out: AudioNode, run: Run, replacing: boolean) {
  const { startedMs, live } = run;
  const deck = panOf(RECORDER_X, RECORDER_Y, 0.1);
  const t = (ms: number) => startedMs + ms;
  playAt(c, out, buffers.doorOpen, TAKES.doorOpen.sync, t(0), { gain: 0.55, pan: deck }, live);
  if (replacing) {
    playAt(c, out, buffers.eject, TAKES.eject.sync, t(EJECT_START_MS), { gain: 0.6, pan: deck, lowpass: 7000 }, live);
    const landed = landedMs();
    for (const tape of recorder.tapes) if (tape.startedMs === startedMs) oldPose.serial = tape.serial;
    oldTapeAt(landed, oldPose);
    playAt(c, out, buffers.snow, TAKES.snow.sync, t(landed), { gain: 1.1, pan: panOf(oldPose.x, oldPose.y, oldPose.z), lowpass: 6000 }, live);
  }
  whoosh(c, out, startedMs, live);
  const seated = t(seatedMs());
  playAt(c, out, buffers.seat, TAKES.seat.sync, seated, { gain: 0.56, pan: deck }, live);
  playAt(c, out, synth?.thump, 0, seated, { gain: 0.22, pan: deck, lowpass: 900 }, live);
  playAt(c, out, buffers.doorShut, TAKES.doorShut.sync, t(doorShutMs()), { gain: 0.36, pan: deck, lowpass: 9000 }, live);
}

export const cassette = {
  /**
   * The whole insert. Call right after insertCassette(startedMs); `replacing`
   * when a tape was already in the deck and gets ejected first.
   */
  insert(startedMs: number, replacing: boolean) {
    cassette.cancel();
    sequence = begin(startedMs, (c, out, run) => scheduleInsert(c, out, run, replacing));
  },

  /** The insert was abandoned (the song failed to load): silence what's still to come. */
  cancel() {
    const run = sequence;
    sequence = null;
    silence(run);
  },

  /**
   * The countdown's rewind: the REWIND key latches, the tape winds back and
   * stops with a clunk before PLAY. Call right after rewindRecorder(startedMs).
   * Starting again replaces a rewind still running rather than adding to it.
   */
  rewind(startedMs: number) {
    cassette.cancelRewind();
    rewinding = begin(startedMs, (c, out, run) => {
      const deck = panOf(RECORDER_X, RECORDER_Y, 0.1);
      const t = (ms: number) => startedMs + ms;
      playAt(c, out, buffers.rewindKey, TAKES.rewindKey.sync, t(REWIND_LATCH_MS), { gain: 0.5, pan: deck }, run.live);
      wind(c, out, startedMs, deck, run.live);
      playAt(c, out, buffers.rewindStop, TAKES.rewindStop.sync, t(REWIND_STOP_MS), { gain: 0.42, pan: deck }, run.live);
    });
  },

  /** The countdown was left before it finished: stop the tape and anything still to come. */
  cancelRewind() {
    const run = rewinding;
    rewinding = null;
    silence(run);
  },

  /** PLAY goes down and the transport catches the tape, coming up to speed. */
  play() {
    const output = sfxOutput();
    if (!output) return;
    const { context: c, bus } = output;
    void load(c);
    playAt(c, bus, buffers.play, TAKES.play.sync, null, {
      gain: 0.78, pan: panOf(RECORDER_X, RECORDER_Y, 0.1), from: 0.9, rate: 1, glide: 0.16,
    });
  },

  /** STOP: the key pops up and the motor winds down. */
  stop() {
    const output = sfxOutput();
    if (!output) return;
    const { context: c, bus } = output;
    void load(c);
    playAt(c, bus, buffers.stop, TAKES.stop.sync, null, { gain: 0.5, pan: panOf(RECORDER_X, RECORDER_Y, 0.1) });
  },
};
