/* ── Fog Shark: air-swimming fog pack predator ───────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.FOG_SHARK,
  name: 'Туманная акула',
  hp: 18,
  speed: 2.85,
  dmg: 12,
  attackRate: 0.78,
  sprite: 0,
  aiFlags: ['fogSwimmer'],
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'В тумане стая быстрая и кусает рывком: выходите на сухой воздух, закрывайте двери и углы, а огонь убивает надежно, но взрывает газовое брюхо рядом.',
  lootHint: 'серебряный зуб, сине-черная чешуя, газовый пузырь, редкая акулья чешуя',
};

export function put(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

export function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: number, width = 0): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round(y0 + (y1 - y0) * u);
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) put(t, x + ox, y + oy, color);
    }
  }
}

export function ellipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: (x: number, y: number, d: number) => number,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) put(t, x, y, color(x, y, d));
    }
  }
}

export function triangle(t: Uint32Array, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, color: number): void {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 0.001) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const w1 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
      const w2 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) put(t, x, y, color);
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const top = rgba(22, 28, 48, 245);
  const fin = rgba(18, 22, 38, 235);
  const silver = rgba(225, 230, 224, 255);
  const jaw = rgba(82, 86, 102, 245);
  const fog = rgba(120, 108, 146, 92);

  // Fog fringe first, so the body reads as swimming above the floor.
  for (let i = 0; i < 88; i++) {
    const x = 6 + Math.floor(noise(i, 2, 4401) * 52);
    const y = 17 + Math.floor(noise(i, 3, 4402) * 32);
    if (noise(x, y, 4403) > 0.36) put(t, x, y, rgba(104, 96, 132, 48 + Math.floor(noise(x, y, 4404) * 70)));
  }

  // Crescent tail and ragged fins.
  triangle(t, 12, 31, 2, 20, 5, 33, rgba(28, 34, 58, 230));
  triangle(t, 12, 32, 3, 48, 7, 34, rgba(24, 28, 50, 220));
  triangle(t, 27, 24, 35, 7, 39, 26, fin);
  triangle(t, 31, 38, 42, 55, 37, 36, rgba(24, 30, 52, 220));
  triangle(t, 18, 36, 12, 48, 27, 40, rgba(30, 36, 60, 205));

  // Main side-facing body, tilted up toward the teeth.
  ellipse(t, 32, 31, 23, 10, (x, y, d) => {
    const u = (x - 9) / 46;
    const centerY = 35 - u * 7;
    if (Math.abs(y - centerY) > 10 * (1 - d * 0.18)) return CLEAR;
    const n = noise(x, y, 4410) * 22 - 8;
    const belly = y > centerY + 2 && x > 18 && x < 48;
    return belly
      ? rgba(clamp(142 + n), clamp(146 + n), clamp(158 + n), clamp(210 - d * 42))
      : rgba(clamp(38 + n), clamp(43 + n), clamp(70 + n + u * 12), clamp(242 - d * 30));
  });

  // Snout and metal jaw.
  ellipse(t, 52, 28, 8, 6, (x, y, d) => {
    const n = noise(x, y, 4420) * 16 - 5;
    return y > 29
      ? rgba(clamp(68 + n), clamp(72 + n), clamp(88 + n), clamp(240 - d * 30))
      : rgba(clamp(30 + n), clamp(34 + n), clamp(58 + n), clamp(245 - d * 28));
  });
  line(t, 46, 31, 59, 33, jaw, 1);
  for (let i = 0; i < 11; i++) {
    const x = 48 + i;
    const y = 32 + (i & 1);
    put(t, x, y, silver);
    if ((i & 1) === 0) put(t, x, y + 1, rgba(184, 188, 186, 255));
  }
  put(t, 51, 25, rgba(136, 198, 245, 255));
  put(t, 52, 25, rgba(8, 12, 20, 255));

  // Gas belly and scars distinguish it from a normal fish.
  ellipse(t, 33, 36, 11, 5, (x, y, d) => {
    const n = noise(x, y, 4430) * 18;
    return rgba(clamp(174 + n), clamp(174 + n), clamp(190 + n), clamp(135 - d * 38));
  });
  for (let i = 0; i < 12; i++) {
    const x = 17 + Math.floor(noise(i, 5, 4440) * 31);
    const y = 24 + Math.floor(noise(i, 6, 4441) * 16);
    line(t, x, y, x + 3 + (i % 3), y + ((i & 1) ? 1 : -1), rgba(178, 184, 198, 185));
  }
  line(t, 11, 30, 20, 34, top);
  line(t, 20, 23, 49, 19, fog);
  line(t, 9, 41, 41, 47, fog);

  return t;
}
