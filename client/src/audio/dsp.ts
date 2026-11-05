// Small DSP toolkit for offline song analysis: resampling, FFT, STFT features.

/** Mixes all channels of an AudioBuffer-like object to mono. */
export function mixToMono(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'getChannelData' | 'length'>): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i]! += data[i]! / channels;
  }
  return mono;
}

/**
 * Resamples to `targetRate` with a simple anti-aliasing low-pass (two cascaded
 * one-pole filters) and linear interpolation. Good enough for onset analysis.
 */
export function resample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (Math.abs(sourceRate - targetRate) < 1) return input;
  let signal = input;
  if (targetRate < sourceRate) {
    const cutoff = targetRate * 0.45;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sourceRate);
    const filtered = new Float32Array(input.length);
    let a = 0;
    let b = 0;
    for (let i = 0; i < input.length; i++) {
      a += alpha * (input[i]! - a);
      b += alpha * (a - b);
      filtered[i] = b;
    }
    signal = filtered;
  }
  const ratio = sourceRate / targetRate;
  const outLength = Math.floor(signal.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const s0 = signal[i0] ?? 0;
    const s1 = signal[i0 + 1] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

/** In-place iterative radix-2 complex FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k]!;
        const aIm = im[i + k]!;
        const bRe = re[i + k + half]! * curRe - im[i + k + half]! * curIm;
        const bIm = re[i + k + half]! * curIm + im[i + k + half]! * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ---------- Small array helpers ----------

export function movingAverage(x: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(x.length);
  let sum = 0;
  let count = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < x.length; i++) {
    const wantLo = Math.max(0, i - radius);
    const wantHi = Math.min(x.length - 1, i + radius);
    while (hi < wantHi) {
      hi++;
      sum += x[hi]!;
      count++;
    }
    while (lo < wantLo) {
      sum -= x[lo]!;
      count--;
      lo++;
    }
    out[i] = sum / Math.max(1, count);
  }
  return out;
}

export function movingMax(x: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let m = -Infinity;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(x.length - 1, i + radius);
    for (let j = lo; j <= hi; j++) if (x[j]! > m) m = x[j]!;
    out[i] = m;
  }
  return out;
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
