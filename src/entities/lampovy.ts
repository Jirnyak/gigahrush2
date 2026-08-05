/* ── Lampovy: light-fed monster, stronger near lamps ─────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.LAMPOVY,
  name: 'Ламповый',
  hp: 38,
  speed: 1.75,
  dmg: 11,
  attackRate: 1.0,
  sprite: 0,
  aiFlags: ['lampPowered'],
  floors: [FloorLevel.LIVING, FloorLevel.KVARTIRY, FloorLevel.MINISTRY, FloorLevel.MAINTENANCE],
  counterplay: 'Не деритесь под лампой: уводите на три клетки от света или за угол, а доступный выключатель используйте до сближения.',
  lootHint: 'перегоревшая нить, стекло, запах озона, редкий предохранитель',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 12; y < 56; y++) {
    const halfW = y < 24 ? 8 : y < 44 ? 10 : 6;
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx) / halfW;
      const edge = Math.abs(dx) * 35;
      const n = noise(x, y, 8200) * 24;
      t[y * S + x] = rgba(clamp(90 + n - edge), clamp(80 + n - edge), clamp(45 + n * 0.5));
    }
  }

  for (let r = 0; r < 12; r++) {
    for (let a = 0; a < 18; a++) {
      const ang = (a / 18) * Math.PI * 2;
      const px = Math.floor(cx + Math.cos(ang) * r);
      const py = Math.floor(17 + Math.sin(ang) * r * 0.75);
      if (px >= 0 && px < S && py >= 0 && py < S) {
        const f = 1 - r / 12;
        t[py * S + px] = rgba(clamp(210 + f * 45), clamp(165 + f * 70), clamp(40 + f * 80), clamp(180 + f * 75));
      }
    }
  }

  for (let y = 8; y < 26; y++) t[y * S + cx] = rgba(255, 230, 120);
  return t;
}
