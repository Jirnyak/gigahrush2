/* -- Tumannik: fog-pocket ambusher with displaced silhouette ----- */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.TUMANNIK,
  name: 'Туманник',
  hp: 64,
  speed: 1.9,
  dmg: 9,
  attackRate: 0.72,
  sprite: 0,
  aiFlags: ['fogOffset'],
  floors: [FloorLevel.LIVING, FloorLevel.HELL],
  counterplay: 'Не гонитесь за силуэтом в тумане: держите угол и слушайте боковой шаг, а свет, огонь или выход из fog-пятна возвращают удар к настоящему телу.',
  lootHint: 'серый влажный след, холодная пыль, редкий фильтрующий слой',
};

function put(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = rgba(r, g, b, a);
}

function fogEllipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  alpha: number,
  blueEdge: boolean,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      if (noise(x * 3, y * 2, seed + 13) > 0.83 && d < 0.72) continue;
      const edge = Math.max(0, d - 0.55) * 1.8;
      const n = noise(x, y, seed) * 26 - 8;
      const cold = blueEdge ? edge * 62 : 0;
      put(
        t,
        x,
        y,
        clamp(92 + n - edge * 24),
        clamp(98 + n - edge * 12 + cold * 0.25),
        clamp(106 + n + cold),
        clamp(alpha - d * 45 + noise(x, y, seed + 29) * 32),
      );
    }
  }
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number): void {
  const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round(y0 + (y1 - y0) * u);
    put(t, x, y, r, g, b, a);
    if ((i & 3) === 0) put(t, x + 1, y, 120, 142, 158, Math.max(30, a - 70));
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S >> 1;

  // Offset decoy silhouette: readable false body, no red/black joint pixels.
  const ghostX = cx + 12;
  fogEllipse(t, ghostX, 13, 5, 7, 2101, 58, true);
  fogEllipse(t, ghostX - 1, 31, 9, 19, 2102, 66, true);
  line(t, ghostX - 8, 23, ghostX - 20, 43, 86, 96, 104, 58);
  line(t, ghostX + 8, 23, ghostX + 20, 43, 86, 96, 104, 58);

  // Broken real body chunks with open center mass.
  fogEllipse(t, cx, 12, 6, 8, 2111, 210, true);
  fogEllipse(t, cx - 8, 27, 7, 14, 2112, 225, true);
  fogEllipse(t, cx + 8, 29, 7, 16, 2113, 218, true);
  fogEllipse(t, cx - 4, 48, 5, 10, 2114, 190, false);
  fogEllipse(t, cx + 5, 49, 5, 9, 2115, 185, false);

  // Transparent fog holes and horizontal bands through the torso.
  for (let y = 22; y < 44; y += 5) {
    for (let x = cx - 12; x <= cx + 12; x++) {
      if (Math.abs(x - cx) < 5 || noise(x, y, 2120) > 0.56) t[y * S + x] = CLEAR;
      else put(t, x, y, 126, 150, 165, 88);
    }
  }
  for (let y = 25; y < 42; y++) {
    for (let x = cx - 4; x <= cx + 4; x++) {
      if (noise(x, y, 2124) > 0.18) t[y * S + x] = CLEAR;
    }
  }

  // Long blurred forearms sit outside the missing mass.
  line(t, cx - 9, 22, cx - 25, 48, 92, 100, 108, 170);
  line(t, cx - 12, 24, cx - 30, 45, 86, 96, 110, 104);
  line(t, cx + 9, 22, cx + 25, 48, 92, 100, 108, 170);
  line(t, cx + 12, 24, cx + 30, 45, 86, 96, 110, 104);

  // Dense real core: tiny black-red joints the decoy does not have.
  for (const [x, y] of [[cx - 2, 18], [cx + 3, 20], [cx - 6, 33], [cx + 7, 35], [cx - 3, 47], [cx + 4, 47]] as const) {
    put(t, x, y, 18, 10, 12);
    put(t, x + 1, y, 112, 18, 24);
    put(t, x, y + 1, 42, 8, 12);
  }

  return t;
}
