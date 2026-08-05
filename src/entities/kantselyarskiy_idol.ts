/* ── Kantselyarskiy Idol: office-field PSI hazard ────────────── */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.KANTSELYARSKIY_IDOL,
  name: 'Канцелярский Идол',
  hp: 72,
  speed: 0,
  dmg: 18,
  attackRate: 2.9,
  sprite: 0,
  isRanged: true,
  projSpeed: 7.2,
  projSprite: 0,
  aiFlags: ['officeField'],
  floors: [FloorLevel.MINISTRY],
  counterplay: 'Офисное поле сильнее у столов, шкафов и бумаг в кармане: прячьтесь за шкафом, сближайтесь в упор после залпа или сбросьте лишние бланки в контейнер.',
  lootHint: 'желтая бумажная пыль, грязный латунный уголок, обломок красной печати',
};

function put(t: Uint32Array, x: number, y: number, color: number): void {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || px >= S || py < 0 || py >= S) return;
  t[py * S + px] = color;
}

function rect(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, seed = 0): void {
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(S - 1, Math.floor(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(S - 1, Math.floor(x1)); x++) {
      const n = seed === 0 ? 0 : noise(x, y, seed) * 16 - 8;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n)));
    }
  }
}

function ellipse(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, seed = 0): void {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(S - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(S - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const n = seed === 0 ? 0 : noise(x, y, seed) * 14 - 7;
      put(t, x, y, rgba(clamp(r + n), clamp(g + n), clamp(b + n)));
    }
  }
}

function line(t: Uint32Array, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    put(t, Math.round(x0 + (x1 - x0) * u), Math.round(y0 + (y1 - y0) * u), rgba(r, g, b));
  }
}

function paper(t: Uint32Array, x: number, y: number, w: number, h: number, seed: number): void {
  rect(t, x, y, x + w, y + h, 216, 201, 128, seed);
  line(t, x + 1, y + 2, x + w - 1, y + 2, 70, 62, 42);
  if (w > 5) line(t, x + 1, y + h - 2, x + w - 2, y + h - 2, 156, 24, 30);
}

export function generateSprite(): Uint32Array {
  return generateKantselyarskiyIdolSprite(13838);
}

export function generateKantselyarskiyIdolSprite(seed: number): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S >> 1;

  // Loose paper halo, with a longer right-side run that reads as the aimed office line.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + noise(i, 0, seed + 10) * 0.35;
    const rr = 19 + noise(i, 1, seed + 11) * 6;
    const x = cx + Math.cos(a) * rr - 3 + noise(i, 2, seed + 12) * 3;
    const y = 24 + Math.sin(a) * (rr * 0.62) - 2 + noise(i, 3, seed + 13) * 3;
    paper(t, x, y, 5 + Math.floor(noise(i, 4, seed + 14) * 4), 4, seed + 100 + i);
  }
  for (let i = 0; i < 4; i++) paper(t, 42 + i * 4, 21 + (i & 1), 7, 4, seed + 140 + i);

  // Rigid desk-base and dirty brass corners.
  rect(t, 9, 42, 55, 56, 23, 22, 20, seed + 20);
  rect(t, 12, 38, 52, 44, 37, 31, 22, seed + 21);
  rect(t, 10, 40, 16, 46, 126, 95, 42, seed + 22);
  rect(t, 48, 40, 54, 46, 126, 95, 42, seed + 23);
  rect(t, 18, 47, 46, 50, 8, 8, 9, seed + 24);

  // Black official fused into the desk.
  ellipse(t, cx, 17, 6, 8, 8, 8, 10, seed + 30);
  rect(t, cx - 8, 23, cx + 8, 44, 6, 7, 8, seed + 31);
  rect(t, cx - 13, 29, cx - 8, 43, 5, 5, 6, seed + 32);
  rect(t, cx + 8, 29, cx + 13, 43, 5, 5, 6, seed + 33);

  // Red stamp marks align into a false face.
  for (let dx = -4; dx <= 4; dx++) {
    if (Math.abs(dx) !== 1) put(t, cx + dx, 17, rgba(152, 18, 24));
    if (dx % 2 === 0) put(t, cx + dx, 23, rgba(178, 24, 28));
  }
  put(t, cx - 3, 15, rgba(210, 28, 32));
  put(t, cx + 3, 15, rgba(210, 28, 32));
  line(t, cx - 5, 27, cx + 5, 27, 116, 12, 18);
  line(t, cx - 4, 31, cx + 4, 33, 144, 18, 24);

  // Ink/legal scoring on the base.
  for (let y = 46; y <= 53; y += 3) {
    line(t, 18, y, 42 + Math.floor(noise(y, 0, seed + 60) * 8), y, 58, 50, 36);
  }
  for (let i = 0; i < 11; i++) {
    const x = 15 + i * 3;
    put(t, x, 39, rgba(155, 22, 28));
    if (i % 3 === 0) put(t, x + 1, 40, rgba(180, 30, 34));
  }

  return t;
}
