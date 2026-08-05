/* ── Eye — flying demonic eye (глаз) ──────────────────────────── */
/*   Ranged monster: shoots projectiles like a cacodemon.        */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { rgba, noise, clamp, CLEAR, outline } from '../render/pixutil';
const S = 128;

export const DEF: MonsterDef = {
  kind: MonsterKind.EYE,
  name: 'Глаз',
  hp: 20,
  speed: 2.2,
  dmg: 14,
  attackRate: 2.5,
  sprite: 0,   // auto-assigned by generateSprites()
  isRanged: true,
  projSpeed: 8,
  projSprite: 0,        // auto-assigned to Spr.EYE_BOLT
  aiFlags: ['flying'],
  floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Зеленый разогрев значит залп: ломайте линию огня углом или дверью до вспышки, затем сближайтесь, пока глаз перезаряжается.',
  lootHint: 'перегоревшая нить, стеклянная пыль, редкая лампа или ПСИ-пыль',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const sc = S / 64; // scale multiplier

  // Spherical body — fleshy red-pink
  for (let y = Math.floor(8 * sc); y < Math.floor(56 * sc); y++) {
    for (let x = Math.floor(8 * sc); x < Math.floor(56 * sc); x++) {
      const dx = (x - cx) / (22 * sc), dy = (y - cy) / (22 * sc);
      const d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        const n = noise(x, y, 1001) * 20;
        const shade = Math.sqrt(d2) * 60; // deeper shade for volume
        t[y * S + x] = rgba(
          clamp(150 + n - shade),
          clamp(50 + n - shade),
          clamp(55 + n - shade),
        );
      }
    }
  }

  // Veins — darker red lines radiating from center
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4 + noise(i, 0, 1002) * 0.5;
    for (let r = Math.floor(8 * sc); r < Math.floor(20 * sc); r++) {
      for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) { // thicker veins
        const vx = Math.floor(cx + Math.cos(ang) * r + noise(r, i, 1003) * 2 * sc) + dx;
        const vy = Math.floor(cy + Math.sin(ang) * r + noise(i, r, 1004) * 2 * sc);
        if (vx >= 0 && vx < S && vy >= 0 && vy < S && t[vy * S + vx] !== CLEAR) {
          t[vy * S + vx] = rgba(100, 20, 25);
        }
      }
    }
  }

  // Giant central eye — white sclera
  for (let y = Math.floor(cy - 10 * sc); y < Math.floor(cy + 10 * sc); y++) {
    for (let x = Math.floor(cx - 12 * sc); x < Math.floor(cx + 12 * sc); x++) {
      const dx = (x - cx) / (12 * sc), dy = (y - cy) / (10 * sc);
      if (dx * dx + dy * dy < 1) {
        t[y * S + x] = rgba(230, 225, 210);
      }
    }
  }

  // Iris — sickly yellow-green
  for (let y = Math.floor(cy - 6 * sc); y < Math.floor(cy + 6 * sc); y++) {
    for (let x = Math.floor(cx - 6 * sc); x < Math.floor(cx + 6 * sc); x++) {
      const dx = (x - cx) / (6 * sc), dy = (y - cy) / (6 * sc);
      if (dx * dx + dy * dy < 1) {
        const n = noise(x, y, 1005) * 30;
        t[y * S + x] = rgba(clamp(180 + n), clamp(200 + n), clamp(40 + n));
      }
    }
  }

  // Pupil — vertical slit (reptilian)
  for (let y = Math.floor(cy - 5 * sc); y < Math.floor(cy + 5 * sc); y++) {
    const slitW = Math.max(1, (2 - Math.abs(y - cy) * 0.3 / sc) * sc);
    for (let x = Math.floor(cx - slitW); x <= Math.floor(cx + slitW); x++) {
      if (x >= 0 && x < S) t[y * S + x] = rgba(5, 5, 5);
    }
  }

  // Small tentacles hanging below
  for (let i = -2; i <= 2; i++) {
    const tx = Math.floor(cx + i * 4 * sc);
    for (let y = Math.floor(cy + 20 * sc); y < Math.floor(cy + 20 * sc + (4 + noise(i + 3, 0, 1006) * 6) * sc); y++) {
      for (let dx = 0; dx < Math.max(1, Math.floor(2 * sc)); dx++) {
        if (y < S && tx + dx >= 0 && tx + dx < S) {
          const n = noise(tx + dx, y, 1007) * 15;
          t[y * S + tx + dx] = rgba(clamp(120 + n), clamp(40 + n), clamp(45 + n));
        }
      }
    }
  }

  outline(t, rgba(40, 10, 10));
  return t;
}

/* ── Eye bolt projectile sprite ───────────────────────────────── */
export function generateBoltSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  const sc = S / 64; // scale multiplier

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.abs(d - 9 * sc);
      const core = d < 5 * sc;
      const halo = d < 16 * sc;
      const ray = (Math.abs(dx) < 1.4 * sc && Math.abs(dy) < 17 * sc) || (Math.abs(dy) < 1.4 * sc && Math.abs(dx) < 17 * sc);
      const spark = noise(x * 2, y * 2, 1301) > 0.88 && d < 18 * sc;
      if (!core && !halo && !ray && !spark) continue;

      const f = Math.max(0, 1 - d / (16 * sc));
      const ringGlow = Math.max(0, 1 - ring / (2.5 * sc));
      const rayGlow = ray ? Math.max(0, 1 - d / (18 * sc)) : 0;
      const sparkGlow = spark ? 0.45 + noise(x, y, 1302) * 0.35 : 0;
      const bright = Math.max(f, ringGlow * 0.8, rayGlow * 0.65, sparkGlow);
      const a = clamp(Math.floor(45 + bright * 210));
      t[y * S + x] = rgba(
        clamp(Math.floor(90 + bright * 165)),
        clamp(Math.floor(190 + bright * 65)),
        clamp(Math.floor(35 + bright * 70)),
        a,
      );
    }
  }

  outline(t, rgba(100, 200, 20, 150), 50);
  return t;
}
