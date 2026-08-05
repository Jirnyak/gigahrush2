/* ── Slide textures — intro-presentation, 8 paired slides ────── */

import { Tex } from '../../core/types';
import { drawTextCentered, CELL_H } from '../../render/text';
import { S, rgba, noise, clamp } from '../../render/pixutil';

function tpx(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

const COL_FG     = rgba(255, 240, 200);
const COL_BORDER = rgba(180, 150, 50);
const COL_ACCENT = rgba(220, 180, 80);
const COL_DIM    = rgba(140, 110, 40);
const BLOCK_NUM  = String(Math.floor(Math.random() * 900 + 100));

const SLIDES: string[][] = [
  ['ТОВАРИЩИ', 'ЖИЛЬЦЫ!'],
  ['ДОБРО', 'ПОЖАЛОВАТЬ', 'В БЛОК', '№ ' + BLOCK_NUM],
  ['ПУСТЬ', 'УСЕРДНЫЙ', 'КОЛЛЕКТИВ', 'НЫЙ ТРУД'],
  ['ПРИВЕДЁТ', 'НАС К', 'ПРОЦВЕТА', 'НИЮ И', 'БЕЗОПАС', 'НОСТИ!'],
  ['ПРАВИЛА:', '', '1 - ПРИ', 'ЗВУКЕ', 'СИРЕНЫ', 'ИДИТЕ К', 'ГЕРМОДВЕРИ'],
  ['2 - НЕ', 'ПОКИДАЙТЕ', 'ЖИЛЫЕ', 'ЯЧЕЙКИ ДО', 'ОКОНЧАНИЯ', 'САМОСБОРА'],
  ['3 - УВИДЕВ', 'ФИОЛЕТОВЫЙ', 'ТУМАН:'],
  ['НЕМЕДЛЕННО', 'ИДИТЕ К', 'БЛИЖАЙШЕМУ', 'ШЛЮЗУ!'],
];
const DEC_H = [14, 16, 3, 3, 0, 0, 16, 0];
const DEC_GAP = 2;

function drawEye(t: Uint32Array, cx: number, cy: number): void {
  const EW = 11, EH = 5;
  const outline = COL_ACCENT;
  const white = rgba(200, 190, 170);
  const irisC = rgba(180, 50, 30);
  const pupilC = rgba(25, 6, 6);
  for (let dx = -EW; dx <= EW; dx++) {
    const f = Math.cos((dx / EW) * Math.PI * 0.5);
    const ry = Math.max(0, Math.round(f * EH));
    tpx(t, cx + dx, cy - ry, outline);
    tpx(t, cx + dx, cy + ry, outline);
    for (let dy = -ry + 1; dy < ry; dy++) tpx(t, cx + dx, cy + dy, white);
  }
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++)
      if (dx * dx + dy * dy <= 16) tpx(t, cx + dx, cy + dy, irisC);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (dx * dx + dy * dy <= 4) tpx(t, cx + dx, cy + dy, pupilC);
  tpx(t, cx - 1, cy - 1, rgba(255, 230, 230));
  for (const ox of [-6, 0, 6]) { tpx(t, cx + ox, cy - EH - 1, outline); tpx(t, cx + ox, cy - EH - 2, outline); }
}

function drawStar(t: Uint32Array, cx: number, cy: number, R: number): void {
  const r = R * 0.38;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > R + 0.5) continue;
    const ang = Math.atan2(dy, dx) - Math.PI / 2;
    const a = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const sector = a / (Math.PI / 5);
    const si = Math.floor(sector);
    const sf = sector - si;
    const r0 = (si & 1) === 0 ? R : r;
    const r1 = (si & 1) === 0 ? r : R;
    if (dist <= r0 + (r1 - r0) * sf) tpx(t, cx + dx, cy + dy, COL_ACCENT);
  }
}

function drawHRule(t: Uint32Array, y: number): void {
  const mid = S >> 1;
  for (let d = 0; d <= 14; d++) { tpx(t, mid - d, y, COL_DIM); tpx(t, mid + d, y, COL_DIM); }
  for (let d = 16; d <= 20; d += 2) { tpx(t, mid - d, y, COL_DIM); tpx(t, mid + d, y, COL_DIM); }
  tpx(t, mid, y - 1, COL_ACCENT); tpx(t, mid - 1, y, COL_ACCENT); tpx(t, mid, y, COL_ACCENT);
  tpx(t, mid + 1, y, COL_ACCENT); tpx(t, mid, y + 1, COL_ACCENT);
}

function drawWarning(t: Uint32Array, cx: number, cy: number, h: number): void {
  const topY = cy - (h >> 1), botY = cy + (h >> 1), halfBase = Math.floor(h * 0.55);
  for (let y = topY; y <= botY; y++) {
    const frac = (y - topY) / (botY - topY);
    const hw = Math.round(frac * halfBase);
    tpx(t, cx - hw, y, COL_ACCENT); tpx(t, cx + hw, y, COL_ACCENT);
    if (y === botY) for (let x = cx - hw; x <= cx + hw; x++) tpx(t, x, y, COL_ACCENT);
  }
  tpx(t, cx, topY, COL_ACCENT);
  const bangTop = topY + Math.floor(h * 0.3), bangBot = botY - 3, bangCol = rgba(255, 80, 40);
  for (let y = bangTop; y <= bangBot - 2; y++) tpx(t, cx, y, bangCol);
  tpx(t, cx, bangBot, bangCol);
}

function drawSlideBorder(t: Uint32Array): void {
  for (let i = 0; i < S; i++) for (let b = 0; b < 2; b++) {
    t[b * S + i] = COL_BORDER; t[(S - 1 - b) * S + i] = COL_BORDER;
    t[i * S + b] = COL_BORDER; t[i * S + (S - 1 - b)] = COL_BORDER;
  }
  for (const [cx, cy] of [[5, 5], [S - 6, 5], [5, S - 6], [S - 6, S - 6]]) {
    tpx(t, cx, cy, COL_ACCENT); tpx(t, cx - 1, cy, COL_ACCENT); tpx(t, cx + 1, cy, COL_ACCENT);
    tpx(t, cx, cy - 1, COL_ACCENT); tpx(t, cx, cy + 1, COL_ACCENT);
  }
  const m = S >> 1;
  for (const [x, y] of [[m, 2], [m, S - 3], [2, m], [S - 3, m]]) tpx(t, x, y, COL_ACCENT);
}

export function generateSlideTextures(textures: Uint32Array[]): void {
  for (let i = 0; i < 8; i++) {
    const t = textures[Tex.SLIDE_1 + i];
    const bgR = 130, bgG = 20, bgB = 20;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = noise(x, y, 270 + i * 10) * 8 - 4;
      t[y * S + x] = rgba(clamp(bgR + Math.floor(n)), clamp(bgG + Math.floor(n / 2)), clamp(bgB + Math.floor(n / 2)));
    }
    drawSlideBorder(t);
    const lines = SLIDES[i] ?? SLIDES[0];
    const nonEmpty = lines.filter(l => l.length > 0).length;
    const emptyCount = lines.filter(l => l === '').length;
    const textH = nonEmpty * CELL_H - 1 + emptyCount * (CELL_H >> 1);
    const decH = DEC_H[i] ?? 0;
    const gap = decH > 0 ? DEC_GAP : 0;
    const totalH = decH + gap + textH;
    const startY = 5 + Math.max(0, Math.floor(((S - 10) - totalH) / 2));
    const mid = S >> 1;
    switch (i) {
      case 0: drawEye(t, mid, startY + 7); break;
      case 1: drawStar(t, mid, startY + 7, 7); break;
      case 2: case 3: drawHRule(t, startY + 1); break;
      case 6: drawWarning(t, mid, startY + 8, 14); break;
    }
    let ty = startY + decH + gap;
    for (const line of lines) {
      if (line === '') { ty += CELL_H >> 1; continue; }
      drawTextCentered(t, line, ty, COL_FG);
      ty += CELL_H;
    }
  }
}
