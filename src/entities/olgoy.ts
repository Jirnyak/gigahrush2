/* ── Olgoy-Khorkhoy: collector meat worm ─────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.OLGOY,
  name: 'Олгой-Хорхой',
  hp: 118,
  speed: 0.95,
  dmg: 22,
  attackRate: 2.25,
  sprite: 0,
  aiFlags: ['foodBait', 'meatWorm'],
  floors: [FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Не деритесь у воды, трубы или провала: Олгой медленен на сухом полу, но у коллектора кусает тяжелее и подтягивает к пасти. Сырое мясо отвлекает его лучше хлеба.',
  lootHint: 'бледная шкура, кровяная слизь, редкая мясная руна из пасти коллектора',
};

function put(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  for (let y = 8; y < 62; y++) {
    const bend = Math.sin(y * 0.09) * 3.2;
    const taper = y < 28 ? 0 : (y - 28) * 0.08;
    const half = 13.5 - taper + Math.sin(y * 0.21) * 1.2;
    for (let x = Math.floor(cx - half + bend); x <= Math.ceil(cx + half + bend); x++) {
      const dx = (x - cx - bend) / Math.max(1, half);
      const dy = (y - 36) / 31;
      if (dx * dx + dy * dy > 1.08) continue;
      const n = noise(x, y, 13_013);
      const band = (Math.floor((y + Math.sin(x * 0.25) * 3) / 7) & 1) ? -12 : 8;
      t[y * S + x] = rgba(
        clamp(190 + n * 30 + band),
        clamp(158 + n * 22 + band),
        clamp(146 + n * 18 + band),
      );
    }
  }

  for (let y = 13; y < 34; y++) {
    const dy = (y - 23) / 11;
    for (let x = 17; x <= 47; x++) {
      const dx = (x - cx) / 15;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const edge = d > 0.58;
      const n = noise(x, y, 13_020) * 24;
      t[y * S + x] = edge
        ? rgba(clamp(126 + n), clamp(48 + n * 0.4), clamp(42 + n * 0.35))
        : rgba(clamp(36 + n * 0.4), clamp(16 + n * 0.25), clamp(18 + n * 0.25));
    }
  }

  for (let a = 0; a < 18; a++) {
    const ang = (Math.PI * 2 * a) / 18;
    const x = Math.round(cx + Math.cos(ang) * 10.5);
    const y = Math.round(23 + Math.sin(ang) * 7.5);
    put(t, x, y, rgba(232, 214, 178));
    if (a % 2 === 0) put(t, x, y + 1, rgba(166, 72, 58));
  }

  for (let y = 34; y < 59; y += 7) {
    const bend = Math.floor(Math.sin(y * 0.09) * 3.2);
    for (let dx = -11; dx <= 11; dx++) {
      const x = Math.floor(cx + bend + dx);
      const c = Math.abs(dx) > 8 ? rgba(142, 96, 91) : rgba(154, 112, 106, 210);
      put(t, x, y + Math.floor(Math.sin(dx * 0.5)), c);
    }
  }

  for (let i = 0; i < 22; i++) {
    const x = 20 + Math.floor(noise(i, 3, 13_030) * 25);
    const y = 10 + Math.floor(noise(i, 9, 13_031) * 41);
    const wet = i % 3 === 0 ? rgba(156, 176, 188, 190) : rgba(216, 192, 184, 170);
    put(t, x, y, wet);
    if (x + 1 < S && i % 4 === 0) put(t, x + 1, y, rgba(106, 124, 138, 150));
  }

  put(t, 25, 16, rgba(20, 20, 24));
  put(t, 39, 16, rgba(20, 20, 24));
  put(t, 23, 18, rgba(42, 30, 32));
  put(t, 41, 18, rgba(42, 30, 32));

  return t;
}
