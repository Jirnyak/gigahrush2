/* ── Betonoed: weak-wall concrete eater ─────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.BETONOED,
  name: 'Бетоноед',
  hp: 360,
  speed: 0.98,
  dmg: 28,
  attackRate: 2.35,
  sprite: 0,
  aiFlags: ['wallBias', 'weakWallBreach'],
  floors: [FloorLevel.MAINTENANCE],
  counterplay: 'Слабую стену решают до прогрыза: герметик или блок-комплект закрывают шов, шум уводит темп, огонь срывает жор.',
  lootHint: 'арматурная крошка, бетонный осколок, редкая ПСИ-бетонная заноза',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Squat dusty body: lower and wider than a Betonnik.
  for (let y = 18; y < 55; y++) {
    const bulge = Math.sin((y - 18) * Math.PI / 37);
    const halfW = 8 + bulge * 12;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / Math.max(1, halfW);
      const dy = (y - 38) / 23;
      if (dx * dx + dy * dy > 1.05) continue;
      const n = noise(x * 2, y * 2, 12420) * 28;
      const chip = noise(x * 5, y * 4, 12421) > 0.87 ? -34 : 0;
      t[y * S + x] = rgba(clamp(142 + n + chip), clamp(138 + n + chip), clamp(124 + n + chip));
    }
  }

  // Circular grinder-mouth with wet dark throat and red gum line.
  const mx = cx + 1;
  const my = 35;
  for (let y = my - 11; y <= my + 11; y++) {
    for (let x = mx - 12; x <= mx + 12; x++) {
      if (x < 0 || x >= S || y < 0 || y >= S) continue;
      const dx = (x - mx) / 12;
      const dy = (y - my) / 10;
      const d = dx * dx + dy * dy;
      if (d > 1.08) continue;
      if (d > 0.78) {
        t[y * S + x] = rgba(150, 34, 28);
      } else if (d > 0.52) {
        const tooth = noise(x * 7, y * 7, 12430) > 0.45;
        t[y * S + x] = tooth ? rgba(214, 206, 176) : rgba(84, 68, 58);
      } else {
        t[y * S + x] = rgba(18, 12, 12);
      }
    }
  }

  // Chalk-dust forearms dragging beside the jaw.
  for (let y = 36; y < 58; y++) {
    const step = y - 36;
    const lx = Math.floor(cx - 16 - step * 0.18 + Math.sin(y * 0.4) * 1.2);
    const rx = Math.floor(cx + 16 + step * 0.16 - Math.sin(y * 0.35) * 1.1);
    for (let w = -2; w <= 2; w++) {
      const a = clamp(230 - step * 7);
      if (lx + w >= 0 && lx + w < S) t[y * S + lx + w] = rgba(188, 184, 166, a);
      if (rx + w >= 0 && rx + w < S) t[y * S + rx + w] = rgba(178, 174, 156, a);
    }
  }

  // Aggregate speckles and powder plume around hands and jaw.
  for (let i = 0; i < 95; i++) {
    const x = Math.floor(10 + noise(i, 3, 12440) * 44);
    const y = Math.floor(15 + noise(i, 9, 12441) * 44);
    const skin = t[y * S + x] !== CLEAR;
    if (skin) {
      const pebble = i % 3 === 0 ? [92, 86, 76] : i % 3 === 1 ? [184, 178, 150] : [112, 104, 92];
      t[y * S + x] = rgba(pebble[0], pebble[1], pebble[2], 238);
    } else if (y > 27 && y < 59 && x > 6 && x < 58 && noise(i, y, 12442) > 0.58) {
      t[y * S + x] = rgba(214, 210, 190, 95);
    }
  }

  // Tiny red gum glints keep the mouth readable in motion.
  for (let dx = -5; dx <= 5; dx += 5) {
    t[(my - 8) * S + mx + dx] = rgba(238, 54, 38);
    t[(my + 8) * S + mx + dx] = rgba(170, 28, 24);
  }

  return t;
}
