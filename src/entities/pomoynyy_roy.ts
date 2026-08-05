/* ── Pomoynyy Roy: food-attracted garbage swarm ──────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.POMOYNY_ROY,
  name: 'Помойный Рой',
  hp: 38,
  speed: 2.18,
  dmg: 2,
  attackRate: 0.38,
  sprite: 0,
  aiFlags: ['foodBait', 'garbageSurround'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Держите еду в контейнере, бросайте приманку в сторону от выхода и выжигайте или простреливайте узкий проход, пока рой расползается по флангам.',
  lootHint: 'пластиковый мусор, грязный жир, желтые крошки еды, редкое сырое мясо',
};

function plot(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function leg(t: Uint32Array, x: number, y: number, dx: number, dy: number): void {
  const c = rgba(16, 16, 14, 235);
  for (let i = 0; i < 6; i++) plot(t, Math.round(x + dx * i), Math.round(y + dy * i), c);
}

function lump(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1 + noise(x, y, seed) * 0.22) continue;
      const n = noise(x, y, seed + 77) * 26;
      const green = noise(x, y, seed + 101) > 0.55;
      t[y * S + x] = green
        ? rgba(clamp(54 + n), clamp(76 + n), clamp(46 + n))
        : rgba(clamp(76 + n), clamp(78 + n), clamp(72 + n));
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 32;
  const cy = 34;
  const bodies = 14;

  for (let i = 0; i < bodies; i++) {
    const a = (i / bodies) * Math.PI * 2;
    const r = 7 + noise(i, 3, 4101) * 10;
    const bx = cx + Math.cos(a) * r;
    const by = cy + Math.sin(a) * r * 0.62 + Math.sin(i * 1.7) * 2;
    const rx = 3 + (i % 3);
    const ry = 2 + ((i + 1) % 3);
    const side = Math.cos(a) >= 0 ? 1 : -1;
    leg(t, bx - side * rx, by + 1, -side * 0.9, 0.55);
    leg(t, bx + side * rx, by + 1, side * 0.9, 0.55);
    lump(t, bx, by, rx, ry, 4200 + i * 31);
  }

  lump(t, cx, cy, 8, 6, 5001);
  lump(t, cx - 2, cy + 5, 6, 4, 5002);

  for (let i = 0; i < 10; i++) {
    const x = 40 + (i % 4) * 2;
    const y = 25 + Math.floor(i / 4) * 4 + (i & 1);
    plot(t, x, y, rgba(222, 174, 54, 245));
    if ((i & 1) === 0) plot(t, x + 1, y, rgba(164, 130, 38, 230));
  }

  return t;
}
