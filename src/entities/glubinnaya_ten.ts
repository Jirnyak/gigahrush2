/* -- Glubinnaya Ten: delayed second-beat deep shadow ------------- */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.GLUBINNAYA_TEN,
  name: 'Глубинная Тень',
  hp: 64,
  speed: 1.82,
  dmg: 18,
  attackRate: 1.7,
  sprite: 0,
  aiFlags: ['secondBeat'],
  floors: [FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Не догоняйте первый силуэт в темноту: стойте на месте, держите светлый выход за спиной или вскройте настоящее тело фонарем до второго удара.',
  lootHint: 'холодная пыль, темный след, редкий странный сгусток из второго силуэта',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function strip(
  t: Uint32Array,
  cx: number,
  y0: number,
  y1: number,
  half: number,
  seed: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  for (let y = y0; y <= y1; y++) {
    const sway = Math.sin(y * 0.18 + seed) * 1.4 + (noise(y, seed, 33_100) - 0.5) * 2.2;
    const taper = y < 17 ? 0.55 : y > 50 ? Math.max(0.2, (61 - y) / 11) : 1;
    const hw = Math.max(1, half * taper);
    for (let x = Math.floor(cx + sway - hw); x <= Math.ceil(cx + sway + hw); x++) {
      const edge = Math.abs(x - (cx + sway)) / hw;
      if (edge > 1) continue;
      if (noise(x, y, seed + 17) > 0.88 && y > 18 && y < 48) continue;
      const n = noise(x, y, seed) * 20 - 6;
      const a = clamp(alpha * (1 - edge * 0.34) + noise(x, y, seed + 41) * 22);
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n), a));
    }
  }
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, c: number): void {
  const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    put(t, x, y, c);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2 - 2;
  const afterX = cx + 10;

  // Lagging second torso: thinner, lower alpha, and slightly lower than the real body.
  strip(t, afterX, 12, 58, 4.1, 33_201, 28, 38, 52, 72);
  strip(t, afterX - 3, 20, 55, 1.2, 33_202, 38, 52, 70, 48);
  strip(t, afterX + 4, 22, 57, 1.1, 33_203, 42, 56, 74, 42);
  for (let y = 22; y < 50; y += 6) {
    for (let x = Math.floor(afterX - 5); x <= Math.floor(afterX + 5); x++) {
      if (noise(x, y, 33_204) > 0.4) t[y * S + x] = CLEAR;
    }
  }

  // Main head and torso are broken negative-space strips, not a solid black column.
  strip(t, cx, 5, 18, 5.8, 33_211, 4, 6, 9, 245);
  strip(t, cx - 5, 18, 55, 2.2, 33_212, 3, 4, 7, 235);
  strip(t, cx, 16, 58, 3.4, 33_213, 5, 7, 10, 250);
  strip(t, cx + 5, 19, 54, 2.0, 33_214, 4, 6, 9, 230);
  strip(t, cx - 1, 25, 62, 1.1, 33_215, 18, 28, 42, 150);

  // Blue-gray edge flashes keep the real silhouette readable in black rooms.
  for (let y = 7; y < 60; y++) {
    const half = y < 17 ? 7 : y < 49 ? 10 : 5;
    const sway = Math.sin(y * 0.16) * 1.2;
    if ((y & 1) === 0 || noise(y, 0, 33_230) > 0.45) {
      put(t, Math.floor(cx - half + sway), y, rgba(56, 70, 92, 155));
      put(t, Math.floor(cx + half + sway), y, rgba(46, 60, 82, 132));
    }
  }

  // Void holes in the torso: true transparent cuts inside the body.
  for (let y = 20; y < 50; y++) {
    for (let x = Math.floor(cx - 6); x <= Math.floor(cx + 6); x++) {
      const d = Math.abs(x - cx) + Math.abs(y - 35) * 0.18;
      if (d < 7.2 && noise(x * 2, y * 3, 33_240) > 0.72) t[y * S + x] = CLEAR;
    }
  }

  // Eye cuts: pale slashes, deliberately not glowing dots.
  line(t, Math.floor(cx - 6), 11, Math.floor(cx - 2), 10, rgba(218, 230, 238, 230));
  line(t, Math.floor(cx + 2), 10, Math.floor(cx + 7), 11, rgba(218, 230, 238, 220));
  put(t, Math.floor(afterX + 1), 16, rgba(190, 204, 218, 95));

  // Long broken arms: the real body points one beat away from the afterimage.
  line(t, Math.floor(cx - 8), 23, Math.floor(cx - 24), 42, rgba(5, 7, 10, 220));
  line(t, Math.floor(cx - 24), 42, Math.floor(cx - 29), 55, rgba(32, 42, 58, 150));
  line(t, Math.floor(cx + 8), 24, Math.floor(cx + 16), 38, rgba(5, 7, 10, 215));
  line(t, Math.floor(cx + 16), 38, Math.floor(cx + 25), 50, rgba(28, 38, 54, 130));

  return t;
}
