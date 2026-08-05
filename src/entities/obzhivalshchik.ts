/* ── Obzhivalshchik: room-bound resident aberration ─────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.OBZHIVALSHCHIK,
  name: 'Комнатный обживальщик',
  hp: 92,
  speed: 1.05,
  dmg: 16,
  attackRate: 1.55,
  sprite: 0,
  aiFlags: ['roomBoundAberration'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING],
  counterplay: 'Не шумите у двери и не тащите бой в квартиру: обживальщик держится своей комнаты, злится от кражи и шума, а спокойный доклад сбивает рост.',
  lootHint: 'домовой мусор, куски мебели, слизь со стены, редкая жалоба соседа',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function bodyColor(x: number, y: number, seed: number, shade = 0): number {
  const n = Math.floor((noise(x, y, seed) - 0.5) * 28 + shade);
  return rgba(clamp(52 + n), clamp(47 + n), clamp(43 + n));
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Square-ish room shell behind the body: wallpaper, dirt, and a dark corner.
  for (let y = 12; y < 56; y++) {
    const edge = y < 16 || y > 51;
    for (let x = 10; x < 54; x++) {
      if (!edge && x > 14 && x < 50) continue;
      const n = Math.floor((noise(x, y, 19100) - 0.5) * 24);
      const seam = x === 14 || x === 49 || y === 16 || y === 51;
      t[y * S + x] = seam
        ? rgba(clamp(50 + n), clamp(38 + n), clamp(28 + n), 215)
        : rgba(clamp(82 + n), clamp(64 + n), clamp(45 + n), 170);
    }
  }

  // Hunched torso tucked into the shell.
  for (let y = 19; y < 50; y++) {
    const hunch = Math.sin(y * 0.18) * 2.4 - Math.max(0, y - 36) * 0.06;
    const halfW = y < 27 ? 8 : y < 42 ? 12 : 9;
    for (let x = Math.floor(cx - halfW + hunch); x <= Math.ceil(cx + halfW + hunch); x++) {
      const dx = (x - (cx + hunch)) / halfW;
      const dy = (y - 34) / 18;
      if (dx * dx + dy * dy > 1.08) continue;
      t[y * S + x] = bodyColor(x, y, 19110, -Math.abs(dx) * 18);
    }
  }

  // Low head and shoulders.
  for (let y = 10; y < 24; y++) {
    const lean = -3 + Math.floor((y - 10) * 0.15);
    for (let x = Math.floor(cx - 7 + lean); x <= Math.ceil(cx + 7 + lean); x++) {
      const dx = (x - (cx + lean)) / 7;
      const dy = (y - 17) / 8;
      if (dx * dx + dy * dy > 1) continue;
      t[y * S + x] = bodyColor(x, y, 19120, 4);
    }
  }

  // Furniture scraps fused to the back.
  for (let i = 0; i < 5; i++) {
    const bx = Math.floor(cx + 8 + noise(i, 0, 19130) * 9);
    const by = 20 + Math.floor(noise(0, i, 19131) * 22);
    const len = 7 + Math.floor(noise(i, i, 19132) * 8);
    for (let j = 0; j < len; j++) {
      const x = bx + Math.floor(j * 0.2);
      const y = by + j;
      put(t, x, y, rgba(92, 62, 38));
      if (j % 3 === 0) put(t, x + 1, y, rgba(48, 33, 24));
    }
  }
  for (let x = 18; x < 29; x++) put(t, x, 38 + Math.floor((x - 18) * 0.18), rgba(87, 54, 32));
  for (let y = 36; y < 45; y++) put(t, 18 + Math.floor((y - 36) * 0.25), y, rgba(60, 39, 28));

  // Long fingers scrape outward.
  for (let y = 27; y < 54; y++) {
    const lx = Math.floor(cx - 12 - (y - 27) * 0.28);
    const rx = Math.floor(cx + 12 + (y - 27) * 0.22);
    const c = bodyColor(lx, y, 19140, 12);
    if (y % 2 === 0) {
      put(t, lx, y, c);
      put(t, rx, y, c);
    }
    if (y > 43 && y % 3 === 0) {
      put(t, lx - 2, y, rgba(126, 108, 82));
      put(t, rx + 2, y, rgba(126, 108, 82));
    }
  }

  // Pale mucus growth on the room shell.
  for (let y = 18; y < 52; y += 4) {
    const side = noise(y, 1, 19150) > 0.5 ? 12 : 51;
    const len = 2 + Math.floor(noise(y, 0, 19151) * 5);
    for (let j = 0; j < len; j++) put(t, side + (side < cx ? j : -j), y + j, rgba(176, 166, 132, 150));
  }

  // Tiny red night eyes only.
  put(t, 28, 16, rgba(248, 28, 24));
  put(t, 35, 16, rgba(248, 28, 24));
  put(t, 28, 17, rgba(90, 8, 7));
  put(t, 35, 17, rgba(90, 8, 7));

  return t;
}
