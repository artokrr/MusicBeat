// Per-window diagnostics for a generated map (shown in the ?debugBeatmap=1 overlay
// and in the downloadable debug JSON).

import type { BeatmapDebugWindow, BeatNote, LaneIndex, NoteType } from '../types/beatmap';

export interface BeatDropEvent {
  timeSec: number;
  reason: string;
}

export function buildDebugWindows(input: {
  notes: BeatNote[];
  duration: number;
  bpm: number;
  dropEvents: BeatDropEvent[];
  binSizeSec: number;
}): BeatmapDebugWindow[] {
  const { notes, duration, bpm, dropEvents, binSizeSec } = input;

  const effectiveDuration = Math.max(
    duration,
    notes.length > 0 ? notes[notes.length - 1]!.time : 0,
  );
  const totalWindows = Math.max(1, Math.ceil(Math.max(effectiveDuration, binSizeSec) / binSizeSec));
  const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
  const sortedDrops = [...dropEvents].sort((a, b) => a.timeSec - b.timeSec);

  const windows: BeatmapDebugWindow[] = [];
  let noteCursor = 0;
  let dropCursor = 0;

  const targetNotesPerSecond = bpm >= 150 ? 2.4 : (bpm >= 120 ? 1.8 : 1.2);

  for (let i = 0; i < totalWindows; i++) {
    const startSec = i * binSizeSec;
    const endSec = Math.min(effectiveDuration, startSec + binSizeSec);
    const isLastWindow = i === totalWindows - 1;

    const windowNotes: BeatNote[] = [];
    while (noteCursor < sortedNotes.length) {
      const note = sortedNotes[noteCursor]!;
      const isInsideWindow = note.time < endSec || (isLastWindow && note.time <= endSec);
      if (!isInsideWindow) break;

      if (note.time >= startSec) {
        windowNotes.push(note);
      }
      noteCursor++;
    }

    const dropReasons: Record<string, number> = {};
    while (dropCursor < sortedDrops.length) {
      const drop = sortedDrops[dropCursor]!;
      const isInsideWindow = drop.timeSec < endSec || (isLastWindow && drop.timeSec <= endSec);
      if (!isInsideWindow) break;

      if (drop.timeSec >= startSec) {
        dropReasons[drop.reason] = (dropReasons[drop.reason] ?? 0) + 1;
      }
      dropCursor++;
    }

    const noteTypeCounts = createEmptyNoteTypeCounts();
    const laneCounts = {
      left: 0,
      center: 0,
      right: 0,
    };

    let longestSameLaneStreak = 0;
    let currentLaneStreak = 0;
    let previousLane: LaneIndex | null = null;

    for (const note of windowNotes) {
      noteTypeCounts[note.type] += 1;
      if (note.laneIndex === 0) laneCounts.left += 1;
      if (note.laneIndex === 1) laneCounts.center += 1;
      if (note.laneIndex === 2) laneCounts.right += 1;

      if (previousLane === note.laneIndex) {
        currentLaneStreak += 1;
      } else {
        currentLaneStreak = 1;
        previousLane = note.laneIndex;
      }
      if (currentLaneStreak > longestSameLaneStreak) {
        longestSameLaneStreak = currentLaneStreak;
      }
    }

    const noteTimes = windowNotes.map((note) => note.time);
    const { maxGapSec, avgGapSec } = calculateWindowGapStats(noteTimes, startSec, endSec);

    const windowDuration = Math.max(0.001, endSec - startSec);
    const notesPerSecond = windowNotes.length / windowDuration;
    const laneEntropy = calculateNormalizedEntropy([laneCounts.left, laneCounts.center, laneCounts.right]);
    const typeEntropy = calculateNormalizedEntropy([
      noteTypeCounts.normal,
      noteTypeCounts.hold,
      noteTypeCounts.switch,
      noteTypeCounts.echo,
    ]);

    const silentPenalty = windowNotes.length === 0 ? 4 : 0;
    const sparsePenalty = Math.max(0, targetNotesPerSecond - notesPerSecond);
    const varietyPenalty = (1 - laneEntropy) * 1.2 + (1 - typeEntropy);
    const gapPenalty = maxGapSec * 1.4;
    const streakPenalty = longestSameLaneStreak >= 6 ? (longestSameLaneStreak - 5) * 0.2 : 0;
    const dropPenalty = Math.min(2.5, Object.keys(dropReasons).length * 0.2);
    const score = silentPenalty + sparsePenalty + varietyPenalty + gapPenalty + streakPenalty + dropPenalty;

    windows.push({
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      notes: windowNotes.length,
      notesPerSecond: Number(notesPerSecond.toFixed(3)),
      maxGapSec: Number(maxGapSec.toFixed(3)),
      avgGapSec: Number(avgGapSec.toFixed(3)),
      laneCounts,
      noteTypeCounts,
      laneEntropy: Number(laneEntropy.toFixed(3)),
      typeEntropy: Number(typeEntropy.toFixed(3)),
      longestSameLaneStreak,
      dropReasons,
      score: Number(score.toFixed(3)),
    });
  }

  return windows;
}

function createEmptyNoteTypeCounts(): Record<NoteType, number> {
  return {
    normal: 0,
    hold: 0,
    switch: 0,
    echo: 0,
  };
}

export function countNoteTypes(notes: BeatNote[]): Record<NoteType, number> {
  const counts = createEmptyNoteTypeCounts();
  for (const note of notes) {
    counts[note.type] += 1;
  }
  return counts;
}

function calculateWindowGapStats(noteTimes: number[], startSec: number, endSec: number): { maxGapSec: number; avgGapSec: number } {
  const windowDuration = Math.max(0, endSec - startSec);
  if (noteTimes.length === 0) {
    return {
      maxGapSec: windowDuration,
      avgGapSec: windowDuration,
    };
  }

  const gaps: number[] = [];
  let previousTime = startSec;
  for (const noteTime of noteTimes) {
    gaps.push(Math.max(0, noteTime - previousTime));
    previousTime = noteTime;
  }
  gaps.push(Math.max(0, endSec - previousTime));

  const maxGapSec = gaps.reduce((max, gap) => (gap > max ? gap : max), 0);
  const avgGapSec = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  return {
    maxGapSec,
    avgGapSec,
  };
}

function calculateNormalizedEntropy(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;

  let entropy = 0;
  for (const value of values) {
    if (value <= 0) continue;
    const probability = value / total;
    entropy -= probability * Math.log2(probability);
  }

  const maxEntropy = Math.log2(values.length);
  if (maxEntropy <= 0) return 0;
  return entropy / maxEntropy;
}

export function calculateLargestGapFromNotes(notes: BeatNote[], duration: number): number {
  if (duration <= 0) return 0;
  if (notes.length === 0) return duration;

  const sortedNotes = [...notes].sort((a, b) => a.time - b.time);
  let largestGap = Math.max(0, sortedNotes[0]!.time);

  for (let i = 1; i < sortedNotes.length; i++) {
    const gap = sortedNotes[i]!.time - sortedNotes[i - 1]!.time;
    if (gap > largestGap) largestGap = gap;
  }

  const trailingGap = duration - sortedNotes[sortedNotes.length - 1]!.time;
  if (trailingGap > largestGap) largestGap = trailingGap;

  return Math.max(0, largestGap);
}

