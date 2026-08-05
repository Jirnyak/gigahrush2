/* ── Paragraph: hostile paper clause, ranged psi bolt ────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.PARAGRAPH,
  name: 'Параграф',
  hp: 46,
  speed: 1.05,
  dmg: 15,
  attackRate: 2.35,
  sprite: 0,
  isRanged: true,
  projSpeed: 6.5,
  projSprite: 0,
  aiFlags: ['rangedClause'],
  floors: [FloorLevel.MINISTRY, FloorLevel.VOID],
  counterplay: 'Параграф уточняет по прямой на 15 клеток: ломайте линию видимости шкафом или углом, врывайтесь сразу после выстрела. В упоре он теряет дистанцию и не успевает дописать пункт.',
  lootHint: 'порванный приказ, сургучная пыль и формулировки, которые еще шевелятся',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 6; y < 58; y++) {
    const bend = Math.sin(y * 0.13) * 2.2;
    const fold = Math.sin(y * 0.31) > 0.75 ? 2 : 0;
    for (let x = cx - 13; x <= cx + 13 - fold; x++) {
      const px = Math.floor(x + bend);
      if (px < 0 || px >= S) continue;
      const n = noise(px, y, 8500) * 15;
      const edge = x <= cx - 12 || x >= cx + 12 - fold;
      t[y * S + px] = edge
        ? rgba(clamp(160 + n), clamp(150 + n), clamp(120 + n))
        : rgba(clamp(207 + n), clamp(200 + n), clamp(166 + n));
    }
  }

  for (let y = 13; y < 51; y += 5) {
    const len = 8 + Math.floor(noise(y, 0, 8501) * 13);
    const off = Math.floor(Math.sin(y * 0.13) * 2.2);
    for (let x = cx - 10; x < cx - 10 + len; x++) {
      const px = x + off;
      if (px >= 0 && px < S) t[y * S + px] = rgba(35, 35, 35);
    }
  }

  for (let y = 18; y < 42; y++) {
    const off = Math.floor(Math.sin(y * 0.13) * 2.2);
    if (y % 3 === 0) t[y * S + cx + off] = rgba(150, 20, 35);
  }

  const ink = rgba(25, 22, 18);
  for (let y = 18; y <= 36; y++) {
    const off = Math.floor(Math.sin(y * 0.13) * 2.2);
    if (y < 29) t[y * S + cx - 3 + off] = ink;
    if (y > 23) t[y * S + cx + 3 + off] = ink;
  }
  for (let dx = -5; dx <= 5; dx++) {
    t[19 * S + cx + dx] = ink;
    t[27 * S + cx + dx] = ink;
    t[35 * S + cx + dx] = ink;
  }

  for (let y = 41; y < 51; y++) {
    for (let x = cx + 3; x <= cx + 12; x++) {
      const dx = (x - (cx + 8)) / 5;
      const dy = (y - 46) / 5;
      if (dx * dx + dy * dy < 1) t[y * S + x] = rgba(155, 18, 28);
    }
  }
  return t;
}
