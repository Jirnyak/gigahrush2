/* Procedural non-explicit adult art-study sprites. */

import { S, rgba, noise, clamp, CLEAR } from './pixutil';

export const ART_NUDE_VARIANTS = 4;
export const F69_FEMALE_NPC_VARIANTS = 8;

interface Palette {
  r: number;
  g: number;
  b: number;
  hairR: number;
  hairG: number;
  hairB: number;
}

const PALETTES: Palette[] = [
  { r: 208, g: 178, b: 154, hairR: 60, hairG: 42, hairB: 32 },
  { r: 218, g: 207, b: 190, hairR: 86, hairG: 78, hairB: 66 },
  { r: 184, g: 142, b: 110, hairR: 45, hairG: 31, hairB: 25 },
  { r: 198, g: 169, b: 148, hairR: 96, hairG: 55, hairB: 36 },
];

const F69_HAIR: [number, number, number][] = [
  [34, 24, 20],
  [86, 52, 32],
  [214, 180, 92],
  [170, 66, 42],
  [208, 210, 220],
  [70, 118, 190],
  [58, 150, 112],
  [210, 92, 156],
  [118, 80, 196],
  [28, 150, 188],
  [230, 118, 74],
  [232, 224, 150],
];

const F69_SKIN: [number, number, number][] = [
  [218, 190, 166],
  [196, 158, 130],
  [232, 210, 188],
  [174, 126, 94],
  [148, 100, 76],
  [206, 170, 146],
  [120, 84, 66],
  [226, 198, 176],
];

const F69_RIBBON: [number, number, number][] = [
  [28, 24, 30],
  [122, 34, 58],
  [42, 58, 112],
  [132, 105, 54],
  [36, 112, 104],
  [158, 62, 126],
];

function mix32(v: number): number {
  v >>>= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d) >>> 0;
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b) >>> 0;
  v ^= v >>> 16;
  return v >>> 0;
}

function rnd(seed: number, salt: number): number {
  return mix32((seed + Math.imul(salt, 0x9e3779b9)) >>> 0) / 0x100000000;
}

function pickColor(list: readonly [number, number, number][], seed: number, salt: number): [number, number, number] {
  return list[Math.floor(rnd(seed, salt) * list.length) % list.length];
}

function jitterColor(c: [number, number, number], seed: number, salt: number, amp: number): [number, number, number] {
  return [
    clamp(c[0] + Math.floor((rnd(seed, salt) - 0.5) * amp)),
    clamp(c[1] + Math.floor((rnd(seed, salt + 1) - 0.5) * amp)),
    clamp(c[2] + Math.floor((rnd(seed, salt + 2) - 0.5) * amp)),
  ];
}

function put(t: Uint32Array, x: number, y: number, c: number): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

function shade(p: Palette, x: number, y: number, seed: number, edge = 0): number {
  const key = seed * 97 + 31;
  const n = noise(x, y, key) * 12 - 6;
  const light = (S - x) * 0.28 - y * 0.05;
  const cut = edge * 26;
  return rgba(
    clamp(Math.floor(p.r + n + light - cut)),
    clamp(Math.floor(p.g + n + light - cut)),
    clamp(Math.floor(p.b + n + light - cut)),
  );
}

function fillEllipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  p: Palette,
  seed: number,
): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 1) put(t, x, y, shade(p, x, y, seed, d));
    }
  }
}

function fillHair(t: Uint32Array, cx: number, cy: number, rx: number, ry: number, p: Palette, seed: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry + 5); y++) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      const lower = y > cy && Math.abs(x - cx) < rx * 0.45;
      if (d <= 1 || lower) {
        const n = noise(x, y, seed + 701) * 18 - 9;
        put(t, x, y, rgba(clamp(p.hairR + n), clamp(p.hairG + n), clamp(p.hairB + n)));
      }
    }
  }
}

function fillCapsule(
  t: Uint32Array,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  p: Palette,
  seed: number,
): void {
  const minX = Math.floor(Math.min(x1, x2) - r - 1);
  const maxX = Math.ceil(Math.max(x1, x2) + r + 1);
  const minY = Math.floor(Math.min(y1, y2) - r - 1);
  const maxY = Math.ceil(Math.max(y1, y2) + r + 1);
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const u = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2));
      const px = x1 + vx * u;
      const py = y1 + vy * u;
      const dx = x - px;
      const dy = y - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r) put(t, x, y, shade(p, x, y, seed, d / r));
    }
  }
}

function drawPedestal(t: Uint32Array, seed: number): void {
  for (let y = 56; y < 61; y++) {
    const inset = y < 58 ? 10 : 7;
    for (let x = inset; x < S - inset; x++) {
      const n = noise(x, y, seed + 1400) * 18 - 9;
      const edge = x < inset + 2 || x > S - inset - 3 ? -18 : 0;
      put(t, x, y, rgba(clamp(126 + n + edge), clamp(118 + n + edge), clamp(108 + n + edge)));
    }
  }
}

function drawContour(t: Uint32Array, seed: number): void {
  const outline = rgba(70, 55, 48, 170);
  const copy = new Uint32Array(t);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (copy[i] !== CLEAR) continue;
      const near = copy[i - 1] !== CLEAR || copy[i + 1] !== CLEAR || copy[i - S] !== CLEAR || copy[i + S] !== CLEAR;
      if (near && noise(x, y, seed + 1700) > 0.35) t[i] = outline;
    }
  }
}

function drawHighlights(t: Uint32Array, variant: number): void {
  const c = rgba(245, 226, 205, 185);
  const rows = variant === 1
    ? [[29, 25, 34], [39, 28, 36], [47, 26, 33]]
    : [[28, 27, 34], [38, 26, 36], [46, 27, 35]];
  for (const [y, x0, x1] of rows) for (let x = x0; x <= x1; x += 2) put(t, x, y, c);
}

function putColorEllipse(
  t: Uint32Array,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  g: number,
  b: number,
  seed: number,
): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d <= 1) {
        const n = noise(x, y, seed) * 12 - 6;
        const sideLight = (S - x) * 0.2 - d * 16;
        put(t, x, y, rgba(
          clamp(Math.floor(r + n + sideLight)),
          clamp(Math.floor(g + n + sideLight)),
          clamp(Math.floor(b + n + sideLight)),
        ));
      }
    }
  }
}

function putColorShade(
  t: Uint32Array,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  seed: number,
  edge = 0,
): void {
  const n = noise(x, y, seed) * 12 - 6;
  const light = (S - x) * 0.18 - y * 0.035;
  put(t, x, y, rgba(clamp(r + n + light - edge), clamp(g + n + light - edge), clamp(b + n + light - edge)));
}

function putColorCapsule(
  t: Uint32Array,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rad: number,
  r: number,
  g: number,
  b: number,
  seed: number,
): void {
  const minX = Math.floor(Math.min(x1, x2) - rad - 1);
  const maxX = Math.ceil(Math.max(x1, x2) + rad + 1);
  const minY = Math.floor(Math.min(y1, y2) - rad - 1);
  const maxY = Math.ceil(Math.max(y1, y2) + rad + 1);
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const u = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2));
      const px = x1 + vx * u;
      const py = y1 + vy * u;
      const dx = x - px;
      const dy = y - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= rad) {
        const n = noise(x, y, seed) * 10 - 5;
        const edge = d / rad * 20;
        put(t, x, y, rgba(clamp(r + n - edge), clamp(g + n - edge), clamp(b + n - edge)));
      }
    }
  }
}

function drawRibbon(
  t: Uint32Array,
  seed: number,
  leftLegTopX: number,
  leftFootX: number,
  rightLegTopX: number,
  rightFootX: number,
  legTop: number,
  legBot: number,
): void {
  const [r, g, b] = jitterColor(pickColor(F69_RIBBON, seed, 12), seed, 13, 24);

  for (let y = 52; y < 61; y++) {
    const shine = ((y + seed) & 5) === 0 ? 34 : 0;
    const p = Math.max(0, Math.min(1, (y - legTop) / Math.max(1, legBot - legTop)));
    const lx = Math.round(leftLegTopX + (leftFootX - leftLegTopX) * p);
    const rx = Math.round(rightLegTopX + (rightFootX - rightLegTopX) * p);
    for (let x = lx - 2; x <= lx + 1; x++) put(t, x, y, rgba(clamp(r + shine), clamp(g + shine), clamp(b + shine)));
    for (let x = rx - 1; x <= rx + 2; x++) put(t, x, y, rgba(clamp(r + shine), clamp(g + shine), clamp(b + shine)));
  }
}

function drawVaseTorso(
  t: Uint32Array,
  cx: number,
  lean: number,
  r: number,
  g: number,
  b: number,
  seed: number,
  shoulder = 5.2,
  waist = 1.9,
  hip = 5.6,
  torsoBot = 44,
): void {
  const points: [number, number][] = [
    [24, 3.0],
    [28, shoulder],
    [31, shoulder * 0.86],
    [35, waist],
    [40, hip],
    [torsoBot, Math.max(2.8, hip * 0.62)],
  ];

  for (let y = 24; y <= torsoBot; y++) {
    let a = points[0];
    let c = points[points.length - 1];
    for (let i = 0; i < points.length - 1; i++) {
      if (y >= points[i][0] && y <= points[i + 1][0]) {
        a = points[i];
        c = points[i + 1];
        break;
      }
    }
    const u = (y - a[0]) / Math.max(1, c[0] - a[0]);
    const smooth = u * u * (3 - 2 * u);
    const halfW = a[1] + (c[1] - a[1]) * smooth;
    const rowLean = lean * (0.25 + (y - 24) / 40);
    const rowCx = cx + rowLean;
    for (let x = Math.floor(rowCx - halfW); x <= Math.ceil(rowCx + halfW); x++) {
      const d = Math.abs(x - rowCx) / halfW;
      if (d > 1) continue;
      putColorShade(t, x, y, r, g, b, seed + 700, d * 22);
    }
  }
}

function drawSoftHighlights(t: Uint32Array, cx: number, lean: number, r: number, g: number, b: number, seed: number): void {
  const hi = rgba(clamp(r + 28), clamp(g + 24), clamp(b + 22), 205);
  const lo = rgba(clamp(r - 34), clamp(g - 24), clamp(b - 18), 190);
  for (let y = 28; y < 38; y += 2) put(t, cx + lean - 2, y, hi);
  for (let y = 32; y < 42; y += 3) put(t, cx + lean + 3, y, lo);
  if ((seed & 1) === 0) {
    put(t, cx + lean - 3, 30, hi);
    put(t, cx + lean + 3, 30, hi);
  }
}

function drawFigureStudyDetails(
  t: Uint32Array,
  cx: number,
  lean: number,
  variant: number,
  r: number,
  g: number,
  b: number,
  hairR: number,
  hairG: number,
  hairB: number,
  seed: number,
): void {
  const chestY = 29 + (variant % 2);
  const blush: [number, number, number][] = [[222, 96, 112], [204, 78, 104], [232, 118, 132], [188, 70, 92], [210, 88, 124], [232, 134, 118]];
  const [pr, pg, pb] = blush[variant % blush.length];
  for (const side of [-1, 1]) {
    const x = cx + lean + side * 3;
    put(t, x, chestY, rgba(pr, pg, pb, 235));
    put(t, x + side, chestY, rgba(clamp(pr + 22), clamp(pg + 16), clamp(pb + 14), 190));
  }

  put(t, cx + lean, 36 + (variant & 1), rgba(clamp(r - 42), clamp(g - 32), clamp(b - 26)));

  const lowerR = clamp(hairR * 0.48 + noise(variant, 0, seed) * 24);
  const lowerG = clamp(hairG * 0.48 + noise(variant, 1, seed) * 20);
  const lowerB = clamp(hairB * 0.48 + noise(variant, 2, seed) * 18);
  const lowerPresence = Math.max(0, (rnd(seed, 331) - 0.18) / 0.82);
  const lowerHeight = lowerPresence <= 0 ? 0 : 2 + Math.floor(lowerPresence * 3 + rnd(seed, 332) * 2);
  const lowerMaxHalf = 0.6 + lowerPresence * 2.2;
  const lowerCx = cx + lean + Math.floor(rnd(seed, 333) * 3) - 1;
  for (let dy = 0; dy < lowerHeight; dy++) {
    const y = 41 + dy;
    const p = dy / Math.max(1, lowerHeight - 1);
    const rowCx = lowerCx + Math.sin((p * 2.2 + variant * 0.11) * Math.PI) * 0.55;
    const rowHalf = 0.35 + p * lowerMaxHalf + (noise(dy, variant, seed + 334) - 0.5) * 0.8;
    for (let x = Math.floor(rowCx - rowHalf - 1); x <= Math.ceil(rowCx + rowHalf + 1); x++) {
      const edge = Math.abs(x - rowCx) / Math.max(0.5, rowHalf);
      if (edge > 1.15) continue;
      const grain = noise(x, y, seed + 330);
      const keep = edge < 0.38 || grain < lowerPresence * 0.68 + (1 - edge) * 0.26;
      if (!keep) continue;
      const cover = Math.max(0.42, Math.min(0.92, 0.54 + lowerPresence * 0.28 + (1 - edge) * 0.15 + (grain - 0.5) * 0.12));
      const n = noise(x, y, seed + 335) * 18 - 9;
      put(t, x, y, rgba(
        clamp(lowerR * cover + r * (1 - cover) + n),
        clamp(lowerG * cover + g * (1 - cover) + n),
        clamp(lowerB * cover + b * (1 - cover) + n),
      ));
    }
  }
}

function drawHairPixel(t: Uint32Array, x: number, y: number, r: number, g: number, b: number, seed: number, edge = 0): void {
  const n = noise(x, y, seed) * 22 - 11;
  put(t, x, y, rgba(clamp(r + n - edge), clamp(g + n - edge), clamp(b + n - edge)));
}

function drawLowerHair(t: Uint32Array, cx: number, lean: number, variant: number, r: number, g: number, b: number, seed: number, hairScale: number): void {
  const style = variant % 6;
  if (style === 1) {
    for (const side of [-1, 1]) {
      const tailX = cx + lean + side * (9 + (variant & 1));
      putColorCapsule(t, tailX, 18, tailX + side * 2, 55, 3.8 * hairScale, r, g, b, seed + 120 + side);
      putColorEllipse(t, tailX + side, 54, 3.5 * hairScale, 4.2 * hairScale, r, g, b, seed + 130 + side);
    }
    return;
  }
  if (style === 4) {
    const side = (variant & 1) ? 1 : -1;
    putColorCapsule(t, cx + lean + side * 7, 15, cx + lean + side * 12, 51, 4.2 * hairScale, r, g, b, seed + 141);
    putColorEllipse(t, cx + lean + side * 12, 51, 4.8 * hairScale, 5.0 * hairScale, r, g, b, seed + 142);
    for (let y = 16; y < 36; y++) {
      const hw = (7 + Math.floor(Math.sin((y + variant) * 0.2) * 2)) * hairScale;
      for (let x = cx + lean - hw; x <= cx + lean + hw; x++) {
        if (Math.abs(x - cx - lean) < 3 && y > 23) continue;
        drawHairPixel(t, x, y, r, g, b, seed + 143, Math.abs(x - cx - lean));
      }
    }
    return;
  }
  if (style === 5) {
    for (let y = 13; y <= 30; y++) {
      const p = (y - 13) / 17;
      const outer = (11 - p * 3) * hairScale;
      const rowCx = cx + lean + Math.sin((p * 4 + variant) * Math.PI) * 1.5;
      for (let x = Math.floor(rowCx - outer); x <= Math.ceil(rowCx + outer); x++) {
        if (Math.abs(x - rowCx) <= outer) drawHairPixel(t, x, y, r, g, b, seed + 151, Math.abs(x - rowCx));
      }
    }
    return;
  }

  const long = style !== 2;
  const yBot = long ? 55 : 34;
  for (let y = 13; y <= yBot; y++) {
    const p = (y - 13) / Math.max(1, yBot - 13);
    const wave = Math.sin((p * 3.4 + variant * 0.31) * Math.PI) * (style === 3 ? 2.2 : 1.1);
    const outer = (style === 2 ? 8.8 + Math.sin(p * Math.PI) * 3.0 : 8.2 + p * (style === 3 ? 7.0 : 4.8)) * hairScale;
    const inner = style === 3 ? 2.5 + p * 1.5 : 3.5 + p * 0.8;
    const rowCx = cx + lean + wave;
    for (let x = Math.floor(rowCx - outer); x <= Math.ceil(rowCx + outer); x++) {
      const d = Math.abs(x - rowCx);
      const sidePanel = d > inner || y < 25;
      if (!sidePanel || d > outer) continue;
      drawHairPixel(t, x, y, r, g, b, seed + 160, d / outer * 18);
    }
  }
}

function drawTopHair(t: Uint32Array, cx: number, lean: number, variant: number, r: number, g: number, b: number, seed: number, hairScale: number): void {
  const top = Math.floor(variant / 2) % 5;
  putColorEllipse(t, cx + lean, 13, 7.6 * hairScale, 5.0 * hairScale, r, g, b, seed + 200);

  if (top === 1) {
    putColorEllipse(t, cx + lean - 7, 9, 3.7 * hairScale, 3.8 * hairScale, r, g, b, seed + 210);
    putColorEllipse(t, cx + lean + 7, 9, 3.7 * hairScale, 3.8 * hairScale, r, g, b, seed + 211);
  } else if (top === 2) {
    for (const side of [-1, 1]) {
      for (let y = 7; y < 13; y++) {
        const hw = (y - 6) * hairScale;
        for (let x = cx + lean + side * 7 - hw; x <= cx + lean + side * 7 + hw; x++) {
          if (side < 0 ? x > cx + lean - 5 : x < cx + lean + 5) continue;
          drawHairPixel(t, x, y, r, g, b, seed + 220 + side, 6);
        }
      }
    }
  } else if (top === 3) {
    putColorEllipse(t, cx + lean + ((variant & 1) ? -4 : 4), 9, 5.8 * hairScale, 3.2 * hairScale, r, g, b, seed + 230);
  } else if (top === 4) {
    for (let i = -4; i <= 4; i += 2) {
      putColorCapsule(t, cx + lean + i, 7, cx + lean + i + Math.sin(i + variant) * 2, 14, 1.5 * hairScale, r, g, b, seed + 232 + i);
    }
  }

  for (let y = 14; y <= 21; y++) {
    const row = y - 14;
    const fall = row * 0.6;
    const fringe = (6 - Math.floor(row * 0.35)) * hairScale;
    for (let x = cx + lean - fringe; x <= cx + lean + fringe; x++) {
      const blade = Math.abs((Math.round(x) - cx - lean + variant) % 4) <= 1;
      if (!blade && row > 3) continue;
      const edge = row > 4 && Math.abs(x - cx - lean) < 2 ? 18 : 2;
      if (y + fall > 23) continue;
      drawHairPixel(t, x, y, r, g, b, seed + 240, edge);
    }
  }
}

function drawAnimeFace(t: Uint32Array, cx: number, lean: number, skinR: number, skinG: number, skinB: number): void {
  put(t, cx + lean - 4, 20, rgba(230, 116, 126, 150));
  put(t, cx + lean + 4, 20, rgba(230, 116, 126, 150));
  put(t, cx + lean, 20, rgba(clamp(skinR - 36), clamp(skinG - 28), clamp(skinB - 24)));
  put(t, cx + lean - 1, 22, rgba(150, 58, 62));
  put(t, cx + lean, 22, rgba(204, 82, 82));
  put(t, cx + lean + 1, 22, rgba(150, 58, 62));
}

function drawFigure(t: Uint32Array, variant: number, p: Palette, seed: number): void {
  const cx = 32;
  const lean = [-1, 2, 0, -2][variant] ?? 0;

  if (variant === 1) {
    fillCapsule(t, cx - 6, 28, cx - 13, 13, 2.3, p, seed + 10);
    fillCapsule(t, cx + 6, 28, cx + 12, 16, 2.3, p, seed + 11);
  } else if (variant === 2) {
    fillCapsule(t, cx - 7, 29, cx - 12, 37, 2.4, p, seed + 12);
    fillCapsule(t, cx + 7, 29, cx + 12, 36, 2.4, p, seed + 13);
  } else {
    fillCapsule(t, cx - 6, 29, cx - 11, 42, 2.2, p, seed + 14);
    fillCapsule(t, cx + 6, 29, cx + 10, 41, 2.2, p, seed + 15);
  }

  fillCapsule(t, cx - 4 + lean, 40, cx - 8, 56, 3.0, p, seed + 20);
  fillCapsule(t, cx + 4 + lean, 40, cx + 8, 56, 3.0, p, seed + 21);
  if (variant === 3) fillCapsule(t, cx + 4, 45, cx + 14, 56, 2.5, p, seed + 22);

  fillEllipse(t, cx + lean, 30, 7.0, 11.0, p, seed + 30);
  fillEllipse(t, cx + lean, 41, 8.5, 6.3, p, seed + 31);
  fillCapsule(t, cx + lean, 22, cx + lean, 27, 2.0, p, seed + 32);

  fillHair(t, cx + lean, 16, 6.0, 7.0, p, seed + 40);
  fillEllipse(t, cx + lean, 17, 5.0, 6.0, p, seed + 41);

  drawHighlights(t, variant);
}

export function generateArtNudeSprite(variant: number): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const v = ((variant % ART_NUDE_VARIANTS) + ART_NUDE_VARIANTS) % ART_NUDE_VARIANTS;
  const seed = 2200 + v * 379;
  const p = PALETTES[v];

  for (let y = 58; y < 63; y++) {
    for (let x = 16; x < 49; x++) {
      const falloff = Math.abs(x - 32) / 18;
      if (falloff < 1) put(t, x, y, rgba(20, 18, 18, Math.floor(65 * (1 - falloff))));
    }
  }
  drawFigure(t, v, p, seed);
  drawPedestal(t, seed);
  drawContour(t, seed);
  return t;
}

export function generateFloor69FemaleNpcSprite(variant: number): Uint32Array {
  const t = new Uint32Array(S * S).fill(CLEAR);
  const seed = mix32((variant | 0) ^ 0x69f69f);
  const v = Math.floor(rnd(seed, 1) * 4096);
  const [sr, sg, sb] = jitterColor(pickColor(F69_SKIN, seed, 2), seed, 3, 26);
  const [hr, hg, hb] = jitterColor(pickColor(F69_HAIR, seed, 4), seed, 5, 34);
  const cx = 31 + Math.floor(rnd(seed, 6) * 4);
  const lean = Math.floor(rnd(seed, 7) * 5) - 2;
  const shoulderScale = 1;
  const waistScale = 1;
  const hipScale = 1;
  const hairScale = 1;
  const ribbonRate = 1;
  const legRad = 1.35 + rnd(seed, 8) * 0.85;
  const legTop = 39 + rnd(seed, 9) * 2.5;
  const legBot = 58 + rnd(seed, 10) * 3;
  const legHipSpread = 2.0 + rnd(seed, 11) * 1.7;
  const legFootSpread = 4.0 + rnd(seed, 12) * 3.0;
  const shoulder = (4.5 + rnd(seed, 13) * 2.6) * shoulderScale;
  const waist = (1.45 + rnd(seed, 14) * 1.25) * waistScale;
  const hip = (4.7 + rnd(seed, 15) * 2.6) * hipScale;
  const torsoBot = 42 + Math.floor(rnd(seed, 16) * 4);
  const armPose = Math.floor(rnd(seed, 17) * 5);

  // Soft floor shadow.
  for (let y = 57; y < 62; y++) {
    for (let x = 18; x < 47; x++) {
      const f = 1 - Math.abs(x - 32) / 16;
      if (f > 0) put(t, x, y, rgba(16, 14, 16, Math.floor(55 * f)));
    }
  }

  drawLowerHair(t, cx, lean, v, hr, hg, hb, seed, hairScale);

  const leftLegTopX = cx - legHipSpread + lean * 0.2;
  const leftFootX = cx - legFootSpread - lean;
  const rightLegTopX = cx + legHipSpread + lean * 0.2;
  const rightFootX = cx + legFootSpread - lean;
  putColorCapsule(t, leftLegTopX, legTop, leftFootX, legBot, legRad, sr, sg, sb, seed + 1);
  putColorCapsule(t, rightLegTopX, legTop, rightFootX, legBot, legRad, sr, sg, sb, seed + 2);
  if (armPose === 0) {
    putColorCapsule(t, cx - shoulder + 0.5, 27, cx - 8 - lean, 44, 1.05 + rnd(seed, 18) * 0.45, sr, sg, sb, seed + 3);
    putColorCapsule(t, cx + shoulder - 0.5, 27, cx + 8 - lean, 44, 1.05 + rnd(seed, 19) * 0.45, sr, sg, sb, seed + 4);
  } else if (armPose === 1) {
    putColorCapsule(t, cx - shoulder, 27, cx - 11, 20, 1.05, sr, sg, sb, seed + 3);
    putColorCapsule(t, cx + shoulder, 27, cx + 10, 41, 1.18, sr, sg, sb, seed + 4);
  } else if (armPose === 2) {
    putColorCapsule(t, cx - shoulder, 28, cx - 12, 36, 1.18, sr, sg, sb, seed + 3);
    putColorCapsule(t, cx + shoulder, 28, cx + 12, 35, 1.18, sr, sg, sb, seed + 4);
  } else if (armPose === 3) {
    putColorCapsule(t, cx - shoulder, 27, cx - 5, 18, 1.0, sr, sg, sb, seed + 3);
    putColorCapsule(t, cx + shoulder, 27, cx + 5, 18, 1.0, sr, sg, sb, seed + 4);
  } else {
    putColorCapsule(t, cx - shoulder, 28, cx - 7 - lean, 48, 1.08, sr, sg, sb, seed + 3);
    putColorCapsule(t, cx + shoulder, 28, cx + 7 - lean, 48, 1.08, sr, sg, sb, seed + 4);
  }
  drawVaseTorso(t, cx, lean, sr, sg, sb, seed + 5, shoulder, waist, hip, torsoBot);
  drawSoftHighlights(t, cx, lean, sr, sg, sb, seed + 6);
  drawFigureStudyDetails(t, cx, lean, v, sr, sg, sb, hr, hg, hb, seed + 10);
  if (rnd(seed, 20) < ribbonRate) drawRibbon(t, seed, leftLegTopX, leftFootX, rightLegTopX, rightFootX, legTop, legBot);

  // Neck, face, hair mass, and facial pixels.
  putColorCapsule(t, cx + lean, 21, cx + lean, 25, 1.5, sr, sg, sb, seed + 7);
  putColorEllipse(t, cx + lean, 17, 5.6, 6.4, sr, sg, sb, seed + 8);
  drawTopHair(t, cx, lean, v, hr, hg, hb, seed, hairScale);
  drawAnimeFace(t, cx, lean, sr, sg, sb);

  drawContour(t, seed);
  return t;
}
