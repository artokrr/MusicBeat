// Synthesized sounds: the paddle hit used until the recorded takes have loaded,
// the air swish of swinging at nothing, and the short room impulse.

type Shape = (t: number, i: number) => number;

function render(sampleRate: number, seconds: number, shape: Shape, peak = 0.9): Float32Array {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  const out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = shape(i / sampleRate, i);
    out[i] = v;
    if (Math.abs(v) > max) max = Math.abs(v);
  }
  if (max > 0) {
    const g = peak / max;
    for (let i = 0; i < n; i++) out[i]! *= g;
  }
  // 2 ms fade-out so nothing ends in a click.
  const fade = Math.min(n, Math.round(sampleRate * 0.002));
  for (let i = 0; i < fade; i++) out[n - 1 - i]! *= i / fade;
  return out;
}

/** Deterministic white noise. */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function onePoleLowpass(x: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i]! - y);
    out[i] = y;
  }
  return out;
}

const TAU = Math.PI * 2;
const decay = (t: number, tau: number) => Math.exp(-t / tau);

/**
 * Ball on paddle: a sharp click from the contact, the hollow celluloid ring of
 * the ball (a few fast-decaying partials around 0.7-4 kHz), and a short low
 * thump from the paddle's wood so it has weight.
 */
export function paddleTock(sampleRate: number, seed = 1): Float32Array {
  const rnd = noise(seed);
  let prev = 0;
  return render(sampleRate, 0.11, (t) => {
    const n = rnd();
    const click = (n - prev) * decay(t, 0.0011);
    prev = n;
    const ring =
      0.9 * Math.sin(TAU * 1250 * t) * decay(t, 0.016) +
      0.45 * Math.sin(TAU * 2480 * t + 0.3) * decay(t, 0.009) +
      0.3 * Math.sin(TAU * 3900 * t + 1.1) * decay(t, 0.005) +
      0.5 * Math.sin(TAU * 700 * t) * decay(t, 0.026);
    const thumpPhase = TAU * (170 * t - 1500 * t * t);
    const thump = 0.45 * Math.sin(thumpPhase) * decay(t, 0.012);
    const attack = Math.min(1, t / 0.0003);
    return attack * (0.85 * click + ring + thump);
  });
}

/** The same hit, but muffled: for late or early ("ok") hits. */
export function dullTock(sampleRate: number): Float32Array {
  const lp = onePoleLowpass(paddleTock(sampleRate, 7), sampleRate, 1600);
  return render(sampleRate, lp.length / sampleRate, (_, i) => lp[i] ?? 0, 0.75);
}



/** Swinging at nothing: a short airy swish. */
export function swish(sampleRate: number): Float32Array {
  const rnd = noise(23);
  let prev = 0;
  let lp = 0;
  return render(
    sampleRate,
    0.09,
    (t) => {
      const n = rnd();
      const hp = n - prev;
      prev = n;
      lp += 0.45 * (hp - lp);
      const env = Math.sin(Math.PI * Math.min(1, t / 0.09)) ** 2;
      return lp * env;
    },
    0.22,
  );
}








/** A short room for everything to sit in: decaying noise, darker over time. */
export function roomImpulse(sampleRate: number, channel: number): Float32Array {
  const rnd = noise(97 + channel);
  const seconds = 0.6;
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const cutoff = 6000 * Math.exp(-t * 4) + 600;
    const a = 1 - Math.exp((-TAU * cutoff) / sampleRate);
    lp += a * (rnd() - lp);
    out[i] = lp * decay(t, 0.16);
  }
  return out;
}

/** Soft, slightly dark noise for air moving past: shaped live by the filters that follow it. */
export function airNoise(sampleRate: number, seconds: number): Float32Array {
  const rnd = noise(311);
  // Paul Kellet's economy pink filter: falls ~3 dB per octave, like real air.
  let b0 = 0, b1 = 0, b2 = 0;
  return render(sampleRate, seconds, () => {
    const w = rnd();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return b0 + b1 + b2 + w * 0.1848;
  }, 0.9);
}

/** The body of a tape dropping into its slot: a short low knock under the recorded plastic clack. */
export function cassetteThump(sampleRate: number): Float32Array {
  return render(sampleRate, 0.09, (t) => {
    const attack = Math.min(1, t / 0.0015);
    const body = Math.sin(TAU * (150 * t - 300 * t * t)) * decay(t, 0.018);
    const knock = 0.3 * Math.sin(TAU * 330 * t) * decay(t, 0.006);
    return attack * (body + knock);
  });
}
