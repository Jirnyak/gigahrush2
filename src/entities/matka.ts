/* ── Матка — warm-wall crawler, slow spawner ──────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.MATKA,
  name: 'Матка',
  hp: 350,
  speed: 0.4,
  dmg: 12,
  attackRate: 3.5,
  sprite: 0,   // auto-assigned by generateSprites() // will shift others
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Решите сразу: убить матку до нового приплода, расчистить детей или уйти с добычей. Смешанный план быстро делает комнату тесной.',
  lootHint: 'маточный узел, теплая слизь, редкая мясная руна после зачистки приплода',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Massive bloated body — fat crawling woman shape
  for (let y = 8; y < 62; y++) {
    // Wide torso with bloated belly
    const bellyY = (y - 30) / 20;
    const bellyBulge = Math.max(0, 1 - bellyY * bellyY) * 8;
    const halfW = y < 16 ? 6 + (y - 8) * 0.5 :   // head
                  y < 25 ? 10 :                     // shoulders
                  y < 50 ? 12 + bellyBulge :        // bloated torso
                  12 - (y - 50) * 0.8;              // legs dragging
    for (let x = Math.floor(cx - halfW); x < Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 555) * 20;
      // Pale sickly skin with purple veins
      const vein = noise(x * 5, y * 3, 556) > 0.92 ? 40 : 0;
      const stretch = noise(x * 2, y * 7, 557) > 0.95 ? -20 : 0; // stretch marks
      const r = clamp(160 + n + stretch - vein * 0.5);
      const g = clamp(120 + n + stretch - vein);
      const b = clamp(130 + n + stretch + vein);
      t[y * S + x] = rgba(r, g, b);
    }
  }

  // Face — sunken eyes, open mouth
  // Eyes: dark hollow sockets
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -2; dx <= 0; dx++) t[(13 + dy) * S + (cx - 4 + dx)] = rgba(15, 5, 10);
    for (let dx = 0; dx <= 2; dx++) t[(13 + dy) * S + (cx + 3 + dx)] = rgba(15, 5, 10);
  }
  // Glowing pupils
  t[13 * S + (cx - 4)] = rgba(180, 40, 40);
  t[13 * S + (cx + 4)] = rgba(180, 40, 40);

  // Open screaming mouth
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      t[(17 + dy) * S + (cx + dx)] = rgba(60, 10, 15);
    }
  }

  // Stringy hair
  for (let i = 0; i < 8; i++) {
    const hx = cx - 6 + Math.floor(noise(i, 0, 558) * 12);
    for (let hy = 4; hy < 22; hy++) {
      if (noise(hx, hy, 559 + i) > 0.3) {
        const idx = hy * S + clamp(hx);
        if (hx >= 0 && hx < S) t[idx] = rgba(30, 20, 15);
      }
    }
  }

  // Crawling arms reaching forward
  for (let ax = 0; ax < 18; ax++) {
    const ly = 44 + Math.floor(Math.sin(ax * 0.3) * 2);
    const ry = 44 + Math.floor(Math.cos(ax * 0.3) * 2);
    if (cx - 14 + ax >= 0 && cx - 14 + ax < S && ly < S) {
      t[ly * S + (cx - 14 + ax)] = rgba(145, 110, 115);
    }
    if (cx + 14 - ax >= 0 && cx + 14 - ax < S && ry < S) {
      t[ry * S + (cx + 14 - ax)] = rgba(145, 110, 115);
    }
  }

  // Dragging legs/trail behind
  for (let y = 52; y < 62; y++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = cx + dx + Math.floor(noise(dx, y, 560) * 3 - 1);
      if (x >= 0 && x < S) {
        const n = noise(x, y, 561) * 15;
        t[y * S + x] = rgba(clamp(130 + n), clamp(90 + n), clamp(95 + n));
      }
    }
  }

  return t;
}
