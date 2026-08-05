/* ── Rzhavnik — scrap-disguise shelf ambusher ────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.RZHAVNIK,
  name: 'Ржавник',
  hp: 72,
  speed: 1.35,
  dmg: 13,
  attackRate: 1.55,
  sprite: 0,
  aiFlags: ['scrapWake'],
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Ровная стопка железа у стеллажа может прыгнуть первой: проверьте ее выстрелом или держите дистанцию, переждите рывок и добейте хрупкий корпус.',
  lootHint: 'ржавчина, обломок арматуры, черная масляная ветошь, редкий годный прут',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = color;
}

function rust(x: number, y: number, bright = 0): number {
  const n = noise(x * 2, y * 3, 7321) * 28 - 10;
  const flake = noise(x * 5, y * 4, 7322) > 0.64 ? 32 : 0;
  return rgba(
    clamp(128 + n + flake + bright),
    clamp(64 + n * 0.45 + bright * 0.3),
    clamp(32 + n * 0.2 - flake * 0.25),
  );
}

function dusty(x: number, y: number): number {
  const n = noise(x, y, 7331) * 18 - 6;
  return rgba(clamp(156 + n), clamp(151 + n), clamp(138 + n), 210);
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, seed: number, w = 1): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    if (i < 2 && noise(seed, i, 7341) > 0.45) continue;
    if (i > steps - 3 && noise(seed, i, 7342) > 0.52) continue;
    const x = Math.round(x0 + dx * k + (noise(i, seed, 7343) > 0.84 ? (dy > 0 ? 1 : -1) : 0));
    const y = Math.round(y0 + dy * k);
    for (let ox = -w; ox <= w; ox++) {
      put(t, x + ox, y, rust(x + ox, y, i % 7 === 0 ? 18 : 0));
    }
    if (noise(x, y, seed + 31) > 0.78) put(t, x, y + 1, rgba(24, 20, 17));
  }
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, color: (x: number, y: number) => number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      put(t, x, y, color(x, y));
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = Math.floor(S / 2);

  // Black oil shadow under the pile keeps the idle silhouette low.
  ellipse(t, cx, 55, 24, 6, (x, y) => {
    const a = clamp(150 + noise(x, y, 7351) * 55);
    return rgba(18, 14, 12, a);
  });

  // Suspiciously straight idle stack: parallel rods like useful scrap.
  for (let i = 0; i < 7; i++) {
    const y = 36 + i * 3;
    const x0 = cx - 22 + (i % 2);
    const x1 = cx + 22 - (i % 3);
    line(t, x0, y, x1, y + (i === 3 ? 0 : (i % 2)), 7360 + i, i === 2 ? 1 : 0);
  }

  // Crooked walker shape unfolding out of the stack.
  line(t, cx - 5, 38, cx - 18, 58, 7391, 1);
  line(t, cx + 4, 38, cx + 19, 57, 7392, 1);
  line(t, cx - 2, 40, cx + 13, 25, 7393, 0);
  line(t, cx + 3, 41, cx - 13, 25, 7394, 0);
  line(t, cx - 10, 47, cx + 12, 47, 7395, 1);

  // Concrete dust and missing rod ends.
  for (let i = 0; i < 46; i++) {
    const x = cx - 24 + Math.floor(noise(i, 1, 7401) * 48);
    const y = 31 + Math.floor(noise(i, 2, 7402) * 28);
    if (noise(x, y, 7403) < 0.5) {
      put(t, x, y, dusty(x, y));
      if (noise(x, y, 7404) > 0.7) put(t, x + 1, y, dusty(x + 1, y));
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = cx - 21 + Math.floor(noise(i, 3, 7411) * 42);
    const y = 35 + Math.floor(noise(i, 4, 7412) * 18);
    put(t, x, y, rgba(20, 16, 13));
    if (x + 1 < S) put(t, x + 1, y, rgba(20, 16, 13));
  }

  // Tiny hot glints only after the player has learned to doubt straight scrap.
  put(t, cx - 4, 34, rgba(238, 82, 24));
  put(t, cx + 5, 35, rgba(255, 128, 36));
  put(t, cx + 6, 35, rgba(110, 34, 18));

  return t;
}
