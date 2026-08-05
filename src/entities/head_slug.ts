/* ── Head slug: visible host parasite with detachable body ───── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const HEAD_SLUG_HOSTED_STAGE = 0;
export const HEAD_SLUG_DETACHED_STAGE = 1;

export const DEF: MonsterDef = {
  kind: MonsterKind.HEAD_SLUG,
  name: 'Головной слизень',
  hp: 58,
  speed: 1.48,
  dmg: 6,
  attackRate: 1.15,
  sprite: 0,
  aiFlags: ['hostParasite'],
  floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Убейте носителя на дистанции и добейте слизня до переползания; огонь, УФ и закрытая гермодверь покупают время.',
  lootHint: 'мокрая нервная слизь, карантинная карта, редкий антибиотик из сорванного носителя',
};

function dot(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

function paintLine(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    dot(t, Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), color);
  }
}

function paintSlugMass(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, seed) * 28;
      const vein = noise(x, y, seed + 41) > 0.78;
      t[y * S + x] = vein
        ? rgba(clamp(54 + n), clamp(22 + n * 0.3), clamp(36 + n * 0.45))
        : rgba(clamp(136 + n), clamp(94 + n * 0.55), clamp(105 + n * 0.65), 238);
    }
  }
}

export function generateSlugSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  paintSlugMass(t, cx, 28, 11, 9, 17201);

  for (let i = 0; i < 6; i++) {
    const x = 22 + i * 4;
    const bend = Math.sin(i * 1.7) * 5;
    paintLine(t, x, 34, x + bend, 47 + (i & 1) * 3, rgba(104, 68, 78, 220));
  }

  for (let i = 0; i < 5; i++) {
    const x = 25 + i * 4;
    const y = 24 + (i & 1);
    dot(t, x, y, rgba(218, 208, 188, 245));
    dot(t, x + 1, y, rgba(38, 28, 34, 250));
  }

  return t;
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 25; y < 51; y++) {
    const halfW = y < 31 ? 7 : y < 43 ? 9 : 6;
    const sway = Math.sin(y * 0.18) * 1.4;
    for (let x = Math.floor(cx - halfW + sway); x <= Math.ceil(cx + halfW + sway); x++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 17230) * 18;
      const coat = noise(x, y, 17231) > 0.48;
      t[y * S + x] = coat
        ? rgba(clamp(54 + n), clamp(66 + n), clamp(78 + n))
        : rgba(clamp(86 + n), clamp(72 + n), clamp(66 + n));
    }
  }

  for (let y = 30; y < 49; y++) {
    dot(t, Math.floor(cx - 10 - Math.sin(y * 0.4) * 2), y, rgba(92, 70, 68));
    dot(t, Math.floor(cx + 10 + Math.sin(y * 0.36) * 2), y, rgba(92, 70, 68));
  }
  for (let y = 49; y < 60; y++) {
    dot(t, Math.floor(cx - 4), y, rgba(34, 34, 38));
    dot(t, Math.floor(cx + 4), y, rgba(34, 34, 38));
  }

  for (let y = 17; y < 25; y++) {
    const halfW = 5 - Math.abs(y - 21) * 0.35;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      dot(t, x, y, rgba(38, 18, 22, 180));
    }
  }

  paintSlugMass(t, cx + 1, 14, 10, 8, 17202);
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(cx - 8 + i * 4);
    paintLine(t, x, 20, x + Math.sin(i * 1.9) * 4, 32 + (i & 1) * 2, rgba(116, 66, 78, 225));
  }
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(cx - 5 + i * 4);
    dot(t, x, 12 + (i & 1), rgba(224, 214, 190, 245));
    dot(t, x + 1, 12 + (i & 1), rgba(28, 22, 26, 250));
  }

  return t;
}
