/* ── Pseudolift: rare route-choice lift mimic ────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.PSEUDOLIFT,
  name: 'Псевдолифт',
  hp: 125,
  speed: 0.55,
  dmg: 24,
  attackRate: 0.78,
  sprite: 0,
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Читайте табло, мокрый порог и неверный металл: осмотрите кабину, бросьте приманку или сразу отступайте из лифтового тамбура.',
  lootHint: 'кабельный язык, мокрая табличка этажа, редкая живая реле-пластина',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 8; y < 59; y++) {
    const edge = y < 12 || y > 55;
    for (let x = 12; x < 52; x++) {
      const side = x < 16 || x > 47;
      if (!edge && !side) continue;
      const n = noise(x, y, 7100) * 32;
      t[y * S + x] = rgba(clamp(74 + n), clamp(77 + n), clamp(72 + n));
    }
  }

  for (let y = 13; y < 55; y++) {
    const open = 7 + Math.sin(y * 0.31) * 1.5;
    for (let x = Math.floor(cx - open); x <= Math.ceil(cx + open); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 7101);
      const gum = Math.abs(x - cx) > open - 2;
      t[y * S + x] = gum
        ? rgba(90 + n * 42, 18 + n * 18, 22 + n * 20)
        : rgba(5 + n * 10, 4 + n * 8, 5 + n * 9);
    }
  }

  for (let x = 17; x <= 47; x += 5) {
    const tilt = Math.floor((noise(x, 17, 7102) - 0.5) * 4);
    for (let y = 14; y < 56; y++) {
      const px = x + Math.floor(Math.sin(y * 0.2 + x) * 1.2) + tilt;
      if (px >= 0 && px < S) t[y * S + px] = rgba(118, 116, 102);
    }
  }

  for (let i = 0; i < 7; i++) {
    const rootX = cx + (i - 3) * 3;
    for (let y = 28; y < 62; y++) {
      const wave = Math.sin(y * 0.28 + i) * (2 + i % 3);
      const x = Math.floor(rootX + wave);
      if (x >= 2 && x < S - 2) t[y * S + x] = rgba(42, 30, 30);
    }
  }

  for (let y = 10; y < 16; y++) {
    for (let x = 36; x < 48; x++) {
      const lit = noise(x, y, 7103) > 0.32;
      t[y * S + x] = lit ? rgba(210, 174, 50) : rgba(54, 44, 24);
    }
  }
  t[12 * S + 39] = rgba(252, 210, 78);
  t[12 * S + 44] = rgba(252, 210, 78);

  for (let y = 50; y < 58; y++) {
    for (let x = 18; x < 47; x++) {
      if (noise(x, y, 7104) < 0.58) continue;
      t[y * S + x] = rgba(112, 18, 21, 210);
    }
  }

  return t;
}
