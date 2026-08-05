/* ── Zakalyonnaya Armatura: slow armored rebar elite ──────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.ZAKALENNAYA_ARMATURA,
  name: 'Закаленная Арматура',
  hp: 265,
  speed: 0.62,
  dmg: 31,
  attackRate: 2.9,
  sprite: 0,
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Броня держит ножи и панические пули: ведите вокруг станков, срывайте темп дробью, кувалдой, гранатой или тяжелым оружием.',
  lootHint: 'закаленный прут, бетонная окалина, обломок бронеплиты',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = Math.floor(S / 2);

  const put = (x: number, y: number, color: number): void => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || px >= S || py < 0 || py >= S) return;
    t[py * S + px] = color;
  };

  const steel = (x: number, y: number, bright = 0): number => {
    const n = noise(x * 2, y * 3, 31031) * 24 - 9;
    return rgba(
      clamp(42 + n + bright),
      clamp(47 + n + bright),
      clamp(50 + n + bright * 0.8),
    );
  };

  const concrete = (x: number, y: number, bright = 0): number => {
    const n = noise(x * 4, y * 2, 31032) * 28 - 10;
    return rgba(
      clamp(96 + n + bright),
      clamp(95 + n + bright),
      clamp(88 + n + bright * 0.7),
    );
  };

  const heat = (x: number, y: number): number => {
    const n = noise(x * 5, y * 5, 31033) * 32;
    return rgba(clamp(214 + n), clamp(76 + n * 0.35), clamp(22 + n * 0.15));
  };

  const rod = (x0: number, y0: number, x1: number, y1: number, width: number, seed: number): void => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const x = x0 + (x1 - x0) * f + (noise(i, seed, 31034) - 0.5) * 0.9;
      const y = y0 + (y1 - y0) * f;
      for (let ox = -width; ox <= width; ox++) {
        put(x + ox, y, steel(x + ox, y, ox === 0 ? 12 : 0));
      }
    }
  };

  // Dense shadow core so the elite reads as a body, not loose scrap.
  for (let y = 9; y < 60; y++) {
    const sway = Math.sin(y * 0.1) * 1.5;
    const half = y < 19 ? 6 : y < 47 ? 8 : 10;
    for (let x = Math.floor(cx - half + sway); x <= Math.ceil(cx + half + sway); x++) {
      if (noise(x, y, 31035) < 0.1) continue;
      put(x, y, rgba(25, 27, 28));
    }
  }

  // Parallel rebar bones: the silhouette stays upright and mechanical.
  for (const rx of [cx - 10, cx - 5, cx, cx + 5, cx + 10]) {
    rod(rx, 4, rx + Math.sin(rx) * 2, 59, rx === cx ? 1 : 0, rx);
  }
  rod(cx - 15, 24, cx + 15, 48, 1, 7);
  rod(cx + 14, 24, cx - 15, 47, 1, 11);
  rod(cx - 18, 52, cx + 17, 56, 1, 13);

  // Slab shoulders and welded knots make weak melee look wrong.
  for (let y = 13; y <= 24; y++) {
    for (let x = cx - 22; x <= cx + 22; x++) {
      const left = x < cx - 3;
      const right = x > cx + 3;
      const shoulder = (left || right) && Math.abs(x - cx) + Math.abs(y - 17) < 27;
      if (!shoulder || noise(x, y, 31036) < 0.06) continue;
      put(x, y, steel(x, y, 18));
      if (noise(x * 2, y * 2, 31037) > 0.82) put(x, y, concrete(x, y, -10));
    }
  }
  for (const knot of [
    { x: cx - 12, y: 29, r: 5 },
    { x: cx + 11, y: 34, r: 5 },
    { x: cx - 8, y: 45, r: 4 },
    { x: cx + 8, y: 50, r: 4 },
  ]) {
    for (let dy = -knot.r; dy <= knot.r; dy++) for (let dx = -knot.r; dx <= knot.r; dx++) {
      if (dx * dx + dy * dy > knot.r * knot.r || noise(dx, dy, 31038) < 0.12) continue;
      put(knot.x + dx, knot.y + dy, concrete(knot.x + dx, knot.y + dy));
    }
  }

  // Heat scars live only in cracks between plates, not as a glow blob.
  const scars = [
    [cx - 14, 18, cx - 7, 23],
    [cx + 6, 20, cx + 15, 17],
    [cx - 5, 33, cx + 3, 39],
    [cx + 9, 43, cx + 16, 49],
  ] as const;
  for (const [x0, y0, x1, y1] of scars) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const x = x0 + (x1 - x0) * f;
      const y = y0 + (y1 - y0) * f;
      put(x, y, heat(x, y));
      if (i % 3 === 0) put(x + 1, y, rgba(94, 34, 20));
    }
  }

  // Small cold head gap and hot eye slits.
  for (let y = 6; y < 13; y++) {
    for (let x = cx - 7; x <= cx + 7; x++) {
      if (Math.abs(x - cx) + Math.abs(y - 10) > 10) continue;
      put(x, y, steel(x, y, 10));
    }
  }
  put(cx - 3, 10, rgba(246, 96, 30));
  put(cx + 3, 10, rgba(246, 96, 30));
  put(cx - 3, 11, rgba(126, 38, 22));
  put(cx + 3, 11, rgba(126, 38, 22));

  return t;
}
