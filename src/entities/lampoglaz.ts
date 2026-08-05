/* ── Lampoglaz: light-linked corridor turret ─────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.LAMPOGLAZ,
  name: 'Лампоглаз',
  hp: 44,
  speed: 0.28,
  dmg: 10,
  attackRate: 1.9,
  sprite: 0,
  isRanged: true,
  projSpeed: 13,
  projSprite: 0,
  aiFlags: ['lightLock'],
  floors: [FloorLevel.LIVING, FloorLevel.MINISTRY],
  counterplay: 'Не стойте в светлой полосе: темный угол, выключенная линия или шкаф между вами срывают зеленый захват.',
  lootHint: 'ламповая линза, фарфоровый ободок, стеклянная пыль, редкий предохранитель',
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
  a = 255,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const edge = Math.sqrt(d2) * 34;
      const n = noise(x, y, seed) * 18 - 7;
      put(t, x, y, rgba(clamp(r + n - edge), clamp(g + n - edge), clamp(b + n - edge), a));
    }
  }
}

function rect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, seed: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const n = noise(x, y, seed) * 16 - 8;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n)));
    }
  }
}

function cable(t: Uint32Array, x0: number, y0: number, len: number, sway: number, seed: number): void {
  let px = x0;
  for (let i = 0; i < len; i++) {
    const x = Math.floor(x0 + Math.sin(i * 0.65 + sway) * 2 + noise(i, x0, seed) * 2 - 1);
    const y = y0 + i;
    put(t, x, y, rgba(12, 12, 10));
    if (i > 2 && i % 3 === 0) put(t, px, y, rgba(34, 29, 18));
    px = x;
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 32;
  const cy = 34;

  for (let ring = 0; ring < 4; ring++) {
    const rx = 26 - ring * 4;
    const ry = 20 - ring * 3;
    const seed = 30_100 + ring * 17;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.82 || d > 1.03) continue;
        const sharp = Math.max(0, 1 - Math.abs(d - 0.92) * 8);
        const n = noise(x, y, seed) * 35;
        put(t, x, y, rgba(230 + n * 0.2, 176 + n * 0.4, 34, clamp(38 + sharp * (56 + ring * 25))));
      }
    }
  }

  rect(t, 22, 9, 42, 17, 84, 78, 64, 30_200);
  rect(t, 25, 13, 39, 24, 206, 198, 174, 30_210);
  rect(t, 27, 17, 37, 27, 92, 80, 56, 30_220);

  for (let i = -3; i <= 3; i++) cable(t, cx + i * 4, 0, 14 + Math.abs(i), i * 0.7, 30_300 + i);

  ellipse(t, cx, cy, 17, 15, 228, 224, 202, 30_400);
  ellipse(t, cx, cy + 1, 12, 10, 230, 188, 78, 30_410);
  ellipse(t, cx, cy + 1, 8, 8, 86, 206, 82, 30_420);
  ellipse(t, cx, cy + 1, 4, 7, 6, 18, 8, 30_430);
  ellipse(t, cx - 2, cy - 3, 2, 2, 236, 255, 190, 30_440, 230);

  for (let y = cy - 10; y <= cy + 11; y += 4) {
    put(t, cx - 17, y, rgba(44, 36, 28));
    put(t, cx + 17, y, rgba(44, 36, 28));
  }

  for (let x = 19; x <= 45; x++) {
    const y = 53 + Math.floor(noise(x, 1, 30_500) * 3);
    put(t, x, y, rgba(30, 24, 18, 190));
  }

  return t;
}
