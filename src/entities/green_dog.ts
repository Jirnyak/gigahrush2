/* ── Green Dog: moss-backed door/corridor pack predator ──────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.GREEN_DOG,
  name: 'Зеленая собака',
  hp: 34,
  speed: 2.55,
  dmg: 9,
  attackRate: 0.82,
  sprite: 0,
  aiFlags: ['packHowl', 'noiseFear', 'foodBait'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Не открывайте дверь на жалобный вой. Громкий металл, шумовая банка, вентиль или дробовик пугают стаю и рвут цель на несколько секунд.',
  lootHint: 'грязная шерсть, зеленый мох, черная слюна, редкий сырой кусок',
};

function dot(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    dot(t, Math.round(x0 + (x1 - x0) * u), Math.round(y0 + (y1 - y0) * u), color);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const fur = rgba(70, 72, 66);
  const dark = rgba(28, 28, 24);
  const moss = rgba(92, 154, 76);
  const mossBright = rgba(136, 202, 94);

  for (let y = 24; y < 45; y++) {
    const dy = (y - 35) / 10;
    const arch = Math.max(0, 1 - Math.abs((y - 29) / 8)) * 4;
    const halfH = 1 - dy * dy;
    if (halfH <= 0) continue;
    const x0 = 13 + arch;
    const x1 = 46 - Math.max(0, y - 39) * 0.45;
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      const u = (x - x0) / Math.max(1, x1 - x0);
      const belly = y > 38 && u > 0.08 && u < 0.86;
      const n = noise(x, y, 7303) * 22 - 8;
      t[y * S + x] = belly
        ? rgba(clamp(48 + n), clamp(50 + n), clamp(45 + n))
        : rgba(clamp(64 + n), clamp(67 + n), clamp(58 + n));
    }
  }

  for (let y = 20; y < 35; y++) {
    const dy = Math.abs(y - 28);
    const left = 41 - Math.max(0, 5 - dy) * 0.35;
    const right = 58 - dy * 0.65;
    for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 7304) * 18 - 7;
      t[y * S + x] = rgba(clamp(58 + n), clamp(60 + n), clamp(52 + n));
    }
  }
  line(t, 44, 21, 38, 12, dark);
  line(t, 48, 22, 51, 12, dark);
  line(t, 49, 32, 58, 34, rgba(18, 14, 12));
  line(t, 50, 33, 57, 35, rgba(102, 18, 18));
  dot(t, 51, 25, rgba(242, 210, 72));
  dot(t, 52, 25, rgba(242, 210, 72));

  const leg = rgba(46, 48, 42);
  line(t, 18, 42, 15, 57, leg);
  line(t, 25, 43, 26, 57, leg);
  line(t, 35, 43, 33, 57, leg);
  line(t, 43, 41, 49, 55, leg);
  line(t, 14, 57, 20, 57, dark);
  line(t, 24, 57, 29, 57, dark);
  line(t, 32, 57, 37, 57, dark);
  line(t, 48, 55, 55, 55, dark);

  for (let i = 0; i < 42; i++) {
    const x = 12 + (i * 7) % 39;
    const y = 22 + Math.floor(noise(x, i, 7310) * 9);
    line(t, x, y + 2, x - 2 + (i % 5), y + 6, fur);
  }
  for (let y = 19; y < 42; y++) {
    for (let x = 17; x < 53; x++) {
      if (noise(x, y, 7315) <= 0.68 || (y >= 31 && x <= 42)) continue;
      t[y * S + x] = noise(x, y, 7316) > 0.55 ? mossBright : moss;
    }
  }

  line(t, 7, 47, 14, 50, rgba(36, 38, 34, 210));
  line(t, 14, 50, 20, 48, rgba(36, 38, 34, 210));
  for (let x = 19; x < 43; x += 3) dot(t, x, 22 + (x % 5), mossBright);

  return t;
}
