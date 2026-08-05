/* ── Lishennyy: deep light-following shadow guardian ------------ */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.LISHENNYY,
  name: 'Лишенный',
  hp: 76,
  speed: 1.72,
  dmg: 11,
  attackRate: 1.05,
  sprite: 0,
  aiFlags: ['lightFollower'],
  floors: [FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Свет ведет Лишенного к вам: бросайте фонарь или свечу как приманку, выключайте луч перед поворотом и не держите контакт.',
  lootHint: 'пепельная пыль, черный след, редкий странный сгусток',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: number): void {
  const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    put(t, x, y, c);
  }
}

function eatEdge(x: number, y: number, seed: number): boolean {
  return noise(x * 2, y * 3, seed) > 0.78 || noise(x, y, seed + 19) < 0.08;
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 31;

  for (let y = 7; y < 61; y++) {
    const bodyTaper = y < 16 ? (y - 5) / 11 : y > 49 ? (62 - y) / 13 : 1;
    const half = Math.max(2.2, (y < 19 ? 7.8 : y < 45 ? 9.6 : 6.2) * bodyTaper);
    const sway = Math.sin(y * 0.13 + 2.1) * 1.4 + (noise(y, 0, 12_700) - 0.5) * 2.4;
    for (let x = Math.floor(cx + sway - half); x <= Math.ceil(cx + sway + half); x++) {
      const edge = Math.abs(x - (cx + sway)) / half;
      if (edge > 1) continue;
      if (edge > 0.72 && eatEdge(x, y, 12_710)) continue;
      if (edge < 0.24 && y > 19 && y < 48 && noise(x, y, 12_720) > 0.88) continue;
      const ash = edge > 0.68 || noise(x, y, 12_730) > 0.84;
      const n = noise(x, y, 12_740) * 18 - 7;
      const r = ash ? 42 : 1;
      const g = ash ? 45 : 2;
      const b = ash ? 48 : 4;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n), clamp(238 - edge * 90 + noise(x, y, 12_750) * 34)));
    }
  }

  // Stretched arms hang toward the light rather than posing as a fast shadow.
  line(t, 22, 23, 8, 41, rgba(2, 3, 5, 224));
  line(t, 8, 41, 4, 55, rgba(44, 44, 42, 130));
  line(t, 41, 24, 55, 39, rgba(3, 4, 6, 216));
  line(t, 55, 39, 59, 53, rgba(48, 48, 45, 124));
  line(t, 18, 26, 12, 47, rgba(28, 29, 32, 150));
  line(t, 45, 27, 52, 46, rgba(24, 25, 28, 145));

  // One edge catches reflected light; the core remains an absence.
  for (let y = 12; y < 57; y++) {
    const x = Math.floor(cx + 9 + Math.sin(y * 0.21) * 1.8);
    if (noise(x, y, 12_800) > 0.28) put(t, x, y, rgba(96, 96, 92, 138));
  }

  for (let i = 0; i < 95; i++) {
    const y = 36 + Math.floor(noise(i, 5, 12_900) * 28);
    const x = 12 + Math.floor(noise(i, 9, 12_901) * 40);
    const a = 52 + Math.floor(noise(i, 13, 12_902) * 70);
    put(t, x, y, rgba(72, 72, 68, a));
  }

  return t;
}
