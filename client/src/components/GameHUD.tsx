import PxText from '../game/pixel/PxText';
import { HUD_PAUSE_RECT, HUD_VOLUME_RECT, LOW_H, LOW_W } from '../game/pixel/stage';

// The HUD itself is drawn into the game canvas (see game/pixel/hud.ts). This
// component only places clickable areas over the pause and volume icons, and
// the volume popover.

interface GameHUDProps {
  onPause: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  showVolumeSlider: boolean;
  onToggleVolumeSlider: () => void;
}

function areaStyle(rect: { x: number; y: number; w: number; h: number }): React.CSSProperties {
  return {
    position: 'absolute',
    left: `${(rect.x / LOW_W) * 100}%`,
    top: `${(rect.y / LOW_H) * 100}%`,
    width: `${(rect.w / LOW_W) * 100}%`,
    height: `${(rect.h / LOW_H) * 100}%`,
  };
}

export default function GameHUD({ onPause, volume, onVolumeChange, showVolumeSlider, onToggleVolumeSlider }: GameHUDProps) {
  return (
    <>
      <button
        style={{ ...areaStyle(HUD_PAUSE_RECT), ...styles.hitArea }}
        onClick={onPause}
        title="Pause (Esc)"
        aria-label="Pause"
      />
      <button
        style={{ ...areaStyle(HUD_VOLUME_RECT), ...styles.hitArea }}
        onClick={onToggleVolumeSlider}
        title="Volume"
        aria-label="Volume"
        aria-expanded={showVolumeSlider}
      />

      {showVolumeSlider && (
        <div className="px-panel" style={styles.popover}>
          <input
            className="px-range"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            style={styles.range}
            aria-label="Music volume"
          />
          <PxText text={Math.round(volume * 100).toString().padStart(3, ' ')} style={styles.value} />
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  hitArea: {
    padding: 0,
    background: 'transparent',
    zIndex: 20,
  },
  popover: {
    position: 'absolute',
    right: 'calc(var(--px) * 2)',
    bottom: 'calc(var(--px) * 14)',
    display: 'flex',
    alignItems: 'center',
    gap: 'calc(var(--px) * 3)',
    padding: 'calc(var(--px) * 3) calc(var(--px) * 4)',
    zIndex: 30,
  },
  range: {
    width: 'calc(var(--px) * 48)',
  },
  value: {
    color: 'var(--text-dim)',
  },
};
