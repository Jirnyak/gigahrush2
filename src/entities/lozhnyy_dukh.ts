/* ── Ложный Дух — local door phaser ─────────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.LOZHNYY_DUKH,
  name: 'Ложный Дух',
  hp: 34,
  speed: 2.25,
  dmg: 9,
  attackRate: 1.65,
  sprite: 0,
  aiFlags: ['falsePhase'],
  floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.VOID],
  counterplay: 'Холодный сквозняк предупреждает один проход через закрытую дверь: выходите в открытое место или сбивайте фазу точным выстрелом/УФ.',
  lootHint: 'пустая записка, холодный сквозняк, редкая ПСИ-пыль из второго лица',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Vertical translucent body, offset like it is leaning through a doorframe.
  for (let y = 8; y < 62; y++) {
    const drift = Math.sin(y * 0.15) * 1.5 - 2.5;
    const half = y < 18 ? 8 : y < 42 ? 12 : 7;
    const fade = y > 48 ? (62 - y) / 14 : 1;
    for (let x = Math.floor(cx + drift - half); x <= Math.floor(cx + drift + half); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - (cx + drift)) / half;
      const dy = (y - 34) / 27;
      const r2 = dx * dx + dy * dy * 0.72 + noise(x * 2, y * 2, 4040) * 0.18;
      if (r2 > 1) continue;

      const edge = Math.max(0, 1 - r2);
      const doorGap =
        (x > cx + drift + half - 3 && y > 20 && y < 35) ||
        (x < cx + drift - half + 3 && y > 38 && y < 52) ||
        (Math.abs(y - 25) <= 1 && x > cx + drift - 9 && x < cx + drift + 7);
      if (doorGap && noise(x, y, 4041) > 0.18) continue;

      const a = clamp(Math.floor((34 + edge * 96 + noise(x, y, 4042) * 28) * fade));
      const cold = noise(x * 3, y, 4043) * 18;
      t[y * S + x] = rgba(clamp(154 + cold), clamp(184 + cold), clamp(210 + cold), a);
    }
  }

  // Side-profile head with a black mouth void.
  const hx = cx - 6;
  const hy = 14;
  for (let y = 3; y < 24; y++) {
    for (let x = 11; x < 37; x++) {
      const dx = (x - hx) / 8.5;
      const dy = (y - hy) / 10;
      const nose = x < hx - 6 && y > hy - 2 && y < hy + 3 ? -0.34 : 0;
      if (dx * dx + dy * dy + nose > 1) continue;
      const n = noise(x, y, 4050) * 24;
      t[y * S + x] = rgba(clamp(206 + n), clamp(222 + n), clamp(232 + n), 184);
    }
  }
  for (let y = 10; y < 15; y++) for (let x = 20; x < 25; x++) {
    const dx = (x - 22) / 2.3;
    const dy = (y - 12) / 2.8;
    if (dx * dx + dy * dy < 1) t[y * S + x] = rgba(8, 10, 18, 235);
  }
  for (let y = 16; y < 20; y++) for (let x = 13; x < 24; x++) {
    const dx = (x - 18) / 5.5;
    const dy = (y - 18) / 2.4;
    if (dx * dx + dy * dy < 1) t[y * S + x] = rgba(3, 4, 8, 245);
  }

  // False face inside the chest.
  const fx = cx + 2;
  const fy = 34;
  for (let y = 26; y < 43; y++) {
    for (let x = 22; x < 43; x++) {
      const dx = (x - fx) / 8;
      const dy = (y - fy) / 9;
      if (dx * dx + dy * dy > 1) continue;
      const inner = 1 - (dx * dx + dy * dy);
      t[y * S + x] = rgba(clamp(118 + inner * 70), clamp(150 + inner * 74), clamp(180 + inner * 64), 120 + Math.floor(inner * 85));
    }
  }
  for (const ex of [fx - 3, fx + 3]) {
    t[(fy - 2) * S + ex] = rgba(0, 0, 0, 220);
    t[(fy - 1) * S + ex] = rgba(20, 24, 32, 190);
  }
  for (let x = fx - 5; x <= fx + 5; x++) {
    if (x < 0 || x >= S) continue;
    t[(fy + 4) * S + x] = rgba(2, 3, 8, 230);
  }

  // Pale edge strokes make the door/wall lean readable in motion.
  for (let y = 18; y < 50; y += 3) {
    const x = Math.floor(cx - 16 + noise(y, 0, 4060) * 3);
    if (x >= 0 && x < S) t[y * S + x] = rgba(220, 238, 245, 96);
  }

  return t;
}
