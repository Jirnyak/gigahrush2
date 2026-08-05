/* ── Shovnik: seam hunter, stronger near walls ───────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SHOVNIK,
  name: 'Шовник',
  hp: 45,
  speed: 2.1,
  dmg: 11,
  attackRate: 1.1,
  sprite: 0,
  aiFlags: ['wallBias'],
  floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY, FloorLevel.MINISTRY],
  counterplay: 'Тяните в центр комнаты: у стены и шва шовник ускоряется и бьет больнее, без кромки теряет ход.',
  lootHint: 'резиновая крошка, герметичный мусор, редкий уплотнитель',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 6; y < 60; y++) {
    const lean = Math.sin(y * 0.17) * 3;
    const halfW = y < 18 ? 4 : y < 46 ? 7 : 5;
    for (let x = Math.floor(cx - halfW + lean); x <= Math.ceil(cx + halfW + lean); x++) {
      if (x < 0 || x >= S) continue;
      const seam = Math.abs(x - (cx + lean)) < 1.4;
      const n = noise(x, y, 8100) * 25;
      t[y * S + x] = seam
        ? rgba(35, 25, 28)
        : rgba(clamp(105 + n), clamp(100 + n), clamp(92 + n));
    }
  }

  for (let y = 14; y < 54; y += 5) {
    const off = Math.floor(Math.sin(y * 0.3) * 3);
    for (let dx = -12; dx <= 12; dx++) {
      if (Math.abs(dx) % 4 !== 0) continue;
      const px = cx + off + dx;
      if (px >= 0 && px < S) t[y * S + px] = rgba(35, 28, 25);
    }
  }

  t[16 * S + (cx - 3)] = rgba(240, 190, 70);
  t[16 * S + (cx + 3)] = rgba(240, 190, 70);
  return t;
}
