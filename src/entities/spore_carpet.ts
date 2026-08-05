/* ── Spore Carpet: domestic lurking rug trap ─────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SPORE_CARPET,
  name: 'Ковер',
  hp: 24,
  speed: 0.82,
  dmg: 4,
  attackRate: 1.4,
  sprite: 0,
  aiFlags: ['lurkingFurniture'],
  floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Смотрите на поднятые углы и зеленые жилы: обходите проем, жгите с дистанции или держите фильтр до пересечения ковра.',
  lootHint: 'плесневелая бахрома, споровый отпечаток, редкий фильтрующий слой из старой подкладки',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

function drawVein(t: Uint32Array, sx: number, sy: number, len: number, seed: number): void {
  let x = sx;
  let y = sy;
  for (let i = 0; i < len; i++) {
    const jx = Math.floor((noise(i, seed, 9041) - 0.5) * 3);
    const jy = Math.floor((noise(seed, i, 9042) - 0.5) * 3);
    put(t, x + jx, y + jy, rgba(18, 62, 35, 220));
    if (i % 4 === 0) put(t, x + jx + 1, y + jy, rgba(108, 148, 82, 185));
    x += noise(i, seed, 9043) > 0.48 ? 1 : -1;
    y += noise(seed, i, 9044) > 0.25 ? 1 : 0;
    if (x < 10) x = 10;
    if (x > 54) x = 54;
    if (y < 18) y = 18;
    if (y > 51) y = 51;
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const paletteRoll = noise(9, 9, 9001);
  const base = paletteRoll < 0.42
    ? [118, 42, 31]
    : paletteRoll < 0.72
      ? [83, 78, 72]
      : [35, 28, 24];

  for (let y = 36; y < 58; y++) {
    const halfW = 18 - Math.abs(y - 48) * 0.55;
    for (let x = Math.floor(32 - halfW); x <= Math.ceil(32 + halfW); x++) {
      const dx = (x - 32) / Math.max(1, halfW);
      const dy = (y - 48) / 9;
      if (dx * dx + dy * dy > 1.08) continue;
      put(t, x, y, rgba(0, 0, 0, Math.floor((1 - Math.abs(dx)) * 62)));
    }
  }

  for (let y = 15; y < 53; y++) {
    const v = (y - 15) / 38;
    const skew = Math.floor((v - 0.5) * 5);
    const left = Math.floor(9 + v * 5 + noise(y, 1, 9010) * 2);
    const right = Math.floor(55 - v * 3 - noise(y, 2, 9011) * 3);
    for (let x = left; x <= right; x++) {
      const u = (x - left) / Math.max(1, right - left);
      const edge = u < 0.05 || u > 0.95 || v < 0.07 || v > 0.93;
      const rag = edge && noise(x, y, 9012) > 0.72;
      if (rag) continue;
      const stripe = Math.sin((u + v * 0.18) * 34) > 0.68 ? 18 : 0;
      const n = noise(x * 2, y, 9013) * 28;
      const mold = edge ? 28 : 0;
      put(t, x + skew, y, rgba(
        clamp(base[0] + stripe - mold + n),
        clamp(base[1] + stripe + mold * 0.8 + n * 0.45),
        clamp(base[2] + stripe * 0.45 + mold * 0.25),
        238,
      ));
    }
  }

  for (let y = 16; y < 29; y++) {
    for (let x = 44; x < 58; x++) {
      const fold = x - 44 > (y - 16) * 0.7;
      if (!fold || noise(x, y, 9020) > 0.88) continue;
      put(t, x, y, rgba(30, 20, 17, 238));
      if ((x + y) % 5 === 0) put(t, x - 1, y, rgba(136, 108, 82, 160));
    }
  }

  for (let i = 0; i < 9; i++) {
    const sx = 14 + Math.floor(noise(i, 0, 9030) * 34);
    const sy = 18 + Math.floor(noise(i, 1, 9031) * 23);
    drawVein(t, sx, sy, 7 + Math.floor(noise(i, 2, 9032) * 15), 9050 + i * 31);
  }

  for (let i = 0; i < 58; i++) {
    const x = 8 + Math.floor(noise(i, 3, 9060) * 49);
    const y = noise(i, 4, 9061) > 0.5 ? 13 : 53 + Math.floor(noise(i, 5, 9062) * 4);
    put(t, x, y, rgba(185, 197, 154, 120 + Math.floor(noise(i, 6, 9063) * 70)));
    if (noise(i, 7, 9064) > 0.55) put(t, x, y + 1, rgba(120, 148, 96, 120));
  }

  for (let i = 0; i < 36; i++) {
    const x = 10 + Math.floor(noise(i, 8, 9070) * 45);
    const y = 17 + Math.floor(noise(i, 9, 9071) * 35);
    if (noise(x, y, 9072) > 0.62) put(t, x, y, rgba(190, 214, 154, 128));
  }

  return t;
}
