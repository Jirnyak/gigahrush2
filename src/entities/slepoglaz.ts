/* -- Slepoglaz: blind last-sound beam turret ------------------- */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SLEPOGLAZ,
  name: 'Слепоглаз',
  hp: 52,
  speed: 0.62,
  dmg: 24,
  attackRate: 3.4,
  sprite: 0,
  aiFlags: ['lastSoundBeam'],
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Слепоглаз заряжает зеленую линию туда, где вы шумели или стояли секунду назад: шумните, шагните в сторону и сближайтесь сразу после луча, пока он слеп и слаб в упоре.',
  lootHint: 'зеленая стеклянная пыль, серые перепонки, редкий слепой нерв',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const cy = S / 2 - 2;

  for (let y = 7; y < 55; y++) {
    for (let x = 10; x < 54; x++) {
      const dx = (x - cx) / 17;
      const dy = (y - cy) / 23;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const edge = Math.sqrt(d2) * 42;
      const n = noise(x, y, 9280) * 22;
      const membrane = y > cy + 7 ? 10 : 0;
      t[y * S + x] = rgba(
        clamp(82 + n - edge - membrane),
        clamp(116 + n - edge),
        clamp(82 + n * 0.5 - edge),
      );
    }
  }

  for (let y = 18; y < 42; y++) {
    const slitW = 13 - Math.abs(y - cy) * 0.42;
    if (slitW <= 0) continue;
    for (let x = Math.floor(cx - slitW); x <= Math.floor(cx + slitW); x++) {
      const dy = Math.abs(y - cy);
      const seam = Math.abs(x - cx) < slitW - 1;
      t[y * S + x] = seam
        ? rgba(18, 22, 18)
        : rgba(48, 62, 48);
      if (dy < 2 && Math.abs(x - cx) < 10) t[y * S + x] = rgba(6, 8, 7);
    }
  }

  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI * 0.9 + i * Math.PI * 0.2 + noise(i, 0, 9281) * 0.22;
    const len = 8 + Math.floor(noise(i, 1, 9282) * 13);
    for (let r = 3; r < len; r++) {
      const x = Math.floor(cx + Math.cos(ang) * r * 1.2);
      const y = Math.floor(cy + Math.sin(ang) * r * 0.9);
      if (x <= 0 || x >= S - 1 || y <= 0 || y >= S - 1) continue;
      if (t[y * S + x] === CLEAR) continue;
      t[y * S + x] = rgba(36, 44, 38);
    }
  }

  for (let i = -4; i <= 4; i++) {
    const baseX = Math.floor(cx + i * 3.3);
    const len = 7 + Math.floor(noise(i + 6, 0, 9283) * 12);
    for (let j = 0; j < len; j++) {
      const x = baseX + Math.floor(Math.sin(j * 0.7 + i) * 1.4);
      const y = Math.floor(cy + 23 + j);
      if (x < 0 || x >= S || y < 0 || y >= S) continue;
      const n = noise(x, y, 9284) * 16;
      t[y * S + x] = rgba(clamp(48 + n), clamp(70 + n), clamp(54 + n));
    }
  }

  for (let r = 0; r < 10; r++) {
    const alpha = clamp(170 - r * 13);
    for (let a = -2; a <= 2; a++) {
      const x = Math.floor(cx + 15 + r);
      const y = Math.floor(cy + a + Math.sin(r * 0.8) * 1.2);
      if (x >= 0 && x < S && y >= 0 && y < S) {
        t[y * S + x] = rgba(clamp(92 + r * 8), clamp(210 + r * 3), clamp(82 + r * 2), alpha);
      }
    }
  }

  return t;
}
