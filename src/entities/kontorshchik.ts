/* ── Kontorshchik: document-scent undead clerk ───────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.KONTORSHCHIK,
  name: 'Конторщик',
  hp: 72,
  speed: 0.95,
  dmg: 12,
  attackRate: 1.65,
  sprite: 0,
  aiFlags: ['documentScent'],
  floors: [FloorLevel.MINISTRY, FloorLevel.LIVING],
  counterplay: 'Конторщик медленный без бумажного следа: сложите бланки, пропуска и печати в ящик или бросьте дешевую форму как приманку. У шкафов и столов рвите хват, пока бумага перестает шуметь.',
  lootHint: 'желтая папка, красная печать на рукаве, редкий пустой бланк',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function rect(t: Uint32Array, x0: number, y0: number, w: number, h: number, c: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) put(t, x, y, c);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = 31;
  const suit = rgba(58, 60, 64);
  const suitDark = rgba(34, 35, 39);
  const paper = rgba(205, 190, 142);
  const paperDark = rgba(150, 133, 96);
  const stamp = rgba(150, 22, 35);
  const face = rgba(92, 128, 88);

  for (let y = 17; y < 54; y++) {
    const shoulder = y < 28 ? 11 : 8;
    const taper = Math.max(0, Math.floor((y - 37) * 0.13));
    for (let x = cx - shoulder - taper; x <= cx + shoulder + taper; x++) {
      const n = Math.floor(noise(x, y, 2600) * 18);
      put(t, x, y, (x + y) % 5 === 0 ? rgba(44 + n, 45 + n, 49 + n) : suit);
    }
  }

  rect(t, cx - 12, 18, 5, 25, suitDark);
  rect(t, cx + 8, 18, 5, 25, suitDark);
  for (let y = 23; y < 53; y++) {
    put(t, cx - 1, y, rgba(28, 29, 34));
    if (y > 27 && y < 43) put(t, cx + 1, y, y % 4 === 0 ? rgba(92, 46, 86) : rgba(64, 34, 68));
  }

  for (let y = 9; y < 21; y++) {
    const ry = (y - 15) / 7;
    for (let x = cx - 6; x <= cx + 6; x++) {
      const rx = (x - cx) / 6;
      if (rx * rx + ry * ry <= 1) put(t, x, y, face);
    }
  }
  put(t, cx - 3, 14, rgba(12, 17, 13));
  put(t, cx + 3, 14, rgba(12, 17, 13));
  rect(t, cx - 4, 18, 8, 2, rgba(118, 104, 78));

  for (let y = 22; y < 47; y++) {
    const x0 = cx - 8 + Math.floor(Math.sin(y * 0.21) * 1.5);
    for (let x = x0; x < x0 + 11; x++) {
      const edge = x === x0 || x === x0 + 10;
      put(t, x, y, edge ? paperDark : paper);
    }
  }
  rect(t, cx - 6, 27, 8, 2, rgba(55, 38, 30));
  rect(t, cx - 6, 34, 7, 2, rgba(55, 38, 30));
  rect(t, cx - 4, 41, 9, 2, stamp);

  for (let i = 0; i < 9; i++) {
    const fromLeft = i % 2 === 0;
    const sx = fromLeft ? cx - 14 : cx + 13;
    const sy = 23 + i * 3;
    const len = 8 + Math.floor(noise(i, 3, 2610) * 10);
    const drift = fromLeft ? -1 : 1;
    for (let j = 0; j < len; j++) {
      const x = sx + drift * Math.floor(j * 0.28 + noise(i, j, 2611) * 2);
      const y = sy + j;
      put(t, x, y, j % 5 === 3 ? stamp : (j & 1) ? paperDark : paper);
    }
  }

  for (let y = 28; y < 44; y += 5) {
    const pull = 8 + Math.floor(noise(y, 0, 2620) * 3);
    for (let x = cx + 14; x < cx + 14 + pull; x++) put(t, x, y, paper);
    put(t, cx + 14 + pull, y, stamp);
  }

  for (let y = 53; y < 61; y++) {
    put(t, cx - 5, y, rgba(27, 28, 31));
    put(t, cx + 5, y, rgba(27, 28, 31));
  }

  for (let i = 0; i < 24; i++) {
    const x = 18 + Math.floor(noise(i, 7, 2630) * 28);
    const y = 13 + Math.floor(noise(i, 11, 2631) * 39);
    if (noise(i, 13, 2632) > 0.72) put(t, x, y, rgba(clamp(118 + i), 26, 42, 170));
  }

  return t;
}
