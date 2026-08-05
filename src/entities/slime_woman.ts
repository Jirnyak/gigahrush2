/* ── Жижевая женщина: rare humanoid toxic slime predator ─────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SLIME_WOMAN,
  name: 'Жижевая женщина',
  hp: 118,
  speed: 1.18,
  dmg: 17,
  attackRate: 1.55,
  sprite: 0,
  aiFlags: ['slimeStrider'],
  floors: [FloorLevel.MAINTENANCE, FloorLevel.LIVING],
  counterplay: 'Не деритесь в воде: сухой освещенный бетон, УФ, огонь, чистящий комплект и сухая кромка режут темп жижевой женщины.',
  lootHint: 'редкая проба жижевого тела только в тару НИИ; без тары остается токсичный след',
};

function paintEllipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: (x: number, y: number, d: number) => number,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    if (y < 0 || y >= S) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) t[y * S + x] = color(x, y, d);
    }
  }
}

function paintLine(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: number, width = 1): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const x = Math.round(x0 + (x1 - x0) * f);
    const y = Math.round(y0 + (y1 - y0) * f);
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) {
        const px = x + ox;
        const py = y + oy;
        if (px >= 0 && px < S && py >= 0 && py < S) t[py * S + px] = color;
      }
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const body = (x: number, y: number, d: number): number => {
    const n = noise(x, y, 5050) * 30;
    const purple = noise(x * 2, y, 5051) > 0.92 ? 38 : 0;
    return rgba(clamp(18 + n + purple), clamp(82 + n), clamp(62 + n + purple), clamp(235 - d * 55));
  };
  const dark = rgba(6, 35, 25, 245);
  const pale = rgba(205, 246, 230, 210);
  const cyan = rgba(75, 242, 255, 255);
  const purple = rgba(108, 54, 142, 210);

  // Lower body alternates visually between legs and a skirt of tendrils.
  paintEllipse(t, cx, 44, 9, 13, body);
  paintLine(t, cx - 4, 47, cx - 10, 62, dark, 2);
  paintLine(t, cx + 4, 47, cx + 10, 62, dark, 2);
  for (let i = -3; i <= 3; i++) {
    const x = cx + i * 3 + Math.floor(noise(i, 0, 5052) * 2);
    paintLine(t, x, 50, x + Math.floor(noise(i, 1, 5053) * 7 - 3), 63, rgba(12, 76, 58, 210), i === 0 ? 2 : 1);
  }

  // Tall humanoid torso and head, transparent holes included.
  paintEllipse(t, cx, 29, 10, 18, body);
  paintEllipse(t, cx, 13, 7, 8, body);
  for (let y = 14; y < 43; y++) {
    for (let x = 20; x < 45; x++) {
      if (t[y * S + x] === CLEAR) continue;
      if (noise(x, y, 5054) > 0.955) t[y * S + x] = rgba(2, 16, 14, 34);
    }
  }

  // Horn-like dark-green head growths.
  paintLine(t, cx - 4, 8, cx - 14, 2, dark, 2);
  paintLine(t, cx + 4, 8, cx + 14, 2, dark, 2);
  paintLine(t, cx - 6, 10, cx - 17, 7, rgba(9, 50, 34, 230), 1);
  paintLine(t, cx + 6, 10, cx + 17, 7, rgba(9, 50, 34, 230), 1);

  // Dripping arms.
  paintLine(t, cx - 9, 25, cx - 19, 44, rgba(10, 74, 51, 230), 2);
  paintLine(t, cx + 9, 25, cx + 20, 44, rgba(10, 74, 51, 230), 2);
  for (let i = 0; i < 11; i++) {
    const side = i & 1 ? -1 : 1;
    const x = Math.floor(cx + side * (12 + noise(i, 2, 5055) * 9));
    const y0 = 28 + Math.floor(noise(i, 3, 5056) * 12);
    const len = 6 + Math.floor(noise(i, 4, 5057) * 12);
    paintLine(t, x, y0, x, Math.min(63, y0 + len), rgba(25, 118, 82, 170), 0);
  }

  // Slime states: black mass, white slicks, and blue-green glints.
  paintLine(t, cx - 7, 20, cx + 6, 36, rgba(5, 18, 17, 220), 1);
  paintLine(t, cx + 4, 22, cx + 10, 41, pale, 0);
  paintLine(t, cx - 11, 37, cx - 5, 58, rgba(45, 174, 156, 205), 0);
  for (let i = 0; i < 12; i++) {
    const x = 20 + Math.floor(noise(i, 6, 5058) * 24);
    const y = 10 + Math.floor(noise(i, 7, 5059) * 43);
    if (t[y * S + x] !== CLEAR) t[y * S + x] = i % 3 === 0 ? pale : (i % 3 === 1 ? purple : rgba(28, 150, 132, 225));
  }

  // Cold eyes keep the silhouette humanoid without making it a normal NPC.
  t[13 * S + (cx - 3)] = cyan;
  t[13 * S + (cx + 3)] = rgba(238, 255, 255, 255);
  t[14 * S + (cx - 3)] = rgba(10, 30, 32, 255);
  t[14 * S + (cx + 3)] = rgba(10, 30, 32, 255);
  return t;
}
