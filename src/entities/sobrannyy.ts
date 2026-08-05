/* ── Sobrannyy chelovek: composite post-samosbor brute ───────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.SOBRANNYY,
  name: 'Собранный человек',
  hp: 260,
  speed: 1.18,
  dmg: 24,
  attackRate: 3.1,
  sprite: 0,
  aiFlags: ['meatGrowth'],
  floors: [FloorLevel.LIVING, FloorLevel.MAINTENANCE, FloorLevel.HELL],
  counterplay: 'Не будите его без выхода: ранний огонь, токсичная слизь и герметичный порог срывают погоню, а частая стрельба раздувает мясо только до ограниченного предела.',
  lootHint: 'обугленная ткань, костяная пуговица, редкий отчет ликвидаторов о составном теле',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = color;
}

function rect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, seed = 0): void {
  const lx = Math.max(0, Math.floor(x0));
  const rx = Math.min(S - 1, Math.floor(x1));
  const ty = Math.max(0, Math.floor(y0));
  const by = Math.min(S - 1, Math.floor(y1));
  for (let y = ty; y <= by; y++) {
    for (let x = lx; x <= rx; x++) {
      const n = seed === 0 ? 0 : noise(x, y, seed) * 18 - 9;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n)));
    }
  }
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed = 0, alpha = 255): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = seed === 0 ? 0 : noise(x, y, seed) * 20 - 10;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n), alpha));
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Fused coat hem dragging lower than the body.
  for (let y = 40; y < 62; y++) {
    const left = cx - 10 - Math.sin(y * 0.22) * 2;
    const right = cx + 13 + Math.sin(y * 0.17) * 1.5;
    for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
      const rag = noise(x, y, 8010) > 0.18;
      if (rag) put(t, x, y, rgba(34 + noise(x, y, 8011) * 18, 31, 30));
    }
  }

  // Oversized lumpy vertical torso.
  ellipse(t, cx - 2, 32, 14, 25, 54, 38, 30, 8020);
  ellipse(t, cx + 6, 34, 12, 22, 44, 34, 31, 8021);
  ellipse(t, cx - 7, 35, 9, 20, 66, 42, 32, 8022);

  // Three to five shoulder/head lobes.
  ellipse(t, cx - 11, 18, 8, 8, 72, 46, 36, 8030);
  ellipse(t, cx - 3, 13, 7, 9, 82, 54, 42, 8031);
  ellipse(t, cx + 6, 16, 8, 8, 58, 42, 38, 8032);
  ellipse(t, cx + 13, 21, 5, 6, 63, 46, 42, 8033);
  if (noise(1, 2, 8034) > 0.35) ellipse(t, cx - 17, 24, 5, 5, 52, 38, 34, 8035);

  // Asymmetric arms: one heavy, one fused hook.
  for (let y = 22; y < 51; y++) {
    const lx = Math.floor(cx - 16 - Math.sin(y * 0.2) * 2);
    for (let w = 0; w < 5; w++) put(t, lx - w, y, rgba(50, 34 + w * 3, 30));
  }
  for (let y = 20; y < 49; y++) {
    const rx = Math.floor(cx + 16 + Math.sin(y * 0.24) * 2);
    put(t, rx, y, rgba(92, 62, 50));
    put(t, rx + 2, y + 1, rgba(74, 48, 42));
    if (y % 6 === 0) put(t, rx + 4, y + 2, rgba(214, 203, 176));
  }
  for (let y = 46; y < 57; y++) {
    put(t, Math.floor(cx + 17 + (y - 46) * 0.25), y, rgba(208, 198, 170));
  }

  // Clothing bands from several garments.
  rect(t, cx - 12, 23, cx + 10, 26, 42, 45, 50, 8040);
  rect(t, cx - 9, 31, cx + 14, 34, 28, 50, 58, 8041);
  rect(t, cx - 13, 39, cx + 8, 42, 55, 38, 35, 8042);
  rect(t, cx - 7, 47, cx + 12, 50, 38, 36, 42, 8043);

  // Burned and wet patches plus dull red seams.
  for (let i = 0; i < 70; i++) {
    const x = 16 + Math.floor(noise(i, 1, 8050) * 33);
    const y = 16 + Math.floor(noise(i, 2, 8051) * 39);
    if ((t[y * S + x] >>> 24) === 0) continue;
    const wet = i % 5 === 0;
    put(t, x, y, wet ? rgba(22, 54, 58, 210) : rgba(16, 12, 10));
  }

  for (let y = 18; y < 54; y++) {
    const seamX = Math.floor(cx + Math.sin(y * 0.28) * 4);
    put(t, seamX, y, rgba(125, 32, 30));
    if (y % 7 === 0) {
      put(t, seamX - 1, y, rgba(205, 190, 164));
      put(t, seamX + 1, y, rgba(205, 190, 164));
    }
  }

  // Pale seams and several dead eye dots make the composite readable at 64 px.
  for (let y = 24; y < 48; y += 4) {
    for (let dx = -8; dx <= 9; dx += 4) {
      const x = Math.floor(cx + dx + Math.sin(y * 0.2));
      if ((t[y * S + x] >>> 24) !== 0) put(t, x, y, rgba(196, 184, 158));
    }
  }
  put(t, Math.floor(cx - 5), 14, rgba(238, 226, 198));
  put(t, Math.floor(cx + 4), 16, rgba(220, 210, 188));
  put(t, Math.floor(cx + 11), 21, rgba(190, 44, 38));

  return t;
}
