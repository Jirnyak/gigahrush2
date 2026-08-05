/* ── Safeguard: NET/BLAME readable blade guard ───────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SAFEGUARD,
  name: 'Сейфгард',
  hp: 185,
  speed: 2.15,
  dmg: 24,
  attackRate: 2.4,
  sprite: 0,
  floors: [FloorLevel.MAINTENANCE, FloorLevel.VOID],
  counterplay: 'Белый замах короткий: ломайте линию стеной, дверью, аппаратом или машиной; дробь сбивает клинки до рывка.',
  lootHint: 'белая пластина, черный суставной штифт, редкая плата отказа',
};

function paintPx(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = rgba(r, g, b, a);
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, w = 1): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round(y0 + (y1 - y0) * u);
    for (let oy = -w; oy <= w; oy++) for (let ox = -w; ox <= w; ox++) {
      if (ox * ox + oy * oy <= w * w + 0.25) paintPx(t, x + ox, y + oy, r, g, b);
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S >> 1;

  // Dark under-silhouette keeps the white body readable on pale floors.
  for (let y = 5; y < 60; y++) {
    const half = y < 14 ? 5 : y < 20 ? 9 : y < 42 ? 7 : 5;
    for (let x = cx - half - 2; x <= cx + half + 2; x++) {
      const legGap = y > 43 && Math.abs(x - cx) < 2;
      if (!legGap) paintPx(t, x, y, 10, 12, 16, 230);
    }
  }

  // Cold white humanoid core, narrower than Creator.
  for (let y = 6; y < 58; y++) {
    let half = 0;
    if (y < 14) {
      const dy = (y - 10) / 5;
      half = Math.floor(Math.sqrt(Math.max(0, 1 - dy * dy)) * 5);
    } else if (y < 19) {
      half = 5 + Math.floor((y - 14) * 0.9);
    } else if (y < 42) {
      half = 6 - Math.floor((y - 19) * 0.05);
    } else {
      for (const side of [-1, 1]) {
        const lx = cx + side * 4;
        for (let dx = -2; dx <= 2; dx++) {
          const px = lx + dx;
          const n = noise(px, y, 13120) * 28;
          paintPx(t, px, y, clamp(206 + n), clamp(214 + n), clamp(222 + n));
        }
      }
      continue;
    }
    for (let x = cx - half; x <= cx + half; x++) {
      const n = noise(x, y, 13100) * 24;
      const edge = Math.abs(x - cx) / Math.max(1, half);
      const shade = Math.floor((1 - edge) * 26 + n);
      paintPx(t, x, y, clamp(198 + shade), clamp(207 + shade), clamp(218 + shade));
    }
  }

  // Black joint gaps and servo cuts.
  for (const y of [18, 30, 42]) {
    for (let x = cx - 7; x <= cx + 7; x++) if (Math.abs(x - cx) > 1) paintPx(t, x, y, 6, 7, 9);
  }
  for (let y = 22; y < 41; y += 4) {
    paintPx(t, cx - 3, y, 18, 20, 25);
    paintPx(t, cx + 3, y + 1, 18, 20, 25);
  }

  // Four long blade tips outside the silhouette.
  line(t, cx - 8, 19, cx - 24, 7, 14, 16, 19, 1);
  line(t, cx + 8, 19, cx + 24, 7, 14, 16, 19, 1);
  line(t, cx - 9, 21, cx - 29, 39, 222, 236, 242, 1);
  line(t, cx + 9, 21, cx + 29, 39, 222, 236, 242, 1);
  line(t, cx - 5, 45, cx - 15, 61, 198, 218, 226, 1);
  line(t, cx + 5, 45, cx + 15, 61, 198, 218, 226, 1);

  // Error slit face: red denial with cyan dead pixels.
  for (let x = cx - 4; x <= cx + 4; x++) paintPx(t, x, 10, 255, 42, 54);
  paintPx(t, cx - 5, 10, 72, 244, 255);
  paintPx(t, cx + 5, 10, 72, 244, 255);
  paintPx(t, cx, 11, 110, 0, 20);

  return t;
}
