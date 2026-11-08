// Game sound effects, built from real table-tennis recordings (CC0, see
// public/sfx/CREDITS.txt): paddle hits, smashes, table and floor bounces, and a
// ball dropping to rest. Each kind has a few takes played round-robin so
// repeats never sound identical. Everything runs through one shared
// AudioContext, a touch of room and a gentle compressor.

import { dullTock, paddleTock, roomImpulse, swish } from './sfxSynth';

import type { HitResult } from '../types/game';
import type { LaneIndex, NoteType } from '../types/beatmap';

type Bank = 'paddle' | 'smash' | 'table' | 'floor' | 'drop';

const BANK_URLS: Record<Bank, string[]> = {
  paddle: ['/sfx/paddle-1.wav', '/sfx/paddle-2.wav', '/sfx/paddle-3.wav', '/sfx/paddle-4.wav'],
  smash: ['/sfx/smash-1.wav', '/sfx/smash-2.wav', '/sfx/smash-3.wav'],
  table: ['/sfx/table-1.wav', '/sfx/table-2.wav', '/sfx/table-3.wav'],
  floor: ['/sfx/floor-1.wav'],
  drop: ['/sfx/drop.mp3'],
};

const LANE_PAN: Record<LaneIndex, number> = { 0: -0.45, 1: 0, 2: 0.45 };
/** The slider's 100% maps to this bus gain, keeping hit peaks ~10 dB over the music's average level. */
const MASTER_SCALE = 0.4;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bus: GainNode | null = null;
let volume = 0.8;
const banks: Partial<Record<Bank, AudioBuffer[]>> = {};
const nextTake: Record<Bank, number> = { paddle: 0, smash: 0, table: 0, floor: 0, drop: 0 };
let fallback: { tock: AudioBuffer; dull: AudioBuffer; swish: AudioBuffer } | null = null;
let variation = 0;

function context(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    // In development, Vite re-runs this module on edit; close the context a
    // previous copy left behind instead of piling up live AudioContexts.
    const shared = globalThis as { __pongSfxContext?: AudioContext };
    if (shared.__pongSfxContext && shared.__pongSfxContext.state !== 'closed') void shared.__pongSfxContext.close();
    ctx = new AudioContext({ latencyHint: 'interactive' });
    shared.__pongSfxContext = ctx;
    const sr = ctx.sampleRate;

    master = ctx.createGain();
    master.gain.value = volume * MASTER_SCALE;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 6;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.12;
    compressor.connect(master);
    master.connect(ctx.destination);

    bus = ctx.createGain();
    bus.connect(compressor);
    // The recordings carry their own room; this just glues them to the scene.
    const room = ctx.createConvolver();
    const impulse = ctx.createBuffer(2, Math.round(sr * 0.6), sr);
    impulse.copyToChannel(roomImpulse(sr, 0) as Float32Array<ArrayBuffer>, 0);
    impulse.copyToChannel(roomImpulse(sr, 1) as Float32Array<ArrayBuffer>, 1);
    room.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.06;
    bus.connect(room);
    room.connect(wet);
    wet.connect(compressor);

    const make = (data: Float32Array): AudioBuffer => {
      const buffer = ctx!.createBuffer(1, data.length, sr);
      buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      return buffer;
    };
    fallback = { tock: make(paddleTock(sr)), dull: make(dullTock(sr)), swish: make(swish(sr)) };
    void loadBanks(ctx);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

async function loadBanks(c: AudioContext) {
  await Promise.all(
    (Object.keys(BANK_URLS) as Bank[]).map(async (bank) => {
      try {
        banks[bank] = await Promise.all(
          BANK_URLS[bank].map(async (url) => c.decodeAudioData(await (await fetch(url)).arrayBuffer())),
        );
      } catch (error) {
        console.warn(`Sound bank "${bank}" failed to load.`, error);
      }
    }),
  );
}

interface PlayOptions {
  gain?: number;
  pan?: number;
  rate?: number;
  delay?: number;
  /** Low-pass cutoff in Hz, for a muffled version. */
  lowpass?: number;
}

function playBuffer(c: AudioContext, buffer: AudioBuffer, options: PlayOptions) {
  if (!bus) return;
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = options.rate ?? 1;
  const gain = c.createGain();
  gain.gain.value = options.gain ?? 1;
  let node: AudioNode = source;
  if (options.lowpass) {
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = options.lowpass;
    node.connect(filter);
    node = filter;
  }
  node.connect(gain);
  if (options.pan) {
    const panner = c.createStereoPanner();
    panner.pan.value = options.pan;
    gain.connect(panner);
    panner.connect(bus);
  } else {
    gain.connect(bus);
  }
  source.start(c.currentTime + (options.delay ?? 0));
}

/** Tiny deterministic pitch spread (about +-1.5%), like no two real hits being identical. */
function wobble(): number {
  variation = (variation * 7919 + 13) % 101;
  return 1 + (variation / 101 - 0.5) * 0.03;
}

/** Plays the next take from a bank. Returns false if the bank isn't loaded yet. */
function take(bank: Bank, options: PlayOptions = {}): boolean {
  const c = context();
  const takes = banks[bank];
  if (!c || !takes || takes.length === 0) return false;
  const buffer = takes[nextTake[bank] % takes.length]!;
  nextTake[bank]++;
  playBuffer(c, buffer, { ...options, rate: (options.rate ?? 1) * wobble() });
  return true;
}

/** The paddle hit, with the synthesized stand-in until the recordings load. */
function paddleHit(options: PlayOptions, bank: Bank = 'paddle') {
  if (take(bank, options) || take('paddle', options)) return;
  const c = context();
  if (c && fallback) playBuffer(c, options.lowpass ? fallback.dull : fallback.tock, { ...options, lowpass: undefined });
}

/**
 * For other sound modules: the shared context (created and resumed on demand)
 * and the bus that carries everything through the room and the compressor
 * into the volume setting.
 */
export function sfxOutput(): { context: AudioContext; bus: GainNode } | null {
  const c = context();
  return c && bus ? { context: c, bus } : null;
}

export const sfx = {
  /** Creates/resumes the audio context; call from a user gesture. */
  unlock() {
    context();
  },

  setVolume(value: number) {
    volume = Math.max(0, Math.min(1, value));
    if (master) master.gain.value = volume * MASTER_SCALE;
  },

  /**
   * A return. Perfect is the full, crisp hit; good is a touch softer; ok sounds
   * muffled, like catching the ball on the edge. Switch balls are hit as smashes.
   */
  hit(result: Exclude<HitResult, 'miss'>, lane: LaneIndex, noteType: NoteType, smash = false) {
    const pan = LANE_PAN[lane];
    const bank: Bank = smash || noteType === 'switch' ? 'smash' : 'paddle';
    if (result === 'perfect') paddleHit({ pan, gain: 1 }, bank);
    else if (result === 'good') paddleHit({ pan, gain: 0.8, lowpass: 7000 }, bank);
    else paddleHit({ pan, gain: 0.7, rate: 0.97, lowpass: 2200 }, bank);
  },

  /** The ball got past you and bounced away on the floor. */
  miss(lane: LaneIndex) {
    take('floor', { pan: LANE_PAN[lane] * 0.7, gain: 0.55, lowpass: 3500, delay: 0.06 });
  },

  /** Pressing a key with no ball there: the paddle cutting air. */
  swing(lane: LaneIndex) {
    const c = context();
    if (c && fallback) playBuffer(c, fallback.swish, { pan: LANE_PAN[lane], gain: 0.45, rate: wobble() });
  },

  /** Letting go of a completed hold sends the ball back with a light tap. */
  holdDone(lane: LaneIndex) {
    paddleHit({ pan: LANE_PAN[lane], gain: 0.6, lowpass: 6000 });
  },

  /** The serve. */
  go() {
    paddleHit({ gain: 0.9 });
  },

  /** Failing a run: the ball drops and bounces to rest. */
  fail() {
    take('drop', { gain: 0.8 });
  },

  uiHover() {
    take('table', { gain: 0.18, lowpass: 9000 });
  },

  uiSelect() {
    paddleHit({ gain: 0.45 });
  },
};

