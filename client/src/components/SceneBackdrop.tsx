import { useEffect, useRef, useState } from 'react';

import { finishOpening } from '../game/scene/intro';
import { openingReady } from '../game/scene/backend';
import { INTRO_HOLD_MS, INTRO_MOVE_MS } from '../game/scene/camera';

import MenuControls from './MenuControls';

import PixelStage from '../game/pixel/PixelStage';
import { renderIdleScene } from '../game/pixel/renderer';
import { LOW_H, LOW_W } from '../game/pixel/stage';

interface SceneBackdropProps {
  /** 0..1 darkness laid over the yard so menus stay readable. */
  dim?: number;
  opening?: boolean;
  withPlayer?: boolean;
  glitch?: boolean;
  children?: React.ReactNode;
}

/** The courtyard at night with the stranger waiting, behind menus. */
export default function SceneBackdrop({ dim = 0.5, withPlayer = false, glitch = false, opening = false, children }: SceneBackdropProps) {
  const [showMenu, setShowMenu] = useState(!opening);
  const intro = useRef(opening);
  const menuRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const optionsRef = useRef({ dim, withPlayer, glitch });
  optionsRef.current = { dim, withPlayer, glitch };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const opacitySteps = ['0', '.25', '.5', '.75', '1'];
    let lastRevealStep = -1;
    let elapsed = 0;
    let reveal = opening ? 0 : 1;
    const idleOptions: { withPlayer: boolean; flicker: boolean; introProgress?: number } = { withPlayer: false, flicker: false };
    const finish = () => {
      if (!intro.current) return;
      intro.current = false;
      finishOpening();
      setShowMenu(true);
    };
    const skip = () => { finish(); reveal = 1; };
    window.addEventListener('pointerdown', skip, true);
    window.addEventListener('click', skip, true);
    window.addEventListener('keydown', skip, true);
    window.addEventListener('drop', skip, true);
    // A programmatic file input (and assistive technology) also finishes it.
    window.addEventListener('change', skip, true);
    let frame = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const options = optionsRef.current;
      if (intro.current && !openingReady()) {
        ctx.fillStyle = '#0c0d16'; ctx.fillRect(0, 0, LOW_W, LOW_H);
        frame = requestAnimationFrame(tick);
        return;
      }
      if (intro.current) {
        elapsed += dt * 1000;
        if (elapsed >= INTRO_HOLD_MS + INTRO_MOVE_MS) finish();
      } else reveal = Math.min(1, reveal + dt / .4);
      idleOptions.withPlayer = options.withPlayer;
      idleOptions.flicker = options.glitch;
      idleOptions.introProgress = intro.current ? Math.max(0, (elapsed - INTRO_HOLD_MS) / INTRO_MOVE_MS) : undefined;
      renderIdleScene(ctx, now, dt, idleOptions);
      const revealStep = Math.floor(reveal * 4);
      if (menuRef.current && revealStep !== lastRevealStep) {
        menuRef.current.style.opacity = opacitySteps[revealStep];
        lastRevealStep = revealStep;
      }
      if (options.dim > 0) {
        ctx.fillStyle = `rgba(10, 10, 16, ${options.dim * reveal})`;
        ctx.fillRect(0, 0, LOW_W, LOW_H);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', skip, true);
      window.removeEventListener('click', skip, true);
      window.removeEventListener('keydown', skip, true);
      window.removeEventListener('drop', skip, true);
      window.removeEventListener('change', skip, true);
    };
  }, []);

  return <PixelStage ref={canvasRef}><div ref={menuRef} data-opening={showMenu ? 'done' : 'active'} style={{ visibility: showMenu ? 'visible' : 'hidden', opacity: opening ? 0 : 1 }}><MenuControls style={{ display: 'contents' }}>{children}</MenuControls></div></PixelStage>;
}
