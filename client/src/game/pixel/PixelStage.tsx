import { forwardRef, useLayoutEffect, useRef, useState } from 'react';

import { LOW_H, LOW_W, PAL } from './stage';

interface PixelStageProps {
  children?: React.ReactNode;
}

/**
 * Centers a 256x216 canvas and scales it by the largest whole number that fits,
 * so every art pixel becomes an exact square of screen pixels. Children are laid
 * over the canvas; they can size themselves in art pixels with `var(--px)`.
 */
const PixelStage = forwardRef<HTMLCanvasElement, PixelStageProps>(function PixelStage({ children }, canvasRef) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(3);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const fit = Math.min(host.clientWidth / LOW_W, host.clientHeight / LOW_H);
      // Whole device pixels per art pixel; below 1x fall back to a fractional fit.
      const devicePixels = Math.floor(fit * dpr);
      setScale(devicePixels >= 1 ? devicePixels / dpr : fit);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div ref={hostRef} style={styles.host}>
      <div
        style={{
          ...styles.frame,
          width: LOW_W * scale,
          height: LOW_H * scale,
          ['--px' as string]: `${scale}px`,
        }}
      >
        <canvas ref={canvasRef} width={LOW_W} height={LOW_H} style={styles.canvas} />
        {children}
      </div>
    </div>
  );
});

export default PixelStage;

const styles: Record<string, React.CSSProperties> = {
  host: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: PAL.void,
    overflow: 'hidden',
  },
  frame: {
    position: 'relative',
    flexShrink: 0,
  },
  canvas: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    imageRendering: 'pixelated',
    cursor: 'pointer',
  },
};
