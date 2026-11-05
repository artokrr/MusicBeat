import { useEffect, useRef } from 'react';

import PixelStage from '../game/pixel/PixelStage';
import { renderIdleScene } from '../game/pixel/renderer';
import { LOW_H, LOW_W } from '../game/pixel/stage';

interface SceneBackdropProps {
  /** 0..1 darkness laid over the yard so menus stay readable. */
  dim?: number;
  withPlayer?: boolean;
  glitch?: boolean;
  children?: React.ReactNode;
}

/** The courtyard at night with the stranger waiting, behind menus. */
export default function SceneBackdrop({ dim = 0.5, withPlayer = false, glitch = false, children }: SceneBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const optionsRef = useRef({ dim, withPlayer, glitch });
  optionsRef.current = { dim, withPlayer, glitch };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const options = optionsRef.current;
      renderIdleScene(ctx, now, dt, { withPlayer: options.withPlayer, flicker: options.glitch });
      if (options.dim > 0) {
        ctx.fillStyle = `rgba(10, 10, 16, ${options.dim})`;
        ctx.fillRect(0, 0, LOW_W, LOW_H);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <PixelStage ref={canvasRef}>{children}</PixelStage>;
}
