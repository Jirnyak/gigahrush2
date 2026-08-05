import type { DemosFeedView, DemosRenderedReaction } from '../systems/demos_posts';
import { fitText, wrapTextLines } from './ui_text';

export interface DrawDemosFeedOptions {
  title?: string;
  scroll?: number;
  reactionsByPostId?: Readonly<Record<number, readonly DemosRenderedReaction[]>>;
}

function drawTag(
  ctx: CanvasRenderingContext2D,
  tag: string,
  x: number,
  y: number,
  maxW: number,
  sy: number,
): number {
  const label = fitText(ctx, tag, maxW - 8 * sy);
  const w = Math.min(maxW, ctx.measureText(label).width + 8 * sy);
  ctx.fillStyle = 'rgba(0,70,68,0.82)';
  ctx.fillRect(x, y, w, 10 * sy);
  ctx.strokeStyle = 'rgba(40,210,190,0.32)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 10 * sy - 1);
  ctx.fillStyle = '#8fe';
  ctx.fillText(label, x + 4 * sy, y + 2 * sy);
  return w;
}

export function drawDemosFeedPanel(
  ctx: CanvasRenderingContext2D,
  view: DemosFeedView,
  x: number,
  y: number,
  w: number,
  h: number,
  sx: number,
  sy: number,
  opts: DrawDemosFeedOptions = {},
): void {
  ctx.fillStyle = 'rgba(0,10,14,0.84)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,220,190,0.42)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pad = 7 * sx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${9 * sy}px monospace`;
  ctx.fillStyle = '#25ffd0';
  ctx.fillText(fitText(ctx, opts.title ?? 'ЛЕНТА ДЕМОСА', w - pad * 2), x + pad, y + 6 * sy);

  ctx.font = `${7 * sy}px monospace`;
  ctx.fillStyle = '#587';
  ctx.fillText(`${view.total}/${view.capacity}`, x + w - pad - 40 * sx, y + 7 * sy);

  const rowX = x + pad;
  let rowY = y + 23 * sy - Math.max(0, Math.floor(opts.scroll ?? 0)) * 18 * sy;
  const bottom = y + h - 6 * sy;
  const rowW = w - pad * 2;
  if (view.posts.length === 0) {
    ctx.font = `${8 * sy}px monospace`;
    ctx.fillStyle = '#789';
    ctx.fillText(fitText(ctx, view.emptyLabel, rowW), rowX, rowY);
    return;
  }

  for (const post of view.posts) {
    if (rowY > bottom) break;
    const textLines = wrapTextLines(ctx, post.text, rowW - 8 * sx, 3, { stable: true });
    const reactions = opts.reactionsByPostId?.[post.id] ?? [];
    const rowH = (25 + textLines.length * 9 + Math.min(2, reactions.length) * 9) * sy;
    if (rowY + rowH >= y + 20 * sy) {
      ctx.fillStyle = 'rgba(2,18,22,0.74)';
      ctx.fillRect(rowX, rowY, rowW, rowH);
      ctx.strokeStyle = 'rgba(0,140,130,0.25)';
      ctx.strokeRect(rowX + 0.5, rowY + 0.5, rowW - 1, rowH - 1);

      ctx.font = `${7 * sy}px monospace`;
      ctx.fillStyle = '#6a9';
      ctx.fillText(
        fitText(ctx, `post:${post.id}  alife:${post.authorAlifeId}  ${Math.floor(post.createdAt)}s`, rowW - 10 * sx),
        rowX + 5 * sx,
        rowY + 4 * sy,
      );

      let tagX = rowX + 5 * sx;
      const tagY = rowY + 14 * sy;
      for (const tag of post.tags.slice(0, 3)) {
        const used = drawTag(ctx, tag, tagX, tagY, Math.min(70 * sx, rowX + rowW - tagX - 4 * sx), sy);
        tagX += used + 3 * sx;
        if (tagX > rowX + rowW - 20 * sx) break;
      }

      ctx.font = `${8 * sy}px monospace`;
      ctx.fillStyle = '#d9f1ed';
      let textY = rowY + 27 * sy;
      for (const line of textLines) {
        ctx.fillText(line, rowX + 5 * sx, textY);
        textY += 9 * sy;
      }

      ctx.font = `${7 * sy}px monospace`;
      for (const reaction of reactions.slice(0, 2)) {
        ctx.fillStyle = reaction.relation < 0 ? '#e99' : '#9dc';
        ctx.fillText(
          fitText(ctx, `alife:${reaction.reactorAlifeId}: ${reaction.text}`, rowW - 12 * sx),
          rowX + 8 * sx,
          textY,
        );
        textY += 9 * sy;
      }
    }
    rowY += rowH + 4 * sy;
  }
}
