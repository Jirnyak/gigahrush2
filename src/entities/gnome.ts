/* ── Gnome: small fast humanoid mutant ─────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.GNOME,
  name: 'Гном',
  hp: 25,
  speed: 2.8,
  dmg: 8,
  attackRate: 0.8,
  sprite: 0,
  aiFlags: ['melee' as any], // We use 'as any' since 'melee' is not in MonsterAIFlag type yet
  floors: [FloorLevel.MAINTENANCE, FloorLevel.KVARTIRY, FloorLevel.LIVING],
  counterplay: 'Маленький и быстрый — дробь или ближний бой.',
  lootHint: 'мелкие детали, гайки, провода, иногда алмаз',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Small humanoid mutant, ~30px high -> let's say from y=34 to y=64
  // We'll draw head, body, arms, legs in grey-brown colors with small eyes.

  // Body (grey-brown)
  for (let y = 42; y < 56; y++) {
    const halfW = 5 + Math.sin(y * 0.4) * 2;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 9211) * 20;
      t[y * S + x] = rgba(clamp(80 + n), clamp(70 + n), clamp(60 + n));
    }
  }

  // Head (grey-brown, small)
  for (let y = 34; y < 43; y++) {
    const halfW = 4 + Math.sin(y * 0.8) * 1.5;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 9212) * 15;
      t[y * S + x] = rgba(clamp(90 + n), clamp(75 + n), clamp(65 + n));
    }
  }

  // Eyes (small, glowing/beady)
  t[38 * S + Math.floor(cx - 2)] = rgba(20, 20, 20); // Dark sockets
  t[38 * S + Math.floor(cx + 2)] = rgba(20, 20, 20);
  t[38 * S + Math.floor(cx - 2)] = rgba(255, 200, 50); // Beady eyes
  t[38 * S + Math.floor(cx + 2)] = rgba(255, 200, 50);

  // Arms
  for (let y = 43; y < 52; y++) {
    // Left arm
    let xL = Math.floor(cx - 6 - (y - 43) * 0.3);
    if (xL >= 0 && xL < S) t[y * S + xL] = rgba(75, 65, 55);
    if (xL - 1 >= 0 && xL - 1 < S) t[y * S + xL - 1] = rgba(75, 65, 55);

    // Right arm
    let xR = Math.floor(cx + 6 + (y - 43) * 0.3);
    if (xR >= 0 && xR < S) t[y * S + xR] = rgba(75, 65, 55);
    if (xR + 1 >= 0 && xR + 1 < S) t[y * S + xR + 1] = rgba(75, 65, 55);
  }

  // Sack on back (left side)
  for (let y = 38; y < 55; y++) {
    const halfW = 6 + Math.sin(y * 0.5) * 3;
    for (let x = Math.floor(cx - 10 - halfW); x <= Math.ceil(cx - 4); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 9213) * 15;
      t[y * S + x] = rgba(clamp(50 + n), clamp(40 + n), clamp(30 + n));
    }
  }

  // Giant rebar in right hand
  for (let y = 20; y < 60; y++) {
    let xR = Math.floor(cx + 8 + (y - 43) * 0.1);
    if (xR >= 0 && xR < S - 2) {
      t[y * S + xR] = rgba(100, 100, 100);
      t[y * S + xR + 1] = rgba(80, 80, 80);
      t[y * S + xR + 2] = rgba(60, 60, 60);
    }
  }

  // Legs (running stance/bent)
  for (let y = 55; y < 63; y++) {
    // Left leg
    let xL = Math.floor(cx - 3 - (y - 55) * 0.4);
    if (xL >= 0 && xL < S) t[y * S + xL] = rgba(65, 55, 45);
    if (xL - 1 >= 0 && xL - 1 < S) t[y * S + xL - 1] = rgba(65, 55, 45);
    if (xL - 2 >= 0 && xL - 2 < S) t[y * S + xL - 2] = rgba(65, 55, 45);

    // Right leg
    let xR = Math.floor(cx + 3 + (y - 55) * 0.4);
    if (xR >= 0 && xR < S) t[y * S + xR] = rgba(65, 55, 45);
    if (xR + 1 >= 0 && xR + 1 < S) t[y * S + xR + 1] = rgba(65, 55, 45);
    if (xR + 2 >= 0 && xR + 2 < S) t[y * S + xR + 2] = rgba(65, 55, 45);
  }

  return t;
}
