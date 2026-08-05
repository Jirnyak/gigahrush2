/* ── Betonnik — massive concrete golem ────────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.BETONNIK,
  name: 'Бетонник',
  hp: 1000,
  speed: 0.8,
  dmg: 35,
  attackRate: 3.0,
  sprite: 0,   // auto-assigned by generateSprites()
  floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Не меняйтесь ударами в прямом коридоре: углы, запас выносливости, шум, огонь или запечатанный слабый проем дают окно уйти.',
  lootHint: 'арматурная крошка, бетонные осколки, редкий теплый бетонный сгусток',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  // Massive blocky body
  for (let y = 4; y < 60; y++) {
    const halfW = y < 15 ? 8 : y < 45 ? 14 : 10;
    for (let x = cx - halfW; x < cx + halfW; x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 777) * 25;
      const crack = noise(x * 3, y * 3, 778) > 0.9 ? -30 : 0;
      t[y * S + x] = rgba(clamp(110 + n + crack), clamp(108 + n + crack), clamp(105 + n + crack));
    }
  }
  // Dark eye slits
  for (let x = cx - 4; x < cx - 1; x++) t[10 * S + x] = rgba(20, 10, 10);
  for (let x = cx + 1; x < cx + 4; x++) t[10 * S + x] = rgba(20, 10, 10);
  // Heavy shoulder slab and broken feet keep the silhouette slow and readable.
  for (let y = 15; y < 24; y++) {
    for (let x = cx - 18; x <= cx + 18; x++) {
      if (x < 0 || x >= S) continue;
      const chip = noise(x * 2, y * 2, 779) > 0.86 ? -26 : 0;
      const n = noise(x, y, 780) * 18;
      t[y * S + x] = rgba(clamp(96 + n + chip), clamp(95 + n + chip), clamp(90 + n + chip));
    }
  }
  for (let y = 55; y < 63; y++) {
    const step = y - 55;
    for (let x = cx - 16 + step; x <= cx - 3; x++) {
      if (x >= 0 && x < S) t[y * S + x] = rgba(88, 86, 82);
    }
    for (let x = cx + 3; x <= cx + 16 - step; x++) {
      if (x >= 0 && x < S) t[y * S + x] = rgba(92, 88, 82);
    }
  }
  // Rebar sticking out
  for (let y = 20; y < 40; y++) {
    t[y * S + (cx - 14)] = rgba(80, 50, 30);
    t[y * S + (cx + 14)] = rgba(80, 50, 30);
  }
  return t;
}
