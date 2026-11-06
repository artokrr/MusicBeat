// The incoming ball's path in courtyard metres. The renderer draws the ball on
// it and the animator aims the paddle at it, so both must read the same curve.
import type { Vec3 } from '../rig/joints';
import type { NoteType } from '../../types/beatmap';

/** Where the ball bounces on the receiver's half, as a fraction of the flight. */
export const BOUNCE_AT = 0.7;
/** Ball centre resting on the table top: TABLE_Z 0.76 + BALL_R 0.055. */
export const BALL_ON_TABLE_Z = 0.815;

const bezier = (a: number, b: number, c: number, t: number) => {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
};

/** Height above the table top along a rally shot: over the net, one bounce, up to the hitter. */
export function flightHeight(p: number): number {
  if (p <= BOUNCE_AT) return bezier(0.22, 0.62, 0, p / BOUNCE_AT);
  if (p <= 1) return bezier(0, 0.42, 0.24, (p - BOUNCE_AT) / (1 - BOUNCE_AT));
  return 0.24 - (p - 1) * 0.8;
}

export interface IncomingNote {
  time: number;
  type: NoteType;
  startX: number;
  targetX: number;
  switchControlX?: number;
}

/**
 * How far an unpressed ball drifts past the player's hit line. It slows to a
 * stop there, which is where a missed ball's fall begins (renderer.ts), and a
 * late stroke still meets it in front of the player's body instead of behind it.
 */
const PAST_LINE = 0.3;

/**
 * The unhit ball's centre at `songTime`, written into `out`. Past the note's
 * time the ball runs on beyond the hit line, slowing and dropping.
 */
export function incomingBall(note: IncomingNote, songTime: number, approachTime: number, out: Vec3): Vec3 {
  const p = Math.max(0, 1 - (note.time - songTime) / approachTime);
  const q = Math.min(p, 1);
  const x = note.type === 'switch' && note.switchControlX !== undefined
    ? bezier(note.startX, note.switchControlX, note.targetX, q)
    : note.startX + (note.targetX - note.startX) * q;
  // Gameplay x (lanes at 320/400/480) to metres; y from the opponent's hit line (+1.5) to the player's (-1.5).
  out[0] = (x - 400) * (0.45 / 80);
  if (p <= 1) out[1] = 1.5 - 3 * p;
  else {
    // Ease out from the approach speed (3 m per approachTime) to rest at PAST_LINE.
    const k = Math.min(1, ((p - 1) * 3) / (2 * PAST_LINE));
    out[1] = -1.5 - PAST_LINE * (1 - (1 - k) * (1 - k));
  }
  out[2] = BALL_ON_TABLE_Z + flightHeight(p);
  return out;
}
