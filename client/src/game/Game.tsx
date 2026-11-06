import { useEffect, useRef, useCallback } from 'react';
import type { Beatmap, BeatNote, LaneIndex, NoteType } from '../types/beatmap';
import { useGameStore } from '../store/gameStore';
import type { HitResult } from '../types/game';
import PixelStage from './pixel/PixelStage';
import { renderFrame, spawnBurst } from './pixel/renderer';
import type { FrameWorld } from './pixel/renderer';
import { PAL } from './pixel/stage';

export type GameSoundEvent =
  | { kind: 'hit'; result: Exclude<HitResult, 'miss'>; lane: LaneIndex; noteType: NoteType }
  | { kind: 'miss'; lane: LaneIndex }
  | { kind: 'swing'; lane: LaneIndex }
  | { kind: 'holdDone'; lane: LaneIndex };

interface GameProps {
  beatmap: Beatmap;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  /** Sound cues at the exact moment things happen (see audio/sfx.ts). */
  onSound: (event: GameSoundEvent) => void;
  /** Seconds left before the song starts, or null once playing. */
  countdown?: number | null;
  /** performance.now() when a failed run started winding down; the scene darkens from then. */
  fadeStartMs?: number | null;
  /** HTML laid over the canvas (pause button hit areas, menus). */
  children?: React.ReactNode;
}

// Game constants. Gameplay runs in this 800x600 world space; the pixel
// renderer maps it onto a 256x192 scene.
const CANVAS_HEIGHT = 600;

// Table dimensions
const TABLE_HEIGHT = 380;
const TABLE_Y = (CANVAS_HEIGHT - TABLE_HEIGHT) / 2 + 40; // Shift down for HUD visibility

// Positions
const PLAYER_Y = TABLE_Y + TABLE_HEIGHT + 35;
const NPC_Y = TABLE_Y - 55;
const CENTER_X = 800 / 2;
const LANE_OFFSET = 80; // Distance between lanes
const LANES = [CENTER_X - LANE_OFFSET, CENTER_X, CENTER_X + LANE_OFFSET];

// Hit zone (invisible, just for logic)
const PLAYER_HIT_Y = TABLE_Y + TABLE_HEIGHT - 50;
const NPC_HIT_Y = TABLE_Y + 50;

// Ball
const PHANTOM_BALL_LIFETIME_SEC = 1.1;
const PHANTOM_BALL_FADE_START_SEC = 0.35;

const WORLD: FrameWorld = {
  npcHitY: NPC_HIT_Y,
  playerHitY: PLAYER_HIT_Y,
  playerY: PLAYER_Y,
  npcY: NPC_Y,
  centerX: CENTER_X,
  lanes: LANES,
};

// Burst colors used by the hit logic below.
const COLORS = {
  ballHold: PAL.hold,
  ballSwitch: PAL.switch,
  perfect: PAL.perfect,
};

// Last time the player returned a ball; drives the swing frame.
let lastSwingMs = -Infinity;

function pseudoRandom01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

function quadraticBezier(p0: number, p1: number, p2: number, t: number): number {
  const inv = 1 - t;
  return inv * inv * p0 + 2 * inv * t * p1 + t * t * p2;
}

function spawnExplosion(x: number, y: number, color: string, count: number = 10) {
  lastSwingMs = performance.now();
  spawnBurst(x, y, color, count);
}

interface ActiveNote extends BeatNote {
  x: number;
  y: number;
  hit: boolean;
  hitResult?: HitResult;
  returnPhase: boolean;
  returnProgress: number;
  spawnTime: number;

  // Initial trajectory
  startX: number;
  targetX: number;
  switchControlX?: number;

  velocityX: number;
  velocityY: number;

  // Return trajectory
  returnStartX?: number;
  returnStartY?: number;
  /** Song time of the press that returned this ball. */
  hitTime?: number;

  // For missed ball physics
  missTime?: number;
  missX?: number;
  missY?: number;

  // Hold note state
  holdStartTime?: number; // When player started holding
  holdStartResult?: Exclude<HitResult, 'miss'>;
  holdProgress?: number; // 0-1 progress through hold
  nextHoldTickTime?: number;
  holdTickEverySec?: number;
}

export default function Game({ beatmap, currentTime, isPlaying, volume, onSound, countdown = null, fadeStartMs = null, children }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeNotesRef = useRef<Map<string, ActiveNote>>(new Map());
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastServeTimeRef = useRef<number>(0);
  const isHoldingRef = useRef<boolean>(false);
  const holdingLaneRef = useRef<LaneIndex | null>(null);
  const activeHoldNoteRef = useRef<string | null>(null);

  // Player state for manual movement
  const playerLaneRef = useRef<LaneIndex>(1); // 0=Left, 1=Center, 2=Right

  // Screen shake state
  const shakeRef = useRef<{ x: number; y: number; intensity: number }>({ x: 0, y: 0, intensity: 0 });

  // Render-only state
  const lastFrameMsRef = useRef<number>(0);
  const playerVisualXRef = useRef<number | null>(null);
  const pressRef = useRef<{ lane: LaneIndex; ms: number } | null>(null);
  // The render loop keeps running between React renders (e.g. during the
  // countdown), so it reads these through a ref instead of a stale closure.
  const overlayRef = useRef({ countdown, fadeStartMs, volume });
  overlayRef.current = { countdown, fadeStartMs, volume };

  const recordHit = useGameStore((state) => state.recordHit);
  const addPoints = useGameStore((state) => state.addPoints);
  const addHitFeedback = useGameStore((state) => state.addHitFeedback);
  const getGameplaySettings = useGameStore((state) => state.getGameplaySettings);

  // Handle player input (press down)
  const handleInputDown = useCallback((laneIndex: LaneIndex) => {
    if (!isPlaying) return;

    // Get dynamic timing windows from difficulty settings
    const settings = getGameplaySettings();
    const timingWindows = settings.timingWindows;

    // Update player position visually immediately
    playerLaneRef.current = laneIndex;
    pressRef.current = { lane: laneIndex, ms: performance.now() };

    isHoldingRef.current = true;
    holdingLaneRef.current = laneIndex;
    const activeNotes = activeNotesRef.current;
    let closestNote: ActiveNote | undefined;
    let closestDelta = Infinity;

    activeNotes.forEach((note) => {
      // Must match lane!
      if (note.hit || note.returnPhase || note.laneIndex !== laneIndex) return;
      // Skip hold notes that are already being held
      if (note.type === 'hold' && note.holdStartTime) return;

      const delta = Math.abs((note.time - currentTime) * 1000);
      const missWindow = (note.type === 'switch' ? 0.75 : 1.0) * timingWindows.miss;

      if (delta < closestDelta && delta < missWindow) {
        closestDelta = delta;
        closestNote = note;
      }
    });

    if (closestNote !== undefined) {
      const note = closestNote;
      const mult = note.type === 'switch' ? 0.75 : 1.0;
      const perfectWindow = timingWindows.perfect * mult;
      const goodWindow = timingWindows.good * mult;
      const okWindow = timingWindows.ok * mult;

      let result: HitResult;
      if (closestDelta <= perfectWindow) {
        result = 'perfect';
      } else if (closestDelta <= goodWindow) {
        result = 'good';
      } else if (closestDelta <= okWindow) {
        result = 'ok';
      } else {
        result = 'miss';
      }

      // Hold notes: start holding instead of instant hit
      if (note.type === 'hold' && result !== 'miss') {
        const holdStartResult = result;
        const beatInterval = 60 / beatmap.timing.bpm;
        const tickEveryBeats = note.holdTickEveryBeats ?? 0.5;
        const tickEverySec = tickEveryBeats * beatInterval;

        note.holdStartTime = currentTime;
        note.holdStartResult = holdStartResult;
        note.holdProgress = 0;
        note.holdTickEverySec = tickEverySec;
        note.nextHoldTickTime = currentTime + tickEverySec;

        activeHoldNoteRef.current = note.id;

        recordHit(result);
        onSound({ kind: 'hit', result: holdStartResult, lane: note.laneIndex, noteType: 'hold' });

        // Don't mark as hit yet - will complete when hold finishes
        addHitFeedback({
          id: note.id + '-start',
          result: holdStartResult,
          x: note.x,
          y: PLAYER_HIT_Y,
          timestamp: Date.now(),
        });
        return;
      }

      // Normal/Strong notes: instant hit
      note.hit = true;
      note.hitResult = result;
      note.hitTime = currentTime;

      if (result !== 'miss') {
        note.returnPhase = true;
        note.returnProgress = 0;
        // Start return from EXACTLY where it was hit (no snapping)
        note.returnStartX = note.x;
        note.returnStartY = note.y;
        onSound({ kind: 'hit', result, lane: note.laneIndex, noteType: note.type });

        // JUICE: Add shake and explosion on hit
        const isSwitch = note.type === 'switch';
        const intensity = result === 'perfect' ? (isSwitch ? 14 : 10) : (isSwitch ? 8 : 5);
        shakeRef.current.intensity = intensity;

        const explosionColor = isSwitch ? COLORS.ballSwitch : COLORS.perfect;
        const explosionCount = result === 'perfect' ? (isSwitch ? 28 : 20) : (isSwitch ? 16 : 10);

        spawnExplosion(note.x, note.y, explosionColor, explosionCount);
      }

      if (note.type === 'switch' && result !== 'miss') {
        recordHit(result, { pointsMultiplier: 1.15 });
      } else {
        recordHit(result);
      }
      if (result === 'miss') onSound({ kind: 'miss', lane: note.laneIndex });
      addHitFeedback({
        id: note.id,
        result,
        x: note.x,
        y: PLAYER_HIT_Y,
        timestamp: Date.now(),
      });
    } else {
      onSound({ kind: 'swing', lane: laneIndex });
    }
  }, [isPlaying, currentTime, recordHit, addHitFeedback, onSound]);

  // Handle player input release (for hold notes)
  const handleInputUp = useCallback((laneIndex: LaneIndex) => {
    isHoldingRef.current = false;
    if (holdingLaneRef.current === laneIndex) {
      holdingLaneRef.current = null;
    }

    // Check if we were holding a note
    if (activeHoldNoteRef.current) {
      const note = activeNotesRef.current.get(activeHoldNoteRef.current);
      
      // Only release if the key matches the note's lane!
      if (note && note.laneIndex === laneIndex) {
        if (note.type === 'hold' && note.holdStartTime && !note.hit) {
          const holdEndTime = note.holdEndTime ?? note.time + 1;

          // Small grace to avoid penalizing release on the final frame.
          if (currentTime < holdEndTime - 0.02) {
            note.hit = true;
            note.hitResult = 'miss';
            note.missTime = currentTime;
            note.missX = note.x;
            note.missY = note.y;
            note.velocityX = 0;
            note.velocityY = 250;

            activeHoldNoteRef.current = null;

            recordHit('miss');

            onSound({ kind: 'miss', lane: note.laneIndex });
            addHitFeedback({
              id: note.id,
              result: 'miss',
              x: note.x,
              y: PLAYER_HIT_Y,
              timestamp: Date.now(),
            });
          }
          return;
        }

        activeHoldNoteRef.current = null;
      }
    }
  }, [currentTime, recordHit, addHitFeedback, onSound]);

  // Input handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // Ignore key repeat
      
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        handleInputDown(0);
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        handleInputDown(1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        handleInputDown(2);
      } else if (e.code === 'Space') {
        e.preventDefault();
        // Space hits Center by default? Or assume "last position"?
        // Let's make Space hit Center (1) as a fallback
        handleInputDown(1); 
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        handleInputUp(0);
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        handleInputUp(1);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        handleInputUp(2);
      } else if (e.code === 'Space') {
        handleInputUp(1);
      }
    };

    // Pointer lanes are thirds of the game canvas, not of the window: the
    // canvas is letterboxed (whole-pixel scaling), so in a wide window it can
    // sit entirely inside the window's middle third. Presses on the letterbox
    // around the canvas count too, mapped to the nearest lane.
    const isPlayArea = (target: EventTarget | null) => {
      const canvas = canvasRef.current;
      if (!canvas || !(target instanceof HTMLElement)) return false;
      return target === canvas || target === canvas.parentElement || target === canvas.parentElement?.parentElement;
    };
    const laneAt = (clientX: number): LaneIndex => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 1;
      const t = (clientX - rect.left) / rect.width;
      return t < 1 / 3 ? 0 : t > 2 / 3 ? 2 : 1;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isPlayArea(e.target)) handleInputDown(laneAt(e.clientX));
    };

    const handleMouseUp = (e: MouseEvent) => {
      handleInputUp(laneAt(e.clientX));
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isPlayArea(e.target)) {
        e.preventDefault();
        handleInputDown(laneAt(e.touches[0].clientX));
      }
    };

    const handleTouchEnd = () => {
       // Touch end doesn't have coordinates easily, so we might just release all?
       // Simplification: just release center or check changedTouches.
       // For now, let's just trigger release on center as a failsafe or ignore touch specific lane release complexity
       handleInputUp(1);
       handleInputUp(0);
       handleInputUp(2);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleInputDown, handleInputUp]);

  // Game render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;

      const activeNotes = activeNotesRef.current;
      
      // Get dynamic approach time from difficulty settings
      const settings = getGameplaySettings();
      const approachTime = settings.approachTime;

      // Add upcoming notes
      beatmap.notes.forEach((note) => {
        const timeUntil = note.time - currentTime;

        if (timeUntil > 0 && timeUntil <= approachTime && !activeNotes.has(note.id)) {
          const laneIndex = note.laneIndex;

          const randomStart = pseudoRandom01(note.time * 91.7);

          const startX = note.type === 'switch' && note.switchFromLaneIndex !== undefined
            ? LANES[note.switchFromLaneIndex]
            : CENTER_X + (randomStart - 0.5) * 60;

          const targetX = LANES[laneIndex];

          const switchControlX = note.type === 'switch'
            ? CENTER_X + (pseudoRandom01(note.time * 77.7) - 0.5) * 160
            : undefined;

          activeNotes.set(note.id, {
            ...note,
            x: startX,
            y: NPC_HIT_Y,
            hit: false,
            returnPhase: false,
            returnProgress: 0,
            spawnTime: currentTime,
            startX,
            targetX,
            switchControlX,
            velocityX: 0,
            velocityY: 0,
          });

          // Track serve time for NPC animation
          lastServeTimeRef.current = currentTime;
        }
      });

      // Update note positions
      activeNotes.forEach((note, id) => {
        const timeUntil = note.time - currentTime;

        // Handle hold notes being held
        if (note.type === 'hold' && note.holdStartTime && !note.hit) {
          const holdEndTime = note.holdEndTime ?? note.time + 1;
          const holdDuration = Math.max(0.001, holdEndTime - note.holdStartTime);
          const holdElapsed = Math.max(0, currentTime - note.holdStartTime);

          note.holdProgress = Math.min(1, holdElapsed / holdDuration);

          // Keep ball at hit position while holding
          note.x = note.targetX;
          note.y = PLAYER_HIT_Y;

          const beatInterval = 60 / beatmap.timing.bpm;
          const tickEveryBeats = note.holdTickEveryBeats ?? 0.5;
          const tickEverySec = note.holdTickEverySec ?? tickEveryBeats * beatInterval;

          if (note.holdTickEverySec === undefined) {
            note.holdTickEverySec = tickEverySec;
          }

          if (note.nextHoldTickTime === undefined) {
            note.nextHoldTickTime = note.holdStartTime + tickEverySec;
          }

          // Award slider ticks while holding.
          while (
            note.nextHoldTickTime !== undefined &&
            note.nextHoldTickTime <= holdEndTime + 1e-6 &&
            currentTime >= note.nextHoldTickTime
          ) {
            const isHoldingLane = holdingLaneRef.current === note.laneIndex;
            const isHoldingThisNote = activeHoldNoteRef.current === note.id;

            if (isHoldingLane && isHoldingThisNote) {
              addPoints(10);
              note.nextHoldTickTime += tickEverySec;
            } else {
              // Miss a tick => immediate miss (combo breaks)
              note.hit = true;
              note.hitResult = 'miss';
              note.missTime = currentTime;
              note.missX = note.x;
              note.missY = note.y;
              note.velocityX = 0;
              note.velocityY = 250;

              activeHoldNoteRef.current = null;

              recordHit('miss');

              onSound({ kind: 'miss', lane: note.laneIndex });
              addHitFeedback({
                id: note.id,
                result: 'miss',
                x: note.x,
                y: PLAYER_HIT_Y,
                timestamp: Date.now(),
              });
              break;
            }
          }

          // Check if hold is complete
          if (!note.hit && currentTime >= holdEndTime) {
            note.hit = true;
            note.hitResult = note.holdStartResult ?? 'ok';
            note.returnPhase = true;
            note.returnProgress = 0;
            note.returnStartX = note.x;
            note.returnStartY = note.y;

            activeHoldNoteRef.current = null;

            // Completion juice (no extra scoring)
            spawnExplosion(note.x, note.y, COLORS.ballHold, 12);
            onSound({ kind: 'holdDone', lane: note.laneIndex });
          }
        } else if (!note.returnPhase && !note.hit) {
          // Ball traveling from NPC to player - realistic trajectory
          // Allow progress > 1 so it flies past the player if not hit
          const progress = Math.max(0, 1 - (timeUntil / approachTime));

          // X trajectory
          if (note.type === 'switch' && note.switchControlX !== undefined) {
            note.x = quadraticBezier(note.startX, note.switchControlX, note.targetX, progress);
          } else {
            note.x = note.startX + (note.targetX - note.startX) * progress;
          }

          // Parabolic arc for Y
          const arcHeight = 30; // How high the arc goes
          const yBase = NPC_HIT_Y + (PLAYER_HIT_Y - NPC_HIT_Y) * progress;
          const arcOffset = Math.sin(progress * Math.PI) * arcHeight;
          
          // If progress > 1 (missed), decay the arc so it falls naturally
          const finalY = progress > 1 
            ? yBase // Straight line past player
            : yBase - arcOffset;
            
          note.y = finalY;

          // Handle missed notes - mark as missed but DON'T delete
          // Trigger miss slightly later so it flies past paddle first
          if (timeUntil < -0.15 && note.type !== 'hold') {
            note.hit = true;
            note.hitResult = 'miss';
            // Store miss state for physics
            note.missTime = currentTime;
            note.missX = note.x;
            note.missY = note.y;
            
            // Calculate velocity to match current movement
            // X velocity is constant
            note.velocityX = (note.targetX - note.startX) / approachTime;
            // Y velocity: It's moving down towards player, plus gravity will take over
            note.velocityY = (PLAYER_HIT_Y - NPC_HIT_Y) / approachTime;
            
            recordHit('miss');
            
            onSound({ kind: 'miss', lane: note.laneIndex });
            addHitFeedback({
              id: note.id,
              result: 'miss',
              x: note.x,
              y: PLAYER_HIT_Y,
              timestamp: Date.now(),
            });
          }
          // Hold notes miss if not started in time
          else if (timeUntil < -0.2 && note.type === 'hold' && !note.holdStartTime) {
            note.hit = true;
            note.hitResult = 'miss';
            note.missTime = currentTime;
            note.missX = note.x;
            note.missY = note.y;
            note.velocityX = 0;
            note.velocityY = 250;
            recordHit('miss');
            onSound({ kind: 'miss', lane: note.laneIndex });
            addHitFeedback({
              id: note.id,
              result: 'miss',
              x: note.x,
              y: PLAYER_HIT_Y,
              timestamp: Date.now(),
            });
          }
        } else if (note.hit && note.hitResult === 'miss' && !note.returnPhase && note.missTime !== undefined) {
          // Missed ball continues flying past player using physics
          const timeSinceMiss = currentTime - note.missTime;
          const gravity = 800; // pixels/sec^2

          // Kinematic equations: x = x0 + v*t, y = y0 + v*t + 0.5*g*t^2
          note.x = note.missX! + note.velocityX * timeSinceMiss;
          note.y = note.missY! + note.velocityY * timeSinceMiss + 0.5 * gravity * timeSinceMiss * timeSinceMiss;

          // Keep phantom notes briefly for feedback, then cull.
          if (timeSinceMiss >= PHANTOM_BALL_LIFETIME_SEC || note.y > CANVAS_HEIGHT + 100) {
            activeNotes.delete(id);
            return;
          }
        } else if (note.returnPhase) {
          note.returnProgress += deltaTime * 2.5;

          if (note.returnProgress >= 1) {
            activeNotes.delete(id);
            return;
          }

          // Return arc - ball hit back to NPC
          // Start from WHERE IT WAS HIT, not the player center
          const returnProgress = note.returnProgress;
          const startX = note.returnStartX ?? note.targetX;
          const startY = note.returnStartY ?? PLAYER_HIT_Y;
          const endY = NPC_HIT_Y;

          // Linear Y with arc
          const yBase = startY + (endY - startY) * returnProgress;
          const returnArc = Math.sin(returnProgress * Math.PI) * 40;
          note.y = yBase - returnArc;

          // X goes back towards center (NPC always centered)
          const returnTargetX = CENTER_X;
          note.x = startX + (returnTargetX - startX) * returnProgress;
        }
      });

      // Screen shake (world units; the renderer snaps it to whole pixels)
      let shakeX = 0;
      let shakeY = 0;
      if (shakeRef.current.intensity > 0) {
        shakeX = (Math.random() - 0.5) * shakeRef.current.intensity;
        shakeY = (Math.random() - 0.5) * shakeRef.current.intensity;
        shakeRef.current.intensity *= 0.9; // Decay
        if (shakeRef.current.intensity < 0.5) shakeRef.current.intensity = 0;
      }

      const nowMs = performance.now();
      const dt = Math.min(0.1, Math.max(0, (nowMs - (lastFrameMsRef.current || nowMs)) / 1000));
      lastFrameMsRef.current = nowMs;

      // The player slides to the chosen lane over a few frames instead of teleporting.
      const playerTargetX = LANES[playerLaneRef.current];
      const previousPlayerX = playerVisualXRef.current ?? playerTargetX;
      playerVisualXRef.current = previousPlayerX + (playerTargetX - previousPlayerX) * Math.min(1, dt * 30);

      const store = useGameStore.getState();
      const overlay = overlayRef.current;
      const press = pressRef.current;

      renderFrame(ctx, {
        nowMs,
        dt,
        songTime: currentTime,
        beat: isPlaying ? (currentTime * beatmap.timing.bpm) / 60 : nowMs / 900,
        approachTime,
        notes: Array.from(activeNotes.values()),
        world: WORLD,
        playerX: playerVisualXRef.current,
        serving: lastServeTimeRef.current > 0 && currentTime - lastServeTimeRef.current < 0.12,
        swinging: nowMs - lastSwingMs < 130,
        pressedLane: press ? press.lane : null,
        pressAgeMs: press ? nowMs - press.ms : Infinity,
        shakeX,
        shakeY,
        feedbacks: store.hitFeedbacks,
        phantomAlpha: getPhantomBallAlpha,
        hud: {
          score: store.score.score,
          combo: store.score.combo,
          health: store.health,
          missStreak: store.missStreak,
          missStreakFail: settings.missStreakFail,
          songTitle: store.songTitle,
          time: currentTime,
          duration: beatmap.metadata.duration,
          volume: overlay.volume,
          nowMs,
        },
        countdown: overlay.countdown,
        fade: overlay.fadeStartMs === null ? 0 : Math.min(1, (nowMs - overlay.fadeStartMs) / 1100),
      });
      store.clearOldFeedbacks();

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [currentTime, beatmap, isPlaying, recordHit, addHitFeedback, onSound]);

  return <PixelStage ref={canvasRef}>{children}</PixelStage>;
}

function getPhantomBallAlpha(timeSinceMiss: number): number {
  if (timeSinceMiss <= PHANTOM_BALL_FADE_START_SEC) return 0.55;

  const fadeDuration = PHANTOM_BALL_LIFETIME_SEC - PHANTOM_BALL_FADE_START_SEC;
  if (fadeDuration <= 0) return 0.55;

  const fadeProgress = Math.min(1, (timeSinceMiss - PHANTOM_BALL_FADE_START_SEC) / fadeDuration);
  return 0.55 * (1 - fadeProgress);
}
