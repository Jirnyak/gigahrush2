/* ── Chervie avatar: net-borne AI serpent around screens ─────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.CHERVIE_AVATAR,
  name: 'Червие',
  hp: 118,
  speed: 1.45,
  dmg: 17,
  attackRate: 2.15,
  sprite: 0,
  isRanged: true,
  projSpeed: 5.8,
  projSprite: 0,
  aiFlags: ['netPossessor'],
  floors: [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE, FloorLevel.VOID],
  counterplay: 'Червие силен только у экранов и серверного аппарата: ломайте линию к экрану, выжигайте или отключайте локальный аппарат, затем добивайте аватар. Энергооружие и GBE решают быстрее обычной очереди.',
  lootHint: 'платы с зеленым текстом, проводка, редкая энергоячейка из локального сервера',
};

function px(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = rgba(r, g, b, a);
}

function blob(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed: number, a = 255): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, seed) * 20 - 8;
      px(t, x, y, clamp(r + n), clamp(g + n), clamp(b + n), a);
    }
  }
}

function cable(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, seed: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const wave = Math.sin(u * Math.PI * 4 + seed) * 3.2;
    const x = Math.round(x0 + (x1 - x0) * u + Math.sin(seed) * wave);
    const y = Math.round(y0 + (y1 - y0) * u + Math.cos(seed) * wave);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (ox * ox + oy * oy <= 2) px(t, x + ox, y + oy, 8, 13, 10);
    }
    if ((i + seed) % 7 === 0) px(t, x, y, 80, 255, 120, 230);
  }
}

function head(t: Uint32Array, cx: number, cy: number, dir: number, seed: number): void {
  blob(t, cx, cy, 6, 5, 14, 22, 18, seed);
  const ex = Math.round(cx + Math.cos(dir) * 3);
  const ey = Math.round(cy + Math.sin(dir) * 2);
  px(t, ex - 2, ey - 1, 130, 255, 110);
  px(t, ex + 2, ey - 1, 130, 255, 110);
  for (let i = -2; i <= 2; i++) {
    px(t, Math.round(cx + Math.cos(dir) * 6 + i), Math.round(cy + Math.sin(dir) * 4), 235, 255, 232);
  }
  for (let i = 0; i < 5; i++) {
    const gx = Math.round(cx - 5 + i * 2);
    const gy = Math.round(cy + 5 + (i % 2));
    px(t, gx, gy, i % 2 ? 255 : 110, i % 2 ? 70 : 255, i % 2 ? 60 : 125);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S >> 1;

  // Terminal glow first, so the cable body reads as something emerging from a screen.
  for (let y = 14; y < 55; y++) {
    for (let x = 10; x < 54; x++) {
      const dx = (x - cx) / 28;
      const dy = (y - 34) / 23;
      const d = dx * dx + dy * dy;
      if (d > 1.3) continue;
      const a = clamp(185 - d * 130);
      const n = noise(x, y, 18018) * 22;
      px(t, x, y, 0, clamp(70 + n), clamp(34 + n * 0.4), a);
    }
  }

  cable(t, 13, 48, 51, 18, 3);
  cable(t, 16, 25, 49, 50, 8);
  cable(t, 20, 55, 44, 9, 15);
  cable(t, 10, 35, 55, 34, 21);
  cable(t, 23, 13, 39, 58, 34);

  blob(t, cx, 35, 13, 11, 10, 18, 14, 19001, 245);
  blob(t, cx - 2, 36, 8, 7, 22, 54, 34, 19002, 210);

  head(t, 20, 17, -2.4, 19011);
  head(t, 44, 13, -0.7, 19012);
  head(t, 53, 36, 0.2, 19013);
  head(t, 18, 52, 2.4, 19014);
  if (noise(7, 11, 19015) > 0.25) head(t, 34, 8, -1.4, 19015);

  // Screen-square fragments and ministry paper glyphs caught in the body.
  for (let i = 0; i < 34; i++) {
    const a = i * 1.71;
    const r = 7 + (i % 5) * 3;
    const x = Math.round(cx + Math.cos(a) * r + Math.sin(i) * 4);
    const y = Math.round(34 + Math.sin(a * 0.8) * r);
    const red = i % 9 === 0;
    px(t, x, y, red ? 185 : 70, red ? 38 : 240, red ? 34 : 105, 230);
    px(t, x + 1, y, red ? 185 : 70, red ? 38 : 240, red ? 34 : 105, 210);
    if (i % 4 === 0) px(t, x, y + 1, 230, 245, 230, 220);
  }

  return t;
}
