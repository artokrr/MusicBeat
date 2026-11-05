// Song analysis for map generation.
//
// One streaming pass over a 22.05 kHz spectrogram (1024-point FFT, 256 hop,
// ~86 frames/s) keeps only a few dozen numbers per frame:
//   - band-wise SuperFlux onset strength (log-magnitude rises against a
//     frequency-max-filtered frame two hops back, so vibrato doesn't count),
//   - a slow flux (frames ~0.12 s apart) for sounds that swell in,
//   - energies (total, low, mid, high), mid-band spectral flatness, chroma.
// From those: tempo (autocorrelation with a prior toward a playable pulse),
// beats (Ellis dynamic programming, follows drift), onset events with
// band/pitch/sustain/loudness descriptors, bar starts, swing feel, and a
// per-beat intensity curve.

import { clamp01, fft, mixToMono, movingAverage, percentile, resample } from './dsp';

import type { BeatAnalysis, OnsetEvent } from '../types/beatmap';

const ANALYSIS_RATE = 22050;
const N_FFT = 1024;
const HOP = 256;
/** Hz edges of the four bands used for flux and onset descriptors. */
const BAND_EDGES = [30, 150, 500, 3000, 10000];
const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_CENTER_BPM = 115;
const PRIOR_WIDTH_OCTAVES = 0.75;
const DP_TIGHTNESS = 120;
const FLUX_LAG = 2;
const SLOW_LAG_SEC = 0.12;

export type AudioLike = Pick<AudioBuffer, 'numberOfChannels' | 'getChannelData' | 'length' | 'sampleRate' | 'duration'>;

interface Features {
  frames: number;
  frameRate: number;
  frameTime: (f: number) => number;
  bandFlux: Float32Array[];
  fluxPitch: Float32Array;
  slowFlux: Float32Array;
  slowPitch: Float32Array;
  energy: Float32Array;
  low: Float32Array;
  high: Float32Array;
  mid: Float32Array;
  flatness: Float32Array;
  chroma: Float32Array; // frames x 12
}

export async function analyzeBeatmap(audioBuffer: AudioLike): Promise<BeatAnalysis> {
  const duration = audioBuffer.duration;
  const signal = resample(mixToMono(audioBuffer), audioBuffer.sampleRate, ANALYSIS_RATE);
  const feat = extractFeatures(signal);
  const { frames, frameRate, frameTime, bandFlux } = feat;

  // Balance bands so hi-hats (many bins) don't drown out kicks (few bins).
  const bandScale = bandFlux.map((flux) => 1 / Math.max(1e-6, percentile(flux, 95)));
  const odf = weightedFlux(bandFlux, bandScale, [1.0, 0.8, 1.0, 0.7]);

  // Pulse curve for tempo and beats: the beat lives in kick and snare; off-beat
  // hi-hats would otherwise pull it half a beat late.
  const pulse = weightedFlux(bandFlux, bandScale, [1.6, 1.0, 0.8, 0.35]);
  const pulseMean = movingAverage(pulse, Math.round(frameRate * 0.25));
  const novelty = new Float32Array(frames);
  for (let f = 0; f < frames; f++) novelty[f] = Math.max(0, pulse[f]! - pulseMean[f]!);
  let sq = 0;
  for (const v of novelty) sq += v * v;
  const std = Math.sqrt(sq / Math.max(1, frames)) || 1;
  for (let f = 0; f < frames; f++) novelty[f] = novelty[f]! / std;

  const tempo = estimateTempo(novelty, frameRate);
  const period = (60 / tempo.bpm) * frameRate;
  const beatFrames = trimToActiveRegion(trackBeats(novelty, period), novelty, frameRate);
  let beatTimes = beatFrames.map(frameTime);

  const usedFallback = tempo.confidence < 0.12 || beatTimes.length < 8;
  if (beatTimes.length < 2) {
    // No pulse at all: lay a nominal grid so the generator still has bars to group by.
    beatTimes = [];
    for (let t = 0.5; t < duration; t += 60 / tempo.bpm) beatTimes.push(t);
  }

  const peakRef = Math.max(1e-6, percentile(novelty, 97));
  const beatStrength = beatTimes.map((t) => {
    const f = Math.round(t * frameRate - N_FFT / 2 / HOP);
    let m = 0;
    for (let d = -2; d <= 2; d++) m = Math.max(m, novelty[f + d] ?? 0);
    return clamp01(m / peakRef);
  });

  const frameDb = new Float32Array(frames);
  for (let f = 0; f < frames; f++) frameDb[f] = 10 * Math.log10(1e-10 + feat.energy[f]!);
  const loudRef = percentile(frameDb, 95);

  const onsets = pickOnsets(feat, odf, bandScale, frameDb, loudRef);
  addSoftOnsets(onsets, feat, frameDb, loudRef);

  const perBeat = summarizeBeats(beatTimes, duration, feat, onsets);
  const downbeatOffset = findDownbeatOffset(beatTimes, onsets, perBeat.chroma);
  const subdivision = detectSubdivision(beatTimes, odf, frameRate, frameTime);
  const { intensity, lowWeight } = computeIntensity(perBeat);

  return {
    bpm: Math.round(tempo.bpm * 10) / 10,
    beatTimes,
    beatStrength,
    downbeatOffset,
    subdivision,
    onsets,
    intensity,
    lowWeight,
    duration,
    usedFallback,
    analysisStats: {
      tempoConfidence: Number(tempo.confidence.toFixed(3)),
      onsetCount: onsets.length,
      beatCount: beatTimes.length,
    },
  };
}

// ---------- Streaming feature extraction ----------

function extractFeatures(signal: Float32Array): Features {
  const frames = Math.max(1, Math.floor((signal.length - N_FFT) / HOP) + 1);
  const frameRate = ANALYSIS_RATE / HOP;
  const binHz = ANALYSIS_RATE / N_FFT;
  const bins = N_FFT / 2 + 1;
  const bin = (hz: number) => Math.min(bins - 1, Math.round(hz / binHz));
  const bandBins = BAND_EDGES.map(bin);
  const lowHi = bin(150);
  const highLo = bin(3000);
  const midLo = bin(150);
  const midHi = bin(4000);
  const slowLo = bin(80);
  const slowHi = bin(5000);
  const slowLag = Math.max(FLUX_LAG + 1, Math.round(frameRate * SLOW_LAG_SEC));
  const logHz = new Float32Array(bins);
  const pitchClass = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const hz = k * binHz;
    logHz[k] = Math.log2(hz);
    if (hz >= 80 && hz <= 2000) pitchClass[k] = (((Math.round(12 * Math.log2(hz / 440)) + 69) % 12) + 12) % 12;
  }

  const window = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  // Ring buffer of recent log-magnitude frames (enough for the slow lag).
  const ringSize = slowLag + 1;
  const ring = Array.from({ length: ringSize }, () => new Float32Array(bins));

  const feat: Features = {
    frames,
    frameRate,
    frameTime: (f: number) => (f * HOP + N_FFT / 2) / ANALYSIS_RATE,
    bandFlux: [0, 1, 2, 3].map(() => new Float32Array(frames)),
    fluxPitch: new Float32Array(frames),
    slowFlux: new Float32Array(frames),
    slowPitch: new Float32Array(frames),
    energy: new Float32Array(frames),
    low: new Float32Array(frames),
    high: new Float32Array(frames),
    mid: new Float32Array(frames),
    flatness: new Float32Array(frames),
    chroma: new Float32Array(frames * 12),
  };

  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = (signal[start + i] ?? 0) * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const cur = ring[f % ringSize]!;
    let energy = 0;
    let low = 0;
    let high = 0;
    let mid = 0;
    let logSum = 0;
    for (let k = 0; k < bins; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      const m = Math.sqrt(p);
      cur[k] = Math.log1p(10 * m);
      if (k === 0) continue;
      energy += p;
      if (k <= lowHi) low += p;
      if (k >= highLo) high += p;
      if (k >= midLo && k < midHi) {
        mid += m;
        logSum += Math.log(m + 1e-9);
      }
      const pc = pitchClass[k]!;
      if (pc >= 0) feat.chroma[f * 12 + pc] += p;
    }
    feat.energy[f] = energy;
    feat.low[f] = low;
    feat.high[f] = high;
    feat.mid[f] = mid;
    const midCount = Math.max(1, midHi - midLo);
    feat.flatness[f] = mid > 0 ? Math.exp(logSum / midCount) / (mid / midCount) : 1;

    if (f >= FLUX_LAG) {
      const ref = ring[(f - FLUX_LAG) % ringSize]!;
      let weighted = 0;
      let total = 0;
      for (let b = 0; b < 4; b++) {
        let sum = 0;
        for (let k = Math.max(1, bandBins[b]!); k < bandBins[b + 1]!; k++) {
          const refMax = Math.max(ref[k - 1]!, ref[k]!, ref[k + 1] ?? 0);
          const rise = cur[k]! - refMax;
          if (rise > 0) {
            sum += rise;
            weighted += rise * logHz[k]!;
            total += rise;
          }
        }
        feat.bandFlux[b]![f] = sum;
      }
      feat.fluxPitch[f] = total > 0 ? weighted / total : 0;
    }
    if (f >= slowLag) {
      const ref = ring[(f - slowLag) % ringSize]!;
      let sum = 0;
      let weighted = 0;
      for (let k = slowLo; k < slowHi; k++) {
        const d = cur[k]! - ref[k]!;
        if (d > 0) {
          sum += d;
          weighted += d * logHz[k]!;
        }
      }
      feat.slowFlux[f] = sum;
      feat.slowPitch[f] = sum > 0 ? weighted / sum : 0;
    }
  }
  return feat;
}

function weightedFlux(bandFlux: Float32Array[], scale: number[], weights: number[]): Float32Array {
  const n = bandFlux[0]!.length;
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let v = 0;
    for (let b = 0; b < 4; b++) v += bandFlux[b]![f]! * scale[b]! * weights[b]!;
    out[f] = v;
  }
  return out;
}

// ---------- Tempo ----------

function estimateTempo(novelty: Float32Array, frameRate: number): { bpm: number; confidence: number } {
  const n = novelty.length;
  const minLag = Math.floor((60 / MAX_BPM) * frameRate);
  const maxLag = Math.ceil((60 / MIN_BPM) * frameRate) * 2 + 2;
  let mean = 0;
  for (const v of novelty) mean += v;
  mean /= Math.max(1, n);
  const centered = new Float32Array(n);
  for (let i = 0; i < n; i++) centered[i] = novelty[i]! - mean;

  const ac = new Float64Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    if (n - lag <= 0) break;
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += centered[i]! * centered[i + lag]!;
    ac[lag] = s / (n - lag);
  }
  const ac0 = ac[0]! || 1;
  const acAt = (lag: number) => {
    const i = Math.floor(lag);
    const frac = lag - i;
    return ((ac[i] ?? 0) * (1 - frac) + (ac[i + 1] ?? 0) * frac) / ac0;
  };

  // Score a period by its own peak plus its double (bar-level) and half (8ths)
  // lags, weighted by a log-normal prior around a comfortable quarter-note tempo.
  let best = { bpm: 120, score: -Infinity, lag: (60 / 120) * frameRate };
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const lag = (60 / bpm) * frameRate;
    if (lag < minLag) continue;
    const raw = acAt(lag) + 0.5 * acAt(lag * 2) + 0.25 * acAt(lag / 2);
    const octaves = Math.log2(bpm / PRIOR_CENTER_BPM);
    const prior = Math.exp(-0.5 * (octaves / PRIOR_WIDTH_OCTAVES) ** 2);
    const score = raw * prior;
    if (score > best.score) best = { bpm, score, lag };
  }

  let floor = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    floor += Math.max(0, acAt(lag));
    count++;
  }
  floor /= Math.max(1, count);
  const confidence = Math.max(0, acAt(best.lag) - floor);
  return { bpm: best.bpm, confidence: Number.isFinite(confidence) ? confidence : 0 };
}

// ---------- Beat tracking (dynamic programming) ----------

function trackBeats(novelty: Float32Array, period: number): number[] {
  const n = novelty.length;
  if (n === 0 || !Number.isFinite(period) || period <= 1) return [];
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    local[i] = 0.25 * (novelty[i - 1] ?? 0) + 0.5 * novelty[i]! + 0.25 * (novelty[i + 1] ?? 0);
  }

  const score = new Float64Array(n);
  const backlink = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestPrev = -1;
    let bestValue = -Infinity;
    for (let tau = Math.max(0, t - hi); tau <= t - lo; tau++) {
      const ratio = Math.log((t - tau) / period);
      const value = score[tau]! - DP_TIGHTNESS * ratio * ratio;
      if (value > bestValue) {
        bestValue = value;
        bestPrev = tau;
      }
    }
    score[t] = local[t]! + (bestPrev >= 0 ? Math.max(0, bestValue) : 0);
    backlink[t] = bestValue > 0 ? bestPrev : -1;
  }

  let end = n - 1;
  let endScore = -Infinity;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) {
    if (score[t]! > endScore) {
      endScore = score[t]!;
      end = t;
    }
  }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = backlink[t]!) {
    beats.push(t);
    if (backlink[t]! < 0) break;
  }
  return beats.reverse();
}

/** Drops beats in leading/trailing stretches with no audible onsets. */
function trimToActiveRegion(beats: number[], novelty: Float32Array, frameRate: number): number[] {
  if (beats.length === 0) return beats;
  const smooth = movingAverage(novelty, Math.round(frameRate * 1.0));
  const threshold = percentile(smooth, 50) * 0.25;
  let first = 0;
  while (first < beats.length && smooth[beats[first]!]! < threshold) first++;
  let last = beats.length - 1;
  while (last > first && smooth[beats[last]!]! < threshold) last--;
  return beats.slice(first, last + 1);
}

// ---------- Onset events ----------

/** 0..1: how loud a frame is relative to the song's loud parts (0 = 36 dB or more below). */
function loudnessAt(frameDb: Float32Array, f: number, loudRef: number): number {
  return clamp01((frameDb[f]! - (loudRef - 36)) / 36);
}

function pickOnsets(feat: Features, odf: Float32Array, bandScale: number[], frameDb: Float32Array, loudRef: number): OnsetEvent[] {
  const { frames: n, frameRate, frameTime, bandFlux, fluxPitch, mid, flatness } = feat;
  const waitFrames = Math.round(frameRate * 0.045);
  const localMean = movingAverage(odf, Math.round(frameRate * 0.15));
  const delta = percentile(odf, 60) * 0.35;
  const strongRef = Math.max(1e-6, percentile(odf, 98));

  const onsets: OnsetEvent[] = [];
  let lastPeak = -Infinity;
  for (let f = 2; f < n - 2; f++) {
    const v = odf[f]!;
    if (v < localMean[f]! * 1.25 + delta) continue;
    let isPeak = true;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && (odf[f + d] ?? 0) > v) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak || f - lastPeak < waitFrames) continue;
    lastPeak = f;

    // Sub-frame timing by parabolic interpolation.
    const a = odf[f - 1]!;
    const c = odf[f + 1]!;
    const denom = a - 2 * v + c;
    const offset = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;

    const raw = [0, 1, 2, 3].map((b) => Math.max(0, bandFlux[b]![f]!) * bandScale[b]!);
    const total = raw.reduce((s, x) => s + x, 0) || 1;
    const bands = raw.map((x) => x / total) as [number, number, number, number];

    const loudness = loudnessAt(frameDb, f, loudRef);
    onsets.push({
      time: frameTime(f + offset),
      strength: clamp01(v / strongRef),
      bands,
      pitch: fluxPitch[f]!,
      sustain: sustainAfter(mid, flatness, loudness, f, frameRate),
      loudness,
    });
  }
  return onsets;
}

/**
 * How much of a sound is still ringing 0.15-0.5 s after it starts. Noise-like
 * spectra (steady hiss, crackle) and near-silent passages score 0, so holds
 * never land on them.
 */
function sustainAfter(mid: Float32Array, flatness: Float32Array, loudness: number, f: number, frameRate: number): number {
  const n = mid.length;
  const peak = Math.max(mid[f]!, mid[f + 1] ?? 0, mid[f + 2] ?? 0);
  if (peak <= 0 || loudness < 0.15) return 0;
  const from = f + Math.round(frameRate * 0.15);
  const to = Math.min(n - 1, f + Math.round(frameRate * 0.5));
  if (to <= from) return 0;
  let tail = 0;
  let flat = 0;
  for (let g = from; g <= to; g++) {
    tail += mid[g]!;
    flat += flatness[g]!;
  }
  const frames = to - from + 1;
  // Hiss measures ~0.85 here; dense mixes 0.4-0.7; tonal pads near 0.
  if (flat / frames > 0.78) return 0;
  return clamp01((tail / frames / peak - 0.35) / 0.55);
}

/**
 * Soft onsets: sounds that swell in (pads, chord changes, bowed notes) barely
 * register as a sharp flux peak. The slow flux finds them; they're only kept
 * where no sharp onset is already nearby, and quiet ones stay weak.
 */
function addSoftOnsets(onsets: OnsetEvent[], feat: Features, frameDb: Float32Array, loudRef: number) {
  const { frames: n, frameRate, frameTime, slowFlux, slowPitch, mid, flatness } = feat;
  const lag = Math.max(FLUX_LAG + 1, Math.round(frameRate * SLOW_LAG_SEC));
  const smooth = movingAverage(slowFlux, Math.round(frameRate * 0.05));
  const floor = movingAverage(smooth, Math.round(frameRate * 1.5));
  const ref = Math.max(1e-6, percentile(smooth, 98));
  const minSpacing = Math.round(frameRate * 0.4);
  const existing = onsets.map((o) => o.time);
  let last = -Infinity;
  const added: OnsetEvent[] = [];
  for (let f = 1; f < n - 1; f++) {
    const v = smooth[f]!;
    if (v < floor[f]! * 1.6 || v < ref * 0.12) continue;
    if (v < smooth[f - 1]! || v < smooth[f + 1]!) continue;
    if (f - last < minSpacing) continue;
    // The swell started roughly half the comparison lag before its flux peak.
    const startFrame = Math.max(0, Math.round(f - lag / 2));
    const t = frameTime(startFrame);
    if (existing.some((e) => Math.abs(e - t) < 0.15)) continue;
    last = f;
    const loudness = loudnessAt(frameDb, f, loudRef);
    added.push({
      time: t,
      strength: clamp01((0.25 + 0.4 * (v / ref)) * loudness),
      bands: [0.1, 0.4, 0.4, 0.1],
      pitch: slowPitch[f]! || 9.5,
      sustain: sustainAfter(mid, flatness, loudness, startFrame, frameRate),
      loudness,
    });
  }
  onsets.push(...added);
  onsets.sort((a, b) => a.time - b.time);
}

// ---------- Per-beat summaries, bars, feel, intensity ----------

interface BeatSummary {
  activity: number[]; // onset strength per second
  loudnessDb: number[];
  lowDb: number[];
  brightnessDb: number[];
  chroma: Float32Array[]; // 12 per beat
}

function summarizeBeats(beatTimes: number[], duration: number, feat: Features, onsets: OnsetEvent[]): BeatSummary {
  const { frameRate, frameTime, energy, low, high, chroma } = feat;
  const offsetSec = frameTime(0);
  const count = beatTimes.length;
  const out: BeatSummary = { activity: [], loudnessDb: [], lowDb: [], brightnessDb: [], chroma: [] };
  let o = 0;
  for (let i = 0; i < count; i++) {
    const start = beatTimes[i]!;
    const end = i + 1 < count ? beatTimes[i + 1]! : Math.min(duration, start + 0.5);
    const span = Math.max(0.05, end - start);
    let act = 0;
    while (o < onsets.length && onsets[o]!.time < start) o++;
    for (let k = o; k < onsets.length && onsets[k]!.time < end; k++) act += onsets[k]!.strength;
    const f0 = Math.max(0, Math.round((start - offsetSec) * frameRate));
    const f1 = Math.min(energy.length, Math.max(f0 + 1, Math.round((end - offsetSec) * frameRate)));
    let e = 0;
    let l = 0;
    let h = 0;
    const c = new Float32Array(12);
    for (let f = f0; f < f1; f++) {
      e += energy[f]!;
      l += low[f]!;
      h += high[f]!;
      for (let p = 0; p < 12; p++) c[p]! += chroma[f * 12 + p]!;
    }
    const frames = Math.max(1, f1 - f0);
    out.activity.push(act / span);
    out.loudnessDb.push(10 * Math.log10(1e-10 + e / frames));
    out.lowDb.push(10 * Math.log10(1e-10 + l / frames));
    out.brightnessDb.push(10 * Math.log10(1e-10 + h / Math.max(1e-10, e)));
    out.chroma.push(c);
  }
  return out;
}

/**
 * Bar starts: the beat in each group of four where low hits land and where the
 * harmony changes (chords and sections tend to change on the one).
 */
function findDownbeatOffset(beatTimes: number[], onsets: OnsetEvent[], chroma: Float32Array[]): number {
  if (beatTimes.length < 8) return 0;
  const lowAt = (t: number) => {
    let best = 0;
    for (const o of onsets) {
      if (o.time < t - 0.06) continue;
      if (o.time > t + 0.06) break;
      best = Math.max(best, o.strength * (0.4 + o.bands[0] + 0.5 * o.bands[1]));
    }
    return best;
  };
  const meanChroma = (from: number, to: number) => {
    const m = new Float32Array(12);
    for (let i = Math.max(0, from); i < Math.min(chroma.length, to); i++) {
      for (let p = 0; p < 12; p++) m[p]! += chroma[i]![p]!;
    }
    return m;
  };
  const cosineDistance = (a: Float32Array, b: Float32Array) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let p = 0; p < 12; p++) {
      dot += a[p]! * b[p]!;
      na += a[p]! * a[p]!;
      nb += b[p]! * b[p]!;
    }
    return na > 0 && nb > 0 ? 1 - dot / Math.sqrt(na * nb) : 0;
  };
  const lowScore = [0, 0, 0, 0];
  const harmonyScore = [0, 0, 0, 0];
  beatTimes.forEach((t, i) => {
    lowScore[i % 4]! += lowAt(t);
    if (i >= 4 && i + 4 <= chroma.length) {
      harmonyScore[i % 4]! += cosineDistance(meanChroma(i - 4, i), meanChroma(i, i + 4));
    }
  });
  const norm = (xs: number[]) => {
    const max = Math.max(...xs);
    const min = Math.min(...xs);
    return xs.map((x) => (max - min > 1e-9 ? (x - min) / (max - min) : 0));
  };
  const lowN = norm(lowScore);
  const harmonyN = norm(harmonyScore);
  let best = 0;
  let bestScore = -Infinity;
  for (let p = 0; p < 4; p++) {
    const score = 0.5 * lowN[p]! + 0.5 * harmonyN[p]!;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function detectSubdivision(beatTimes: number[], odf: Float32Array, frameRate: number, frameTime: (f: number) => number): 2 | 3 {
  if (beatTimes.length < 8) return 2;
  const offsetSec = frameTime(0);
  const at = (t: number) => {
    const f = Math.round((t - offsetSec) * frameRate);
    let m = 0;
    for (let d = -1; d <= 1; d++) m = Math.max(m, odf[f + d] ?? 0);
    return m;
  };
  let straight = 0;
  let triplet = 0;
  for (let i = 0; i + 1 < beatTimes.length; i++) {
    const a = beatTimes[i]!;
    const span = beatTimes[i + 1]! - a;
    straight += at(a + span / 2);
    triplet += (at(a + span / 3) + at(a + (2 * span) / 3)) / 2;
  }
  return triplet > straight * 1.3 ? 3 : 2;
}

/**
 * Per-beat intensity 0..1 from loudness, kick/bass weight, brightness and
 * onset activity. A feature that barely varies across the song (a heavily
 * compressed master, say) is held at 0.5 instead of having its noise stretched
 * into fake dynamics, and songs with a small loudness range keep their
 * intensity in the upper part of the scale.
 */
function computeIntensity(beats: BeatSummary): { intensity: number[]; lowWeight: number[] } {
  const count = beats.activity.length;
  if (count === 0) return { intensity: [], lowWeight: [] };
  const norm = (xs: number[], minSpread: number) => {
    const lo = percentile(xs, 5);
    const hi = percentile(xs, 95);
    if (hi - lo < minSpread) return xs.map(() => 0.5);
    return xs.map((x) => clamp01((x - lo) / (hi - lo)));
  };
  const a = norm(beats.activity, Math.max(0.15, percentile(beats.activity, 5) * 0.3));
  const l = norm(beats.loudnessDb, 2);
  const w = norm(beats.lowDb, 2);
  const b = norm(beats.brightnessDb, 2);
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) raw[i] = 0.2 * a[i]! + 0.35 * l[i]! + 0.25 * w[i]! + 0.2 * b[i]!;
  const smooth = Array.from(movingAverage(raw, 4));
  let intensity = norm(smooth, 0.04);
  const loudRange = percentile(beats.loudnessDb, 95) - percentile(beats.loudnessDb, 5);
  if (loudRange < 6) intensity = intensity.map((v) => 0.4 + 0.6 * v);
  return { intensity, lowWeight: Array.from(movingAverage(Float32Array.from(w), 2)) };
}
