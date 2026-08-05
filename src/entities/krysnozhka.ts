/* ── Krysnozhka: small food-garbage swarm threat ─────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.KRYSNOZHKA,
  name: 'Крысоножка',
  hp: 14,
  speed: 2.45,
  dmg: 3,
  attackRate: 0.65,
  sprite: 0,
  aiFlags: ['foodBait'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Сбивайте первый рывок дробью, бросайте помеченную приманку дальше себя и держите запас еды в закрытом контейнере.',
  lootHint: 'мелкие лапки, грязный жир, мусор гнезда, редкое сырое мясо',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 22; y < 48; y++) {
    const dy = (y - 35) / 13;
    const halfW = 7 + Math.sin(y * 0.5) * 2;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / 9;
      if (dx * dx + dy * dy > 1.05) continue;
      const n = noise(x, y, 9111) * 24;
      t[y * S + x] = rgba(clamp(64 + n), clamp(43 + n), clamp(34 + n));
    }
  }

  for (let y = 27; y < 49; y += 4) {
    const lean = Math.sin(y * 0.55) * 2;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 9; i++) {
        const x = Math.floor(cx + side * (7 + i) + lean);
        const yy = y + Math.floor(i * 0.35);
        if (x >= 0 && x < S && yy >= 0 && yy < S) t[yy * S + x] = rgba(70, 52, 35);
      }
    }
  }

  for (let y = 14; y < 27; y++) {
    const halfW = 4 + Math.sin(y * 0.8);
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 9112) * 18;
      t[y * S + x] = rgba(clamp(74 + n), clamp(47 + n), clamp(38 + n));
    }
  }

  t[18 * S + (cx - 2)] = rgba(255, 178, 60);
  t[18 * S + (cx + 2)] = rgba(255, 178, 60);
  t[19 * S + (cx - 2)] = rgba(220, 70, 38);
  t[19 * S + (cx + 2)] = rgba(220, 70, 38);

  return t;
}
