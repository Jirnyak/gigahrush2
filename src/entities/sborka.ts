/* ── Sborka — fast twitchy creature ───────────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { rgba, noise, clamp, CLEAR, outline } from '../render/pixutil';
const S = 128;

export const DEF: MonsterDef = {
  kind: MonsterKind.SBORKA,
  name: 'Сборка',
  hp: 8,
  speed: 3.15,
  dmg: 3,
  attackRate: 0.65,
  sprite: 0,   // auto-assigned by generateSprites()
  aiFlags: ['foodBait'],
  floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Быстрая и слабая: принимайте в широком проходе, гасите дешевым выстрелом до касания и не тратьте последний магазин на первую.',
  lootHint: 'проволока, кладовой мусор, редкая изолента из треснувшего узла',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const sc = S / 64; // scale multiplier

  // Compact jagged body: weak, fast, made from scraps.
  for (let y = Math.floor(16 * sc); y < Math.floor(50 * sc); y++) {
    const lean = Math.sin(y * 0.33 / sc) * 2 * sc;
    const halfW = y < 28 * sc ? (5 + Math.sin(y * 0.7 / sc) * 2) * sc : (7 + Math.sin(y * 0.45 / sc) * 3) * sc;
    for (let x = Math.floor(cx - halfW + lean); x <= Math.ceil(cx + halfW + lean); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx - lean) / Math.max(1, halfW);
      if (dx * dx > 1.1) continue;
      const n = noise(x, y, 444) * 30;
      const crack = noise(x * 3, y * 2, 445) > 0.82 ? -35 : 0;
      const depth = Math.abs(x - cx - lean) * 3 / sc; // shading
      t[y * S + x] = rgba(
        clamp(82 + n + crack - depth),
        clamp(45 + n + crack - depth),
        clamp(54 + n + crack - depth)
      );
    }
  }

  for (let y = Math.floor(20 * sc); y < Math.floor(48 * sc); y += Math.max(1, Math.floor(6 * sc))) {
    const shift = Math.floor(Math.sin(y * 0.6 / sc) * 3 * sc);
    for (let dx = Math.floor(-10 * sc); dx <= Math.floor(10 * sc); dx += Math.max(1, Math.floor(4 * sc))) {
      const px = cx + dx + shift;
      if (px >= 0 && px < S) t[y * S + px] = rgba(35, 28, 32);
    }
  }

  for (let y = Math.floor(27 * sc); y < Math.floor(53 * sc); y += Math.max(1, Math.floor(5 * sc))) {
    const spread = (6 + (y / sc - 27) * 0.28) * sc;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 5 * sc; i++) {
        const x = Math.floor(cx + side * (spread + i));
        const yy = y + Math.floor(i * 0.4);
        if (x >= 0 && x < S && yy >= 0 && yy < S) t[yy * S + x] = rgba(72, 45, 38);
      }
    }
  }

  const ex1 = Math.floor(cx - 3 * sc);
  const ex2 = Math.floor(cx + 3 * sc);
  const ey1 = Math.floor(18 * sc);
  const ey2 = Math.floor(19 * sc);

  // Eyes with pupils
  for (let dy = 0; dy < Math.max(1, Math.floor(2 * sc)); dy++) {
    for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
      t[(ey1 + dy) * S + (ex1 + dx)] = rgba(255, 100, 100);
      t[(ey1 + dy) * S + (ex2 + dx)] = rgba(255, 100, 100);
      t[(ey2 + dy) * S + (ex1 + dx)] = rgba(255, 80, 80);
      t[(ey2 + dy) * S + (ex2 + dx)] = rgba(255, 80, 80);
    }
  }

  for (let y = Math.floor(50 * sc); y < Math.floor(58 * sc); y++) {
    const n = noise(cx, y, 446) * 18;
    const lx = Math.floor(cx - (5 + (y / sc - 50) * 0.45) * sc);
    const rx = Math.floor(cx + (4 + (y / sc - 50) * 0.25) * sc);
    if (lx >= 0) t[y * S + lx] = rgba(clamp(78 + n), clamp(45 + n), clamp(42 + n));
    if (rx < S) t[y * S + rx] = rgba(clamp(78 + n), clamp(45 + n), clamp(42 + n));
  }

  outline(t, rgba(20, 10, 15));
  return t;
}
