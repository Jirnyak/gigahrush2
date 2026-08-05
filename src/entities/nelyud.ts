/* ── Nelyud: false human, attacks only after close reveal ────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.NELYUD,
  name: 'Нелюдь',
  hp: 80,
  speed: 1.8,
  dmg: 18,
  attackRate: 1.4,
  sprite: 0,
  aiFlags: ['closeReveal'],
  floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY, FloorLevel.MINISTRY],
  counterplay: 'Проверяйте дистанцией: молчаливого соседа не подпускайте без света, свидетеля и свободного выхода за спиной.',
  lootHint: 'фальшивый пропуск, слишком ровная бытовая вещь, редкий детектор нелюдей',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 5; y < 18; y++) for (let x = cx - 5; x <= cx + 5; x++) {
    const dx = (x - cx) / 5;
    const dy = (y - 11) / 7;
    if (dx * dx + dy * dy < 1) {
      const n = noise(x, y, 8600) * 18;
      t[y * S + x] = rgba(clamp(145 + n), clamp(120 + n), clamp(105 + n));
    }
  }

  for (let y = 18; y < 46; y++) {
    const halfW = y < 24 ? 8 : 7;
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      if (x < 0 || x >= S) continue;
      const cloth = noise(x, y, 8601) > 0.45;
      t[y * S + x] = cloth ? rgba(65, 72, 85) : rgba(55, 55, 60);
    }
  }

  for (let y = 22; y < 47; y++) {
    const drift = y < 34 ? 0 : Math.floor((y - 34) / 4);
    const nL = noise(y, 2, 8602) > 0.52 ? 8 : -4;
    const nR = noise(2, y, 8603) > 0.5 ? 6 : -5;
    const lx = Math.floor(cx - 8 - drift);
    const rx = Math.floor(cx + 8 + drift);
    if (lx >= 0) t[y * S + lx] = rgba(clamp(52 + nL), clamp(52 + nL), clamp(58 + nL));
    if (rx < S) t[y * S + rx] = rgba(clamp(55 + nR), clamp(55 + nR), clamp(62 + nR));
  }

  for (let y = 39; y < 51; y++) {
    const x = Math.floor(cx - 10 + (y - 39) * 0.15);
    if (x >= 0 && x < S) t[y * S + x] = rgba(144, 112, 94);
  }
  for (let y = 37; y < 48; y++) {
    const x = Math.floor(cx + 10 - (y - 37) * 0.25);
    if (x >= 0 && x < S) t[y * S + x] = rgba(134, 102, 86);
  }

  for (let y = 46; y < 60; y++) {
    t[y * S + (cx - 3)] = rgba(35, 35, 38);
    t[y * S + (cx + 3)] = rgba(35, 35, 38);
  }

  for (let x = cx - 6; x <= cx + 6; x++) {
    if ((x + 1) % 3 === 0) t[25 * S + x] = rgba(42, 42, 48);
  }
  for (let y = 24; y < 43; y++) {
    if (y % 2 === 0) t[y * S + cx] = rgba(36, 36, 42);
  }

  t[11 * S + (cx - 2)] = rgba(20, 20, 20);
  t[11 * S + (cx + 2)] = rgba(20, 20, 20);
  t[10 * S + (cx + 3)] = rgba(68, 10, 16);
  t[13 * S + (cx - 1)] = rgba(82, 12, 18);
  t[14 * S + cx] = rgba(160, 20, 30);
  t[15 * S + cx] = rgba(74, 10, 14);
  return t;
}
