/* ── Zombie — humanoid undead (мертвяк) ───────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { rgba, noise, clamp, CLEAR, outline } from '../render/pixutil';
const S = 128;

export const DEF: MonsterDef = {
  kind: MonsterKind.ZOMBIE,
  name: 'Мертвяк',
  hp: 35,
  speed: 1.4,
  dmg: 8,
  attackRate: 1.5,
  sprite: 0,   // auto-assigned by generateSprites()
  floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Опасен толпой и дверью: вытяните из кухни, очереди или палаты в пустой проход и добейте до первого хвата.',
  lootHint: 'карманный бытовой хлам, чужая записка, редкие сигареты',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const sc = S / 64; // scale multiplier

  // Head — sickly green-grey
  for (let y = Math.floor(4 * sc); y < Math.floor(18 * sc); y++) {
    for (let x = Math.floor(cx - 5 * sc); x < Math.floor(cx + 5 * sc); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / (5 * sc), dy = (y - 11 * sc) / (7 * sc);
      if (dx * dx + dy * dy < 1) {
        const n = noise(x, y, 901) * 20;
        t[y * S + x] = rgba(clamp(80 + n), clamp(95 + n), clamp(70 + n));
      }
    }
  }

  // Eyes — dead white with tiny dark pupil
  for (let dy = 0; dy < Math.max(1, Math.floor(2 * sc)); dy++) {
    for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
      const eY1 = Math.floor(10 * sc) + dy;
      const eY2 = Math.floor(11 * sc) + dy;
      const eX1 = Math.floor(cx - 2 * sc) + dx;
      const eX2 = Math.floor(cx + 2 * sc) + dx;

      t[eY1 * S + eX1] = rgba(200, 200, 190);
      t[eY1 * S + eX2] = rgba(200, 200, 190);
      t[eY2 * S + eX1] = rgba(15, 5, 5); // darker pupil
      t[eY2 * S + eX2] = rgba(15, 5, 5);
    }
  }

  // Mouth — dark gash
  for (let y = Math.floor(14 * sc); y <= Math.floor(15 * sc); y++) {
    for (let x = Math.floor(cx - 3 * sc); x <= Math.floor(cx + 3 * sc); x++) {
      const centerDist = Math.abs(x - cx);
      if (y === Math.floor(14 * sc)) {
        t[y * S + x] = centerDist < 2 * sc ? rgba(20, 5, 5) : rgba(40, 15, 15);
      } else {
        if (noise(x, y, 902) > 0.5) t[y * S + x] = rgba(50, 20, 20);
      }
    }
  }

  // Torso — tattered domestic clothes over rotting skin
  for (let y = Math.floor(18 * sc); y < Math.floor(44 * sc); y++) {
    const halfW = (7 + Math.sin(y * 0.2 / sc) * 1.5) * sc;
    for (let x = Math.floor(cx - halfW); x < Math.floor(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 903) * 25;
      const depth = Math.abs(x - cx) * 2 / sc;
      const cloth = noise(x * 2, y * 2, 904) > 0.6;
      if (cloth) {
        t[y * S + x] = rgba(clamp(46 + n - depth), clamp(58 + n - depth), clamp(78 + n - depth));
      } else {
        t[y * S + x] = rgba(clamp(75 + n - depth), clamp(90 + n - depth), clamp(65 + n - depth));
      }
    }
  }

  // Faded undershirt and apartment key on a string
  for (let y = Math.floor(20 * sc); y < Math.floor(35 * sc); y++) {
    const wobble = Math.floor(Math.sin(y * 0.7 / sc) * 1.5 * sc);
    for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
      t[y * S + cx + wobble + dx] = rgba(122, 116, 92);
      if (y > 25 * sc && y < 32 * sc) t[y * S + cx + wobble + 1 + dx] = rgba(70, 64, 42);
    }
  }

  for (let y = Math.floor(21 * sc); y < Math.floor(37 * sc); y++) {
    if ((y & 3) === 0) continue;
    for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
      t[y * S + Math.floor(cx - 4 * sc) + dx] = rgba(135, 128, 112);
      t[y * S + Math.floor(cx + 4 * sc) + dx] = rgba(135, 128, 112);
    }
  }

  // Arms — dangling, one shorter (torn)
  for (let y = Math.floor(20 * sc); y < Math.floor(40 * sc); y++) {
    const lx = Math.floor(cx - (8 + (y / sc - 20) * 0.15) * sc);
    const rx = Math.floor(cx + (8 + (y / sc - 20) * 0.1) * sc);
    for (let dx = 0; dx < Math.max(1, Math.floor(3 * sc)); dx++) {
      if (lx + dx >= 0 && lx + dx < S) {
        const n = noise(lx + dx, y, 905) * 15;
        t[y * S + lx + dx] = rgba(clamp(70 + n), clamp(85 + n), clamp(60 + n));
      }
      if (rx + dx < S && y < 36 * sc) {
        const n = noise(rx + dx, y, 906) * 15;
        t[y * S + rx + dx] = rgba(clamp(70 + n), clamp(85 + n), clamp(60 + n));
      }
    }
  }

  // Legs
  for (let y = Math.floor(44 * sc); y < Math.floor(60 * sc); y++) {
    const n = noise(cx - 3 * sc, y, 907) * 15;
    for (let dx = 0; dx < Math.max(1, Math.floor(3 * sc)); dx++) {
      t[y * S + Math.floor(cx - 3 * sc) + dx] = rgba(clamp(55 + n), clamp(50 + n), clamp(45 + n));
      t[y * S + Math.floor(cx + 2 * sc) + dx] = rgba(clamp(55 + n), clamp(50 + n), clamp(45 + n));
    }
  }

  for (let dx = 0; dx < Math.max(1, Math.floor(3 * sc)); dx++) {
    t[Math.floor(60 * sc) * S + Math.floor(cx - 4 * sc) + dx] = rgba(85, 45, 35);
    t[Math.floor(60 * sc) * S + Math.floor(cx + 2 * sc) + dx] = rgba(38, 38, 42);
  }

  // Blood splatters
  for (let i = 0; i < 12 * sc; i++) {
    const bx = Math.floor(cx - 6 * sc + noise(i, 0, 908) * 12 * sc);
    const by = Math.floor(20 * sc + noise(0, i, 909) * 30 * sc);
    for (let dy = 0; dy < Math.max(1, Math.floor(2 * sc)); dy++) {
      for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
        if (bx + dx >= 0 && bx + dx < S && by + dy < S && t[(by + dy) * S + bx + dx] !== CLEAR) {
          t[(by + dy) * S + bx + dx] = rgba(clamp(100 + noise(bx + dx, by + dy, 910) * 30), 20, 15);
        }
      }
    }
  }

  outline(t, rgba(10, 15, 10));
  return t;
}
