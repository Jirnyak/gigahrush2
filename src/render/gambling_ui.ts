import { type GamblingOverlaySnapshot } from '../systems/gambling';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { drawGlitchText, drawNeuroPanel, drawStaticNoise, textJitter } from './hud_fx';
import { fitText } from './ui_text';

function rub(value: number): string {
  return `${Math.max(0, Math.floor(value))} руб.`;
}

export function drawGamblingOverlay(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  time: number,
  game: GamblingOverlaySnapshot,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const s = Math.max(0.8, Math.min(2, Math.min(sx, sy)));
  const pad = 8 * s;
  const panelW = Math.min(w - 12 * s, 320 * s);
  const panelH = Math.min(h - 12 * s, 176 * s);
  const x = (w - panelW) * 0.5;
  const y = (h - panelH) * 0.5;
  const maxW = panelW - pad * 2;
  const jitter = textJitter(time * 1.4, 1550);

  ctx.save();
  ctx.fillStyle = 'rgba(3,0,0,0.82)';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 1551);
  drawStaticNoise(ctx, x, y, panelW, panelH, time, 0.025);

  ctx.textBaseline = 'top';
  drawGlitchText(ctx, game.label, x + pad, y + 10 * s, time, 1552, '#ffd36a', 12 * s);
  ctx.font = `${8 * s}px monospace`;
  ctx.fillStyle = '#a98';
  ctx.fillText(fitText(ctx, `Наличные: ${rub(game.cashRubles)}`, maxW), x + pad, y + 36 * s);
  ctx.fillText(fitText(ctx, `Предел: ${rub(game.minBet)}-${rub(game.maxBet)}  маржа ${(game.houseEdge * 100).toFixed(1)}%`, maxW), x + pad, y + 50 * s);

  ctx.font = `bold ${14 * s}px monospace`;
  ctx.fillStyle = game.canSubmit ? '#ffd36a' : '#ff7860';
  ctx.fillText(fitText(ctx, `Ставка: ${rub(game.betRubles)}`, maxW), x + pad + jitter.dx, y + 78 * s + jitter.dy);

  ctx.font = `${8 * s}px monospace`;
  ctx.fillStyle = game.canSubmit ? '#8f8' : '#f86';
  const stakeLine = game.itemStakeName
    ? `${game.itemStakeName}: ставка ${rub(game.itemStakeRubles)}.`
    : game.canSubmit
      ? 'Автомат принимает ставку.'
      : 'Наличных не хватает.';
  ctx.fillText(fitText(ctx, stakeLine, maxW), x + pad, y + 102 * s);
  if (game.message) {
    ctx.fillStyle = '#d7f7ff';
    ctx.fillText(fitText(ctx, game.message, maxW), x + pad, y + 119 * s);
  }

  ctx.fillStyle = '#6d6670';
  ctx.font = `${7 * s}px monospace`;
  ctx.fillText(fitText(ctx, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} ставка  ${controlHint('gameMenu')} играть  ${menuCloseHint()} выйти`, maxW), x + pad, y + panelH - 16 * s);
  ctx.restore();
}
