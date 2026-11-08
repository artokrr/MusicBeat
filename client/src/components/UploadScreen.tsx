import { useRef, useState } from 'react';

import { prepareUpload } from '../audio/songUpload';
import { sfx } from '../audio/sfx';
import { insertCassette } from '../game/anim/recorder';
import { at, u } from '../game/pixel/layout';
import PxText from '../game/pixel/PxText';
import { LOW_W } from '../game/pixel/stage';
import { useGameStore } from '../store/gameStore';
import SceneBackdrop from './SceneBackdrop';



export default function UploadScreen() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const accepted = useRef(false);
  const [dragOver, setDragOver] = useState(false);

  const setScreen = useGameStore((state) => state.setScreen);
  const setAudioBuffer = useGameStore((state) => state.setAudioBuffer);
  const setBeatmap = useGameStore((state) => state.setBeatmap);
  const setPhase = useGameStore((state) => state.setPhase);
  const resetScore = useGameStore((state) => state.resetScore);
  const setSongTitle = useGameStore((state) => state.setSongTitle);
  const musicVolume = useGameStore((state) => state.musicVolume);
  const setMusicVolume = useGameStore((state) => state.setMusicVolume);

  const handleFile = (file: File) => {
    if (accepted.current) return;
    if (!file.type.startsWith('audio/')) {
      alert('Please upload an audio file (MP3, WAV, OGG)');
      return;
    }
    accepted.current = true;
    sfx.unlock();
    insertCassette(performance.now());
    prepareUpload(file);
    resetScore();
    setPhase('countdown');
    setBeatmap(null);
    setAudioBuffer(null);
    setSongTitle(file.name.replace(/\.[^/.]+$/, ''));
    setScreen('loading');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      style={styles.page}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <SceneBackdrop dim={dragOver ? 0.25 : 0.45}>
        <div style={at(0, 48, styles.titleBlock)}>
          <h1 style={styles.title}>
            <PxText text="ping pong" scale={2} />
          </h1>
        </div>

        <div className="px-panel px-panel-light" style={at((LOW_W - PANEL_W) / 2, 92, styles.panel)}>
          <button
            className="px-drop"
            style={{ ...styles.drop, ...(dragOver ? styles.dropActive : {}) }}
            onClick={() => fileInputRef.current?.click()}
          >
            <PxText text="drop a song" />
          </button>

          <div style={styles.row}>
            <input
              className="px-range"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={musicVolume}
              onChange={(e) => setMusicVolume(Number.parseFloat(e.target.value))}
              style={styles.range}
              aria-label="Music volume"
            />
            <PxText text={Math.round(musicVolume * 100).toString().padStart(3, ' ')} style={styles.volume} />
          </div>
        </div>

        <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileInput} style={{ display: 'none' }} />
      </SceneBackdrop>
    </div>
  );
}

const PANEL_W = 176;

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: 'absolute',
    inset: 0,
  },
  titleBlock: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
  },
  title: {
    display: 'flex',
    fontWeight: 400,
    color: 'var(--text)',
  },
  panel: {
    width: u(PANEL_W),
    padding: u(6),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: u(6),
  },
  drop: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    padding: `${u(10)} ${u(4)}`,
    border: `${u(1)} dashed var(--text-faint)`,
    color: 'var(--text)',
  },
  dropActive: {
    borderColor: 'var(--rose)',
    color: 'var(--rose)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: u(4),
  },
  range: {
    width: u(96),
  },
  volume: {
    color: 'var(--text-dim)',
  },
};
