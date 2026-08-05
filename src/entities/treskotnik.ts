/* ── Treskotnik: brittle crack sprinter ──────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.TRESKOTNIK,
  name: 'Трескотник',
  hp: 18,
  speed: 2.75,
  dmg: 15,
  attackRate: 1.65,
  sprite: 0,
  aiFlags: ['fractureSprint'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL],
  counterplay: 'Стреляйте в красный треск во время короткого замирания, ломайте прямую углом или ставьте между собой дверь, стол, шкаф.',
  lootHint: 'бетонная крошка, красная пыль из трещин, редкий кусок хрупкой плиты',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

function drawCrack(t: Uint32Array, sx: number, sy: number, len: number, seed: number, dir: number): void {
  let x = sx;
  let y = sy;
  for (let i = 0; i < len; i++) {
    const jx = Math.floor((noise(i, seed, 21010) - 0.5) * 3);
    const jy = Math.floor((noise(seed, i, 21011) - 0.5) * 3);
    put(t, x + jx, y + jy, rgba(255, 44, 36));
    if (i % 3 === 0) put(t, x + jx + 1, y + jy, rgba(170, 16, 20));
    if (i % 5 === 0) put(t, x + jx, y + jy + 1, rgba(255, 92, 48));
    x += dir + Math.floor(noise(i, seed, 21012) * 2) - 1;
    y += 1 + Math.floor(noise(seed, i, 21013) * 2);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 11; y < 58; y++) {
    const lean = Math.sin(y * 0.2) * 2.4 - 1.2;
    const halfW = y < 22 ? 6 : y < 42 ? 8 : 5;
    for (let x = Math.floor(cx - halfW + lean); x <= Math.ceil(cx + halfW + lean); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx - lean) / Math.max(1, halfW);
      const dy = (y - 34) / 25;
      if (dx * dx + dy * dy * 0.45 > 1.08) continue;
      if (x < cx - 6 && y < 24) continue;
      if (x > cx + 3 && y > 47) continue;
      const n = noise(x, y, 21000) * 30;
      const seam = noise(x * 3, y * 2, 21001) > 0.86 ? -34 : 0;
      t[y * S + x] = rgba(clamp(94 + n + seam), clamp(98 + n + seam), clamp(98 + n + seam));
    }
  }

  for (let i = 0; i < 11; i++) {
    put(t, Math.floor(cx - 9 + noise(i, 2, 21020) * 2), 15 + i, rgba(36, 34, 32));
    put(t, Math.floor(cx + 4 + noise(i, 3, 21021) * 2), 48 + i, rgba(40, 36, 34));
  }

  const crackCount = 5 + Math.floor(noise(4, 7, 21030) * 5);
  for (let i = 0; i < crackCount; i++) {
    const sx = Math.floor(cx - 7 + noise(i, 1, 21031) * 14);
    const sy = 14 + Math.floor(noise(i, 2, 21032) * 25);
    const len = 8 + Math.floor(noise(i, 3, 21033) * 14);
    const dir = noise(i, 4, 21034) > 0.5 ? 1 : -1;
    drawCrack(t, sx, sy, len, 21100 + i * 17, dir);
  }

  for (let i = 0; i < 45; i++) {
    const x = Math.floor(cx - 13 + noise(i, 6, 21040) * 26);
    const y = 10 + Math.floor(noise(i, 7, 21041) * 47);
    if (noise(x, y, 21042) > 0.68) put(t, x, y, rgba(220, 32, 28, 170));
  }

  put(t, cx - 2, 18, rgba(255, 55, 44));
  put(t, cx + 3, 17, rgba(255, 55, 44));
  put(t, cx - 2, 19, rgba(140, 12, 16));
  put(t, cx + 3, 18, rgba(140, 12, 16));

  return t;
}
