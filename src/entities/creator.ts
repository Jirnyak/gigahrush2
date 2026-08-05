/* ── Creator (Творец) — late VOID green contour encounter ───── */
/*   Local accounting error with ranged AoE splash attacks.       */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.CREATOR,
  name: 'Творец',
  hp: 520,
  speed: 1.05,
  dmg: 44,
  attackRate: 2.35,
  sprite: 0,   // auto-assigned by generateSprites()
  isRanged: true,
  projSpeed: 7.5,
  projSprite: 0,
  floors: [FloorLevel.VOID],
  counterplay: 'Входите с полным запасом: держите укрытие между залпами, уходите из зелёного света и не тратьте рывок без выхода.',
  lootHint: 'пустотные шипы и квитанция контура без владельца',
  boss: {
    warningLine: 'Творец считает только открытый контур. Держите укрытие между залпами и не стойте в зеленой разметке.',
    windupLine: 'Контур Творца замкнулся: уходите за стену до зеленого разряда.',
    interruptLine: 'Контур Творца потерял доказательство: укрытие разорвало линию.',
    deathCause: 'Творец убил вас зеленым контуром без укрытия',
    counterplay: 'cover_between_green_bursts_leave_contour',
    windupSec: 1.25,
    range: 18,
    minRange: 2.4,
    phases: [
      { hpPct: 0.7, tag: 'proof_rewrites', line: 'Творец переписал первую строку. Залпы медленные: меняйте укрытие, не стойте в свете.' },
      { hpPct: 0.4, tag: 'return_clause', line: 'Творец открыл возвратную ошибку. Добивайте только из-за укрытия: портал будет на его месте.' },
      { hpPct: 0.18, tag: 'last_contour', line: 'Последний контур Творца дрожит. Отступить можно; жадность держит линию открытой.' },
    ],
  },
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // A humanoid outline only because the witness expects one.
  for (let y = 4; y < 60; y++) {
    // Humanoid shape: head, shoulders, torso, legs
    let halfW: number;
    if (y < 12) {
      // Head — oval
      const dy = (y - 8) / 4;
      halfW = Math.sqrt(Math.max(0, 1 - dy * dy)) * 6;
    } else if (y < 16) {
      halfW = 3 + (y - 12) * 1.5; // neck → shoulders
    } else if (y < 20) {
      halfW = 9; // shoulders
    } else if (y < 40) {
      halfW = 8 - (y - 20) * 0.1; // tapered torso
    } else if (y < 44) {
      halfW = 5; // waist
    } else {
      // Two legs
      const legSpread = 4;
      for (let leg = -1; leg <= 1; leg += 2) {
        const legCx = cx + leg * legSpread;
        for (let dx = -2; dx <= 2; dx++) {
          const px = legCx + dx;
          if (px >= 0 && px < S) {
            const bright = 170 + Math.floor(noise(px, y, 901) * 65);
            const glow = clamp(bright + Math.floor(Math.sin((y + px) * 0.3) * 20));
            t[y * S + px] = rgba(clamp(glow - 45), glow, clamp(glow - 15));
          }
        }
      }
      continue;
    }

    if (halfW <= 0) continue;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / Math.max(halfW, 1);
      const edgeFade = 1 - dx * dx;
      const n = noise(x, y, 900) * 30;
      const base = 170 + Math.floor(edgeFade * 70 + n * 0.5);
      const r = clamp(base - 55 + Math.floor(Math.sin(y * 0.1 + x * 0.05) * 10));
      const g = clamp(base + 20 + Math.floor(Math.cos(y * 0.08 + x * 0.07) * 8));
      const b = clamp(base - 25);
      t[y * S + x] = rgba(r, g, b);
    }
  }

  // Lateral proof lines: the same door counted twice.
  for (let arm = -1; arm <= 1; arm += 2) {
    for (let a = 0; a < 14; a++) {
      const ax = cx + arm * (10 + a);
      const ay = 22 + Math.floor(Math.sin(a * 0.4) * 2);
      for (let dy = -1; dy <= 1; dy++) {
        if (ax >= 0 && ax < S && ay + dy >= 0 && ay + dy < S) {
          const bright = 220 - a * 3;
          t[(ay + dy) * S + ax] = rgba(clamp(bright - 70), bright, clamp(bright - 35));
        }
      }
    }
  }

  // Witness marks, not eyes.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -2; dx <= 0; dx++) {
      const px = cx - 3 + dx, py = 8 + dy;
      if (px >= 0 && px < S && py >= 0 && py < S)
        t[py * S + px] = rgba(120, 255, 170);
    }
    for (let dx = 0; dx <= 2; dx++) {
      const px = cx + 2 + dx, py = 8 + dy;
      if (px >= 0 && px < S && py >= 0 && py < S)
        t[py * S + px] = rgba(120, 255, 170);
    }
  }
  t[8 * S + (cx - 3)] = rgba(210, 255, 220);
  t[8 * S + (cx + 3)] = rgba(210, 255, 220);

  // Broken accounting contour around the figure.
  for (let angle = 0; angle < 32; angle++) {
    const a = (angle / 32) * Math.PI * 2;
    for (let r = 24; r < 28 + Math.floor(noise(angle, 0, 902) * 5); r++) {
      const hx = Math.floor(cx + Math.cos(a) * r);
      const hy = Math.floor(8 + Math.sin(a) * r * 0.5); // head height
      if (hx >= 0 && hx < S && hy >= 0 && hy < S && t[hy * S + hx] === CLEAR) {
        const fade = 1 - (r - 24) / 8;
        const c = Math.floor(180 * fade);
        t[hy * S + hx] = rgba(Math.floor(c * 0.45), clamp(c + 50), Math.floor(c * 0.7), Math.floor(160 * fade));
      }
    }
  }

  return t;
}
