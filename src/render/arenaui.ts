import { ArenaOverlaySnapshot } from '../systems/arena';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { drawNeuroPanel, drawStaticNoise, textJitter } from './hud_fx';
import { fitText } from './ui_text';

export function drawArenaOverlay(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  time: number,
  game: ArenaOverlaySnapshot,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const s = Math.max(0.8, Math.min(2, Math.min(sx, sy)));
  const pad = 8 * s;
  const panelW = Math.min(w - 12 * s, 320 * s);
  const panelH = Math.min(h - 12 * s, 160 * s);
  const x = (w - panelW) * 0.5;
  const y = (h - panelH) * 0.5;
  const maxW = panelW - pad * 2;
  const jitter = textJitter(time * 1.4, 1550);

  ctx.save();
  ctx.fillStyle = 'rgba(3,0,0,0.82)';
  ctx.fillRect(0, 0, w, h);

  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 1500);

  ctx.fillStyle = '#9a6';
  ctx.font = `${10 * s}px monospace`;
  ctx.fillText('МАСТЕР АРЕНЫ', x + pad + jitter.dx, y + pad + 10 * s + jitter.dy);

  drawStaticNoise(ctx, x + pad, y + pad + 16 * s, maxW, 2 * s, time, 0.4);

  const opts = [
    { label: 'Ставки на бой' },
    { label: 'Выйти на арену' },
  ];

  ctx.font = `${8.6 * sy}px monospace`;
  for (let i = 0; i < opts.length; i++) {
    const selected = i === game.selection;
    const yy = y + pad + 40 * s + i * 20 * s;
    const mj = textJitter(time, 910 + i);

    ctx.fillStyle = selected ? '#9a6' : '#665';
    ctx.fillText(`${selected ? '▶ ' : '  '}${opts[i].label}`, x + pad + mj.dx, yy + mj.dy);
  }

  drawStaticNoise(ctx, x + pad, y + panelH - pad - 12 * s, maxW, 2 * s, time, 0.2);

  ctx.fillStyle = '#565';
  ctx.font = `${6 * s}px monospace`;
  const hints = fitText(ctx, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} ВЫБОР | ${controlHint('gameMenu')} ПОДТВЕРДИТЬ | ${menuCloseHint()} ВЫХОД`, maxW);
  ctx.fillText(hints, x + pad, y + panelH - pad);

  ctx.restore();
}
