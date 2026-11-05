// Minimal HUD floating over the frame: score top-left, combo top-right, a thin
// health bar top-centre, a hairline of song progress along the bottom, and the
// pause/volume icons in the bottom-right corner.

import { drawText } from './font';
import { HUD_PAUSE_RECT, HUD_VOLUME_RECT, LOW_H, LOW_W, PAL } from './stage';

export interface HudState {
  score: number;
  combo: number;
  health: number; // 0..1
  missStreak: number;
  missStreakFail: number | null;
  songTitle: string;
  time: number;
  duration: number;
  volume: number;
  nowMs: number;
}

const MARGIN = 9;
const HP_WIDTH = 72;

export function drawHud(ctx: CanvasRenderingContext2D, hud: HudState) {
  // Score and combo, with a one-pixel shadow so they read over snow.
  drawText(ctx, Math.floor(hud.score).toString().padStart(7, '0'), MARGIN, 5, PAL.text, { shadow: PAL.void });
  if (hud.combo >= 2) {
    drawText(ctx, `×${hud.combo}`, LOW_W - MARGIN, 5, hud.combo >= 10 ? PAL.rose : PAL.text, { align: 'right', shadow: PAL.void });
  }

  // Health: a thin bar, blinking when low.
  const hpX = Math.round((LOW_W - HP_WIDTH) / 2);
  const hpY = 12;
  const health = Math.max(0, Math.min(1, hud.health));
  const low = health <= 0.3;
  const blinkOff = low && Math.floor(hud.nowMs / 250) % 2 === 1;
  ctx.fillStyle = 'rgba(10, 10, 16, 0.55)';
  ctx.fillRect(hpX - 1, hpY - 1, HP_WIDTH + 2, 4);
  ctx.fillStyle = PAL.hudLine;
  ctx.fillRect(hpX, hpY, HP_WIDTH, 2);
  ctx.fillStyle = low ? (blinkOff ? PAL.roseDeep : PAL.miss) : PAL.text;
  ctx.fillRect(hpX, hpY, Math.round(HP_WIDTH * health), 2);

  if (hud.missStreakFail !== null) {
    const pipsX = Math.round(LOW_W / 2 - (hud.missStreakFail * 4 - 1) / 2);
    for (let i = 0; i < hud.missStreakFail; i++) {
      ctx.fillStyle = i < hud.missStreak ? PAL.miss : PAL.hudLine;
      ctx.fillRect(pipsX + i * 4, hpY + 5, 3, 2);
    }
  }

  // Song progress along the bottom edge.
  const barY = LOW_H - 4;
  const barX0 = MARGIN;
  const barX1 = HUD_PAUSE_RECT.x - 6;
  const progress = hud.duration > 0 ? Math.max(0, Math.min(1, hud.time / hud.duration)) : 0;
  ctx.fillStyle = 'rgba(10, 10, 16, 0.5)';
  ctx.fillRect(barX0, barY - 1, barX1 - barX0, 3);
  ctx.fillStyle = PAL.hudLine;
  ctx.fillRect(barX0, barY, barX1 - barX0, 1);
  const knobX = Math.round(barX0 + (barX1 - barX0) * progress);
  ctx.fillStyle = PAL.textDim;
  ctx.fillRect(barX0, barY, knobX - barX0, 1);
  ctx.fillStyle = PAL.text;
  ctx.fillRect(knobX - 1, barY - 1, 2, 3);

  // Pause: two bars. Volume: a speaker and up to three bars.
  const iconY = HUD_PAUSE_RECT.y + 3;
  ctx.fillStyle = PAL.textDim;
  ctx.fillRect(HUD_PAUSE_RECT.x + 3, iconY, 2, 6);
  ctx.fillRect(HUD_PAUSE_RECT.x + 7, iconY, 2, 6);
  const vx = HUD_VOLUME_RECT.x + 2;
  ctx.fillRect(vx, iconY + 2, 2, 2);
  ctx.fillRect(vx + 2, iconY + 1, 1, 4);
  ctx.fillRect(vx + 3, iconY, 1, 6);
  const bars = hud.volume <= 0 ? 0 : Math.ceil(hud.volume * 3);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < bars ? PAL.textDim : PAL.hudLine;
    const h = 2 + i * 2;
    ctx.fillRect(vx + 6 + i * 2, iconY + 6 - h, 1, h);
  }
  if (bars === 0) {
    ctx.fillStyle = PAL.miss;
    for (let i = 0; i < 4; i++) ctx.fillRect(vx + 6 + i, iconY + 1 + i, 1, 1);
  }
}
