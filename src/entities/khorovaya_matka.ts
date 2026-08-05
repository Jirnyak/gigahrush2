/* ── Хоровая Матка — wet choir countdown spawner ─────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.KHOROVAYA_MATKA,
  name: 'Хоровая Матка',
  hp: 420,
  speed: 0.28,
  dmg: 10,
  attackRate: 3.8,
  sprite: 0,
  floors: [FloorLevel.HELL],
  counterplay: 'Слушайте мокрый хор: либо давите источник до приплода, либо чистите детей и бейте матку в короткое открытое окно.',
  lootHint: 'хоровой маточный узел, серая мембрана, редкая мясная руна после сорванного припева',
};

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
  a = 255,
): void {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(S - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(S - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, seed) * 18 - 8;
      t[y * S + x] = rgba(clamp(r + n), clamp(g + n), clamp(b + n), a);
    }
  }
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const x = Math.round(x0 + (x1 - x0) * f);
    const y = Math.round(y0 + (y1 - y0) * f);
    if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = rgba(r, g, b);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Hanging cords make the source read as a suspended womb, not another crawler.
  for (let i = 0; i < 8; i++) {
    const x = 18 + i * 4 + Math.floor(noise(i, 0, 3701) * 3 - 1);
    line(t, x, 2, x + Math.floor(noise(i, 1, 3702) * 7 - 3), 21, 66, 38, 44);
  }

  ellipse(t, cx, 31, 19, 24, 108, 28, 34, 3710);
  ellipse(t, cx - 2, 37, 14, 18, 136, 36, 42, 3711);
  ellipse(t, cx + 2, 27, 13, 16, 86, 28, 35, 3712);

  // Gray membrane countdown bands.
  for (let y = 16; y <= 49; y += 6) {
    const wave = Math.sin(y * 0.33) * 4;
    line(t, cx - 16, y, cx + 15, y + wave, 118, 112, 112);
    line(t, cx - 13, y + 2, cx + 12, y + 2 + wave, 64, 42, 48);
  }

  // Central throat holes.
  ellipse(t, cx, 35, 6, 10, 8, 4, 6, 3720);
  ellipse(t, cx - 8, 30, 3, 5, 6, 4, 5, 3721);
  ellipse(t, cx + 9, 41, 4, 6, 5, 3, 4, 3722);

  const buds: readonly [number, number, number, number][] = [
    [18, 21, 5, 4],
    [46, 22, 5, 4],
    [14, 36, 5, 5],
    [50, 36, 5, 5],
    [24, 50, 5, 4],
    [41, 51, 5, 4],
  ];
  for (let i = 0; i < buds.length; i++) {
    const [bx, by, brx, bry] = buds[i];
    ellipse(t, bx, by, brx, bry, 184, 162, 150, 3730 + i);
    ellipse(t, bx, by + 1, Math.max(1, i % 3), 1 + Math.floor(i / 2), 8, 4, 5, 3740 + i);
    t[(by - 1) * S + (bx - 2)] = rgba(16, 8, 9);
    t[(by - 1) * S + (bx + 2)] = rgba(16, 8, 9);
  }

  // Wet lower birth lip.
  for (let y = 50; y < 61; y++) {
    const half = 15 - (y - 50) * 0.6;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / Math.max(1, half);
      const dy = (y - 54) / 7;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, 3750) * 18;
      t[y * S + x] = rgba(clamp(72 + n), clamp(24 + n * 0.5), clamp(28 + n * 0.5));
    }
  }

  return t;
}
