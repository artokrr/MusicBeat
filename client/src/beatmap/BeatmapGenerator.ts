// Turns a song analysis into a playable map.
//
// Notes sit on a rhythmic grid built from the tracked beats (8ths/16ths, or
// triplets for swing). Every grid slot is scored by the sound actually heard
// there and by where it falls in the bar; each bar then gets as many notes as
// the song's intensity asks for. Bars that repeat musically repeat their rhythm
// and lane pattern. Lanes follow the sound: low hits left, mid centre, high
// right, so the same sound keeps the same key. Holds go on sustained sounds
// before a gap, switch balls on big accents and drops. A final pass enforces
// spacing rules so everything stays playable.

import { buildDebugWindows, calculateLargestGapFromNotes, countNoteTypes } from './debugReport';
import { exposeBeatmapDebug, isBeatmapDebugEnabled } from './beatmapDebug';

import type { BeatAnalysis, Beatmap, BeatmapDebugReport, BeatNote, LaneIndex, NoteType, OnsetEvent } from '../types/beatmap';

/** Nothing before this, so the first ball has time to fly in after PLAY. */
const LEAD_IN_SEC = 1.8;
/** No two notes closer than this... */
const MIN_GAP_SEC = 0.14;
/** ...except a quick pair in the busiest bars (16ths at up to ~140 BPM). */
const PAIR_GAP_SEC = 0.105;
/** Same key twice in a row needs at least this long (the game takes the closest note in a lane). */
const MIN_JACK_SEC = 0.2;
/** Rolling caps so bursts stay readable: at most N note starts in any window of W seconds. */
const ROLLING_CAPS: Array<[number, number]> = [[1.0, 6], [2.0, 10]];
/** Ceiling for any bar's average note rate. */
const MAX_NOTES_PER_SEC = 6;
/** Slots weaker than this have nothing audible on them. */
const MIN_SALIENCE = 0.18;
const DEBUG_BIN_SIZE_SEC = 2;

interface Slot {
  time: number;
  beat: number; // index into beatTimes (or -1 in fallback)
  pos: number; // position inside the beat, 0..1
  metric: number; // 0..1, metrical weight
  salience: number; // 0..1, strongest onset matched to this slot
  onset?: OnsetEvent;
}

interface Bar {
  slots: Slot[];
  start: number;
  end: number;
  intensity: number;
  low: number; // kick/bass weight
  impact: boolean; // a big jump in intensity: a drop
}

interface Placed {
  time: number;
  slot: Slot;
  bar: number;
  lane: LaneIndex;
  type: NoteType;
  holdEndTime?: number;
  switchFrom?: LaneIndex;
}

export interface GenerateOptions {
  debug?: boolean;
  /** No note before this many seconds. 0 for an ambush, whose first ball is served during the countdown. */
  leadInSec?: number;
}

export function generateBeatmap(input: BeatAnalysis, options: GenerateOptions = {}): Beatmap {
  const leadInSec = options.leadInSec ?? LEAD_IN_SEC;
  const analysis = { ...input, onsets: withLocalSalience(input.onsets) };
  const { bpm, duration } = analysis;
  const beatSec = 60 / bpm;

  const bars = analysis.usedFallback ? buildOnsetBars(analysis) : buildGridBars(analysis);
  markImpacts(bars);

  // ---- Rhythm: choose slots bar by bar ----
  const chosenPerBar: Slot[][] = [];
  const templateOf: number[] = [];
  const templateUses = new Map<number, number>();
  // Bars that lost notes to the lead-in. Their rhythm is incomplete, so they aren't copied.
  const cutByLeadIn: boolean[] = [];
  const allChosen: number[] = []; // sorted note times, for spacing checks
  for (let b = 0; b < bars.length; b++) {
    const bar = bars[b]!;
    let template = findTemplate(bars, b, templateOf, cutByLeadIn);
    // Copying an empty bar would copy silence; only bars with notes are patterns.
    if (template >= 0 && (chosenPerBar[template]?.length ?? 0) === 0) template = -1;
    // A pattern carries a phrase (up to 4 bars), then the next phrase gets its own.
    if (template >= 0) {
      const uses = templateUses.get(template) ?? 0;
      if (uses >= 3) template = -1;
      else templateUses.set(template, uses + 1);
    }
    templateOf[b] = template;
    let chosen: Slot[];
    if (template >= 0) {
      chosen = copyRhythm(bars[template]!, chosenPerBar[template]!, bar);
      // Keep this bar's own pushed accents, which the template can't know about.
      for (const slot of bar.slots) {
        if (slot.pos < 0 && slot.salience >= 0.7 && spacingOk(chosen.map((c) => c.time).sort((x, y) => x - y), slot.time, MIN_GAP_SEC)) {
          chosen.push(slot);
        }
      }
      // The last bar of a phrase gets a small fill: its weakest note moves to the best unused sound.
      if ((templateUses.get(template) ?? 0) === 3) chosen = addFill(bar, chosen);
    } else {
      // Right after a drop, play at least a third denser than the bar before it.
      const dropBoost = bar.impact || bars[b - 1]?.impact === true;
      const prevBar = bars[b - (bar.impact ? 1 : 2)];
      const prevRate = prevBar ? (chosenPerBar[bars.indexOf(prevBar)]?.length ?? 0) / Math.max(0.25, prevBar.end - prevBar.start) : 0;
      chosen = chooseSlots(bar, beatSec, dropBoost ? prevRate * 1.3 : 0);
    }
    cutByLeadIn[b] = chosen.some((s) => s.time < leadInSec);
    chosen = chosen.filter((s) => s.time >= leadInSec && fitsSpacing(allChosen, s.time));
    for (const s of chosen) insertSorted(allChosen, s.time);
    chosenPerBar[b] = chosen.sort((x, y) => x.time - y.time);
  }

  // ---- Lanes ----
  // Song-wide pitch terciles anchor which lane a kind of sound belongs to.
  const allPitches = chosenPerBar.flat().map(pitchOf).sort((a, b) => a - b);
  const pitchSplits: [number, number] = [
    allPitches[Math.floor(allPitches.length / 3)] ?? 8,
    allPitches[Math.floor((allPitches.length * 2) / 3)] ?? 10,
  ];
  const placed: Placed[] = [];
  const laneUse = [0, 0, 0];
  let prevLane: LaneIndex = 1;
  for (let b = 0; b < bars.length; b++) {
    const chosen = chosenPerBar[b]!;
    if (chosen.length === 0) continue;
    const template = templateOf[b]!;
    let lanes: LaneIndex[];
    if (template >= 0 && placedLanesOf(placed, template).length === chosen.length) {
      // Repeats keep the exact lanes: same music, same pattern.
      lanes = placedLanesOf(placed, template);
    } else {
      lanes = assignLanes(chosen, prevLane, pitchSplits, laneUse);
    }
    chosen.forEach((slot, i) => {
      placed.push({ time: noteTime(slot), slot, bar: b, lane: lanes[i]!, type: 'normal' });
      laneUse[lanes[i]!]!++;
    });
    prevLane = lanes[lanes.length - 1]!;
  }
  placed.sort((a, b) => a.time - b.time);
  keepSpacingAfterSnap(placed);

  // Drops open on the centre key.
  for (const p of placed) {
    const bar = bars[p.bar]!;
    if (bar.impact && p.slot === bar.slots.find((s) => s.pos === 0)) p.lane = 1;
  }
  enforcePlayability(placed);
  addHolds(placed, bars, analysis, beatSec);
  addSwitches(placed, bars, beatSec);
  markEchoes(placed, beatSec);

  const notes: BeatNote[] = placed.map((p, index) => ({
    id: `note-${index}`,
    time: p.time,
    side: 'player',
    intensity: Math.min(1, 0.5 + 0.5 * p.slot.salience),
    type: p.type,
    laneIndex: p.lane,
    holdEndTime: p.holdEndTime,
    holdTickEveryBeats: p.type === 'hold' ? 0.5 : undefined,
    switchFromLaneIndex: p.switchFrom,
  }));

  const debug = (options.debug ?? isBeatmapDebugEnabled()) ? buildDebugReport(analysis, notes, bars.length) : undefined;
  if (debug) exposeBeatmapDebug(debug);

  return {
    metadata: { title: 'Uploaded Track', duration },
    timing: { bpm, beatDuration: 60000 / bpm, offsetMs: 0 },
    notes,
    debug,
  };
}

/**
 * Song-wide strength undersells quiet sections: a breakdown's pads are faint next
 * to the drop's drums but are still the thing to play there. Each onset also gets
 * credit for how strong it is relative to its own neighbourhood (+-4 s).
 */
function withLocalSalience(onsets: OnsetEvent[]): OnsetEvent[] {
  const result: OnsetEvent[] = [];
  let lo = 0;
  let hi = 0;
  for (const onset of onsets) {
    while (onsets[lo]!.time < onset.time - 4) lo++;
    while (hi < onsets.length && onsets[hi]!.time <= onset.time + 4) hi++;
    const local = onsets.slice(lo, hi).map((o) => o.strength).sort((a, b) => a - b);
    const p75 = local[Math.floor(local.length * 0.75)] ?? onset.strength;
    const relative = Math.min(1, onset.strength / Math.max(0.03, p75));
    // Squared, so only onsets that clearly stand out locally get lifted, not every bump.
    // Near-silence (~32 dB or more below the song's loud parts) can't carry notes at all.
    const audibility = Math.min(1, Math.max(0, (onset.loudness - 0.02) / 0.1));
    const lifted = onset.strength >= 0.05 ? Math.max(onset.strength, 0.55 * relative * relative) : onset.strength;
    result.push({ ...onset, strength: lifted * audibility });
  }
  return result;
}

// ---------- Grid and bars ----------

function metricWeight(beatInBar: number, pos: number, subdivision: 2 | 3): number {
  const beatWeight = beatInBar === 0 ? 1 : beatInBar === 2 ? 0.85 : 0.75;
  if (pos === 0) return beatWeight;
  if (subdivision === 3) return 0.45 * beatWeight;
  if (pos === 0.5) return 0.55 * beatWeight;
  return 0.32 * beatWeight;
}

function buildGridBars(analysis: BeatAnalysis): Bar[] {
  const { beatTimes, subdivision, downbeatOffset, intensity, onsets } = analysis;
  const positions = subdivision === 3 ? [0, 1 / 3, 2 / 3] : [0, 0.25, 0.5, 0.75];
  const spans = beatTimes.slice(1).map((t, i) => t - beatTimes[i]!);
  const typical = median(spans) || 0.5;

  const slots: Slot[] = [];
  for (let i = 0; i < beatTimes.length; i++) {
    const t = beatTimes[i]!;
    const span = i + 1 < beatTimes.length ? beatTimes[i + 1]! - t : typical;
    const beatInBar = (((i - downbeatOffset) % 4) + 4) % 4;
    // Don't subdivide across a hole where the tracker lost the beat.
    const subdivide = span < typical * 1.6;
    for (const pos of subdivide ? positions : [0]) {
      slots.push({ time: t + pos * span, beat: i, pos, metric: metricWeight(beatInBar, pos, subdivision), salience: 0 });
    }
  }
  attachOnsets(slots, onsets, typical / positions.length);
  addOffGridSlots(slots, onsets);

  const bars: Bar[] = [];
  const firstBarStart = downbeatOffset > 0 ? -(4 - downbeatOffset) : 0;
  for (let startBeat = firstBarStart; startBeat < beatTimes.length; startBeat += 4) {
    const from = Math.max(0, startBeat);
    const to = Math.min(beatTimes.length, startBeat + 4);
    const barSlots = slots.filter((s) => s.beat >= from && s.beat < to);
    if (barSlots.length === 0) continue;
    const beatIntensities = intensity.slice(from, to);
    const lows = analysis.lowWeight.slice(from, to);
    bars.push({
      low: lows.length ? lows.reduce((a, b) => a + b, 0) / lows.length : 0,
      slots: barSlots,
      start: beatTimes[from]!,
      end: to < beatTimes.length ? beatTimes[to]! : beatTimes[to - 1]! + typical,
      intensity: beatIntensities.length ? beatIntensities.reduce((a, b) => a + b, 0) / beatIntensities.length : 0,
      impact: false,
    });
  }
  return bars;
}

/** No steady pulse: every onset is a candidate, grouped into ~2 s "bars". */
function buildOnsetBars(analysis: BeatAnalysis): Bar[] {
  const { onsets, beatTimes, intensity, duration } = analysis;
  const intensityAt = (t: number) => {
    let i = 0;
    while (i + 1 < beatTimes.length && beatTimes[i + 1]! <= t) i++;
    return intensity[i] ?? 0.5;
  };
  const bars: Bar[] = [];
  for (let start = 0; start < duration; start += 2) {
    const slots = onsets
      .filter((o) => o.time >= start && o.time < start + 2)
      .map((o) => ({ time: o.time, beat: -1, pos: 0, metric: 0.6, salience: o.strength, onset: o }));
    bars.push({ slots, start, end: start + 2, intensity: intensityAt(start + 1), low: 0, impact: false });
  }
  return bars;
}

/** Gives each onset to its nearest slot, if it's close enough to belong there. */
function attachOnsets(slots: Slot[], onsets: OnsetEvent[], slotSpacing: number) {
  if (slots.length === 0) return;
  const tolerance = Math.min(0.06, slotSpacing * 0.4);
  let j = 0;
  for (const onset of onsets) {
    while (j + 1 < slots.length && slots[j + 1]!.time <= onset.time) j++;
    let best = j;
    if (j + 1 < slots.length && Math.abs(slots[j + 1]!.time - onset.time) < Math.abs(slots[j]!.time - onset.time)) best = j + 1;
    const slot = slots[best]!;
    if (Math.abs(slot.time - onset.time) > tolerance) continue;
    if (onset.strength > slot.salience) {
      slot.salience = onset.strength;
      slot.onset = onset;
    }
  }
}

/**
 * A big hit that falls between grid points (a syncopated fill, a pushed accent)
 * is still something you hear, so it becomes its own candidate slot.
 */
function addOffGridSlots(slots: Slot[], onsets: OnsetEvent[]) {
  const extra: Slot[] = [];
  for (const onset of onsets) {
    if (onset.strength < 0.7) continue;
    let nearest = Infinity;
    let beat = -1;
    for (const s of slots) {
      const d = Math.abs(s.time - onset.time);
      if (d < nearest) {
        nearest = d;
        beat = s.beat;
      }
      if (s.time > onset.time + 0.1) break;
    }
    if (nearest < 0.06) continue;
    extra.push({ time: onset.time, beat, pos: -1, metric: 0.15, salience: onset.strength, onset });
  }
  slots.push(...extra);
  slots.sort((a, b) => a.time - b.time);
}

function markImpacts(bars: Bar[]) {
  for (let b = 2; b < bars.length; b++) {
    const bar = bars[b]!;
    const before = (bars[b - 1]!.intensity + bars[b - 2]!.intensity) / 2;
    const lowBefore = (bars[b - 1]!.low + bars[b - 2]!.low) / 2;
    // A drop: the music jumps up, or the kick and bass come in.
    const energyJump = bar.intensity - before >= 0.2 && bar.intensity >= 0.55;
    const bassJump = bar.low - lowBefore >= 0.35 && bar.intensity >= 0.45;
    const bassEntry = bar.low >= 0.85 && bars[b - 1]!.low <= 0.6 && bars[b - 2]!.low <= 0.6 && bar.intensity >= 0.45;
    bar.impact = energyJump || bassJump || bassEntry;
  }
}

// ---------- Rhythm selection ----------

/** Note starts per second for a bar's intensity (0..1): sparse when calm, busy on drops. Tempo-independent. */
function notesPerSecond(intensity: number): number {
  return 0.4 + 3.6 * Math.pow(intensity, 1.4);
}

function chooseSlots(bar: Bar, beatSec: number, minRate = 0): Slot[] {
  const duration = Math.max(0.25, bar.end - bar.start);
  const target = Math.min(
    Math.round(duration * Math.max(notesPerSecond(bar.intensity), minRate)),
    Math.floor(duration * MAX_NOTES_PER_SEC),
  );
  // 16ths only when the music is busy. Half-time readings of fast songs unlock them sooner.
  const sixteenthGate = beatSec >= 0.63 ? 0.4 : 0.55;
  const allowSixteenths = bar.intensity >= sixteenthGate && beatSec / 4 >= 0.1;
  // The busiest bars may use quick pairs (two notes closer than the normal gap, never three).
  const pairGap = bar.intensity >= 0.75 ? PAIR_GAP_SEC : MIN_GAP_SEC;
  const candidates = bar.slots.filter((s) => {
    if (s.salience < MIN_SALIENCE) return false;
    if (!allowSixteenths && (s.pos === 0.25 || s.pos === 0.75)) return false;
    return true;
  });
  const score = (s: Slot) => Math.pow(s.salience, 0.8) * (0.5 + 0.5 * s.metric);
  const best = candidates.reduce((m, s) => Math.max(m, score(s)), 0);
  const ranked = candidates
    .filter((s) => score(s) >= best * 0.3)
    .sort((a, b) => score(b) - score(a));

  const chosen: Slot[] = [];
  for (const slot of ranked) {
    if (chosen.length >= target) break;
    const times = chosen.map((c) => c.time).sort((a, b) => a - b);
    if (!spacingOk(times, slot.time, pairGap)) continue;
    if (!withinRollingCaps(times, slot.time)) continue;
    chosen.push(slot);
  }
  // A drop always lands on its first beat.
  if (bar.impact) {
    const downbeat = bar.slots.find((s) => s.pos === 0);
    if (downbeat && downbeat.salience >= MIN_SALIENCE * 0.5 && !chosen.includes(downbeat)) {
      chosen.push(downbeat);
    }
  }
  return chosen;
}

function addFill(bar: Bar, chosen: Slot[]): Slot[] {
  if (chosen.length === 0) return chosen;
  const score = (sl: Slot) => sl.salience * (0.5 + 0.5 * sl.metric);
  const weakest = chosen.reduce((m, sl) => (score(sl) < score(m) ? sl : m), chosen[0]!);
  const rest = chosen.filter((sl) => sl !== weakest);
  const restTimes = rest.map((sl) => sl.time).sort((a, b) => a - b);
  const replacement = bar.slots
    .filter((sl) => !chosen.includes(sl) && sl.salience >= MIN_SALIENCE && spacingOk(restTimes, sl.time, MIN_GAP_SEC))
    .sort((a, b) => score(b) - score(a))[0];
  return replacement ? [...rest, replacement] : chosen;
}

/** Bar fingerprint: what is heard at each slot position. */
function fingerprint(bar: Bar): number[] {
  return gridSlots(bar).map((s) => s.salience);
}

/** The bar's regular grid positions (off-grid accent slots excluded). */
function gridSlots(bar: Bar): Slot[] {
  return bar.slots.filter((s) => s.pos >= 0);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** An earlier bar that sounds the same, to reuse its pattern; -1 if none. */
function findTemplate(bars: Bar[], index: number, templateOf: number[], cutByLeadIn: boolean[]): number {
  const bar = bars[index]!;
  if (bar.slots.length === 0 || bar.slots[0]!.beat < 0) return -1;
  const fp = fingerprint(bar);
  let best = -1;
  let bestSim = 0.86;
  // Look back up to 8 bars; prefer the original a repeat was copied from.
  for (let j = index - 1; j >= Math.max(0, index - 8); j--) {
    const other = bars[j]!;
    if (cutByLeadIn[j]) continue;
    if (gridSlots(other).length !== gridSlots(bar).length) continue;
    if (Math.abs(other.intensity - bar.intensity) > 0.18) continue;
    const sim = cosine(fp, fingerprint(other));
    if (sim > bestSim) {
      bestSim = sim;
      best = templateOf[j]! >= 0 ? templateOf[j]! : j;
    }
  }
  return best;
}

function copyRhythm(source: Bar, sourceChosen: Slot[], target: Bar): Slot[] {
  const result: Slot[] = [];
  const sourceGrid = gridSlots(source);
  const targetGrid = gridSlots(target);
  for (const chosen of sourceChosen) {
    const index = sourceGrid.indexOf(chosen);
    if (index < 0) continue;
    const slot = targetGrid[index];
    if (slot && slot.salience >= MIN_SALIENCE * 0.6) result.push(slot);
  }
  return result;
}

// ---------- Lanes ----------

/**
 * Lanes follow the sound. Notes are grouped by how high they sound; the lowest
 * group goes left, the highest right. With only one kind of sound, the lane
 * follows the melody's direction instead.
 */
function assignLanes(chosen: Slot[], prevLane: LaneIndex, splits: [number, number], laneUse: number[]): LaneIndex[] {
  const pitches = chosen.map((s) => pitchOf(s));
  const groups = clusterPitches(pitches);
  const distinct = new Set(groups).size;
  if (distinct === 3) return groups.map((g) => g as LaneIndex);
  if (distinct === 2) {
    // Place each group by where its sound sits in the whole song, keeping them apart.
    const meanOf = (g: number) => {
      const ps = pitches.filter((_, i) => groups[i] === g);
      return ps.reduce((a, b) => a + b, 0) / ps.length;
    };
    const laneFor = (p: number) => (p < splits[0] ? 0 : p < splits[1] ? 1 : 2);
    const want = [laneFor(meanOf(0)), laneFor(meanOf(1))];
    // Both sounds in the same third of the range: any pair keeps their order, so let usage decide.
    if (want[0] === want[1]) {
      want[0] -= 0.5;
      want[1] += 0.5;
    }
    // Pick the lane pair closest to where the sounds belong, nudged toward lanes used less so far.
    const total = laneUse[0]! + laneUse[1]! + laneUse[2]! + 1;
    const pairs: Array<[LaneIndex, LaneIndex]> = [[0, 1], [1, 2], [0, 2]];
    let best = pairs[2]!;
    let bestCost = Infinity;
    for (const pair of pairs) {
      const fit = Math.abs(pair[0] - want[0]!) + Math.abs(pair[1] - want[1]!);
      const share = (laneUse[pair[0]]! + laneUse[pair[1]]!) / total;
      const cost = fit + 2.5 * share;
      if (cost < bestCost) {
        bestCost = cost;
        best = pair;
      }
    }
    return groups.map((g) => best[g === 0 ? 0 : 1]);
  }

  // One timbre: move with the melody, bouncing off the edges.
  const lanes: LaneIndex[] = [];
  let lane: LaneIndex = prevLane;
  const leastUsed = laneUse.indexOf(Math.min(...laneUse)) as LaneIndex;
  let direction = leastUsed > prevLane ? 1 : leastUsed < prevLane ? -1 : prevLane === 2 ? -1 : 1;
  for (let i = 0; i < chosen.length; i++) {
    if (i > 0) {
      const delta = pitches[i]! - pitches[i - 1]!;
      // The same sound again keeps its key; the jack rule handles anything too fast.
      if (Math.abs(delta) <= 0.12) {
        lanes.push(lane);
        continue;
      }
      direction = delta > 0 ? 1 : -1;
      let next = lane + direction;
      if (next < 0 || next > 2) {
        direction = -direction;
        next = lane + direction;
      }
      lane = next as LaneIndex;
    }
    lanes.push(lane);
  }
  return lanes;
}

function pitchOf(slot: Slot): number {
  const o = slot.onset;
  if (!o) return 9;
  // Blend the flux centroid with the band split so a kick under a hat still reads low.
  const bandPitch = o.bands[0] * 6.5 + o.bands[1] * 8.3 + o.bands[2] * 10.3 + o.bands[3] * 12.6;
  return 0.5 * o.pitch + 0.5 * bandPitch;
}

/** 1-D grouping: sorts pitches and splits at gaps larger than 0.45 octave, at most 3 groups. */
function clusterPitches(pitches: number[]): number[] {
  const order = pitches.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const gaps: Array<{ at: number; size: number }> = [];
  for (let k = 1; k < order.length; k++) gaps.push({ at: k, size: order[k]!.p - order[k - 1]!.p });
  const cuts = gaps
    .filter((g) => g.size > 0.45)
    .sort((a, b) => b.size - a.size)
    .slice(0, 2)
    .map((g) => g.at)
    .sort((a, b) => a - b);
  const groups = new Array<number>(pitches.length);
  let group = 0;
  order.forEach((entry, k) => {
    while (group < cuts.length && k >= cuts[group]!) group++;
    groups[entry.i] = group;
  });
  return groups;
}

function placedLanesOf(placed: Placed[], bar: number): LaneIndex[] {
  return placed.filter((p) => p.bar === bar).sort((a, b) => a.time - b.time).map((p) => p.lane);
}

function mirror(lane: LaneIndex): LaneIndex {
  return (2 - lane) as LaneIndex;
}

/** Fixes fast same-key repeats and long same-lane runs. */
function enforcePlayability(placed: Placed[]) {
  let streak = 1;
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1]!;
    const note = placed[i]!;
    const gap = note.time - prev.time;
    if (note.lane === prev.lane) {
      streak++;
      const tooFast = gap < MIN_JACK_SEC;
      const tooLong = (streak >= 4 && gap < 0.4) || streak >= 7;
      if (tooFast || tooLong) {
        // Move to whichever other lane was used longest ago (and isn't the next note's).
        const others = ([0, 1, 2] as LaneIndex[]).filter((l) => l !== prev.lane);
        const lastUse = (lane: LaneIndex) => {
          for (let k = i - 1; k >= 0; k--) if (placed[k]!.lane === lane) return k;
          return -1;
        };
        const next = placed[i + 1];
        others.sort((a, b) => {
          const clashA = next && next.lane === a && next.time - note.time < MIN_JACK_SEC ? 1 : 0;
          const clashB = next && next.lane === b && next.time - note.time < MIN_JACK_SEC ? 1 : 0;
          return clashA - clashB || lastUse(a) - lastUse(b);
        });
        note.lane = others[0]!;
        streak = 1;
      }
    } else {
      streak = 1;
    }
  }
}

// ---------- Specials ----------

function addHolds(placed: Placed[], bars: Bar[], analysis: BeatAnalysis, beatSec: number) {
  const maxHolds = Math.floor(placed.length * 0.14);
  let holds = 0;
  for (let i = 0; i < placed.length && holds < maxHolds; i++) {
    const note = placed[i]!;
    const next = placed[i + 1];
    const gap = (next ? next.time : analysis.duration) - note.time;
    const sustain = note.slot.onset?.sustain ?? 0;
    const bar = bars[note.bar]!;
    if (gap < Math.max(1.5 * beatSec, 0.65)) continue;
    if (i > 0 && note.time - placed[i - 1]!.time < 0.3) continue;
    if (bar.impact && note.slot === bar.slots.find((s) => s.pos === 0)) continue;
    // Sustained sounds get held; in calm stretches, so does the last note before a long rest.
    const phraseEnd = gap >= 2.5 * beatSec && bar.intensity < 0.6 && sustain >= 0.3;
    if ((sustain < 0.5 && !phraseEnd) || bar.intensity > 0.85) continue;
    const release = Math.max(0.5 * beatSec, 0.3);
    const rawEnd = Math.min(note.time + 4 * beatSec, note.time + gap - release);
    // Snap the release to the half-beat grid so it ends on the music.
    const end = note.time + Math.floor((rawEnd - note.time) / (beatSec / 2)) * (beatSec / 2);
    if (end - note.time < Math.max(0.75 * beatSec, 0.4)) continue;
    note.type = 'hold';
    note.holdEndTime = end;
    holds++;
  }
}

function addSwitches(placed: Placed[], bars: Bar[], beatSec: number) {
  const maxSwitches = Math.floor(placed.length * 0.06);
  let switches = 0;
  let lastSwitchBar = -99;
  for (let i = 1; i < placed.length - 1 && switches < maxSwitches; i++) {
    const note = placed[i]!;
    if (note.type !== 'normal') continue;
    const bar = bars[note.bar]!;
    const before = note.time - placed[i - 1]!.time;
    const after = placed[i + 1]!.time - note.time;
    // An accent stands out from the notes around it.
    const around = [placed[i - 2], placed[i - 1], placed[i + 1], placed[i + 2]].filter((p): p is Placed => p !== undefined);
    const aroundMean = around.reduce((s2, p) => s2 + p.slot.salience, 0) / Math.max(1, around.length);
    const accent = note.slot.salience >= 0.8 && note.slot.salience >= aroundMean * 1.25;
    // The first beat of a drop stays a plain note: the payoff there is density, not a trick ball.
    const isDropDownbeat = bar.impact && note.slot === bar.slots.find((s) => s.pos === 0);
    if (!accent || isDropDownbeat) continue;
    if (before < Math.max(0.3, 0.9 * beatSec) || after < Math.max(0.3, 0.7 * beatSec) || bar.intensity < 0.4) continue;
    if (note.bar - lastSwitchBar < 2) continue;
    const prev = placed[i - 1]!.lane;
    note.type = 'switch';
    note.switchFrom = note.lane === 1 ? (prev === 0 ? 2 : 0) : (mirror(note.lane));
    lastSwitchBar = note.bar;
    switches++;
  }
}

/** The second hit of a quick double on the same key shows as an echo. */
function markEchoes(placed: Placed[], beatSec: number) {
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1]!;
    const note = placed[i]!;
    if (note.type !== 'normal' || prev.type === 'hold') continue;
    const beforePrev = placed[i - 2];
    const isDouble = note.lane === prev.lane && note.time - prev.time <= beatSec * 0.5 + 0.01;
    // Only a pair, not the middle of a run on one key.
    if (isDouble && beforePrev?.lane !== prev.lane && placed[i + 1]?.lane !== note.lane) note.type = 'echo';
  }
}

// ---------- Helpers ----------

function noteTime(slot: Slot): number {
  // Hit on the sound itself when there is one; it's what the player hears.
  return slot.onset && Math.abs(slot.onset.time - slot.time) <= 0.04 ? slot.onset.time : slot.time;
}

/**
 * Notes were chosen with spacing checked on grid times, then snapped to their
 * onsets (up to 40 ms away), which can squeeze two notes closer than allowed.
 * Put the notes of any squeezed spot back on their grid times, which passed
 * the spacing check, until the final times are clean too.
 */
function keepSpacingAfterSnap(placed: Placed[]) {
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let i = 1; i < placed.length; i++) {
      const gap = placed[i]!.time - placed[i - 1]!.time;
      const nextGap = i + 1 < placed.length ? placed[i + 1]!.time - placed[i]!.time : Infinity;
      const squeezed = gap < PAIR_GAP_SEC || (gap < MIN_GAP_SEC && nextGap < MIN_GAP_SEC);
      if (!squeezed) continue;
      for (const j of [i - 1, i, i + 1]) {
        const note = placed[j];
        if (note && note.time !== note.slot.time) {
          note.time = note.slot.time;
          changed = true;
        }
      }
    }
    if (!changed) return;
    placed.sort((a, b) => a.time - b.time);
  }
}

function fitsSpacing(sortedTimes: number[], time: number): boolean {
  return spacingOk(sortedTimes, time, PAIR_GAP_SEC) && withinRollingCaps(sortedTimes, time);
}

/**
 * Notes need MIN_GAP_SEC between them, except that a quick pair (down to
 * `minGap`) is allowed as long as it doesn't chain into a run of three.
 */
function spacingOk(sortedTimes: number[], time: number, minGap: number): boolean {
  let lo = 0;
  let hi = sortedTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid]! < time) lo = mid + 1;
    else hi = mid;
  }
  const after = sortedTimes[lo];
  const before = sortedTimes[lo - 1];
  const gapAfter = after === undefined ? Infinity : after - time;
  const gapBefore = before === undefined ? Infinity : time - before;
  if (gapAfter < minGap || gapBefore < minGap) return false;
  const tightAfter = gapAfter < MIN_GAP_SEC;
  const tightBefore = gapBefore < MIN_GAP_SEC;
  if (tightAfter && tightBefore) return false;
  if (tightBefore && before !== undefined && (sortedTimes[lo - 2] ?? -Infinity) > before - MIN_GAP_SEC) return false;
  if (tightAfter && after !== undefined && (sortedTimes[lo + 1] ?? Infinity) < after + MIN_GAP_SEC) return false;
  return true;
}

/** True if adding `time` keeps every rolling window under its cap. */
function withinRollingCaps(sortedTimes: number[], time: number): boolean {
  for (const [window, cap] of ROLLING_CAPS) {
    const near = sortedTimes.filter((t) => t > time - window && t < time + window);
    near.push(time);
    near.sort((a, b) => a - b);
    let lo = 0;
    for (let hi = 0; hi < near.length; hi++) {
      while (near[hi]! - near[lo]! >= window) lo++;
      if (hi - lo + 1 > cap) return false;
    }
  }
  return true;
}

function insertSorted(sortedTimes: number[], time: number) {
  let i = sortedTimes.length;
  while (i > 0 && sortedTimes[i - 1]! > time) i--;
  sortedTimes.splice(i, 0, time);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function buildDebugReport(analysis: BeatAnalysis, notes: BeatNote[], barCount: number): BeatmapDebugReport {
  const windows = buildDebugWindows({
    notes,
    duration: analysis.duration,
    bpm: analysis.bpm,
    dropEvents: [],
    binSizeSec: DEBUG_BIN_SIZE_SEC,
  });
  const types = countNoteTypes(notes);
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    enabled: true,
    durationSec: analysis.duration,
    bpm: analysis.bpm,
    usedFallback: analysis.usedFallback,
    songFingerprint: `${analysis.duration.toFixed(1)}s-${Math.round(analysis.bpm)}bpm-${analysis.onsets.length}onsets-${notes.length}notes`,
    binSizeSec: DEBUG_BIN_SIZE_SEC,
    stageCounts: {
      onsets: analysis.onsets.length,
      beats: analysis.beatTimes.length,
      bars: barCount,
      finalNotes: notes.length,
      holdNotes: types.hold,
      switchNotes: types.switch,
      echoNotes: types.echo,
    },
    holdCoverageSec: notes.reduce((s, n) => s + (n.holdEndTime ? n.holdEndTime - n.time : 0), 0),
    largestFinalGapSec: calculateLargestGapFromNotes(notes, analysis.duration),
    dropReasons: {},
    alerts: [],
    windows,
    worstWindows: [...windows].sort((a, b) => b.score - a.score).slice(0, 5),
  };
}
