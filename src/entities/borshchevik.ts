/* ── Borshchevik: rooted sap-and-seed plant threat ───────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.BORSHCHEVIK,
  name: 'Борщевик',
  hp: 62,
  speed: 0,
  dmg: 12,
  attackRate: 1.45,
  sprite: 0,
  aiFlags: ['rootedPlant'],
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Держите дистанцию от сока и зонтика семян: рубка открывает путь без дыма, огонь убивает быстро, но дает короткую споровую вспышку.',
  lootHint: 'семена борщевика, желтый фототоксичный сок, редкий противогрибковый расходник',
};

function put(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = rgba(r, g, b, a);
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a = 255): void {
  const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    put(t, Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), r, g, b, a);
  }
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed: number, a = 255): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, seed) * 22 - 8;
      put(t, x, y, clamp(r + n), clamp(g + n), clamp(b + n), a);
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 32;

  // Root tendrils: wide base so the raycaster reads it as a route blocker.
  for (let i = 0; i < 9; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const len = 10 + Math.floor(noise(i, 2, 616) * 10);
    const y0 = 55 - Math.floor(noise(i, 1, 617) * 5);
    line(t, cx + side * 2, 53, cx + side * len, y0 + 4, 42, 74, 36, 230);
  }

  // Hollow striped stem with purple-black burn scars and yellow sap.
  for (let y = 12; y < 56; y++) {
    const sway = Math.sin(y * 0.18) * 2.2;
    const half = 3.8 + Math.sin(y * 0.31) * 0.8;
    for (let x = Math.floor(cx + sway - half); x <= Math.ceil(cx + sway + half); x++) {
      const dx = Math.abs((x - cx - sway) / half);
      const shade = dx * 28;
      const n = noise(x, y, 601) * 24;
      put(t, x, y, clamp(112 + n - shade), clamp(162 + n - shade), clamp(90 + n * 0.45 - shade));
    }
    if (y % 7 === 0) line(t, cx + sway - 3, y, cx + sway + 3, y + 1, 62, 92, 52, 225);
  }

  for (let i = 0; i < 8; i++) {
    const y = 22 + Math.floor(noise(i, 4, 619) * 25);
    const x = Math.floor(cx + Math.sin(y * 0.18) * 2 + (noise(i, 5, 620) - 0.5) * 8);
    ellipse(t, x, y, 2.2, 3.2, 58, 22, 58, 621 + i, 235);
    put(t, x + 1, y, 220, 198, 52, 245);
  }

  // Spreading umbrella leaves.
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = 26 + Math.floor(i * 4.2);
    const lx = cx + side * (9 + Math.floor(noise(i, 7, 631) * 9));
    const ly = y + Math.floor(noise(i, 8, 632) * 4) - 2;
    line(t, cx + side * 2, y, lx, ly, 58, 120, 54, 240);
    ellipse(t, lx, ly, 7.5, 3.8, 60, 132, 62, 640 + i, 230);
    for (let j = -2; j <= 2; j++) line(t, lx, ly, lx + side * (4 + Math.abs(j)), ly + j * 2, 44, 96, 42, 205);
  }

  // Flower umbel: many pale seed dots on readable spokes.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 8 + noise(i, 1, 650) * 10;
    const ex = cx + Math.cos(a) * r;
    const ey = 12 + Math.sin(a) * r * 0.45;
    line(t, cx, 16, ex, ey, 112, 158, 96, 180);
    ellipse(t, ex, ey, 1.7, 1.7, 232, 232, 216, 660 + i, 245);
    if (i % 3 === 0) put(t, Math.round(ex + 1), Math.round(ey), 244, 238, 176, 245);
  }
  ellipse(t, cx, 16, 3.2, 3.2, 224, 230, 204, 699, 255);

  return t;
}
