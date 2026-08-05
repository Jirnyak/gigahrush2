/* ── Idol — immobile psi monolith (идол) ──────────────────────── */
/*   A dark, irregular stone spire covered in eyes. Doesn't move */
/*   but attacks with devastating PSI bolts. Each idol is unique */
/*   — procedural shape from entity name hash.                   */

import { FloorLevel, MonsterKind } from '../core/types';
import type { MonsterDef } from './monster';
import { S, rgba, noise, clamp, CLEAR } from '../render/pixutil';

export const DEF: MonsterDef = {
  kind: MonsterKind.IDOL,
  name: 'Идол',
  hp: 100,
  speed: 0,            // immobile — does not move
  dmg: 30,
  attackRate: 2.0,
  sprite: 0,           // auto-assigned by generateSprites()
  isRanged: true,
  projSpeed: 12,
  projSprite: 0,       // auto-assigned to Spr.PSI_BOLT
  floors: [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.HELL, FloorLevel.VOID],
  counterplay: 'Идол не двигается: сбейте угол стеной или дверью и входите в упор между ПСИ-выстрелами.',
  lootHint: 'ПСИ-пыль, холодный культовый камень, редкий идол Чернобога или меточный сгусток',
};

/* ── Static fallback sprite (used in sprite sheet) ────────────── */
export function generateSprite(): Uint32Array {
  return generateIdolSprite(13666);
}

export interface IdolParams {
  t: Uint32Array;
  seed: number;
  cx: number;
  lean: number;
  baseW: number;
  topW: number;
  height: number;
  topY: number;
  botY: number;
  bR: number;
  bG: number;
  bB: number;
}

/* ── Procedural sprite from seed — each idol unique ────────────── */
export function generateIdolSprite(seed: number): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const cx = S / 2;

  // Hash-derived shape parameters
  const lean      = (noise(0, 0, seed + 10) - 0.5) * 6;       // slight tilt
  const baseW     = 10 + Math.floor(noise(0, 1, seed + 11) * 6); // 10-15 base width
  const topW      = 2 + Math.floor(noise(1, 0, seed + 12) * 3);  // 2-4 top width
  const height    = 50 + Math.floor(noise(1, 1, seed + 13) * 8); // 50-57 height
  const topY      = S - 2 - height;                               // top of spire
  const botY      = S - 3;                                        // bottom
  const numEyes   = 4 + (seed % 6);                               // 4-9 eyes
  const numCracks = 3 + (seed % 5);                               // 3-7 cracks
  const hue       = seed % 4;                                     // color variation

  // Color palettes — all dark, eldritch
  const palettes: [number, number, number][] = [
    [35, 30, 40],    // dark violet-black stone
    [30, 35, 30],    // dark mossy stone
    [40, 28, 28],    // dark reddish stone
    [28, 28, 35],    // blue-black obsidian
  ];
  const [bR, bG, bB] = palettes[hue];

  const ctx: IdolParams = {
    t, seed, cx, lean, baseW, topW, height, topY, botY, bR, bG, bB
  };

  drawMainSpireBody(ctx);
  drawJaggedCrown(ctx);
  drawCracks(ctx, numCracks);
  drawEyes(ctx, numEyes);
  drawOozingCracks(ctx);
  drawGlowingRunes(ctx);

  return ctx.t;
}

function drawMainSpireBody(ctx: IdolParams) {
  const { t, seed, cx, lean, baseW, topW, topY, botY, bR, bG, bB } = ctx;
  for (let y = topY; y <= botY; y++) {
    const t01 = (y - topY) / (botY - topY); // 0 at top, 1 at bottom
    const halfW = topW + (baseW - topW) * t01;

    // Wobble the edges for irregular shape
    const wobL = noise(y * 0.15, 0, seed + 20) * 4 - 2;
    const wobR = noise(y * 0.15, 1, seed + 21) * 4 - 2;

    // Lean offset
    const leanOff = lean * (1 - t01);

    const left  = Math.floor(cx + leanOff - halfW + wobL);
    const right = Math.floor(cx + leanOff + halfW + wobR);

    for (let x = left; x <= right; x++) {
      if (x < 0 || x >= S || y < 0 || y >= S) continue;

      // Distance from center for shading
      const xn = (x - (cx + leanOff)) / halfW; // -1..1
      const shade = Math.abs(xn) * 25;

      // Surface noise — rough stone
      const n1 = noise(x, y, seed + 100) * 20;
      const n2 = noise(x * 3, y * 3, seed + 101) * 10;

      // Veins — dark purple-red capillaries running through stone
      const vein = Math.sin(y * 0.4 + x * 0.2 + noise(x, y, seed + 102) * 4) > 0.85 ? 15 : 0;

      // Pulsating glow from within — faint violet
      const glow = noise(x * 0.5, y * 0.5, seed + 103) > 0.92
        ? 20 + Math.floor(noise(x, y, seed + 104) * 15) : 0;

      t[y * S + x] = rgba(
        clamp(bR + n1 - shade + vein + glow * 0.8),
        clamp(bG + n1 - n2 - shade),
        clamp(bB + n1 - shade + vein * 0.5 + glow),
      );
    }
  }
}

function drawJaggedCrown(ctx: IdolParams) {
  const { t, seed, cx, lean, topW, topY, bR, bG, bB } = ctx;
  for (let i = -3; i <= 3; i++) {
    const fragH = 2 + Math.floor(noise(i + 4, 0, seed + 30) * 6);
    const fragX = Math.floor(cx + lean + i * (topW * 0.5) + noise(i + 4, 1, seed + 31) * 2);
    for (let dy = 0; dy < fragH; dy++) {
      const py = topY - dy - 1;
      if (py < 0 || py >= S || fragX < 0 || fragX >= S) continue;
      const n = noise(fragX, py, seed + 32) * 15;
      t[py * S + fragX] = rgba(clamp(bR - 5 + n), clamp(bG - 5 + n), clamp(bB - 5 + n));
      // Width decreases as we go up
      if (dy < fragH - 1 && fragX + 1 < S) {
        t[py * S + fragX + 1] = rgba(clamp(bR - 8 + n), clamp(bG - 8 + n), clamp(bB - 8 + n));
      }
    }
  }
}

function drawCracks(ctx: IdolParams, numCracks: number) {
  const { t, seed, cx, lean, baseW, height, topY } = ctx;
  for (let i = 0; i < numCracks; i++) {
    let cy2 = Math.floor(topY + 8 + noise(i, 0, seed + 40) * (height - 16));
    let cx2 = Math.floor(cx + lean * (1 - (cy2 - topY) / height) + (noise(0, i, seed + 41) - 0.5) * baseW * 0.6);
    const len = 4 + Math.floor(noise(i, i, seed + 42) * 8);
    for (let j = 0; j < len; j++) {
      if (cx2 < 0 || cx2 >= S || cy2 < 0 || cy2 >= S) break;
      if (t[cy2 * S + cx2] !== CLEAR) {
        t[cy2 * S + cx2] = rgba(8, 5, 12);
      }
      // Crack direction — mostly downward with drift
      cx2 += Math.floor((noise(j, i, seed + 43) - 0.5) * 3);
      cy2 += 1;
    }
  }
}

function drawEyes(ctx: IdolParams, numEyes: number) {
  const { t, seed, cx, lean, baseW, topW, height, topY } = ctx;
  for (let i = 0; i < numEyes; i++) {
    const et = 0.15 + noise(i, 0, seed + 50) * 0.7; // vertical position 15%-85%
    const ey = Math.floor(topY + et * height);
    const halfWAtEy = topW + (baseW - topW) * et;
    const exOff = (noise(0, i, seed + 51) - 0.5) * halfWAtEy * 1.2;
    const ex = Math.floor(cx + lean * (1 - et) + exOff);

    const eyeR = 2 + Math.floor(noise(i, i, seed + 52) * 2); // radius 2-3
    const eyeType = Math.floor(noise(i, 2, seed + 53) * 4);  // 0-3: different eye styles

    for (let dy = -eyeR; dy <= eyeR; dy++) {
      for (let dx = -eyeR; dx <= eyeR; dx++) {
        if (dx * dx + dy * dy > eyeR * eyeR) continue;
        const px = ex + dx, py = ey + dy;
        if (px < 0 || px >= S || py < 0 || py >= S) continue;
        if (t[py * S + px] === CLEAR) continue;

        const d2 = dx * dx + dy * dy;
        const pupilR = eyeR * 0.4;

        if (d2 < pupilR * pupilR) {
          // Pupil — deep black with faint glow
          if (eyeType === 0) {
            // Red pupil — malevolent
            t[py * S + px] = rgba(160, 10, 10);
          } else if (eyeType === 1) {
            // Violet pupil — psi energy
            t[py * S + px] = rgba(140, 20, 180);
          } else if (eyeType === 2) {
            // Slit pupil — reptilian black
            const slitW = Math.abs(dx) < 1 ? 1 : 0;
            t[py * S + px] = slitW ? rgba(5, 5, 5) : rgba(180, 160, 50);
          } else {
            // Dead white pinpoint
            t[py * S + px] = rgba(220, 220, 200);
          }
        } else {
          // Sclera — not white but yellowish, bloodshot
          const n = noise(px, py, seed + 54) * 20;
          const bloodshot = noise(px * 2, py * 2, seed + 55) > 0.7 ? 40 : 0;
          t[py * S + px] = rgba(
            clamp(200 + n + bloodshot),
            clamp(185 + n - bloodshot * 0.5),
            clamp(140 + n - bloodshot * 0.5),
          );
        }
      }
    }
  }
}

function drawOozingCracks(ctx: IdolParams) {
  const { t, seed, cx, lean, baseW, height, topY } = ctx;
  for (let i = 0; i < 4; i++) {
    const dx2 = Math.floor(cx + lean * 0.5 + (noise(i, 3, seed + 60) - 0.5) * baseW);
    const startY = Math.floor(topY + height * 0.4 + noise(3, i, seed + 61) * height * 0.4);
    const dripLen = 3 + Math.floor(noise(i, i, seed + 62) * 5);
    for (let j = 0; j < dripLen; j++) {
      const py = startY + j;
      if (py >= S || dx2 < 0 || dx2 >= S) break;
      if (t[py * S + dx2] === CLEAR) break;
      t[py * S + dx2] = rgba(
        clamp(15 + noise(dx2, py, seed + 63) * 10),
        5,
        clamp(20 + noise(dx2, py, seed + 64) * 10),
      );
    }
  }
}

function drawGlowingRunes(ctx: IdolParams) {
  const { t, seed, cx, lean, height, topY } = ctx;
  const numRunes = 2 + (seed % 3);
  for (let i = 0; i < numRunes; i++) {
    const rt = 0.3 + noise(i, 4, seed + 70) * 0.5;
    const ry = Math.floor(topY + rt * height);
    const rx = Math.floor(cx + lean * (1 - rt));
    // Simple rune: small cross or circle
    const runeType = Math.floor(noise(4, i, seed + 71) * 2);
    const glowR = clamp(60 + Math.floor(noise(i, 5, seed + 72) * 40));
    const glowG = 15;
    const glowB = clamp(80 + Math.floor(noise(5, i, seed + 73) * 40));
    if (runeType === 0) {
      // Cross
      for (let d = -2; d <= 2; d++) {
        const px1 = rx + d, py1 = ry;
        const px2 = rx, py2 = ry + d;
        if (px1 >= 0 && px1 < S && py1 >= 0 && py1 < S && t[py1 * S + px1] !== CLEAR)
          t[py1 * S + px1] = rgba(glowR, glowG, glowB);
        if (px2 >= 0 && px2 < S && py2 >= 0 && py2 < S && t[py2 * S + px2] !== CLEAR)
          t[py2 * S + px2] = rgba(glowR, glowG, glowB);
      }
    } else {
      // Small circle
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const px = rx + dx, py = ry + dy;
        if (px >= 0 && px < S && py >= 0 && py < S && t[py * S + px] !== CLEAR) {
          if (dx * dx + dy * dy > 2) {
            t[py * S + px] = rgba(glowR, glowG, glowB);
          }
        }
      }
    }
  }
}
