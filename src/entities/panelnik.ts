/* ── Panelnik: wall-braced panel bruiser ─────────────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.PANELNIK,
  name: 'Панельник',
  hp: 96,
  speed: 1.08,
  dmg: 16,
  attackRate: 1.45,
  sprite: 0,
  aiFlags: ['wallBrace'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Выманивайте от стены в центр комнаты: у панели он держит броню и достает плитной рукой, в открытом полу замедляется.',
  lootHint: 'бетонная пыль, ржавые царапины арматуры, редкий герметик из плитного шва',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || px >= S || py < 0 || py >= S) return;
  t[py * S + px] = color;
}

function panelColor(x: number, y: number, seed: number, bright = 0): number {
  const n = noise(x * 2, y * 2, seed) * 30 - 10;
  const chip = noise(x * 5, y * 3, seed + 11) > 0.91 ? -34 : 0;
  return rgba(clamp(132 + n + bright + chip), clamp(128 + n + bright + chip), clamp(112 + n * 0.6 + bright + chip));
}

function organicColor(x: number, y: number): number {
  const n = noise(x * 2, y * 2, 12470) * 26;
  return rgba(clamp(70 + n), clamp(54 + n * 0.55), clamp(48 + n * 0.35));
}

function rect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, seed: number, bright = 0): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const edgeChip = (x === x0 || x === x1 || y === y0 || y === y1) && noise(x, y, seed + 31) > 0.72;
      if (edgeChip) continue;
      put(t, x, y, panelColor(x, y, seed, bright));
    }
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = Math.floor(S / 2);

  // Organic torso underneath the panel slabs.
  for (let y = 12; y < 58; y++) {
    const halfW = y < 22 ? 9 : y < 42 ? 12 : 8;
    const sway = Math.sin(y * 0.16) * 2;
    for (let x = Math.floor(cx - halfW + sway); x <= Math.ceil(cx + halfW + sway); x++) {
      const dx = (x - (cx + sway)) / halfW;
      const dy = (y - 34) / 25;
      if (dx * dx + dy * dy > 1.05) continue;
      put(t, x, y, organicColor(x, y));
    }
  }

  // Broad concrete shoulder slab and belly plates.
  rect(t, cx - 17, 16, cx + 14, 25, 12500, 4);
  rect(t, cx - 13, 27, cx + 9, 36, 12520);
  rect(t, cx - 10, 39, cx + 8, 49, 12540, -6);

  // One arm is a fused panel rib. The brighter dusty edge is the active armor cue.
  for (let y = 18; y < 55; y++) {
    const x0 = cx - 23 + Math.floor(Math.sin(y * 0.11) * 2);
    for (let w = 0; w < 6; w++) {
      const bright = w <= 1 ? 54 : 10;
      put(t, x0 + w, y, panelColor(x0 + w, y, 12600, bright));
    }
    if (y % 6 === 0) {
      put(t, x0 - 2, y, rgba(214, 204, 172));
      put(t, x0 + 7, y + 1, rgba(92, 74, 58));
    }
  }

  // Shorter meat arm, kept dark so the fused slab reads first.
  for (let y = 24; y < 48; y++) {
    const x = cx + 15 + Math.floor(Math.sin(y * 0.24) * 2);
    put(t, x, y, organicColor(x, y));
    put(t, x + 1, y, organicColor(x + 1, y));
  }

  // Rebar scratches and wall-facing scrape marks.
  for (let i = 0; i < 9; i++) {
    const y = 20 + i * 4;
    const startX = cx - 16 + (i % 3) * 5;
    for (let k = 0; k < 10; k++) {
      const x = startX + k;
      put(t, x, y + Math.floor(k * 0.25), rgba(72, 58, 48));
    }
  }
  for (let y = 21; y < 52; y += 5) {
    for (let k = 0; k < 8; k++) put(t, cx - 27 + k, y + (k & 1), rgba(196, 184, 150));
  }

  // Chipped panel corners and rusty rebar darks.
  for (const [x, y] of [[cx - 17, 16], [cx + 14, 25], [cx - 13, 36], [cx + 8, 49]] as const) {
    put(t, x, y, CLEAR);
    put(t, x + 1, y, rgba(58, 47, 41));
    put(t, x, y + 1, rgba(62, 50, 43));
  }
  for (const x of [cx - 11, cx - 2, cx + 7]) {
    for (let y = 14; y < 52; y += 3) {
      if (noise(x, y, 12650) > 0.42) put(t, x, y, rgba(86, 52, 38));
    }
  }

  // Raw red mouth seam under the concrete brow.
  for (let x = cx - 6; x <= cx + 5; x++) {
    put(t, x, 28, rgba(146, 22, 24));
    if ((x - cx) % 3 === 0) put(t, x, 29, rgba(214, 42, 36));
  }
  put(t, cx - 4, 18, rgba(244, 226, 172));
  put(t, cx + 5, 18, rgba(244, 226, 172));

  return t;
}
