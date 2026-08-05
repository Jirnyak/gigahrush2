/* ── Blood Plant: rooted red-mold hive source ───────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.BLOOD_PLANT,
  name: 'Кровавое Растение',
  hp: 96,
  speed: 0,
  dmg: 19,
  attackRate: 2.85,
  sprite: 0,
  aiFlags: ['rootHive'],
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Не входите в красный центр без соли, огня или режущего инструмента: корни бьют только в коротком радиусе, красная плесень рядом медленно лечит источник.',
  lootHint: 'красная плесень, влажная кора, редкий живой корень для НИИ или культа',
};

function put(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = rgba(r, g, b, a);
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a = 255): void {
  const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    put(t, Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), r, g, b, a);
  }
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed: number, a = 255): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, seed) * 26 - 10;
      put(t, x, y, clamp(r + n), clamp(g + n * 0.45), clamp(b + n * 0.35), a);
    }
  }
}

function redWalk(t: Uint32Array, sx: number, sy: number, seed: number): void {
  let x = sx;
  let y = sy;
  for (let i = 0; i < 28; i++) {
    const n = noise(i, seed, 1515);
    const ang = -Math.PI * 0.5 + (n - 0.5) * 2.1 + Math.sin(i * 0.5 + seed) * 0.5;
    const nx = x + Math.cos(ang) * (1.6 + noise(i, seed, 1516) * 2.8);
    const ny = y + Math.sin(ang) * (1.2 + noise(seed, i, 1517) * 2.4);
    line(t, x, y, nx, ny, 146, 12, 24, 190);
    if (i % 4 === 0) put(t, Math.round(nx), Math.round(ny), 232, 54, 64, 235);
    x = nx;
    y = ny;
    if (x < 3 || x > 60 || y < 3 || y > 60) break;
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 32;

  // Low root fan: reads as a stationary blocker before the face detail resolves.
  for (let i = 0; i < 12; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const len = 8 + Math.floor(noise(i, 2, 1501) * 19);
    const y = 53 + Math.floor(noise(i, 3, 1502) * 7);
    line(t, cx + side * 4, 48, cx + side * len, y, 48, 8, 12, 235);
    line(t, cx + side * 3, 50, cx + side * (len - 3), y + 2, 118, 12, 24, 195);
  }

  // Red-black trunk with a partial human posture.
  ellipse(t, cx, 35, 10, 21, 42, 16, 20, 1510, 255);
  ellipse(t, cx - 1, 23, 7, 10, 52, 18, 22, 1511, 250);
  ellipse(t, cx + 1, 42, 12, 15, 35, 12, 16, 1512, 255);
  for (let y = 14; y < 55; y++) {
    const half = 4 + Math.sin(y * 0.22) * 2.4 + (y > 35 ? 2.2 : 0);
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const dx = Math.abs((x - cx) / Math.max(1, half));
      if (dx > 1) continue;
      const n = noise(x, y, 1513) * 32;
      put(t, x, y, clamp(34 + n - dx * 24), clamp(9 + n * 0.22), clamp(13 + n * 0.28));
    }
  }

  // Vein walks over the trunk and outward tendrils.
  for (let i = 0; i < 9; i++) {
    redWalk(t, cx + Math.round((noise(i, 0, 1520) - 0.5) * 12), 48 - i * 3, 1520 + i);
  }
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const y = 26 + i * 4;
    line(t, cx + side * 4, y, cx + side * (15 + Math.floor(noise(i, 4, 1530) * 11)), y + Math.floor(noise(i, 5, 1531) * 10) - 4, 102, 7, 18, 215);
  }

  // Human-face suggestion in bark: two pale dots and a closed red mouth, not explicit gore.
  put(t, cx - 3, 23, 226, 190, 168, 250);
  put(t, cx + 4, 24, 226, 190, 168, 250);
  line(t, cx - 4, 31, cx + 5, 30, 162, 22, 32, 245);
  line(t, cx - 2, 34, cx + 3, 35, 86, 8, 18, 230);

  // Flower/seed state: readable bright dots near the crown.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 8 + noise(i, 1, 1540) * 7;
    const x = cx + Math.cos(a) * r;
    const y = 12 + Math.sin(a) * r * 0.55;
    line(t, cx, 17, x, y, 92, 12, 18, 150);
    ellipse(t, x, y, 1.5, 1.5, 226, 18, 32, 1541 + i, 245);
    if (i % 5 === 0) put(t, Math.round(x), Math.round(y - 1), 255, 116, 124, 250);
  }
  ellipse(t, cx, 17, 3.2, 3.2, 92, 12, 18, 1559, 245);

  return t;
}
