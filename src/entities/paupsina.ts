/* ── Paupsina: fast web-spitting service spider ──────────────── */

import { FloorLevel, MonsterKind, ProjType } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const PAUPSINA_WEB_COOLDOWN_SEC = 2.65;

export const DEF: MonsterDef = {
  kind: MonsterKind.PAUPSINA,
  name: 'Паупсина',
  hp: 32,
  speed: 2.25,
  dmg: 0,
  attackRate: PAUPSINA_WEB_COOLDOWN_SEC,
  sprite: 0,
  isRanged: true,
  projSpeed: 9.5,
  projType: ProjType.WEB,
  aiFlags: ['webSpitter'],
  floors: [FloorLevel.KVARTIRY, FloorLevel.LIVING, FloorLevel.MAINTENANCE],
  counterplay: 'Сеть летит по прямой и держит недолго: ломайте линию дверью или стеллажом, режьте ножом/пилой, жгите огнем или наказывайте дробью вблизи.',
  lootHint: 'бледные нитки, обломки сбруи, липкий мешок, редкий моток проволоки',
};

function put(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  t[y * S + x] = rgba(r, g, b, a);
}

function ell(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed: number, a = 255): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(S - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(S - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    if (dx * dx + dy * dy > 1) continue;
    const n = noise(x, y, seed) * 20 - 8;
    put(t, x, y, clamp(r + n), clamp(g + n), clamp(b + n * 0.7), a);
  }
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a = 255): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    put(t, Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), r, g, b, a);
  }
}

export function generateSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;
  const leg = [22, 27, 33, 39] as const;

  for (const y of leg) {
    const spread = 8 + (y - 22) * 0.28;
    line(t, cx - 8, y, cx - 23, y - spread * 0.35, 42, 30, 22);
    line(t, cx - 23, y - spread * 0.35, cx - 30, y + spread * 0.12, 56, 39, 26);
    line(t, cx + 8, y, cx + 23, y - spread * 0.35, 42, 30, 22);
    line(t, cx + 23, y - spread * 0.35, cx + 30, y + spread * 0.12, 56, 39, 26);
  }

  ell(t, cx + 9, 34, 12, 11, 188, 186, 158, 17_030, 235);
  for (let y = 26; y <= 42; y += 4) line(t, cx + 2, y, cx + 18, y + 6, 218, 218, 190, 185);
  for (let x = 3; x <= 17; x += 4) line(t, cx + x, 25, cx + x - 7, 43, 226, 226, 198, 120);

  ell(t, cx - 3, 32, 15, 9, 54, 34, 24, 17_031);
  ell(t, cx - 15, 30, 8, 7, 39, 28, 22, 17_032);
  ell(t, cx - 6, 26, 10, 4, 82, 52, 32, 17_033, 210);

  for (let i = 0; i < 4; i++) {
    put(t, cx - 19 + i * 2, 27, 220, 38, 32);
    put(t, cx - 19 + i * 2, 28, 140, 18, 20);
  }

  line(t, cx - 18, 35, cx - 23, 43, 116, 238, 82);
  line(t, cx - 12, 36, cx - 16, 44, 116, 238, 82);
  line(t, cx + 3, 24, cx + 12, 20, 112, 72, 46, 220);
  line(t, cx + 10, 20, cx + 16, 24, 98, 40, 34, 220);
  put(t, cx + 18, 25, 210, 210, 186, 210);

  return t;
}
