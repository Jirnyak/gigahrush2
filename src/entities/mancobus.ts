/* ── Mancobus — fat boss controller of monsters ──────────────── */
/*   Doom-inspired mancubus: massive, fat, terrifying.           */
/*   Ranged AoE attack — shoots explosive fireballs.             */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.MANCOBUS,
  name: 'Манкобус',
  hp: 400,
  speed: 0.7,
  dmg: 40,
  attackRate: 3.0,
  sprite: 0,   // auto-assigned by generateSprites()
  isRanged: true,
  projSpeed: 6,
  projSprite: 0, // uses PSI_BOLT or similar
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Не входите в прямой сектор: сначала снимите охрану, затем бейте из-за углов между залпами. Стены и колонны режут огненный темп.',
  lootHint: 'жирный металл, командная органика, энергоячейка, закупоренный голос',
  boss: {
    warningLine: 'Манкобус развел пушки. Уберите охрану, держите колонну и бейте только между залпами.',
    windupLine: 'Манкобус набирает жирный залп: выходите из прямого сектора за угол.',
    interruptLine: 'Залп Манкобуса ушел в бетон: укрытие сработало.',
    deathCause: 'Манкобус поймал вас в прямом секторе залпа',
    counterplay: 'guard_clear_corner_reload_window',
    windupSec: 1.05,
    range: 14,
    minRange: 2.2,
    phases: [
      { hpPct: 0.66, tag: 'guards_thinning', line: 'Манкобус потерял строй охраны и стреляет реже, но тяжелее. Не стойте на оси пушек.' },
      { hpPct: 0.33, tag: 'last_barrage', line: 'Манкобус хрипит перед последней третью. Отход доступен: угол важнее добивания.' },
    ],
  },
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Massive obese body — fills most of the sprite
  for (let y = 2; y < 62; y++) {
    // Very wide bloated torso
    const bellyY = (y - 35) / 20;
    const bellyBulge = Math.max(0, 1 - bellyY * bellyY) * 12;
    const halfW = y < 10 ? 8 + (y - 2) * 0.8 :   // small head
                  y < 18 ? 14 :                     // thick neck
                  y < 48 ? 18 + bellyBulge :        // massive belly
                  18 - (y - 48) * 1.0;              // stumpy legs
    if (halfW <= 0) continue;
    for (let x = Math.floor(cx - halfW); x < Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 700) * 20;
      // Sickly yellowish-brown skin with boils
      const boil = noise(x * 3, y * 3, 701) > 0.93 ? 30 : 0;
      const scar = noise(x * 5, y * 2, 702) > 0.96 ? -25 : 0;
      const r = clamp(140 + n + boil + scar);
      const g = clamp(100 + n - boil * 0.5 + scar);
      const b = clamp(60 + n + scar);
      t[y * S + x] = rgba(r, g, b);
    }
  }

  // Dark eye pits
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -3; dx <= -1; dx++) t[(7 + dy) * S + (cx + dx)] = rgba(10, 5, 5);
    for (let dx = 1; dx <= 3; dx++) t[(7 + dy) * S + (cx + dx)] = rgba(10, 5, 5);
  }
  // Glowing red pupils
  t[7 * S + (cx - 2)] = rgba(255, 40, 20);
  t[7 * S + (cx + 2)] = rgba(255, 40, 20);

  // Huge gaping mouth with teeth
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const px = cx + dx;
      if (px >= 0 && px < S) {
        if (dy === 0 && Math.abs(dx) % 2 === 0) {
          t[(11 + dy) * S + px] = rgba(200, 200, 180); // teeth
        } else {
          t[(11 + dy) * S + px] = rgba(80, 15, 15); // dark mouth
        }
      }
    }
  }

  // Fat arm cannons on both sides — like Doom mancubus
  for (let y = 18; y < 40; y++) {
    // Left cannon
    for (let dx = -3; dx <= 0; dx++) {
      const px = cx - 18 + dx;
      if (px >= 0 && px < S) {
        const n = noise(px, y, 703) * 15;
        t[y * S + px] = rgba(clamp(90 + n), clamp(80 + n), clamp(70 + n));
      }
    }
    // Right cannon
    for (let dx = 0; dx <= 3; dx++) {
      const px = cx + 18 + dx;
      if (px >= 0 && px < S) {
        const n = noise(px, y, 704) * 15;
        t[y * S + px] = rgba(clamp(90 + n), clamp(80 + n), clamp(70 + n));
      }
    }
  }

  // Cannon tips — glowing orange
  for (let dx = -2; dx <= 1; dx++) {
    const lx = cx - 18 + dx, rx = cx + 18 + dx;
    if (lx >= 0 && lx < S) t[18 * S + lx] = rgba(255, 140, 30);
    if (rx >= 0 && rx < S) t[18 * S + rx] = rgba(255, 140, 30);
  }

  // Belly button / gaping wound
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy <= 4) {
        const px = cx + dx, py = 35 + dy;
        if (px >= 0 && px < S && py >= 0 && py < S)
          t[py * S + px] = rgba(100, 30, 30);
      }
    }
  }

  // Stumpy legs
  for (let y = 50; y < 62; y++) {
    for (let dx = -4; dx <= -1; dx++) {
      const px = cx - 5 + dx;
      if (px >= 0 && px < S) {
        const n = noise(px, y, 705) * 12;
        t[y * S + px] = rgba(clamp(120 + n), clamp(85 + n), clamp(55 + n));
      }
    }
    for (let dx = 1; dx <= 4; dx++) {
      const px = cx + 5 + dx;
      if (px >= 0 && px < S) {
        const n = noise(px, y, 706) * 12;
        t[y * S + px] = rgba(clamp(120 + n), clamp(85 + n), clamp(55 + n));
      }
    }
  }

  return t;
}
