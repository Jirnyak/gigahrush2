import { menuCloseHint } from '../systems/controls';
import { drawGlitchText, drawNeuroPanel, drawStaticNoise, textJitter } from './hud_fx';
import { fitText, wrapTextLines } from './ui_text';

export type NetTerminalGenDeniedStatus = 'missing' | 'denied' | 'offline' | 'searching' | 'locked' | string;

export interface NetTerminalGenDeniedSnapshot {
  title?: string;
  status?: NetTerminalGenDeniedStatus;
  lines?: readonly string[];
  footer?: string;
  code?: string;
}

export type NetTerminalGenDeniedInput = readonly string[] | NetTerminalGenDeniedSnapshot | undefined;

function normalizeDeniedInput(input: NetTerminalGenDeniedInput): NetTerminalGenDeniedSnapshot {
  if (Array.isArray(input)) return { lines: input as readonly string[] };
  return (input as NetTerminalGenDeniedSnapshot | undefined) ?? {};
}

function deniedStatusText(status: NetTerminalGenDeniedStatus | undefined): string {
  if (!status || status === 'missing' || status === 'denied') return 'НЕТ-ТЕРМИНАЛ ГЕН НЕ НАЙДЕН';
  if (status === 'offline') return 'ТЕРМИНАЛ ОФЛАЙН';
  if (status === 'searching') return 'ПОИСК НЕТ-ТЕРМИНАЛА ГЕН';
  if (status === 'locked') return 'ГЕН ЗАПЕРТ';
  return String(status).toUpperCase();
}

export function drawNetTerminalGenDenied(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  time: number,
  linesOrStatus?: NetTerminalGenDeniedInput,
): void {
  const denied = normalizeDeniedInput(linesOrStatus);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const s = Math.max(0.8, Math.min(2, Math.min(sx, sy)));
  const pad = 8 * s;
  const panelW = Math.min(w - 12 * s, 320 * s);
  const panelH = Math.min(h - 12 * s, 180 * s);
  const x = (w - panelW) * 0.5;
  const y = (h - panelH) * 0.5;
  const maxTextW = panelW - pad * 2;
  const status = deniedStatusText(denied.status);
  const lines = denied.lines && denied.lines.length > 0
    ? denied.lines
    : [
      'Нужен НЕТ-ГЕН: странный кусок плоти.',
      'Без него доступен только банк.',
    ];

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,4,0.82)';
  ctx.fillRect(0, 0, w, h);
  drawNeuroPanel(ctx, x, y, panelW, panelH, time, 1180);
  drawStaticNoise(ctx, x, y, panelW, panelH, time, 0.036);

  ctx.textBaseline = 'top';
  drawGlitchText(ctx, denied.title ?? 'НЕТ-ТЕРМИНАЛ ГЕН', x + pad, y + 10 * s, time, 1181, '#63f6ff', 11 * s);

  const warnY = y + 40 * s;
  const jitter = textJitter(time * 1.7, 1182);
  ctx.save();
  ctx.shadowColor = 'rgba(255,60,80,0.55)';
  ctx.shadowBlur = 12 * s;
  ctx.fillStyle = '#ff5868';
  ctx.font = `bold ${13 * s}px monospace`;
  ctx.fillText(fitText(ctx, status, maxTextW), x + pad + jitter.dx, warnY + jitter.dy);
  ctx.shadowBlur = 0;
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,70,90,0.45)';
  ctx.lineWidth = Math.max(1, s);
  ctx.beginPath();
  ctx.moveTo(x + pad, warnY + 21 * s);
  ctx.lineTo(x + panelW - pad, warnY + 21 * s);
  ctx.stroke();

  ctx.font = `${8 * s}px monospace`;
  let ly = warnY + 33 * s;
  const lineH = 10 * s;
  ctx.fillStyle = '#9fb8bd';
  const maxRows = Math.max(1, Math.floor((y + panelH - ly - 22 * s) / lineH));
  let rows = 0;
  for (const line of lines) {
    for (const wrapped of wrapTextLines(ctx, line, maxTextW, maxRows - rows)) {
      ctx.fillText(wrapped, x + pad, ly);
      ly += lineH;
      rows++;
      if (rows >= maxRows) break;
    }
    if (rows >= maxRows) break;
  }

  ctx.fillStyle = '#4f6470';
  ctx.font = `${7 * s}px monospace`;
  const footer = denied.footer ?? `${menuCloseHint()} закрыть  |  нужен НЕТ-ГЕН`;
  ctx.fillText(fitText(ctx, footer, maxTextW), x + pad, y + panelH - 16 * s);
  if (denied.code) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#70505a';
    ctx.fillText(fitText(ctx, denied.code, 90 * s), x + panelW - pad, y + panelH - 16 * s);
    ctx.textAlign = 'left';
  }

  ctx.restore();
}
