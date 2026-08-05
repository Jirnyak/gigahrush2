/* ── Kostorez: readable melee elite with blade windup ─────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.KOSTOREZ,
  name: 'Косторез',
  hp: 150,
  speed: 1.55,
  dmg: 17,
  attackRate: 2.8,
  sprite: 0,
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Не стойте в замахе: три шага, угол или колонна срывают рывок; дробь сбивает пилы, бронелист принимает один рез.',
  lootHint: 'резаный металл, бронелист, обломок арматуры',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Long dark body with a narrow red core: taller than normal humanoids.
  for (let y = 7; y < 59; y++) {
    const sway = Math.sin(y * 0.13) * 2;
    const halfW = y < 18 ? 4 : y < 45 ? 6 : 5;
    for (let x = Math.floor(cx - halfW + sway); x <= Math.ceil(cx + halfW + sway); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 11200) * 20;
      const rib = Math.abs(x - (cx + sway)) < 1.2;
      t[y * S + x] = rib
        ? rgba(105, 22, 20)
        : rgba(clamp(58 + n), clamp(54 + n), clamp(50 + n));
    }
  }

  // Bone-saw forearms: the readable silhouette is two raised cutting bars.
  for (let y = 9; y < 45; y++) {
    const leftX = Math.floor(cx - 12 + Math.sin(y * 0.22) * 2);
    const rightX = Math.floor(cx + 11 - Math.sin(y * 0.19) * 2);
    for (let w = 0; w < 2; w++) {
      const l = leftX + w;
      const r = rightX + w;
      const n = noise(y, w, 11210) * 28;
      if (l >= 0 && l < S) t[y * S + l] = rgba(clamp(170 + n), clamp(168 + n), clamp(154 + n));
      if (r >= 0 && r < S) t[y * S + r] = rgba(clamp(180 + n), clamp(176 + n), clamp(158 + n));
    }
    if (y % 5 === 0) {
      const toothL = leftX - 2;
      const toothR = rightX + 3;
      if (toothL >= 0 && toothL < S) t[y * S + toothL] = rgba(225, 218, 188);
      if (toothR >= 0 && toothR < S) t[y * S + toothR] = rgba(235, 225, 190);
    }
  }

  // Shoulder plates and cut-mask face.
  for (let y = 14; y < 21; y++) {
    for (let x = Math.floor(cx - 10); x <= Math.ceil(cx + 10); x++) {
      if (x < 0 || x >= S) continue;
      if (Math.abs(x - cx) < 3) continue;
      const n = noise(x, y, 11220) * 18;
      t[y * S + x] = rgba(clamp(92 + n), clamp(88 + n), clamp(76 + n));
    }
  }

  t[13 * S + (cx - 3)] = rgba(250, 38, 24);
  t[13 * S + (cx + 3)] = rgba(250, 38, 24);
  t[14 * S + (cx - 3)] = rgba(160, 18, 18);
  t[14 * S + (cx + 3)] = rgba(160, 18, 18);

  // Fresh cuts across the torso.
  for (let i = 0; i < 5; i++) {
    const y = 24 + i * 5;
    for (let dx = -5; dx <= 5; dx++) {
      const x = Math.floor(cx + dx + i - 2);
      if (x >= 0 && x < S && y + dx >= 0 && y + dx < S) {
        t[(y + dx) * S + x] = rgba(150, 28, 26);
      }
    }
  }

  return t;
}
