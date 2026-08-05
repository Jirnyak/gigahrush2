/* ── Herald (Вестник) — threshold siren watcher ───────────────── */
/*   Tall listening mast with voice horns, dangling eyes and      */
/*   a meat-root base. It reads as a guard, not a boss.           */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.HERALD,
  name: 'Вестник',
  hp: 250,
  speed: 1.4,
  dmg: 30,
  attackRate: 2.0,
  sprite: 0,   // auto-assigned by generateSprites()
  isRanged: true,
  projSpeed: 7,
  projSprite: 0,
  floors: [FloorLevel.HELL],
  counterplay: 'Держите дверь, угол или колонну между залпами: Вестник сторожит открытую линию, а не охотится за героем.',
  lootHint: 'осколок сирены, бирка порога, запечатанный голос',
  boss: {
    warningLine: 'Вестник слушает открытую линию. Дверь, угол или колонна срывают его голосовой залп.',
    windupLine: 'Вестник втягивает воздух в рога: закройте линию до вспышки.',
    interruptLine: 'Голос Вестника захлебнулся о преграду.',
    deathCause: 'Вестник убил вас открытой линией порога',
    counterplay: 'break_threshold_line_between_siren_bolts',
    windupSec: 0.9,
    range: 16,
    minRange: 1.8,
    phases: [
      { hpPct: 0.66, tag: 'horns_cracked', line: 'У Вестника треснули рога. Он держит дистанцию: не выходите в длинный коридор.' },
      { hpPct: 0.33, tag: 'threshold_scream', line: 'Вестник срывается на пороговый крик. Добивайте из-за укрытия или отходите.' },
    ],
  },
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Thin bone-and-speaker mast.
  for (let y = 7; y < 60; y++) {
    const sway = Math.sin(y * 0.14) * 1.1;
    const halfW = y < 17 ? 2 :
                  y < 46 ? 3 :
                  2;
    for (let x = Math.floor(cx - halfW + sway); x <= Math.ceil(cx + halfW + sway); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 800) * 20;
      const bark = noise(x * 7, y * 2, 801) > 0.85 ? -20 : 0;
      t[y * S + x] = rgba(
        clamp(68 + n + bark),
        clamp(58 + n + bark),
        clamp(54 + n + bark),
      );
    }
  }

  // Siren horns on the crown: visible listening/voice silhouette.
  for (const dir of [-1, 1]) {
    const baseX = cx + dir * 3;
    const baseY = 14;
    for (let y = -5; y <= 5; y++) {
      const spread = 2 + Math.abs(y) * 0.55;
      for (let x = 0; x <= 8; x++) {
        const px = Math.floor(baseX + dir * x);
        const py = baseY + y;
        if (px < 0 || px >= S || py < 0 || py >= S) continue;
        if (x < spread || x > 7) continue;
        const rim = x >= 6 || Math.abs(y) > 3;
        t[py * S + px] = rim ? rgba(105, 72, 62) : rgba(18, 12, 16);
      }
    }
  }

  // Ribbed vocal slits in the chest.
  for (let y = 22; y < 42; y += 4) {
    const w = 5 + Math.floor(noise(y, 0, 804) * 3);
    for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) {
      if (x < 0 || x >= S) continue;
      const dy = Math.abs(y - 32);
      const glow = 105 - dy * 4;
      t[y * S + x] = rgba(35, clamp(glow), 55);
    }
  }

  // Dangling eye-cables, not branches.
  const eyeStalks: [number, number, number, number][] = [
    [-13, 16, -1, 0.25],
    [12, 17, 1, 0.22],
    [-15, 24, -1, 0.33],
    [14, 25, 1, 0.28],
    [-9, 32, -1, 0.18],
    [10, 34, 1, 0.24],
    [-6, 10, -1, 0.12],
    [7, 11, 1, 0.15],
  ];

  for (const [ex, ey, dir, curve] of eyeStalks) {
    const startX = cx;
    const startY = ey;
    const endX = cx + ex;
    const endY = ey + Math.abs(ex) * 0.4 + noise(ex, ey, 802) * 4;
    const steps = Math.max(Math.abs(ex), 8);

    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const sx = Math.floor(startX + (endX - startX) * frac);
      const sy = Math.floor(startY + (endY - startY) * frac + Math.sin(frac * Math.PI) * curve * dir * 8);
      if (sx >= 0 && sx < S && sy >= 0 && sy < S) {
        t[sy * S + sx] = rgba(58, 42, 46);
        if (frac < 0.25 && sx + 1 < S) t[sy * S + sx + 1] = rgba(58, 42, 46);
      }
    }

    const eyeX = endX;
    const eyeY = Math.floor(ey + Math.abs(ex) * 0.4 + noise(ex, ey, 802) * 4);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const px = Math.floor(eyeX + dx), py = Math.floor(eyeY + dy);
        if (px >= 0 && px < S && py >= 0 && py < S) {
          t[py * S + px] = rgba(225, 218, 188);
        }
      }
    }
    const px = Math.floor(eyeX), py = Math.floor(eyeY);
    if (px >= 0 && px < S && py >= 0 && py < S) {
      t[py * S + px] = rgba(30, 180, 60);
      if (px + 1 < S) t[py * S + px + 1] = rgba(60, 200, 80);
      if (py + 1 < S) t[(py + 1) * S + px] = rgba(60, 200, 80);
    }
  }

  // Meat-root tripod base.
  for (let i = 0; i < 5; i++) {
    const rootDir = Math.PI * (0.12 + i * 0.19);
    for (let r = 0; r < 10; r++) {
      const rx = Math.floor(cx + Math.cos(rootDir) * r * 1.3);
      const ry = Math.floor(57 + Math.sin(rootDir) * r * 0.35);
      if (rx >= 0 && rx < S && ry >= 0 && ry < S) {
        t[ry * S + rx] = rgba(74, 38, 34);
      }
    }
  }

  // Faint throat glow.
  for (let y = 15; y < 45; y++) {
    const n = noise(cx, y, 803);
    if (n > 0.6) {
      if (cx >= 0 && cx < S) {
        t[y * S + cx] = rgba(40, 100 + Math.floor(n * 60), 64);
      }
    }
  }

  return t;
}
