/* ── Vodyanoy Koshmar: water-line PSI predator ───────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.VODYANOY_KOSHMAR,
  name: 'Водяной кошмар',
  hp: 86,
  speed: 1.34,
  dmg: 10,
  attackRate: 1.2,
  sprite: 0,
  aiFlags: ['waterPressureLine'],
  floors: [FloorLevel.MAINTENANCE],
  counterplay: 'Сухой бетон рвет мокрую ПСИ-линию: не пятитесь по воде, переходите на сухую кромку и бейте коротким burst, пока давление сбито.',
  lootHint: 'мокрый ПСИ-налет, вода с привкусом металла, редкая ПСИ-пыль из сливного лица',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function ellipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
  seed: number,
  alpha = 255,
): void {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(S - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(S - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const edge = Math.sqrt(d) * 34;
      const n = noise(x, y, seed) * 24 - 7;
      t[y * S + x] = rgba(clamp(r + n - edge), clamp(g + n - edge), clamp(b + n - edge), alpha);
    }
  }
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: number): void {
  const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    put(t, x, y, c);
  }
}

function ripple(t: Uint32Array, cx: number, cy: number, rx: number, seed: number): void {
  for (let a = 0; a < 80; a++) {
    const ang = (a / 80) * Math.PI * 2;
    const wobble = 1 + (noise(a, seed, 9300) - 0.5) * 0.18;
    const x = Math.floor(cx + Math.cos(ang) * rx * wobble);
    const y = Math.floor(cy + Math.sin(ang) * rx * 0.34 * wobble);
    put(t, x, y, rgba(70, 126, 128, 150));
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let i = 0; i < 4; i++) ripple(t, cx, 43 + i * 3, 13 + i * 4, 9400 + i);

  ellipse(t, cx - 1, 13, 6, 7, 17, 24, 34, 9410);
  ellipse(t, cx, 28, 11, 17, 12, 30, 43, 9411);
  ellipse(t, cx - 10, 30, 4, 16, 9, 23, 36, 9412, 230);
  ellipse(t, cx + 10, 31, 4, 17, 10, 25, 38, 9413, 230);

  for (let y = 18; y < 43; y++) {
    const half = 8 + Math.sin(y * 0.21) * 2;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const n = noise(x * 2, y * 2, 9420);
      if (n > 0.72) put(t, x, y, rgba(20, 56, 66, 210));
    }
  }

  ellipse(t, cx - 1, 14, 3, 5, 202, 205, 184, 9430, 235);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(cx - 4 + noise(i, 1, 9431) * 8);
    line(t, x, 12 + i, x + Math.floor(noise(i, 2, 9432) * 3) - 1, 25 + i * 2, rgba(52, 96, 92, 190));
  }
  put(t, cx - 3, 13, rgba(8, 18, 24));
  put(t, cx + 3, 15, rgba(7, 16, 21));
  line(t, cx - 4, 20, cx + 3, 21, rgba(180, 198, 170, 170));

  for (let y = 43; y < 61; y++) {
    const fy = y - 43;
    const half = Math.max(2, 10 - fy * 0.35);
    const shift = Math.sin(y * 0.4) * 2;
    for (let x = Math.floor(cx - half + shift); x <= Math.ceil(cx + half + shift); x++) {
      const n = noise(x, y, 9440) * 20;
      const a = clamp(165 - fy * 7 + n);
      if (a > 20) t[y * S + x] = rgba(clamp(8 + n), clamp(36 + n), clamp(50 + n), a);
    }
  }

  for (let i = 0; i < 18; i++) {
    const x = Math.floor(cx - 15 + noise(i, 3, 9450) * 30);
    const y0 = 7 + Math.floor(noise(i, 4, 9451) * 33);
    const len = 7 + Math.floor(noise(i, 5, 9452) * 14);
    line(t, x, y0, x + Math.floor(noise(i, 6, 9453) * 3) - 1, Math.min(62, y0 + len), rgba(46, 92, 94, 150));
  }

  for (const x of [cx - 8, cx + 8]) {
    ripple(t, x, 41, 5, x * 31);
    line(t, x, 34, x + (x < cx ? -5 : 5), 43, rgba(66, 118, 116, 170));
  }

  return t;
}
