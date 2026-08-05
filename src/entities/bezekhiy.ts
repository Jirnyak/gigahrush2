/* ── Bezekhiy — door-threshold dead-echo ambusher ────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.BEZEKHIY,
  name: 'Безэхий',
  hp: 58,
  speed: 1.28,
  dmg: 9,
  attackRate: 1.45,
  sprite: 0,
  aiFlags: ['deadEcho'],
  floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY, FloorLevel.MINISTRY],
  counterplay: 'Проверяйте косяки до лута, закрывайте дверь за собой и проходите порог спиной назад: безэхий слаб лицом к лицу, но резко бьет в спину у открытого проема.',
  lootHint: 'серый дверной налет, белая ногтевая крошка, редкий шумовой крючок',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // A dirty floor strip from far away: flat, matte, and below knee height.
  for (let y = 43; y < 61; y++) {
    const bend = Math.sin(y * 0.31) * 2.2;
    const half = 23 - Math.abs(y - 52) * 0.68;
    for (let x = Math.floor(cx - half + bend); x <= Math.ceil(cx + half + bend); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx - bend) / Math.max(1, half);
      const dy = (y - 52) / 8.5;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, 823) * 20;
      const dust = noise(x * 2, y * 2, 824) > 0.62 ? 14 : 0;
      t[y * S + x] = rgba(clamp(70 + n + dust), clamp(70 + n + dust), clamp(66 + n));
    }
  }

  // Bent neck and pale gum line, offset so the silhouette is recognizable.
  for (let y = 34; y < 49; y++) {
    const nx = cx + 7 + Math.sin((y - 32) * 0.42) * 3.5;
    const rx = 6.2 - Math.max(0, y - 42) * 0.18;
    for (let x = Math.floor(nx - rx); x <= Math.ceil(nx + rx); x++) {
      const dx = (x - nx) / rx;
      const dy = (y - 42) / 8;
      if (dx * dx + dy * dy > 1) continue;
      const n = noise(x, y, 825) * 18;
      t[y * S + x] = rgba(clamp(62 + n), clamp(60 + n), clamp(57 + n));
    }
  }
  for (let x = 34; x < 46; x++) {
    const y = 43 + ((x & 1) === 0 ? 0 : 1);
    t[y * S + x] = rgba(203, 188, 174);
  }

  // Dusted elbows scrape like knots in a baseboard shadow.
  for (const elbow of [[18, 52], [28, 47], [42, 55], [50, 49]] as const) {
    const [ex, ey] = elbow;
    for (let y = ey - 2; y <= ey + 2; y++) for (let x = ex - 3; x <= ex + 3; x++) {
      const dx = (x - ex) / 3;
      const dy = (y - ey) / 2;
      if (dx * dx + dy * dy <= 1) t[y * S + x] = rgba(94, 92, 86);
    }
  }

  // Door-side white fingers: no glow, just wrong bright pixels on one edge.
  for (let i = 0; i < 9; i++) {
    const x = 50 + (i & 1);
    const y = 43 + i * 2;
    t[y * S + x] = rgba(224, 218, 205);
    if (y + 1 < S) t[(y + 1) * S + x] = rgba(142, 135, 124);
  }

  return t;
}
