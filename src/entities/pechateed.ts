/* ── Pechateed: document eater, smells notes and keys ────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.PECHATEED,
  name: 'Печатеед',
  hp: 58,
  speed: 1.62,
  dmg: 10,
  attackRate: 1.45,
  sprite: 0,
  aiFlags: ['documentHunter'],
  floors: [FloorLevel.MINISTRY, FloorLevel.KVARTIRY, FloorLevel.LIVING],
  counterplay: 'Чует документы как кровь: Сбросьте лишние бумаги, бланки и корешки в ящик до боя. Без бумажного запаха хуже ищет цель; держите дистанцию и теряйте его через углы.',
  lootHint: 'обглоданные бланки, кислые чернила и пустой формуляр без подписи',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 8; y < 56; y++) {
    const halfW = y < 20 ? 9 : y < 44 ? 12 : 8;
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      if (x < 0 || x >= S) continue;
      const fold = (Math.floor((x + y) / 5) & 1) ? -12 : 10;
      const n = noise(x, y, 8300) * 18;
      t[y * S + x] = rgba(clamp(185 + n + fold), clamp(172 + n + fold), clamp(135 + n + fold));
    }
  }

  for (let y = 14; y < 49; y += 5) {
    const len = 7 + Math.floor(noise(y, 0, 8302) * 12);
    for (let x = cx - 10; x < cx - 10 + len; x++) {
      if (x >= 0 && x < S) t[y * S + x] = rgba(42, 27, 22);
    }
  }

  for (let y = 12; y < 50; y += 9) {
    for (let dx = -9; dx <= 9; dx++) {
      const x = Math.floor(cx + dx);
      const yy = y + Math.floor(dx * 0.18);
      if (x >= 0 && x < S && yy >= 0 && yy < S) t[yy * S + x] = rgba(115, 18, 26);
    }
  }

  for (let dx = -10; dx <= 10; dx++) {
    const x = Math.floor(cx + dx);
    if (x >= 0 && x < S) t[31 * S + x] = rgba(78, 8, 9);
  }
  for (let dx = -8; dx <= 8; dx += 4) {
    const x = Math.floor(cx + dx);
    if (x >= 0 && x < S) t[32 * S + x] = rgba(224, 210, 168);
  }

  for (let y = 18; y < 52; y++) {
    const leftX = Math.floor(cx - 13 - noise(y, 0, 8303) * 2);
    const rightX = Math.floor(cx + 13 + noise(y, 1, 8303) * 2);
    const ink = y % 3 === 0;
    if (leftX >= 0) t[y * S + leftX] = ink ? rgba(30, 18, 28) : rgba(168, 155, 124);
    if (rightX < S) t[y * S + rightX] = ink ? rgba(30, 18, 28) : rgba(168, 155, 124);
  }

  t[21 * S + (cx - 4)] = rgba(18, 8, 7);
  t[21 * S + (cx + 4)] = rgba(18, 8, 7);
  return t;
}
