import type { DemosSocialLinkView } from '../systems/demos_profiles';
import { fitText } from './ui_text';

export interface DrawDemosSocialLinksOptions {
  title?: string;
  maxRows?: number;
}

export function drawDemosSocialLinksPanel(
  ctx: CanvasRenderingContext2D,
  links: readonly DemosSocialLinkView[],
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
  opts: DrawDemosSocialLinksOptions = {},
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,190,0.38)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pad = 7 * sx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${9 * sy}px monospace`;
  ctx.fillStyle = '#25ffd0';
  ctx.fillText(fitText(ctx, opts.title ?? 'СВЯЗИ', w - pad * 2), x + pad, y + 6 * sy);

  const rowH = 16 * sy;
  const maxRowsByHeight = Math.max(0, Math.floor((h - 28 * sy) / rowH));
  const maxRows = Math.min(opts.maxRows ?? 9, maxRowsByHeight);
  if (links.length === 0 || maxRows <= 0) {
    ctx.font = `${8 * sy}px monospace`;
    ctx.fillStyle = '#789';
    ctx.fillText(fitText(ctx, 'Связей в исходящих слотах нет.', w - pad * 2), x + pad, y + 25 * sy);
    return;
  }

  const rowW = w - pad * 2;
  let rowY = y + 24 * sy;
  for (const link of links.slice(0, maxRows)) {
    ctx.fillStyle = link.hidden ? 'rgba(24,18,24,0.72)' : 'rgba(2,18,22,0.72)';
    ctx.fillRect(x + pad, rowY, rowW, rowH - 3 * sy);
    ctx.strokeStyle = link.dead ? 'rgba(180,70,82,0.28)' : 'rgba(0,140,130,0.22)';
    ctx.strokeRect(x + pad + 0.5, rowY + 0.5, rowW - 1, rowH - 3 * sy - 1);

    ctx.font = `${7.2 * sy}px monospace`;
    ctx.fillStyle = link.dead ? '#b77' : link.relationColor;
    ctx.fillText(fitText(ctx, link.roleLabel, 50 * sx), x + pad + 5 * sx, rowY + 3 * sy);

    ctx.fillStyle = link.dead ? '#a88' : '#d9f1ed';
    ctx.fillText(fitText(ctx, link.targetLabel, Math.max(20, rowW - 122 * sx)), x + pad + 58 * sx, rowY + 3 * sy);

    ctx.textAlign = 'right';
    ctx.fillStyle = link.relationColor;
    ctx.fillText(fitText(ctx, `${link.relation} ${link.relationLabel}`, 60 * sx), x + pad + rowW - 5 * sx, rowY + 3 * sy);
    ctx.textAlign = 'left';
    rowY += rowH;
  }
}
