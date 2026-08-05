/* ── Polzun — low crawling horror ─────────────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.POLZUN,
  name: 'Ползун',
  hp: 168,
  speed: 0.85,
  dmg: 22,
  attackRate: 2.25,
  sprite: 0,   // auto-assigned by generateSprites()
  aiFlags: ['foodBait'],
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Медленный, но в двери, ванной или воде уже рядом: отходите по прямой, не спиной к сантехнике, и уводите приманкой в сторону.',
  lootHint: 'мокрая ветошь, ванная грязь, редкий фильтрующий слой',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Floor smear anchors the silhouette below human knee height.
  for (let y = 53; y < 62; y++) for (let x = Math.floor(cx - 24); x <= Math.ceil(cx + 24); x++) {
    if (x < 0 || x >= S) continue;
    const dx = (x - cx) / 24;
    const dy = (y - 57) / 5;
    if (dx * dx + dy * dy < 1) {
      const n = noise(x, y, 665) * 12;
      t[y * S + x] = rgba(clamp(34 + n), clamp(31 + n), clamp(25 + n));
    }
  }

  // Flat wide body near bottom
  for (let y = 37; y < 59; y++) {
    const halfW = 23 - Math.abs(y - 50) * 0.35;
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / halfW, dy = (y - 50) / 10;
      if (dx * dx + dy * dy < 1) {
        const n = noise(x, y, 666) * 25;
        const vein = Math.sin(x * 0.7 + y * 0.3) * 10;
        const floorDark = y > 53 ? -16 : 0;
        t[y * S + x] = rgba(clamp(58 + n + vein + floorDark), clamp(52 + n + floorDark), clamp(39 + n + floorDark));
      }
    }
  }

  // Dragging forelimbs make it read as a crawler, not a standing blob.
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 15; i++) {
      const x = Math.floor(cx + side * (10 + i));
      const y = 45 + Math.floor(i * 0.75);
      if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = rgba(54, 42, 32);
      if (x >= 0 && x < S && y + 1 < S) t[(y + 1) * S + x] = rgba(37, 31, 25);
    }
  }

  // Low head protrusion
  for (let y = 31; y < 43; y++) for (let x = Math.floor(cx - 7); x <= Math.ceil(cx + 7); x++) {
    const dx = (x - cx) / 7, dy = (y - 38) / 6;
    if (dx * dx + dy * dy > 1) continue;
    const n = noise(x, y, 667) * 15;
    t[y * S + x] = rgba(clamp(68 + n), clamp(58 + n), clamp(43 + n));
  }
  // Eyes
  t[36 * S + (cx - 3)] = rgba(255, 200, 50);
  t[36 * S + (cx + 3)] = rgba(255, 200, 50);
  t[37 * S + (cx - 3)] = rgba(180, 70, 28);
  t[37 * S + (cx + 3)] = rgba(180, 70, 28);
  return t;
}
