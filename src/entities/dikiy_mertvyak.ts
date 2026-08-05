/* ── Dikiy Mertvyak: fragile crowd-runner ────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.DIKIY_MERTVYAK,
  name: 'Дикий Мертвяк',
  hp: 22,
  speed: 2.55,
  dmg: 7,
  attackRate: 1.05,
  sprite: 0,
  aiFlags: ['crowdShove'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
  counterplay: 'Хрупкий, но влетает в дверную толпу: бейте до разгона, отходите в широкий проход и не принимайте бой в дверной каше.',
  lootHint: 'рваная одежда, белые костяшки, мелкий бытовой хлам',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Forward-lean sprint silhouette: head and ribs are shifted into the run.
  for (let y = 6; y < 18; y++) {
    const lean = -4 + (y - 6) * 0.12;
    for (let x = Math.floor(cx - 6 + lean); x <= Math.ceil(cx + 5 + lean); x++) {
      const dx = (x - cx - lean) / 5.4;
      const dy = (y - 12) / 6.6;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, 2727) * 18;
      t[y * S + x] = rgba(clamp(142 + n), clamp(150 + n), clamp(132 + n));
    }
  }

  for (let y = 18; y < 43; y++) {
    const lean = -6 + (y - 18) * 0.28;
    const half = 6.5 + Math.sin(y * 0.31) * 1.4;
    for (let x = Math.floor(cx - half + lean); x <= Math.ceil(cx + half + lean); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx - lean) / half;
      if (dx * dx > 1.15) continue;
      const rag = noise(x * 2, y * 2, 2728);
      const n = noise(x, y, 2729) * 22;
      t[y * S + x] = rag > 0.34
        ? rgba(clamp(34 + n), clamp(38 + n), clamp(46 + n))
        : rgba(clamp(124 + n), clamp(132 + n), clamp(116 + n));
    }
  }

  // Extended elbows and pale knuckles.
  for (let y = 20; y < 45; y++) {
    const ldx = -10 - Math.floor((y - 20) * 0.08);
    const rdx = 7 + Math.floor((y - 20) * 0.42);
    const lx = Math.floor(cx + ldx);
    const rx = Math.floor(cx + rdx);
    if (lx >= 0) t[y * S + lx] = rgba(118, 126, 112);
    if (rx < S) t[y * S + rx] = rgba(122, 130, 116);
    if (y > 36 && rx + 1 < S) {
      t[y * S + rx] = rgba(222, 226, 206);
      t[y * S + rx + 1] = rgba(226, 228, 210);
    }
  }

  // Torn jaw and dead eyes.
  t[11 * S + (cx - 6)] = rgba(238, 238, 220);
  t[11 * S + (cx - 2)] = rgba(238, 238, 220);
  for (let x = cx - 8; x <= cx - 1; x++) {
    t[15 * S + x] = rgba(64, 20, 20);
    if ((x & 1) === 0) t[16 * S + x] = rgba(210, 208, 188);
  }

  // Running legs: one planted, one blurred back.
  for (let y = 42; y < 59; y++) {
    const run = y - 42;
    const lx = Math.floor(cx - 5 - run * 0.42);
    const rx = Math.floor(cx + 2 + run * 0.22);
    if (lx >= 0) t[y * S + lx] = rgba(38, 40, 42);
    if (lx + 1 >= 0 && lx + 1 < S && (y & 1) === 0) t[y * S + lx + 1] = rgba(56, 58, 60, 160);
    if (rx < S) t[y * S + rx] = rgba(42, 42, 45);
  }
  for (let x = 19; x < 32; x++) {
    const a = 70 + Math.floor(noise(x, 58, 2730) * 70);
    t[58 * S + x] = rgba(190, 196, 182, a);
  }

  // Bright scrape wounds on knees, hands, and forearms.
  for (let i = 0; i < 4; i++) {
    const sx = 21 + Math.floor(noise(i, 1, 2731) * 25);
    const sy = 31 + Math.floor(noise(i, 2, 2732) * 22);
    for (let j = 0; j < 4; j++) {
      const x = sx + j;
      const y = sy + Math.floor(j * 0.45);
      if (x >= 0 && x < S && y >= 0 && y < S && t[y * S + x] !== CLEAR) {
        t[y * S + x] = rgba(214, 72, 54);
      }
    }
  }

  return t;
}
