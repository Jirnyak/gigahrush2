/* ── Zhornaya Tvar: food-scent lunge predator ────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.ZHORNAYA_TVAR,
  name: 'Жорная Тварь',
  hp: 62,
  speed: 1.72,
  dmg: 19,
  attackRate: 2.65,
  sprite: 0,
  aiFlags: ['foodBait', 'scentOvercommit'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.HELL],
  counterplay: 'Запечатайте еду в контейнер или бросайте мясную приманку в сторону от своего пути: после промаха жорная тварь долго восстанавливается.',
  lootHint: 'сырой жир, зубная крошка, редкое сырое мясо',
};

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Low shoulders and folded belly: readable as a meat-heavy lunger.
  for (let y = 18; y < 58; y++) {
    const dy = (y - 39) / 20;
    const bellyFold = y > 39 ? 1.25 : 1;
    const halfW = (15 - Math.abs(dy) * 5) * bellyFold;
    const sway = Math.sin(y * 0.19) * 2;
    for (let x = Math.floor(cx - halfW + sway); x <= Math.ceil(cx + halfW + sway); x++) {
      if (x < 0 || x >= S) continue;
      const dx = (x - cx - sway) / halfW;
      if (dx * dx + dy * dy > 1.05) continue;
      const n = noise(x, y, 2525) * 24;
      const fold = y > 43 && Math.abs(Math.sin((x + y) * 0.35)) > 0.82 ? -22 : 0;
      t[y * S + x] = rgba(clamp(58 + n + fold), clamp(32 + n + fold), clamp(30 + n + fold));
    }
  }

  // Stretched jaw arc.
  for (let a = 0; a <= 24; a++) {
    const u = a / 24;
    const ang = Math.PI * (0.12 + u * 0.76);
    const x = Math.floor(cx + Math.cos(ang) * 17);
    const y = Math.floor(21 + Math.sin(ang) * 10);
    for (let w = -1; w <= 1; w++) {
      const px = x + w;
      if (px >= 0 && px < S && y >= 0 && y < S) {
        const n = noise(px, y, 2530) * 18;
        t[y * S + px] = rgba(clamp(92 + n), clamp(63 + n), clamp(42 + n));
      }
    }
    if (a % 2 === 0) {
      const toothY = Math.min(S - 1, y + 2 + (a % 4));
      if (x >= 0 && x < S) t[toothY * S + x] = rgba(218, 204, 150);
    }
  }

  // Wet streaks under head and belly.
  for (let i = 0; i < 11; i++) {
    const x = Math.floor(cx - 10 + i * 2 + Math.sin(i) * 1.5);
    const y0 = 26 + (i % 3) * 3;
    const len = 8 + (i * 7) % 13;
    for (let y = y0; y < y0 + len && y < S; y++) {
      if (x < 0 || x >= S) continue;
      const n = noise(x, y, 2535) * 16;
      t[y * S + x] = rgba(clamp(34 + n), clamp(20 + n), clamp(18 + n));
    }
  }

  // Greasy yellow highlights and concrete-dust claws.
  for (const [ox, oy] of [[-11, 31], [12, 33], [-8, 48], [9, 49]]) {
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(cx + ox + i * Math.sign(ox));
      const y = oy + Math.floor(i * 0.45);
      if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = rgba(178, 144, 54);
    }
  }
  for (const [ox, oy] of [[-18, 54], [-13, 56], [14, 56], [19, 54]]) {
    const x = Math.floor(cx + ox);
    if (x >= 0 && x < S && oy >= 0 && oy < S) t[oy * S + x] = rgba(154, 148, 128);
  }

  // Sniffing tendrils: broken lines near the mouth.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x0 = cx + side * (8 + i);
    const y0 = 21 + i;
    for (let j = 0; j < 7; j++) {
      if ((j + i) % 3 === 0) continue;
      const x = Math.floor(x0 + side * j);
      const y = y0 + Math.floor(Math.sin(j * 0.7 + i) * 2);
      if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = rgba(126, 84, 58);
    }
  }

  // Scent-lock readability: open red jaw and contracted yellow belly ribs.
  for (let x = Math.floor(cx - 8); x <= Math.ceil(cx + 8); x++) {
    if (x >= 0 && x < S) {
      t[23 * S + x] = rgba(118, 18, 16);
      if (x % 3 === 0) t[41 * S + x] = rgba(142, 112, 42);
    }
  }

  return t;
}
