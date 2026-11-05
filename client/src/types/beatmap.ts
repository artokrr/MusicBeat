export type NoteType = 'normal' | 'hold' | 'echo' | 'switch';

export type LaneIndex = 0 | 1 | 2;

export interface BeatNote {
  id: string;
  time: number; // When to hit (seconds)
  side: 'player' | 'npc'; // Who should hit
  intensity: number; // 0-1, affects visual size
  type: NoteType;
  laneIndex: LaneIndex;

  // Hold notes (osu-like sliders)
  holdEndTime?: number; // Seconds
  holdTickEveryBeats?: number; // Typically 0.5 (8th-note ticks)

  // Switch notes
  switchFromLaneIndex?: LaneIndex;
}

export interface TimingInfo {
  bpm: number;
  beatDuration: number; // ms per beat
  offsetMs: number; // Audio start offset
}

export interface Beatmap {
  id?: string;
  metadata: {
    title: string;
    duration: number; // seconds
    audioUrl?: string;
  };
  timing: TimingInfo;
  notes: BeatNote[];
  debug?: BeatmapDebugReport;
}

/** One detected onset (something you can hear start): a drum hit, a note, a vocal syllable. */
export interface OnsetEvent {
  time: number; // seconds
  strength: number; // 0..1, relative to the song's strong onsets
  /** Share of the onset's spectral flux per band: [low <150Hz, low-mid, mid, high >3kHz]. Sums to 1. */
  bands: [number, number, number, number];
  /** log2(Hz) of the flux-weighted spectral centroid: how "high" the hit sounds. */
  pitch: number;
  /** 0..1, how much of the sound is still ringing ~0.15-0.5s later (holds). */
  sustain: number;
  /** 0..1, how loud the moment is relative to the song's loud parts (0 = ~36 dB below). */
  loudness: number;
}

export interface BeatAnalysis {
  bpm: number;
  /** Tracked beat times (follow tempo drift). */
  beatTimes: number[];
  /** Per beat, 0..1: how clearly the beat is audible. */
  beatStrength: number[];
  /** Index into beatTimes of the first bar start (downbeat). */
  downbeatOffset: number;
  /** 2 for straight 8th/16th feel, 3 for swing/triplet feel. */
  subdivision: 2 | 3;
  onsets: OnsetEvent[];
  /** Per beat, 0..1: how intense the music is around that beat (loudness, activity, brightness). */
  intensity: number[];
  /** Per beat, 0..1: kick/bass weight (drops are where this jumps). */
  lowWeight: number[];
  duration: number;
  /** True when no steady beat was found; the map then follows onsets only. */
  usedFallback: boolean;
  analysisStats?: Record<string, number>;
}

export interface BeatmapDebugWindow {
  startSec: number;
  endSec: number;
  notes: number;
  notesPerSecond: number;
  maxGapSec: number;
  avgGapSec: number;
  laneCounts: {
    left: number;
    center: number;
    right: number;
  };
  noteTypeCounts: Record<NoteType, number>;
  laneEntropy: number; // 0-1
  typeEntropy: number; // 0-1
  longestSameLaneStreak: number;
  dropReasons: Record<string, number>;
  score: number;
}

export interface BeatmapDebugReport {
  version: number;
  generatedAt: string;
  enabled: boolean;
  durationSec: number;
  bpm: number;
  usedFallback: boolean;
  songFingerprint: string;
  binSizeSec: number;
  stageCounts: Record<string, number> & { finalNotes: number };
  holdCoverageSec: number;
  largestFinalGapSec: number;
  dropReasons: Record<string, number>;
  alerts: string[];
  windows: BeatmapDebugWindow[];
  worstWindows: BeatmapDebugWindow[];
}
