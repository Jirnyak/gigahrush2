import { clamp } from '../core/math';
import { fitText } from './ui_text';

export { clamp };

export function snap(v: number): number {
  return Math.round(v) + 0.5;
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, stroke?: string): void {
  const xx = Math.round(x);
  const yy = Math.round(y);
  const ww = Math.round(w);
  const hh = Math.round(h);
  ctx.fillStyle = fill;
  ctx.fillRect(xx, yy, ww, hh);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(snap(xx), snap(yy), Math.max(0, ww - 1), Math.max(0, hh - 1));
  }
}

export function drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, s: number, color: string): void {
  rect(ctx, x, y, w, h, '#090d0d', '#303936');
  ctx.fillStyle = color;
  ctx.font = `${Math.max(7, Math.round(h * 0.52))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, text, w - 5 * s), Math.round(x + w * 0.5), Math.round(y + h * 0.53));
}
