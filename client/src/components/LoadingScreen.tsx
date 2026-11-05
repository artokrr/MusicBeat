import { useEffect, useState } from 'react';

import { analyzeInBackground } from '../audio/analyzeInBackground';
import { generateBeatmap } from '../beatmap/BeatmapGenerator';
import { at, u } from '../game/pixel/layout';
import PxText from '../game/pixel/PxText';
import { useGameStore } from '../store/gameStore';
import SceneBackdrop from './SceneBackdrop';

const SEGMENTS = 20;

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const audioBuffer = useGameStore((state) => state.audioBuffer);
  const songTitle = useGameStore((state) => state.songTitle);
  const setBeatmap = useGameStore((state) => state.setBeatmap);
  const setScreen = useGameStore((state) => state.setScreen);

  useEffect(() => {
    if (!audioBuffer) {
      setScreen('upload');
      return;
    }

    // A newer upload (or leaving this screen) supersedes this run: its results
    // must not overwrite the newer song's beatmap or reopen gameplay.
    let cancelled = false;
    let startTimer: number | undefined;
    const current = () => !cancelled && useGameStore.getState().audioBuffer === audioBuffer;

    const analyze = async () => {
      try {
        setWarning(null);
        setProgress(20);

        const analysis = await analyzeInBackground(audioBuffer);
        if (!current()) return;
        if (analysis.usedFallback) {
          setWarning('simple mode');
        }
        setProgress(60);

        const beatmap = generateBeatmap(analysis);
        if (!current()) return;
        setProgress(100);

        setBeatmap(beatmap);

        startTimer = window.setTimeout(() => {
          if (current()) setScreen('playing');
        }, 500);
      } catch (error) {
        if (!current()) return;
        console.error('Analysis failed:', error);
        setFailed(true);
      }
    };

    analyze();
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [audioBuffer, setBeatmap, setScreen]);

  // Only interpolate the presentation; analysis and screen timing stay untouched.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayProgress((value) => Math.min(progress, value + 5));
    }, 60);
    return () => window.clearInterval(timer);
  }, [progress]);

  const filled = Math.floor((displayProgress / 100) * SEGMENTS);

  return (
    <SceneBackdrop dim={0.55}>
      <div style={at(0, 92, styles.column)}>
        <PxText className="px-loading-title" text={songTitle || 'untitled'} style={{ color: 'var(--rose)' }} />
        {failed && <PxText text="error" style={{ color: 'var(--miss)' }} />}
        {warning && <PxText text={warning} style={{ color: 'var(--warm)' }} />}

        <div style={styles.bar} role="progressbar" aria-valuenow={displayProgress} aria-valuemin={0} aria-valuemax={100}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} className={!failed && i === filled - 1 ? 'px-loading-tip' : undefined} style={{ ...styles.segment, background: i < filled ? 'var(--rose)' : 'var(--hud-line)' }} />
          ))}
        </div>
        <PxText text={`${displayProgress.toString().padStart(3, '0')}%`} style={{ color: 'var(--text-dim)' }} />

        {failed && (
          <button className="px-option" onClick={() => setScreen('upload')} style={{ marginTop: u(4) }}>
            <PxText text="back" />
          </button>
        )}
      </div>
    </SceneBackdrop>
  );
}

const styles: Record<string, React.CSSProperties> = {
  column: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: u(6),
  },
  bar: {
    display: 'flex',
    gap: u(1),
    marginTop: u(2),
  },
  segment: {
    width: u(4),
    height: u(5),
  },
};
