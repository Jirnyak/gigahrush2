/* ── Tube eel: maintenance water ambusher ────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.TUBE_EEL,
  name: 'Трубный угорь',
  hp: 60,
  speed: 1.45,
  dmg: 14,
  attackRate: 1.35,
  sprite: 0,
  aiFlags: ['waterStrider'],
  floors: [FloorLevel.MAINTENANCE],
  counterplay: 'Не стойте в лотке: сухая кромка и мост режут темп угря, гарпун достает через воду, а приманка уводит с маршрута.',
  lootHint: 'ржавая слизь, манометр, обломок трубы из затопленного лотка',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 5; y < 60; y++) {
    const wave = Math.sin(y * 0.23) * 7;
    const halfW = 4 + Math.sin(y * 0.11) * 1.5;
    for (let x = Math.floor(cx + wave - halfW); x <= Math.ceil(cx + wave + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 8400) * 22;
      t[y * S + x] = rgba(clamp(35 + n), clamp(95 + n), clamp(105 + n));
    }
  }

  for (let y = 18; y < 54; y += 6) {
    const wave = Math.floor(Math.sin(y * 0.23) * 7);
    for (let dx = -7; dx <= 7; dx++) {
      const px = cx + wave + dx;
      if (px >= 0 && px < S) t[y * S + px] = rgba(45, 55, 58);
    }
  }

  t[11 * S + (cx - 2)] = rgba(240, 240, 180);
  t[12 * S + (cx + 2)] = rgba(240, 240, 180);
  return t;
}
