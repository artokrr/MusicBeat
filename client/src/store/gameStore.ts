import { create } from 'zustand';

import { sfx } from '../audio/sfx';
import { SCORING, DIFFICULTY_PRESETS } from '../types/game';

import type {
  GameScreen,
  GamePhase,
  GameScore,
  HitResult,
  HitFeedback,
  DifficultyLevel,
  GameplaySettings,
  RunOutcome,
} from '../types/game';
import type { Beatmap } from '../types/beatmap';

interface GameState {
  // Navigation
  screen: GameScreen;
  setScreen: (screen: GameScreen) => void;

  // Game settings
  difficulty: DifficultyLevel;
  setDifficulty: (difficulty: DifficultyLevel) => void;
  musicVolume: number;
  setMusicVolume: (volume: number) => void;
  sfxVolume: number;
  setSfxVolume: (volume: number) => void;
  getGameplaySettings: () => GameplaySettings;

  // Game phase
  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;

  // Current beatmap
  beatmap: Beatmap | null;
  setBeatmap: (beatmap: Beatmap | null) => void;

  // Audio buffer
  audioBuffer: AudioBuffer | null;
  setAudioBuffer: (buffer: AudioBuffer | null) => void;

  // Run metadata
  playerHandle: string;
  setPlayerHandle: (handle: string) => void;
  songTitle: string;
  setSongTitle: (title: string) => void;

  // Score tracking
  score: GameScore;
  health: number;
  missStreak: number;
  runOutcome: RunOutcome | null;
  setRunOutcome: (outcome: RunOutcome | null) => void;
  recordHit: (result: HitResult, options?: { pointsMultiplier?: number; incrementCombo?: boolean }) => void;
  applyPassiveDrain: (deltaSeconds: number) => void;
  addPoints: (points: number) => void;
  resetScore: () => void;

  // Hit feedback for visual effects
  hitFeedbacks: HitFeedback[];
  addHitFeedback: (feedback: HitFeedback) => void;
  clearOldFeedbacks: () => void;

  // Reset game
  resetGame: () => void;
}

const initialScore: GameScore = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfectCount: 0,
  goodCount: 0,
  okCount: 0,
  missCount: 0,
};
const MAX_HEALTH = 1;
const MIN_HEALTH = 0;
const HANDLE_STORAGE_KEY = 'pong:handle';
const LEGACY_HANDLE_STORAGE_KEY = 'musicbeat:handle';
const VOLUME_STORAGE_KEY = 'musicbeat:volume';
const SFX_VOLUME_STORAGE_KEY = 'pong:sfxVolume';
const DEFAULT_SFX_VOLUME = 0.8;
const DEFAULT_MUSIC_VOLUME = 0.3;

function clampHealth(value: number) {
  return Math.max(MIN_HEALTH, Math.min(MAX_HEALTH, value));
}

function clampVolume(value: number) {
  return Math.max(0, Math.min(1, value));
}

const storedHandle = typeof window !== 'undefined'
  ? (window.localStorage.getItem(HANDLE_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_HANDLE_STORAGE_KEY))
  : null;
const defaultHandle = storedHandle && storedHandle.trim() ? storedHandle : 'player';
const storedVolume = typeof window !== 'undefined'
  ? window.localStorage.getItem(VOLUME_STORAGE_KEY)
  : null;
const parsedStoredVolume = storedVolume === null ? Number.NaN : Number.parseFloat(storedVolume);
const defaultMusicVolume = Number.isFinite(parsedStoredVolume)
  ? clampVolume(parsedStoredVolume)
  : DEFAULT_MUSIC_VOLUME;
const storedSfxVolume = typeof window !== 'undefined'
  ? Number.parseFloat(window.localStorage.getItem(SFX_VOLUME_STORAGE_KEY) ?? '')
  : Number.NaN;
const defaultSfxVolume = Number.isFinite(storedSfxVolume) ? clampVolume(storedSfxVolume) : DEFAULT_SFX_VOLUME;
sfx.setVolume(defaultSfxVolume);

export const useGameStore = create<GameState>((set, get) => ({
  screen: 'upload',
  setScreen: (screen) => set({ screen }),

  difficulty: 'pro', // Default to 'pro' for best experience
  setDifficulty: (difficulty) => set({ difficulty }),
  musicVolume: defaultMusicVolume,
  setMusicVolume: (musicVolume) => {
    const normalizedVolume = clampVolume(musicVolume);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, normalizedVolume.toString());
    }
    set({ musicVolume: normalizedVolume });
  },
  sfxVolume: defaultSfxVolume,
  setSfxVolume: (volume) => {
    const normalized = clampVolume(volume);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SFX_VOLUME_STORAGE_KEY, normalized.toString());
    }
    sfx.setVolume(normalized);
    set({ sfxVolume: normalized });
  },
  getGameplaySettings: () => DIFFICULTY_PRESETS[get().difficulty],

  phase: 'countdown',
  setPhase: (phase) => set({ phase }),

  beatmap: null,
  setBeatmap: (beatmap) => set({ beatmap }),

  audioBuffer: null,
  setAudioBuffer: (audioBuffer) => set({ audioBuffer }),

  playerHandle: defaultHandle,
  setPlayerHandle: (playerHandle) => {
    const trimmedHandle = playerHandle.trim();
    if (typeof window !== 'undefined' && trimmedHandle) {
      window.localStorage.setItem(HANDLE_STORAGE_KEY, trimmedHandle);
      window.localStorage.removeItem(LEGACY_HANDLE_STORAGE_KEY);
    }
    set({ playerHandle });
  },

  songTitle: '',
  setSongTitle: (songTitle) => set({ songTitle }),

  score: { ...initialScore },
  health: MAX_HEALTH,
  missStreak: 0,
  runOutcome: null,
  setRunOutcome: (runOutcome) => set({ runOutcome }),

  recordHit: (result, options) => {
    const { score, health, missStreak } = get();
    const { pointsMultiplier = 1, incrementCombo = true } = options ?? {};
    const gameplaySettings = DIFFICULTY_PRESETS[get().difficulty];

    const scoring = SCORING[result];

    const comboMultiplier = 1 + Math.floor(score.combo / 10) * 0.1;
    const addedPoints = scoring.points * pointsMultiplier * comboMultiplier;

    const newCombo = scoring.keepCombo
      ? (incrementCombo ? score.combo + 1 : score.combo)
      : 0;
    const newMissStreak = result === 'miss' ? missStreak + 1 : 0;
    const healthDelta = result === 'miss'
      ? -gameplaySettings.hpMissPenalty
      : gameplaySettings.hpGain[result];
    const nextHealth = clampHealth(health + healthDelta);

    set({
      score: {
        ...score,
        score: score.score + addedPoints,
        combo: newCombo,
        maxCombo: Math.max(score.maxCombo, newCombo),
        [`${result}Count`]: (score[`${result}Count` as keyof GameScore] as number) + 1,
      },
      health: nextHealth,
      missStreak: newMissStreak,
    });
  },

  applyPassiveDrain: (deltaSeconds) => {
    if (deltaSeconds <= 0) return;

    const { health } = get();
    const gameplaySettings = DIFFICULTY_PRESETS[get().difficulty];
    const drainedHealth = clampHealth(health - gameplaySettings.hpDrainPerSecond * deltaSeconds);

    if (drainedHealth === health) return;
    set({ health: drainedHealth });
  },

  addPoints: (points) => {
    const { score } = get();
    const comboMultiplier = 1 + Math.floor(score.combo / 10) * 0.1;

    set({
      score: {
        ...score,
        score: score.score + points * comboMultiplier,
      },
    });
  },

  resetScore: () => set({
    score: { ...initialScore },
    health: MAX_HEALTH,
    missStreak: 0,
    runOutcome: null,
  }),

  hitFeedbacks: [],
  addHitFeedback: (feedback) => {
    set((state) => ({
      hitFeedbacks: [...state.hitFeedbacks, feedback],
    }));
  },
  clearOldFeedbacks: () => {
    const now = Date.now();
    const feedbacks = get().hitFeedbacks;
    // Usually nothing expires on this frame. Preserve the array and avoid
    // notifying every store subscriber for an unchanged judgement list.
    for (const feedback of feedbacks) {
      if (now - feedback.timestamp >= 1000) {
        set({ hitFeedbacks: feedbacks.filter((f) => now - f.timestamp < 1000) });
        break;
      }
    }
  },

  resetGame: () => {
    set({
      screen: 'upload',
      phase: 'countdown',
      beatmap: null,
      audioBuffer: null,
      songTitle: '',
      score: { ...initialScore },
      health: MAX_HEALTH,
      missStreak: 0,
      runOutcome: null,
      hitFeedbacks: [],
    });
  },
}));
