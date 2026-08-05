/* ── Chernosliz: black-water ambush turret ───────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.CHERNOSLIZ,
  name: 'Чернослиз',
  hp: 18,
  speed: 0.5,
  dmg: 18,
  attackRate: 3.1,
  sprite: 0,
  isRanged: true,
  projSpeed: 9,
  projSprite: 0,
  aiFlags: ['blackWaterWake'],
  floors: [FloorLevel.MAINTENANCE],
  counterplay: 'Не входите лицом в черную воду: подсветите лоток, киньте шумовую банку или дайте пробный выстрел, потом тяните чернослиз на сухую кромку.',
  lootHint: 'проба черной слизи, стеклянная пыль, редкий мутный зрачок из коллектора',
};

function put(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = rgba(r, g, b, a);
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const surfaceY = 36;

  for (let y = surfaceY - 3; y < S; y++) {
    const wave = Math.sin(y * 0.35) * 2.2;
    const half = 22 - Math.max(0, y - surfaceY) * 0.16;
    for (let x = Math.floor(cx - half + wave); x <= Math.ceil(cx + half + wave); x++) {
      const dx = (x - cx - wave) / Math.max(1, half);
      const dy = (y - surfaceY) / 26;
      if (dx * dx + dy * dy > 1.05) continue;
      const n = noise(x * 2, y * 2, 7721) * 18;
      t[y * S + x] = rgba(clamp(3 + n), clamp(5 + n), clamp(8 + n), clamp(210 + n * 2));
    }
  }

  for (let y = 12; y <= surfaceY + 2; y++) {
    for (let x = 15; x < 49; x++) {
      const dx = (x - cx) / 16;
      const dy = (y - 31) / 20;
      const d = dx * dx + dy * dy;
      if (d > 1 || y > surfaceY + Math.sin(x * 0.45) * 1.8) continue;
      const rim = Math.max(0, d - 0.64) * 95;
      const n = noise(x, y, 7731) * 24;
      const violet = noise(x * 3, y, 7732) > 0.74 ? 34 : 0;
      t[y * S + x] = rgba(
        clamp(12 + n - rim + violet),
        clamp(11 + n * 0.5 - rim),
        clamp(17 + n + violet),
      );
    }
  }

  for (let y = 20; y < 38; y++) {
    const open = Math.max(1, 3 - Math.abs(y - 29) * 0.18);
    for (let x = Math.floor(cx - open); x <= Math.ceil(cx + open); x++) {
      const glow = Math.max(0, 1 - Math.abs(x - cx) / Math.max(1, open + 1));
      put(t, x, y, clamp(50 + glow * 60), clamp(190 + glow * 55), clamp(60 + glow * 60));
    }
    put(t, cx, y, 4, 10, 5);
  }

  for (let x = 10; x < 54; x++) {
    const y = surfaceY + Math.round(Math.sin(x * 0.37) * 1.4);
    put(t, x, y, 1, 2, 3, 250);
    if (x % 3 === 0) put(t, x, y - 1, 75, 52, 98, 145);
  }

  for (let i = 0; i < 20; i++) {
    const bx = 11 + Math.floor(noise(i, 1, 7741) * 42);
    const by = surfaceY + 3 + Math.floor(noise(i, 2, 7742) * 19);
    const c = noise(i, 3, 7743);
    put(t, bx, by, c > 0.55 ? 56 : 18, c > 0.55 ? 38 : 18, c > 0.55 ? 82 : 24, 170);
    if (noise(i, 4, 7744) > 0.65) put(t, bx + 1, by, 90, 64, 118, 120);
  }

  for (let i = 0; i < 5; i++) {
    const y = surfaceY + 4 + i * 4;
    const span = 12 + i * 3;
    for (let x = cx - span; x <= cx + span; x += 2) {
      if (noise(x, y, 7751) < 0.22) put(t, x, y, 38, 44, 54, 120);
    }
  }

  return t;
}
