/* ── Swarm: vent/void body mass from a local source ─────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SWARM,
  name: 'Рой',
  hp: 12,
  speed: 2.75,
  dmg: 2,
  attackRate: 0.24,
  sprite: 0,
  aiFlags: ['sourceSwarm', 'foodBait'],
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Не тратьте весь боезапас на тела: заклейте щель изолентой или герметиком, выжгите источник огнем, уводите тела приманкой либо бегите через рой коротким рывком.',
  lootHint: 'черная хитиновая крошка, ржавые лапки, желтые глазки, редкая изолента из гнезда',
};

function plot(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, seed: number, dense: boolean): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      const ragged = 1 + noise(x, y, seed) * (dense ? 0.12 : 0.34);
      if (d > ragged) continue;
      const n = noise(x, y, seed + 71) * 34;
      const band = Math.max(0, 1 - d);
      const rust = noise(x, y, seed + 111) > 0.54;
      const red = !dense && noise(x, y, seed + 181) > 0.92;
      t[y * S + x] = red
        ? rgba(146, 26, 18, 225)
        : rust
          ? rgba(clamp(64 + n + band * 34), clamp(35 + n * 0.55), clamp(17 + n * 0.35), 230)
          : rgba(clamp(18 + n * 0.28), clamp(16 + n * 0.24), clamp(14 + n * 0.18), dense ? 248 : 220);
    }
  }
}

function line(t: Uint32Array, x: number, y: number, dx: number, dy: number, len: number, c: number): void {
  for (let i = 0; i < len; i++) plot(t, Math.round(x + dx * i), Math.round(y + dy * i), c);
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 32;
  const cy = 35;

  ellipse(t, cx, cy, 15, 10, 18_010, true);
  ellipse(t, cx - 4, cy + 3, 12, 8, 18_011, true);
  ellipse(t, cx + 5, cy - 2, 10, 7, 18_012, true);

  for (let i = 0; i < 42; i++) {
    const a = i * 2.399963 + noise(i, 4, 18_100) * 0.45;
    const r = 6 + noise(i, 7, 18_101) * 17;
    const bx = cx + Math.cos(a) * r;
    const by = cy + Math.sin(a) * r * 0.62 + Math.sin(i * 1.31) * 2.4;
    const rx = 1.5 + noise(i, 2, 18_102) * 3.2;
    const ry = 1.2 + noise(i, 3, 18_103) * 2.4;
    ellipse(t, bx, by, rx, ry, 18_200 + i * 29, false);
  }

  const legColor = rgba(10, 9, 7, 235);
  for (let i = 0; i < 26; i++) {
    const side = i & 1 ? 1 : -1;
    const y = 24 + (i * 5) % 25;
    const x = cx + side * (10 + noise(i, y, 18_400) * 10);
    line(t, x, y, side * (0.7 + noise(i, y, 18_401) * 0.6), -0.35 + noise(i, y, 18_402) * 0.9, 5, legColor);
  }

  for (let i = 0; i < 12; i++) {
    const x = 23 + (i * 7) % 19;
    const y = 25 + (i * 11) % 20;
    plot(t, x, y, rgba(220, 205, 66, 250));
    if ((i & 3) === 0) plot(t, x + 1, y, rgba(171, 38, 28, 230));
  }

  return t;
}
