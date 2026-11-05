import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

import { useGameStore } from '../store/gameStore';
import { DIFFICULTY_PRESETS } from '../types/game';
import Game from '../game/Game';
import { sfx } from '../audio/sfx';

import type { GameSoundEvent } from '../game/Game';
import GameHUD from './GameHUD';
import PxText from '../game/pixel/PxText';

import type { FailReason, RunOutcome } from '../types/game';

const FAIL_AUDIO_DURATION_MS = 1200;

export default function GameScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastDrainTimeRef = useRef<number>(0);
  const failTimeoutRef = useRef<number | null>(null);
  const hasFinalizedRunRef = useRef(false);
  const failSequenceStartedRef = useRef(false);
  const ignoreOnEndedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [failStartMs, setFailStartMs] = useState<number | null>(null);


  const audioBuffer = useGameStore((state) => state.audioBuffer);
  const beatmap = useGameStore((state) => state.beatmap);
  const phase = useGameStore((state) => state.phase);
  const setPhase = useGameStore((state) => state.setPhase);
  const setScreen = useGameStore((state) => state.setScreen);
  const resetGame = useGameStore((state) => state.resetGame);
  const difficulty = useGameStore((state) => state.difficulty);
  const volume = useGameStore((state) => state.musicVolume);
  const setMusicVolume = useGameStore((state) => state.setMusicVolume);
  const sfxVolume = useGameStore((state) => state.sfxVolume);
  const setSfxVolume = useGameStore((state) => state.setSfxVolume);
  const health = useGameStore((state) => state.health);
  const missStreak = useGameStore((state) => state.missStreak);
  const setRunOutcome = useGameStore((state) => state.setRunOutcome);
  const applyPassiveDrain = useGameStore((state) => state.applyPassiveDrain);
  const [showDebugOverlay, setShowDebugOverlay] = useState(true);

  const gameplaySettings = useMemo(() => DIFFICULTY_PRESETS[difficulty], [difficulty]);

  const clearFailTimeout = useCallback(() => {
    if (failTimeoutRef.current === null) return;
    window.clearTimeout(failTimeoutRef.current);
    failTimeoutRef.current = null;
  }, []);

  const closeAudio = useCallback(() => {
    try {
      sourceNodeRef.current?.stop();
    } catch (error) {
      // Ignore already-stopped sources.
    }

    try {
      audioContextRef.current?.close();
    } catch (error) {
      // Ignore already-closed contexts.
    }

    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    audioContextRef.current = null;
  }, []);

  const finalizeRun = useCallback((outcome: RunOutcome) => {
    if (hasFinalizedRunRef.current) return;

    hasFinalizedRunRef.current = true;
    setRunOutcome(outcome);
    setIsPlaying(false);
    setPhase('ended');
    closeAudio();
    setScreen('results');
  }, [closeAudio, setPhase, setRunOutcome, setScreen]);

  const triggerFail = useCallback((reason: FailReason) => {
    if (hasFinalizedRunRef.current || failSequenceStartedRef.current) return;

    failSequenceStartedRef.current = true;
    setFailStartMs(performance.now());
    sfx.fail();
    setRunOutcome(reason);
    setIsPlaying(false);
    setPhase('ended');
    clearFailTimeout();

    const audioContext = audioContextRef.current;
    const sourceNode = sourceNodeRef.current;
    const gainNode = gainNodeRef.current;

    if (!audioContext || !sourceNode || !gainNode) {
      finalizeRun(reason);
      return;
    }

    const now = audioContext.currentTime;
    const safeCurrentGain = Math.max(gainNode.gain.value, 0.0001);

    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(safeCurrentGain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + FAIL_AUDIO_DURATION_MS / 1000);

    sourceNode.playbackRate.cancelScheduledValues(now);
    sourceNode.playbackRate.setValueAtTime(Math.max(sourceNode.playbackRate.value, 0.0001), now);
    sourceNode.playbackRate.exponentialRampToValueAtTime(0.6, now + FAIL_AUDIO_DURATION_MS / 1000);

    ignoreOnEndedRef.current = true;
    failTimeoutRef.current = window.setTimeout(() => {
      finalizeRun(reason);
    }, FAIL_AUDIO_DURATION_MS);
  }, [clearFailTimeout, finalizeRun, setPhase, setRunOutcome]);

  // Sound cues from the game (hits, misses, finished holds, empty swings).
  const handleSound = useCallback((event: GameSoundEvent) => {
    switch (event.kind) {
      case 'hit':
        sfx.hit(event.result, event.lane, event.noteType);
        break;
      case 'miss':
        sfx.miss(event.lane);
        break;
      case 'swing':
        sfx.swing(event.lane);
        break;
      case 'holdDone':
        sfx.holdDone(event.lane);
        break;
    }
  }, []);

  // Handle volume change - update gain node directly
  const handleVolumeChange = useCallback((newVolume: number) => {
    setMusicVolume(newVolume);

    if (gainNodeRef.current) {
      // Direct value assignment - works immediately
      // Use small value instead of 0 to avoid clicks, but true 0 for mute
      gainNodeRef.current.gain.value = newVolume === 0 ? 0 : newVolume;
    }
  }, [setMusicVolume]);

  // Start the game audio - only call once!
  const startGame = useCallback(() => {
    // Guard: don't start if already playing
    if (!audioBuffer || audioContextRef.current) return;

    hasFinalizedRunRef.current = false;
    failSequenceStartedRef.current = false;
    ignoreOnEndedRef.current = false;
    lastDrainTimeRef.current = 0;
    clearFailTimeout();

    setRunOutcome(null);
    setCurrentTime(0);
    setCountdown(0);

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    // Create gain node for volume control.
    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;
    gainNodeRef.current = gainNode;

    // Create and connect source -> gain -> destination
    const sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    sourceNode.onended = () => {
      if (ignoreOnEndedRef.current) return;
      finalizeRun('completed');
    };

    sourceNode.start(0);
    sourceNodeRef.current = sourceNode;
    sfx.go();
    startTimeRef.current = audioContext.currentTime;
    lastDrainTimeRef.current = 0;

    setIsPlaying(true);
    setPhase('playing');
  }, [audioBuffer, clearFailTimeout, finalizeRun, setPhase, setRunOutcome, volume]);

  // A blip on each countdown number (once per number, even if the effect re-runs).
  const lastBlipRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== 'countdown' || countdown <= 0) {
      lastBlipRef.current = null;
      return;
    }
    if (lastBlipRef.current === countdown) return;
    lastBlipRef.current = countdown;
    sfx.countdown();
  }, [phase, countdown]);

  // Start countdown and then play
  useEffect(() => {
    if (phase !== 'countdown') return;

    // Count down outside the state updater: updaters run during render, and
    // starting the game from one would update the store mid-render.
    let remaining = countdownRef.current;
    const countdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        setCountdown(0);
        startGame();
        return;
      }
      setCountdown(remaining);
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [phase, startGame]);

  // Update current time
  useEffect(() => {
    if (!isPlaying || !audioContextRef.current) return;

    const updateTime = () => {
      if (audioContextRef.current) {
        const time = audioContextRef.current.currentTime - startTimeRef.current;
        setCurrentTime(time);
      }
    };

    const interval = setInterval(updateTime, 16);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Passive HP drain while gameplay is active.
  useEffect(() => {
    if (phase !== 'playing') {
      lastDrainTimeRef.current = currentTime;
      return;
    }

    const deltaSeconds = Math.max(0, currentTime - lastDrainTimeRef.current);
    lastDrainTimeRef.current = currentTime;
    // HP only drains while there's something to play; a long quiet passage
    // with no notes would otherwise kill a player who hit everything.
    if (deltaSeconds > 0 && beatmap && isNearNote(beatmap.notes, currentTime)) {
      applyPassiveDrain(deltaSeconds);
    }
  }, [applyPassiveDrain, beatmap, currentTime, phase]);

  // Defeat checks:
  // - miss streak fails immediately (osu-style),
  // - HP fail starts after grace period.
  useEffect(() => {
    if (phase !== 'playing') return;

    if (gameplaySettings.missStreakFail !== null && missStreak >= gameplaySettings.missStreakFail) {
      triggerFail('miss_streak');
      return;
    }

    if (currentTime >= gameplaySettings.failGraceSec && health <= 0) {
      triggerFail('hp_depleted');
    }
  }, [
    currentTime,
    gameplaySettings.failGraceSec,
    gameplaySettings.missStreakFail,
    health,
    missStreak,
    phase,
    triggerFail,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearFailTimeout();
      closeAudio();
    };
  }, [clearFailTimeout, closeAudio]);

  // Handle pause/resume
  const togglePause = useCallback(() => {
    if (phase === 'playing') {
      audioContextRef.current?.suspend();
      setPhase('paused');
    } else if (phase === 'paused') {
      audioContextRef.current?.resume();
      setPhase('playing');
    }
  }, [phase, setPhase]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        togglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause]);

  useEffect(() => {
    if (!beatmap?.debug?.enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setShowDebugOverlay((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [beatmap?.debug?.enabled]);

  const debugReport = beatmap?.debug;
  const currentDebugWindow = useMemo(() => {
    if (!debugReport?.enabled || debugReport.windows.length === 0) return undefined;

    const windows = debugReport.windows;
    for (let i = 0; i < windows.length; i++) {
      const windowInfo = windows[i]!;
      const isLast = i === windows.length - 1;
      if (
        (currentTime >= windowInfo.startSec && currentTime < windowInfo.endSec) ||
        (isLast && currentTime >= windowInfo.startSec)
      ) {
        return windowInfo;
      }
    }

    return windows[windows.length - 1];
  }, [debugReport, currentTime]);

  const nextRiskWindow = useMemo(() => {
    if (!debugReport?.enabled || currentDebugWindow === undefined) return undefined;
    return debugReport.worstWindows.find((windowInfo) => windowInfo.startSec > currentDebugWindow.endSec);
  }, [debugReport, currentDebugWindow]);

  const currentDropSummary = useMemo(() => {
    if (!currentDebugWindow) return 'none';

    const entries = Object.entries(currentDebugWindow.dropReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);

    if (entries.length === 0) return 'none';

    return entries
      .map(([reason, count]) => `${formatDebugReason(reason)} (${count})`)
      .join(' | ');
  }, [currentDebugWindow]);

  const debugSeverityColor = useMemo(() => {
    if (!currentDebugWindow) return '#a0b890';
    if (currentDebugWindow.score >= 5) return '#d47070';
    if (currentDebugWindow.score >= 3) return '#f0d060';
    return '#7db86a';
  }, [currentDebugWindow]);

  if (!beatmap) {
    return <div>No beatmap loaded</div>;
  }

  return (
    <div ref={containerRef} style={styles.container}>
      <Game
        beatmap={beatmap}
        currentTime={currentTime}
        isPlaying={isPlaying && phase === 'playing'}
        volume={volume}
        onSound={handleSound}
        countdown={phase === 'countdown' ? countdown : null}
        fadeStartMs={failStartMs}
      >
        <GameHUD
          onPause={togglePause}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          showVolumeSlider={showVolumeSlider}
          onToggleVolumeSlider={() => setShowVolumeSlider(!showVolumeSlider)}
        />

        {/* Live beatmap diagnostics overlay */}
        {phase === 'playing' && debugReport?.enabled && showDebugOverlay && currentDebugWindow && (
          <div style={styles.debugOverlay}>
            <div style={styles.debugHeaderRow}>
              <span style={styles.debugTitle}>Live Mapper Debug</span>
              <span style={styles.debugHotkey}>F3 to hide</span>
            </div>
            <div style={styles.debugTimeRow}>
              <span>
                Bin {currentDebugWindow.startSec.toFixed(1)}s-{currentDebugWindow.endSec.toFixed(1)}s
              </span>
              <span style={{ ...styles.debugScore, color: debugSeverityColor }}>
                score {currentDebugWindow.score.toFixed(2)}
              </span>
            </div>
            <div style={styles.debugStatGrid}>
              <span>NPS {currentDebugWindow.notesPerSecond.toFixed(2)}</span>
              <span>Max gap {currentDebugWindow.maxGapSec.toFixed(2)}s</span>
              <span>Lane H {currentDebugWindow.laneEntropy.toFixed(2)}</span>
              <span>Type H {currentDebugWindow.typeEntropy.toFixed(2)}</span>
              <span>Streak {currentDebugWindow.longestSameLaneStreak}</span>
              <span>Notes {currentDebugWindow.notes}</span>
            </div>
            <div style={styles.debugLine}>
              Drops: <span style={styles.debugDetailText}>{currentDropSummary}</span>
            </div>
            <div style={styles.debugLine}>
              Next risk:{' '}
              <span style={styles.debugDetailText}>
                {nextRiskWindow
                  ? `${nextRiskWindow.startSec.toFixed(1)}s-${nextRiskWindow.endSec.toFixed(1)}s (score ${nextRiskWindow.score.toFixed(2)})`
                  : 'none'}
              </span>
            </div>
          </div>
        )}

        {phase === 'playing' && debugReport?.enabled && !showDebugOverlay && (
          <div style={styles.debugCollapsedHint}>Live Mapper Debug hidden (F3)</div>
        )}

        {/* Pause menu */}
        {phase === 'paused' && (
          <div style={styles.pauseScrim}>
            <div className="px-panel" style={styles.pausePanel}>
              <PxText text="paused" scale={2} style={styles.pauseTitle} />

              <div style={styles.pauseVolume}>
                <PxText text="music" style={styles.pauseLabel} />
                <input
                  className="px-range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  style={styles.pauseRange}
                  aria-label="Music volume"
                />
                <PxText text={Math.round(volume * 100).toString().padStart(3, ' ')} style={styles.pauseValue} />
              </div>

              <div style={styles.pauseVolume}>
                <PxText text="fx" style={styles.pauseLabel} />
                <input
                  className="px-range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={sfxVolume}
                  onChange={(e) => setSfxVolume(parseFloat(e.target.value))}
                  style={styles.pauseRange}
                  aria-label="Sound effects volume"
                />
                <PxText text={Math.round(sfxVolume * 100).toString().padStart(3, ' ')} style={styles.pauseValue} />
              </div>

              <div style={styles.pauseMenu}>
                <button className="px-option" onClick={togglePause} autoFocus>
                  <PxText text="resume" />
                </button>
                <button
                  className="px-option"
                  onClick={() => {
                    ignoreOnEndedRef.current = true;
                    clearFailTimeout();
                    closeAudio();
                    setIsPlaying(false);
                    setCurrentTime(0);
                    setCountdown(3);
                    resetGame();
                  }}
                >
                  <PxText text="quit" />
                </button>
              </div>
            </div>
          </div>
        )}
      </Game>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    position: 'relative',
    background: 'var(--void)',
    overflow: 'hidden',
  },
  pauseScrim: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(10, 10, 16, 0.72)',
    zIndex: 100,
  },
  pausePanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'calc(var(--px) * 4)',
    padding: 'calc(var(--px) * 8) calc(var(--px) * 12)',
  },
  pauseTitle: {
    color: 'var(--text)',
  },
  pauseVolume: {
    display: 'flex',
    alignItems: 'center',
    gap: 'calc(var(--px) * 3)',
    marginTop: 'calc(var(--px) * 4)',
  },
  pauseLabel: {
    color: 'var(--text-dim)',
  },
  pauseRange: {
    width: 'calc(var(--px) * 56)',
  },
  pauseValue: {
    color: 'var(--text-dim)',
  },
  pauseMenu: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 'calc(var(--px) * 2)',
    marginTop: 'calc(var(--px) * 2)',
  },
  debugOverlay: {
    position: 'absolute',
    left: '16px',
    top: '16px',
    width: '340px',
    background: 'rgba(15, 18, 22, 0.88)',
    border: '1px solid rgba(140, 170, 200, 0.45)',
    borderRadius: '10px',
    padding: '10px 12px',
    color: '#d8e2ef',
    fontSize: '11px',
    letterSpacing: '0.2px',
    pointerEvents: 'none',
    zIndex: 25,
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
  },
  debugHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '6px',
  },
  debugTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#f7fbff',
  },
  debugHotkey: {
    fontSize: '10px',
    color: '#a5b7cd',
  },
  debugTimeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '6px',
    color: '#c5d4e6',
  },
  debugScore: {
    fontWeight: 700,
  },
  debugStatGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '4px 10px',
    marginBottom: '6px',
    color: '#e0ebf7',
  },
  debugLine: {
    marginTop: '4px',
    color: '#b8c8da',
  },
  debugDetailText: {
    color: '#f1f7ff',
  },
  debugCollapsedHint: {
    position: 'absolute',
    left: '16px',
    top: '16px',
    padding: '6px 10px',
    background: 'rgba(15, 18, 22, 0.78)',
    border: '1px solid rgba(140, 170, 200, 0.35)',
    borderRadius: '8px',
    color: '#d8e2ef',
    fontSize: '11px',
    pointerEvents: 'none',
    zIndex: 25,
  },
};

/** True when a note was due within the last second or is due within the next two. */
function isNearNote(notes: { time: number; holdEndTime?: number }[], time: number): boolean {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  const next = notes[lo];
  const prev = notes[lo - 1];
  if (next && next.time - time <= 2) return true;
  if (prev && time - (prev.holdEndTime ?? prev.time) <= 1) return true;
  return false;
}

function formatDebugReason(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
