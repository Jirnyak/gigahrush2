/* -- Mukhozhuk: exposed parasite authority host ---------------- */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.MUKHOZHUK_HOST,
  name: 'Мухожук-носитель',
  hp: 118,
  speed: 1.28,
  dmg: 13,
  attackRate: 1.28,
  sprite: 0,
  aiFlags: ['parasiteLeader', 'foodBait'],
  floors: [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE],
  counterplay: 'Не давайте носителю добежать до охраны: вскрывайте болезнь при свидетелях, карантиньте, бейте до командного крика или уводите его от складов еды.',
  lootHint: 'жирный хитин, испорченный приказ, редкая карантинная карточка из воротника',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    put(t, Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), color);
  }
}

function ellipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
  seed: number,
  alpha = 255,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / Math.max(1, rx);
      const dy = (y - cy) / Math.max(1, ry);
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, seed) * 24 - 10;
      const r = color & 255;
      const g = (color >>> 8) & 255;
      const b = (color >>> 16) & 255;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n), alpha));
    }
  }
}

function jaggedPlate(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  const shell = rgba(46, 31, 22, 245);
  const shellHi = rgba(83, 58, 35, 238);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1 + noise(x, y, seed) * 0.12) continue;
      put(t, x, y, (x + y + seed) % 5 === 0 ? shellHi : shell);
    }
  }
  line(t, cx, cy - ry + 2, cx, cy + ry - 2, rgba(17, 12, 9, 240));
}

function insectLeg(t: Uint32Array, x: number, y: number, side: -1 | 1, bend: number): void {
  const dark = rgba(27, 19, 14, 245);
  const green = rgba(77, 111, 61, 210);
  line(t, x, y, x + side * 7, y + bend, dark);
  line(t, x + side * 7, y + bend, x + side * 12, y + bend + 6, dark);
  put(t, x + side * 5, y + bend - 1, green);
  put(t, x + side * 9, y + bend + 3, green);
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const coat = rgba(45, 53, 57, 250);
  const coatHi = rgba(70, 82, 84, 245);
  const skin = rgba(128, 137, 122, 245);
  const sick = rgba(73, 118, 65, 220);

  for (let y = 22; y < 57; y++) {
    const upper = y < 36;
    const half = upper ? 10 - Math.abs(y - 32) * 0.12 : 8 - Math.max(0, y - 45) * 0.22;
    const sway = Math.sin(y * 0.2) * 1.4;
    for (let x = Math.floor(cx - half + sway); x <= Math.ceil(cx + half + sway); x++) {
      const dx = (x - cx - sway) / Math.max(1, half);
      const dy = (y - 39) / 22;
      if (dx * dx + dy * dy > 1.05) continue;
      const n = noise(x, y, 14930);
      put(t, x, y, n > 0.55 ? coatHi : coat);
    }
  }

  ellipse(t, cx - 1, 16, 7.5, 8.5, skin, 14931, 248);
  ellipse(t, cx + 1, 12, 9.5, 6.5, skin, 14932, 235);
  jaggedPlate(t, cx + 2, 12, 8, 5, 14933);
  jaggedPlate(t, cx + 1, 27, 11, 8, 14934);

  for (let i = 0; i < 3; i++) {
    const y = 25 + i * 5;
    insectLeg(t, cx - 8, y, -1, i - 2);
    insectLeg(t, cx + 8, y + 1, 1, 2 - i);
  }

  for (let y = 35; y < 52; y++) {
    put(t, Math.floor(cx - 11 - Math.sin(y * 0.34) * 2), y, coat);
    put(t, Math.floor(cx + 11 + Math.sin(y * 0.3) * 2), y, coat);
  }
  for (let y = 55; y < 63; y++) {
    put(t, Math.floor(cx - 4 - (y - 55) * 0.12), y, rgba(22, 24, 24));
    put(t, Math.floor(cx + 4 + (y - 55) * 0.1), y, rgba(21, 23, 23));
  }

  for (let i = 0; i < 32; i++) {
    const x = 20 + Math.floor(noise(i, 3, 14940) * 25);
    const y = 14 + Math.floor(noise(i, 7, 14941) * 36);
    if ((t[y * S + x] >>> 24) === 0) continue;
    put(t, x, y, i % 3 === 0 ? sick : rgba(31, 21, 15, 220));
  }

  put(t, cx - 3, 15, rgba(208, 227, 154, 250));
  put(t, cx + 4, 16, rgba(205, 231, 137, 250));
  put(t, cx - 2, 16, rgba(25, 18, 14, 255));
  put(t, cx + 5, 17, rgba(25, 18, 14, 255));
  line(t, cx - 5, 8, cx - 9, 3, rgba(35, 25, 17, 240));
  line(t, cx + 5, 8, cx + 10, 4, rgba(35, 25, 17, 240));

  return t;
}
