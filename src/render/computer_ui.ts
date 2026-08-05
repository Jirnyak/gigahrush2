import { type ComputerOverlaySnapshot } from '../systems/computers';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { drawGlitchText, drawNeuroPanel, drawStaticNoise } from './hud_fx';
import { fitText, wrapTextLines } from './ui_text';

export function drawComputerOverlay(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  time: number,
  computer: ComputerOverlaySnapshot,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const s = Math.max(0.8, Math.min(2, Math.min(sx, sy)));
  const pad = 8 * s;
  const panelW = Math.min(w - 12 * s, 360 * s);
  const panelH = Math.min(h - 12 * s, 214 * s);
  const x = (w - panelW) * 0.5;
  const y = (h - panelH) * 0.5;
  const maxW = panelW - pad * 2;

  ctx.save();
  ctx.fillStyle = 'rgba(0,4,6,0.84)';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 1620);
  drawStaticNoise(ctx, x, y, panelW, panelH, time, 0.022);

  ctx.textBaseline = 'top';
  drawGlitchText(ctx, computer.label, x + pad, y + 10 * s, time, 1621, '#7ee8ff', 12 * s);
  ctx.textAlign = 'right';
  ctx.font = `${7 * s}px monospace`;
  ctx.fillStyle = '#607880';
  ctx.fillText(`${computer.pageIndex + 1}/${computer.pageCount}`, x + panelW - pad, y + 14 * s);
  ctx.textAlign = 'left';

  ctx.font = `bold ${10 * s}px monospace`;
  ctx.fillStyle = '#d8f7ff';
  ctx.fillText(fitText(ctx, computer.title, maxW), x + pad, y + 38 * s);

  ctx.font = `${8 * s}px monospace`;
  ctx.fillStyle = '#9fb8bd';
  let ly = y + 58 * s;
  const lineH = 11 * s;
  const maxRows = Math.max(1, Math.floor((y + panelH - ly - 42 * s) / lineH));
  let rows = 0;
  for (const line of computer.lines) {
    for (const wrapped of wrapTextLines(ctx, line, maxW, maxRows - rows)) {
      ctx.fillText(wrapped, x + pad, ly);
      ly += lineH;
      rows++;
      if (rows >= maxRows) break;
    }
    if (rows >= maxRows) break;
  }

  ctx.fillStyle = computer.copied ? '#888' : '#6cf';
  ctx.fillText(
    fitText(ctx, computer.copied ? 'Данные уже скопированы.' : `${controlHint('gameMenu')} скопировать: ${computer.copyLabel} +${computer.rewardRubles} руб.`, maxW),
    x + pad,
    y + panelH - 34 * s,
  );
  if (computer.message) {
    ctx.fillStyle = '#d7f7ff';
    ctx.fillText(fitText(ctx, computer.message, maxW), x + pad, y + panelH - 24 * s);
  }
  ctx.fillStyle = '#547078';
  ctx.font = `${7 * s}px monospace`;
  ctx.fillText(fitText(ctx, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')} страницы  ${controlHint('gameMenu')} копия  ${menuCloseHint()} закрыть`, maxW), x + pad, y + panelH - 14 * s);
  ctx.restore();
}
