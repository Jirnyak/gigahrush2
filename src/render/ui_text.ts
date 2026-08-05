import { translateText } from '../systems/localization';

let uiTextTime = 0;
const fitTextSeenAt = new Map<string, number>();
const fitTextStableCache = new Map<string, string>();
const FIT_TEXT_CACHE_LIMIT = 256;
const FIT_TEXT_STABLE_CACHE_LIMIT = 512;
const FIT_TEXT_EDGE_HOLD = 0.65;
const FIT_TEXT_CHARS_PER_SECOND = 9;

export function setUiTextTime(time: number): void {
  uiTextTime = Number.isFinite(time) ? time : 0;
}

export function formatUiNumber(value: number | undefined, maxFractionDigits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return '0';
  const digits = Math.max(0, Math.min(2, Math.floor(maxFractionDigits)));
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  const stable = Object.is(rounded, -0) ? 0 : rounded;
  if (digits === 0 || Number.isInteger(stable)) return String(stable);
  return stable.toFixed(digits).replace(/\.?0+$/, '');
}

function fitTextCacheKey(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  return `${ctx.font}|${Math.round(maxW)}|${text}`;
}

function cachedFitTextStable(key: string): string | undefined {
  const cached = fitTextStableCache.get(key);
  if (cached === undefined) return undefined;
  fitTextStableCache.delete(key);
  fitTextStableCache.set(key, cached);
  return cached;
}

function rememberFitTextStable(key: string, value: string): string {
  if (fitTextStableCache.size >= FIT_TEXT_STABLE_CACHE_LIMIT) {
    const oldest = fitTextStableCache.keys().next().value;
    if (oldest !== undefined) fitTextStableCache.delete(oldest);
  }
  fitTextStableCache.set(key, value);
  return value;
}

function firstSeenTime(ctx: CanvasRenderingContext2D, text: string, maxW: number): number {
  const key = fitTextCacheKey(ctx, text, maxW);
  const seen = fitTextSeenAt.get(key);
  if (seen !== undefined) return seen;
  if (fitTextSeenAt.size >= FIT_TEXT_CACHE_LIMIT) {
    const oldest = fitTextSeenAt.keys().next().value;
    if (oldest !== undefined) fitTextSeenAt.delete(oldest);
  }
  fitTextSeenAt.set(key, uiTextTime);
  return uiTextTime;
}

function snakeTextStart(elapsed: number, maxStart: number): number {
  if (maxStart <= 0) return 0;
  const travel = maxStart / FIT_TEXT_CHARS_PER_SECOND;
  const cycle = FIT_TEXT_EDGE_HOLD * 2 + travel * 2;
  let t = ((elapsed % cycle) + cycle) % cycle;
  if (t < FIT_TEXT_EDGE_HOLD) return 0;
  t -= FIT_TEXT_EDGE_HOLD;
  if (t < travel) return Math.min(maxStart, Math.floor(t * FIT_TEXT_CHARS_PER_SECOND));
  t -= travel;
  if (t < FIT_TEXT_EDGE_HOLD) return maxStart;
  t -= FIT_TEXT_EDGE_HOLD;
  return Math.max(0, maxStart - Math.floor(t * FIT_TEXT_CHARS_PER_SECOND));
}

function maxFittingChars(ctx: CanvasRenderingContext2D, text: string, maxW: number): number {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (ctx.measureText(text.slice(0, mid)).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function fittingTextSlice(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  start: number,
  count: number,
): string {
  let from = Math.max(0, Math.min(start, text.length - 1));
  let to = Math.min(text.length, from + Math.max(1, count));
  while (to > from && ctx.measureText(text.slice(from, to)).width > maxW) {
    if (to >= text.length) from++;
    else to--;
  }
  return from < to ? text.slice(from, to) : '';
}

export function fitTextStable(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  mode: 'ellipsis' | 'clip' = 'ellipsis',
): string {
  text = translateText(text);
  if (maxW <= 0 || text.length === 0) return '';
  const cacheKey = `${mode}|${fitTextCacheKey(ctx, text, maxW)}`;
  const cached = cachedFitTextStable(cacheKey);
  if (cached !== undefined) return cached;
  if (ctx.measureText(text).width <= maxW) return rememberFitTextStable(cacheKey, text);
  if (mode === 'clip') {
    const count = maxFittingChars(ctx, text, maxW);
    return rememberFitTextStable(cacheKey, count <= 0 ? '' : text.slice(0, count));
  }

  const ellipsis = '...';
  const ellipsisW = ctx.measureText(ellipsis).width;
  if (ellipsisW >= maxW) {
    const count = maxFittingChars(ctx, text, maxW);
    return rememberFitTextStable(cacheKey, count <= 0 ? '' : text.slice(0, count));
  }
  const count = maxFittingChars(ctx, text, maxW - ellipsisW);
  return rememberFitTextStable(cacheKey, count <= 0 ? '' : `${text.slice(0, count)}${ellipsis}`);
}

function maxFittingUnits(ctx: CanvasRenderingContext2D, units: readonly string[], start: number, maxW: number): number {
  let lo = 0;
  let hi = units.length - start;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (ctx.measureText(units.slice(start, start + mid).join('')).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function splitOverwideToken(ctx: CanvasRenderingContext2D, token: string, maxW: number): string[] {
  const units = Array.from(token);
  const lines: string[] = [];
  let start = 0;
  while (start < units.length) {
    const count = maxFittingUnits(ctx, units, start, maxW);
    if (count <= 0) break;
    lines.push(units.slice(start, start + count).join(''));
    start += count;
  }
  return lines;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  text = translateText(text);
  if (maxW <= 0 || text.length === 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  const count = maxFittingChars(ctx, text, maxW);
  if (count <= 0) return '';
  const maxStart = text.length - count;
  const elapsed = Math.max(0, uiTextTime - firstSeenTime(ctx, text, maxW));
  return fittingTextSlice(ctx, text, maxW, snakeTextStart(elapsed, maxStart), count);
}

export function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines = 64,
  options: { stable?: boolean; mode?: 'ellipsis' | 'clip' } = {},
): string[] {
  text = translateText(text);
  if (maxW <= 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  const pushLine = (line: string): boolean => {
    if (lines.length >= maxLines) return false;
    lines.push(options.stable ? fitTextStable(ctx, line, maxW, options.mode ?? 'ellipsis') : fitText(ctx, line, maxW));
    return lines.length < maxLines;
  };
  const pushOverwideWord = (word: string): boolean => {
    const parts = splitOverwideToken(ctx, word, maxW);
    for (const part of parts) {
      if (!pushLine(part)) return false;
    }
    return true;
  };

  const paragraphs = text.split('\n');
  for (let p = 0; p < paragraphs.length; p++) {
    const words = paragraphs[p].trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (p < paragraphs.length - 1 && !pushLine('')) break;
      continue;
    }
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) {
        if (!pushLine(line)) return lines;
        line = word;
      } else {
        line = test;
      }

      if (ctx.measureText(line).width > maxW) {
        if (!pushOverwideWord(line)) return lines;
        line = '';
      }
    }
    if (line) {
      if (!pushLine(line)) return lines;
    }
  }

  return lines;
}

export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines = 64,
): number {
  const lines = wrapTextLines(ctx, text, maxW, maxLines);
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lineH);
  return y + lines.length * lineH;
}

export function drawCenteredWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines = 64,
): number {
  const lines = wrapTextLines(ctx, text, maxW, maxLines);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'center';
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lineH);
  ctx.textAlign = prevAlign;
  return y + lines.length * lineH;
}
