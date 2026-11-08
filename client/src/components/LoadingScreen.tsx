import { useEffect, useState } from 'react';

import { pendingUpload, clearUpload } from '../audio/songUpload';
import { recorder, cancelCassette, sampleRecorder } from '../game/anim/recorder';
import { sfx } from '../audio/sfx';
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

  const [inserting, setInserting] = useState(recorder.inserting);
  const setAudioBuffer = useGameStore((state) => state.setAudioBuffer);
  const songTitle = useGameStore((state) => state.songTitle);
  const setBeatmap = useGameStore((state) => state.setBeatmap);
  const setScreen = useGameStore((state) => state.setScreen);

  useEffect(() => {
    const request = pendingUpload;
    if (!request) { setScreen('upload'); return; }
    let cancelled = false;
    let prepared = false;
    let readyAt = Infinity;
    let clunked = false;
    const current = () => !cancelled && pendingUpload === request;
    // Sampling and preparation are independent. The gate is checked even when
    // rendering was suspended in a background tab, using the same time origin.
    const gate = window.setInterval(() => {
      if (!current()) return;
      sampleRecorder(performance.now());
      if (!recorder.inserting) {
        setInserting(false);
        if (!clunked && recorder.loaded) { clunked = true; sfx.cassetteDoor(); }
        if (prepared && performance.now() >= readyAt) {
          clearUpload(request);
          setScreen('playing');
        }
      }
    }, 30);
    setProgress(20);
    request.result.then(result => {
      if (!current()) return;
      if (result.usedFallback) setWarning('simple mode');
      setAudioBuffer(result.audioBuffer);
      setBeatmap(result.beatmap);
      setProgress(100);
      prepared = true;
      readyAt = performance.now() + 500;
    }).catch(error => {
      if (!current()) return;
      console.error('Song preparation failed:', error);
      cancelCassette();
      setInserting(false);
      setFailed(true);
    });
    return () => {
      cancelled = true;
      window.clearInterval(gate);
      // StrictMode may remount this effect immediately; abort only if the
      // accepted upload was really abandoned, rather than on effect teardown.
      queueMicrotask(() => {
        if (pendingUpload === request && useGameStore.getState().screen !== 'loading') {
          request.abort.abort(); clearUpload(request); cancelCassette();
        }
      });
    };
  }, [setAudioBuffer, setBeatmap, setScreen]);

  // Interpolate only the progress display; preparation never waits for it.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayProgress((value) => Math.min(progress, value + 5));
    }, 60);
    return () => window.clearInterval(timer);
  }, [progress]);

  const filled = Math.floor((displayProgress / 100) * SEGMENTS);

  return (
    <SceneBackdrop dim={inserting ? 0 : 0.55}>
      <div style={{ ...at(0, 92, styles.column), visibility: inserting ? 'hidden' : 'visible' }}>
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
