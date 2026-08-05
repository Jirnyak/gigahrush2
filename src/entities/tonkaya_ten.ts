/* ── Tonkaya Ten: cowardly bait-and-retreat shadow ───────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.TONKAYA_TEN,
  name: 'Тонкая Тень',
  hp: 28,
  speed: 2.95,
  dmg: 5,
  attackRate: 1.45,
  sprite: 0,
  aiFlags: ['baitLine'],
  floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.VOID],
  counterplay: 'Не гонитесь за тонкой тенью в темный коридор: держите место, включайте свет или шумите, чтобы она потеряла линию и вернулась слабой.',
  lootHint: 'холодная пыль, узкий темный след, редкий странный сгусток',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function thinLine(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: number): void {
  const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    put(t, x, y, c);
    if ((i & 3) === 0) put(t, x + 1, y, c);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const black = rgba(4, 5, 8);
  const rim = rgba(64, 70, 82, 150);
  const joint = rgba(72, 112, 156, 180);

  // Faint cold outline keeps the needle body readable against dark concrete.
  for (let y = 6; y < 60; y++) {
    const sway = Math.sin(y * 0.21) * 1.4 + (noise(y, 3, 3401) - 0.5) * 1.8;
    const half = y < 16 ? 5 : y < 46 ? 3 : 2;
    put(t, Math.floor(cx - half + sway), y, rim);
    put(t, Math.floor(cx + half + sway), y, rim);
  }

  // Head: almost a vertical chip with high eye slits.
  for (let y = 5; y < 17; y++) {
    const half = y < 9 ? 3 : 4;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const dx = (x - cx) / half;
      const dy = (y - 11) / 7;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, 3402) * 12;
      put(t, x, y, rgba(clamp(5 + n), clamp(6 + n), clamp(10 + n)));
    }
  }
  for (const y of [9, 10]) {
    for (let x = Math.floor(cx - 4); x <= Math.floor(cx - 1); x++) put(t, x, y, rgba(116, 142, 178, 210));
    for (let x = Math.floor(cx + 1); x <= Math.floor(cx + 4); x++) put(t, x, y, rgba(116, 142, 178, 210));
  }

  // Body: 3-5 broken vertical strips, no real torso.
  const strips = [
    { ox: -2, seed: 3411 },
    { ox: 0, seed: 3412 },
    { ox: 2, seed: 3413 },
    { ox: -4, seed: 3414 },
    { ox: 4, seed: 3415 },
  ] as const;
  for (let y = 17; y < 55; y++) {
    const fade = y > 48 ? (56 - y) / 8 : 1;
    for (const strip of strips) {
      if (Math.abs(strip.ox) === 4 && noise(y, strip.ox, strip.seed) < 0.42) continue;
      const x = Math.floor(cx + strip.ox + Math.sin(y * 0.18 + strip.ox) * 0.9);
      const n = noise(x, y, strip.seed) * 15;
      put(t, x, y, rgba(clamp(6 + n), clamp(7 + n), clamp(12 + n), clamp(190 * fade)));
      if (noise(y, x, strip.seed + 7) > 0.7) put(t, x + 1, y, rgba(18, 20, 27, clamp(120 * fade)));
    }
  }

  // Long angular elbows: both arms point away from the center line like a retreat cue.
  thinLine(t, 27, 22, 16, 31, rgba(12, 14, 19, 220));
  thinLine(t, 16, 31, 10, 45, rgba(7, 8, 12, 205));
  thinLine(t, 37, 22, 49, 29, rgba(12, 14, 19, 220));
  thinLine(t, 49, 29, 55, 43, rgba(7, 8, 12, 205));
  for (const [x, y] of [[16, 31], [49, 29], [10, 45], [55, 43]] as const) {
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) put(t, xx, yy, joint);
  }

  // Thread legs and a small blue joint trail.
  for (let y = 50; y < 62; y++) {
    const spread = y - 50;
    put(t, Math.floor(cx - 2 - spread * 0.25), y, black);
    put(t, Math.floor(cx + 2 + spread * 0.25), y, black);
    if ((y & 1) === 0) put(t, Math.floor(cx + Math.sin(y) * 3), y, rgba(58, 86, 124, 135));
  }

  return t;
}
