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

    const analyze = async () => {
      try {
        setWarning(null);
        setProgress(20);

        const analysis = await analyzeInBackground(audioBuffer);
        if (analysis.usedFallback) {
          setWarning('simple mode');
        }
        setProgress(60);

        const beatmap = generateBeatmap(analysis);
        setProgress(100);

        setBeatmap(beatmap);

        setTimeout(() => {
          setScreen('playing');
        }, 500);
      } catch (error) {
        console.error('Analysis failed:', error);
        setFailed(true);
      }
    };

    analyze();
  }, [audioBuffer, setBeatmap, setScreen]);

  const filled = Math.floor((progress / 100) * SEGMENTS);

  return (
    <SceneBackdrop dim={0.55}>
      <div style={at(0, 92, styles.column)}>
        <PxText text={songTitle || 'untitled'} style={{ color: 'var(--rose)' }} />
        {failed && <PxText text="error" style={{ color: 'var(--miss)' }} />}
        {warning && <PxText text={warning} style={{ color: 'var(--warm)' }} />}

        <div style={styles.bar} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} style={{ ...styles.segment, background: i < filled ? 'var(--rose)' : 'var(--hud-line)' }} />
          ))}
        </div>
        <PxText text={`${progress.toString().padStart(3, '0')}%`} style={{ color: 'var(--text-dim)' }} />

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
