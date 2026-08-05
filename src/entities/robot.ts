/* ── Robot — industrial automaton (робот) ──────────────────────── */
/*   Non-anthropomorphic industrial machine — random arrangement   */
/*   of armored blocks, sensor clusters, welded plates, treads.   */
/*   Shoots plasma bolts. Each robot is procedurally unique.      */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.ROBOT,
  name: 'Робот',
  hp: 65,
  speed: 1.8,
  dmg: 18,
  attackRate: 1.8,
  sprite: 0,   // auto-assigned by generateSprites()
  isRanged: true,
  projSpeed: 9,
  projSprite: 0,        // auto-assigned
  floors: [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE],
  counterplay: 'Сойдите с прямой линии плазмы, дождитесь залпа и заходите в паузу перезарядки. Стена, дверь или аппарат срывают наведение.',
  lootHint: 'электронный лом, плата, проводка, редкая энергоячейка',
};

/* ── Static fallback sprite (used in sprite sheet) ────────────── */
export function generateSprite(): Uint32Array {
  return generateRobotSprite(42);
}

/* ── Plasma bolt projectile sprite ────────────────────────────── */
export function generatePlasmaSprite(): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2, cy = S / 2;
  for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) {
    const dx = (x - cx) / 5, dy = (y - cy) / 5;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1) {
      const bright = 1 - Math.sqrt(d2);
      t[y * S + x] = rgba(
        clamp(Math.floor(80 + bright * 175)),
        clamp(Math.floor(180 + bright * 75)),
        clamp(Math.floor(220 + bright * 35)),
      );
    }
  }
  return t;
}

/* helper: filled rect with optional noise */
function rect(
  t: Uint32Array, x0: number, y0: number, w: number, h: number,
  r: number, g: number, b: number, seed: number,
) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || x >= S || y < 0 || y >= S) continue;
    const n = noise(x, y, seed) * 18;
    t[y * S + x] = rgba(clamp(r + n), clamp(g + n), clamp(b + n));
  }
}

/* helper: outline rect (1px border) */
function rectOutline(
  t: Uint32Array, x0: number, y0: number, w: number, h: number,
  r: number, g: number, b: number,
) {
  for (let x = x0; x < x0 + w; x++) {
    if (x >= 0 && x < S) {
      if (y0 >= 0 && y0 < S) t[y0 * S + x] = rgba(r, g, b);
      const yb = y0 + h - 1;
      if (yb >= 0 && yb < S) t[yb * S + x] = rgba(r, g, b);
    }
  }
  for (let y = y0; y < y0 + h; y++) {
    if (y >= 0 && y < S) {
      if (x0 >= 0 && x0 < S) t[y * S + x0] = rgba(r, g, b);
      const xr = x0 + w - 1;
      if (xr >= 0 && xr < S) t[y * S + xr] = rgba(r, g, b);
    }
  }
}

export interface RobotCtx {
  t: Uint32Array;
  seed: number;
  cx: number;
  chX: number; chY: number; chW: number; chH: number;
  headX: number; headY: number; headW: number; headH: number;
  pr: number; pg: number; pb: number;
  ar: number; ag: number; ab: number;
  hr: number; hg: number; hb: number;
}

function drawChassis(ctx: RobotCtx) {
  const { t, seed, chX, chY, chW, chH, pr, pg, pb, ar, ag, ab, hr, hg, hb } = ctx;
  rect(t, chX, chY, chW, chH, pr, pg, pb, seed + 10);
  rectOutline(t, chX, chY, chW, chH, ar, ag, ab);

  // Panel lines / seams on chassis
  for (let i = 0; i < 2 + (seed % 2); i++) {
    const sy = chY + 4 + Math.floor(noise(i, 0, seed + 20) * (chH - 8));
    for (let x = chX + 1; x < chX + chW - 1; x++) {
      if (t[sy * S + x] !== CLEAR)
        t[sy * S + x] = rgba(clamp(ar - 5), clamp(ag - 5), clamp(ab - 5));
    }
  }

  // Rivets (small bright dots)
  for (let i = 0; i < 4 + (seed % 4); i++) {
    const rx = chX + 2 + Math.floor(noise(i, 1, seed + 30) * (chW - 4));
    const ry = chY + 2 + Math.floor(noise(1, i, seed + 31) * (chH - 4));
    if (rx >= 0 && rx < S && ry >= 0 && ry < S)
      t[ry * S + rx] = rgba(hr, hg, hb);
  }
}

function drawSideModules(ctx: RobotCtx, numModules: number) {
  const { t, seed, chX, chY, chW, chH, pr, pg, pb, ar, ag, ab } = ctx;
  for (let i = 0; i < numModules; i++) {
    const side = (noise(i, 2, seed + 40) > 0.5) ? 1 : -1;
    const mW = 5 + Math.floor(noise(i, 3, seed + 41) * 5);
    const mH = 6 + Math.floor(noise(3, i, seed + 42) * 8);
    const mY = chY + 2 + Math.floor(noise(i, 4, seed + 43) * (chH - mH - 2));
    const mX = side > 0 ? chX + chW : chX - mW;
    rect(t, mX, mY, mW, mH, ar, ag, ab, seed + 44 + i);
    rectOutline(t, mX, mY, mW, mH, pr - 30, pg - 30, pb - 25);
  }
}

function drawHead(ctx: RobotCtx) {
  const { t, seed, headX, headY, headW, headH, pr, pg, pb, ar, ag, ab } = ctx;
  rect(t, headX, headY, headW, headH, pr + 5, pg + 5, pb + 5, seed + 50);
  rectOutline(t, headX, headY, headW, headH, ar, ag, ab);
  const opticY = headY + Math.floor(headH / 2);
  for (let x = headX + 2; x < headX + headW - 2; x++) {
    if (x >= 0 && x < S && opticY >= 0 && opticY < S) t[opticY * S + x] = rgba(50, 220, 255);
  }
}

function drawSensors(ctx: RobotCtx, numSensors: number) {
  const { t, seed, chX, chY, chW, chH, headX, headY, headW, headH } = ctx;
  for (let i = 0; i < numSensors; i++) {
    const onHead = noise(i, 5, seed + 60) > 0.4;
    const sx = (onHead ? headX : chX) + 2 + Math.floor(noise(i, 6, seed + 61) *
      ((onHead ? headW : chW) - 4));
    const sy = (onHead ? headY : chY) + 1 + Math.floor(noise(6, i, seed + 62) *
      ((onHead ? headH : chH) - 3));
    if (sx < 0 || sx >= S || sy < 0 || sy >= S) continue;
    // Glowing color: red, yellow, or cyan
    const col = (seed + i) % 3;
    const colors: [number, number, number][] = [
      [255, 40, 30],   // red
      [255, 200, 40],  // yellow
      [40, 220, 255],  // cyan
    ];
    const [lr, lg, lb] = colors[col];
    t[sy * S + sx] = rgba(lr, lg, lb);
    // Glow halo (1px)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const px = sx + dx, py = sy + dy;
      if (px >= 0 && px < S && py >= 0 && py < S && t[py * S + px] !== CLEAR)
        t[py * S + px] = rgba(
          clamp(((t[py * S + px] & 0xFF) + lr) >> 1),
          clamp((((t[py * S + px] >> 8) & 0xFF) + lg) >> 1),
          clamp((((t[py * S + px] >> 16) & 0xFF) + lb) >> 1),
        );
    }
  }
}

function drawGunBarrel(ctx: RobotCtx) {
  const { t, seed, chX, chY, chW, chH, ar, ag, ab } = ctx;
  const gunSide = noise(0, 7, seed + 70) > 0.5 ? 1 : -1;
  const gunY = chY + Math.floor(chH * 0.4);
  const gunLen = 6 + Math.floor(noise(7, 0, seed + 71) * 6);
  const gunX = gunSide > 0 ? chX + chW : chX - gunLen;
  rect(t, gunX, gunY, gunLen, 3, ar - 10, ag - 10, ab - 10, seed + 72);
  const coilX = gunSide > 0 ? chX + chW - 2 : chX + 1;
  for (let i = 0; i < 3; i++) {
    const coilY = gunY - 2 + i * 2;
    if (coilX >= 0 && coilX < S && coilY >= 0 && coilY < S) {
      t[coilY * S + coilX] = rgba(60, 210, 245);
      if (coilX + gunSide >= 0 && coilX + gunSide < S) t[coilY * S + coilX + gunSide] = rgba(25, 105, 135);
    }
  }
  // Muzzle glow
  const muzzX = gunSide > 0 ? gunX + gunLen - 1 : gunX;
  if (muzzX >= 0 && muzzX < S) {
    t[gunY * S + muzzX] = rgba(80, 180, 220);
    t[(gunY + 1) * S + muzzX] = rgba(100, 200, 240);
    t[(gunY + 2) * S + muzzX] = rgba(80, 180, 220);
  }
}

function drawLocomotion(ctx: RobotCtx, hasTreads: boolean) {
  const { t, seed, cx, chX, chY, chW, chH } = ctx;
  const baseY = chY + chH;
  if (hasTreads) {
    // Rectangular treads on both sides
    const tW = 5, tH = 8;
    rect(t, chX - 2, baseY, tW, tH, 50, 50, 50, seed + 80);
    rect(t, chX + chW - tW + 2, baseY, tW, tH, 50, 50, 50, seed + 81);
    // Tread pattern (horizontal lines)
    for (let i = 0; i < tH; i += 2) {
      for (let x = chX - 2; x < chX - 2 + tW; x++)
        if (x >= 0 && x < S && baseY + i < S)
          t[(baseY + i) * S + x] = rgba(35, 35, 35);
      for (let x = chX + chW - tW + 2; x < chX + chW + 2; x++)
        if (x >= 0 && x < S && baseY + i < S)
          t[(baseY + i) * S + x] = rgba(35, 35, 35);
    }
  } else {
    // Blocky legs (2-3 segments)
    const legOff = 3 + (seed % 3);
    for (const dx of [-legOff, legOff]) {
      const lx = cx + dx - 1;
      rect(t, lx, baseY, 3, 5 + (seed % 3), 60, 60, 60, seed + 82);
      rect(t, lx - 1, baseY + 5 + (seed % 3), 5, 2, 50, 50, 50, seed + 83);
    }
  }
}

function drawAntenna(ctx: RobotCtx, hasAntenna: boolean) {
  if (!hasAntenna) return;
  const { t, seed, cx, headY } = ctx;
  const ax = cx + Math.floor((noise(0, 8, seed + 90) - 0.5) * 6);
  for (let y = headY - 6; y < headY; y++) {
    if (y >= 0 && ax >= 0 && ax < S)
      t[y * S + ax] = rgba(100, 100, 110);
  }
  // Tip light
  if (headY - 7 >= 0 && ax >= 0 && ax < S)
    t[(headY - 7) * S + ax] = rgba(255, 50, 30);
}

function drawExhaust(ctx: RobotCtx) {
  const { t, chX, chY, chW, chH, pr, pg, pb } = ctx;
  const ventY = chY + chH - 5;
  const ventX = chX + 2;
  for (let i = 0; i < 3; i++) {
    const vy = ventY + i * 2;
    if (vy >= S) continue;
    for (let x = ventX; x < ventX + chW - 4; x++) {
      if (x >= 0 && x < S && vy >= 0 && t[vy * S + x] !== CLEAR)
        t[vy * S + x] = rgba(clamp(pr - 35), clamp(pg - 35), clamp(pb - 30));
    }
  }
}

/* ── Procedural sprite from seed — each robot unique ──────────── */
export function generateRobotSprite(seed: number): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Seed-derived parameters
  const hueType    = seed % 3;           // 0=gunmetal, 1=rust-orange, 2=military-green
  const numModules = 2 + (seed % 3);     // 2-4 side modules
  const numSensors = 2 + (seed % 4);     // 2-5 sensor lights
  const hasTreads  = (seed % 2) === 0;   // treads or legs
  const hasAntenna = (seed % 3) === 0;   // antenna on top

  const palettes: [number, number, number][] = [
    [80, 85, 90],    // gunmetal grey
    [110, 70, 45],   // rust orange
    [65, 80, 55],    // military olive
  ];
  const [pr, pg, pb] = palettes[hueType];
  // Darker accent
  const [ar, ag, ab] = [pr - 20, pg - 20, pb - 15];
  // Bright highlight for edges/rivets
  const [hr, hg, hb] = [pr + 30, pg + 30, pb + 25];

  const chW = 16 + (seed % 6);          // 16-21
  const chH = 20 + (seed % 8);          // 20-27
  const chX = cx - Math.floor(chW / 2);
  const chY = 18;

  const headW = 10 + (seed % 5);
  const headH = 6 + (seed % 4);
  const headX = cx - Math.floor(headW / 2);
  const headY = chY - headH + 1;

  const ctx: RobotCtx = {
    t, seed, cx,
    chX, chY, chW, chH,
    headX, headY, headW, headH,
    pr, pg, pb,
    ar, ag, ab,
    hr, hg, hb,
  };

  drawChassis(ctx);
  drawSideModules(ctx, numModules);
  drawHead(ctx);
  drawSensors(ctx, numSensors);
  drawGunBarrel(ctx);
  drawLocomotion(ctx, hasTreads);
  drawAntenna(ctx, hasAntenna);
  drawExhaust(ctx);

  return t;
}
