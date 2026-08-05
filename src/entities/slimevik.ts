/* ── Slimevik — neutral slime scavenger/symbiote ─────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SLIMEVIK,
  name: 'Слизневик',
  hp: 18,
  speed: 1.05,
  dmg: 2,
  attackRate: 1.8,
  sprite: 0,
  aiFlags: ['slimeScavenger'],
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Не давите вплотную без фильтра и тары: слизневик не охотится первым, но долгий контакт сушит ПСИ, а раненый бьет слабой кислотной плетью.',
  lootHint: 'слизистый соскоб, грязная проба, редкий фильтрующий слой',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 18; y < 52; y++) {
    const lean = Math.sin(y * 0.25) * 2.2;
    const half = y < 29 ? 5.5 : 7.5 - (y - 29) * 0.04;
    for (let x = Math.floor(cx - half + lean); x <= Math.ceil(cx + half + lean); x++) {
      const dx = (x - cx - lean) / Math.max(1, half);
      const dy = (y - 34) / 19;
      if (dx * dx + dy * dy > 1.05) continue;
      const n = noise(x * 2, y * 2, 910) * 24;
      t[y * S + x] = rgba(clamp(28 + n), clamp(31 + n), clamp(34 + n));
    }
  }

  for (let y = 14; y < 47; y++) {
    const sacCx = cx + 6 + Math.sin(y * 0.18) * 1.5;
    const rx = 11 + Math.sin(y * 0.31) * 1.3;
    const ry = 19;
    for (let x = Math.floor(sacCx - rx); x <= Math.ceil(sacCx + rx); x++) {
      const dx = (x - sacCx) / rx;
      const dy = (y - 29) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const gloss = Math.max(0, 1 - d);
      const n = noise(x, y, 921);
      const a = clamp(105 + gloss * 80 + n * 38);
      t[y * S + x] = rgba(clamp(18 + n * 36), clamp(78 + gloss * 72 + n * 26), clamp(86 + gloss * 96 + n * 32), a);
    }
  }

  for (let i = 0; i < 18; i++) {
    const x = 24 + Math.floor(noise(i, 4, 933) * 22);
    const y = 18 + Math.floor(noise(i, 8, 934) * 23);
    const c = i % 3 === 0 ? [166, 235, 205] : i % 3 === 1 ? [72, 210, 72] : [182, 176, 230];
    t[y * S + x] = rgba(c[0], c[1], c[2], 210);
    if (x + 1 < S) t[y * S + x + 1] = rgba(c[0], c[1], c[2], 120);
  }

  for (let i = 0; i < 7; i++) {
    const x0 = Math.floor(cx + 2 + noise(i, 1, 941) * 13);
    const y0 = 38 + Math.floor(noise(i, 2, 942) * 10);
    const len = 9 + Math.floor(noise(i, 3, 943) * 9);
    const side = i % 2 === 0 ? -1 : 1;
    for (let j = 0; j < len; j++) {
      const x = x0 + side * Math.floor(j * (0.35 + noise(i, j, 944) * 0.35));
      const y = y0 + j;
      if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = rgba(36, 138, 126, clamp(210 - j * 7));
    }
  }

  t[23 * S + 29] = rgba(230, 238, 205);
  t[23 * S + 30] = rgba(38, 26, 18);
  t[24 * S + 29] = rgba(130, 210, 178);

  for (let y = 50; y < 59; y++) {
    const lx = Math.floor(cx - 5 - (y - 50) * 0.35);
    const rx = Math.floor(cx + 2 + (y - 50) * 0.25);
    if (lx >= 0) t[y * S + lx] = rgba(24, 28, 30);
    if (rx < S) t[y * S + rx] = rgba(26, 72, 68, 210);
  }

  return t;
}
