/* ── Agitprop poster textures — procedural Soviet-style placards ── */
/*   Each poster is unique: generated from noise and a per-poster   */
/*   seed. Coordinates and seed axes are independent to prevent     */
/*   periodic patterns.                                             */
/*                                                                  */
/*   To add new words: just append to WORDS_A / WORDS_B / WORDS_C. */
/*   More words = more unique combinations.                         */

import { Tex } from '../../core/types';
import { drawTextCentered, measureText, CELL_H } from '../../render/text';
import { S, rgba, noise, clamp } from '../../render/pixutil';

function tpx(t: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && x < S && y >= 0 && y < S) t[y * S + x] = c;
}

/* ── Poster word dictionary ──────────────────────────────────── */
/* Add new words freely — the generator picks random combos.     */

/** First line — subject / imperative */
const WORDS_A: string[] = [
  'ТОВАРИЩ!',
  'ЖИЛЕЦ!',
  'ГРАЖДАНИН!',
  'РАБОЧИЙ!',
  'КОЛЛЕКТИВ!',
  'НАРОД!',
  'СМЕНА!',
  'ДЕЖУРНЫЙ!',
  'БРИГАДА!',
  'БОЕЦ!',
  'ЛИКВИДАТОР!',
  'УЧЁНЫЙ!',
  'СТРОИТЕЛЬ!',
  'МАСТЕР!',
  'СЛЕСАРЬ!',
  'МЕХАНИК!',
  'ПОВАР!',
  'ЭЛЕКТРИК!',
  'ВРАЧ!',
  'ИНЖЕНЕР!',
];

/** Middle line(s) — verbs / calls to action */
const WORDS_B: string[] = [
  'СТОЙ! СЛУШАЙ!',
  'ВПЕРЁД!',
  'К ТРУДУ!',
  'КРЕПИ СТЕНЫ!',
  'ЗАМУРУЙ ЩЕЛИ!',
  'ЗАЩИТИ БЛОК!',
  'НЕ СПАТЬ!',
  'БУДЬ БДИТЕЛЕН!',
  'ПОМНИ ДОЛГ!',
  'ДОЛОЖИ!',
  'ЗАКРОЙ ДВЕРИ!',
  'БЕЙ ТВАРЕЙ!',
  'ДЕРЖИ СТРОЙ!',
  'ГАСИ ОЧАГ!',
  'БЕРЕГИ СВЕТ!',
  'ОЧИСТИ ЭТАЖ!',
  'СДАЙ ОТЧЁТ!',
  'ВЕРЬ В СПИСОК!',
  'В АТАКУ!',
  'ТОПИ ПЕЧЬ!',
  'СТРОЙ СТЕНЫ!',
  'ЧИНИ ТРУБЫ!',
  'ЗАДЕЛАЙ ЩЕЛЬ!',
  'РАСТИ ГРИБЫ!',
  'ТУШИ СВЕТ!',
  'НЕСИ ВАХТУ!',
  'ДЕРЖИ КЛЮЧ!',
  'ХРАНИ КЛЮЧ!',
  'СЛУШАЙ ЩИТОК!',
  'ГАСИ ПОЖАР!',
];

/** Bottom line — grand concept / noun */
const WORDS_C: string[] = [
  'ГИГАХРУЩ',
  'БЕТОН',
  'СВЕТ',
  'КОРИДОРЫ',
  'ТИШИНА',
  'ПОРЯДОК',
  'СТЕНА',
  'ЭТАЖ',
  'ТРУБА',
  'АРМАТУРА',
  'САМОСБОР',
  'БЕЗОПАСНОСТЬ',
  'БЛОК',
  'ЕДИНСТВО',
  'СИЛА',
  'КОММУНА',
  'БДИТЕЛЬНОСТЬ',
  'ПОБЕДА',
  'ОБОРОНА',
  'НАУКА',
  'ПРОГРЕСС',
  'ДОЛГ',
  'ГЕРМЕТИКА',
  'ПЕРИМЕТР',
  'ЛИНИЯ',
  'БРИГАДА',
  'КОНТРОЛЬ',
  'ФУНДАМЕНТ',
  'СТРУКТУРА',
  'ГОРИЗОНТ',
];

/* ── Seeded RNG (deterministic per poster) ───────────────────── */
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** Deterministic hash for word selection — separate axes to avoid patterns */
function wordHash(seed: number, axis: number): number {
  let n = (seed * 374761393 + axis * 1274126177) | 0;
  n = (n ^ (n >> 13)) * 1103515245; n = n ^ (n >> 16);
  return (n & 0x7fff) / 0x7fff;
}

/* ── Word selection — picks a word that fits the available width ── */
function pickFittingWord(words: string[], seed: number, axis: number, maxW: number): string {
  const idx = Math.floor(wordHash(seed, axis) * words.length);
  for (let i = 0; i < words.length; i++) {
    const w = words[(idx + i) % words.length];
    if (measureText(w) <= maxW) return w;
  }
  return words[idx]; // fallback
}

function phraseTokensFit(text: string, maxW: number): boolean {
  for (const token of text.split(' ')) {
    if (measureText(token) > maxW) return false;
  }
  return true;
}

function pickWrappablePhrase(words: string[], seed: number, axis: number, maxW: number): string {
  const idx = Math.floor(wordHash(seed, axis) * words.length);
  for (let i = 0; i < words.length; i++) {
    const w = words[(idx + i) % words.length];
    if (phraseTokensFit(w, maxW)) return w;
  }
  return pickFittingWord(words, seed, axis, maxW);
}

function wrapPosterWords(parts: readonly string[], maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const part of parts) {
    for (const rawToken of part.split(' ')) {
      const token = rawToken.trim();
      if (!token) continue;
      const prev = lines[lines.length - 1] ?? '';
      const next = prev ? `${prev} ${token}` : token;
      if (prev && measureText(next) <= maxW) {
        lines[lines.length - 1] = next;
      } else if (measureText(token) <= maxW && lines.length < maxLines) {
        lines.push(token);
      }
    }
  }
  return lines;
}

function drawPosterTextBlock(
  t: Uint32Array,
  lines: readonly string[],
  startY: number,
  fg: number,
  accent: number,
): void {
  for (let i = 0; i < lines.length; i++) {
    drawTextCentered(t, lines[i], startY + i * CELL_H, i === 0 || i === lines.length - 1 ? accent : fg);
  }
}

/* ── Palette generation from noise ───────────────────────────── */
function makePalette(seed: number): { bgR: number; bgG: number; bgB: number; fg: number; accent: number; accent2: number } {
  const r = seededRng(seed * 7 + 111);
  const style = Math.floor(r() * 6);
  switch (style) {
    case 0: return { bgR: 140 + r() * 40, bgG: 20 + r() * 20, bgB: 15 + r() * 20,  // red
      fg: rgba(255, 240, 200), accent: rgba(255, 200 + r() * 55, 40 + r() * 40), accent2: rgba(200, 160 + r() * 40, 40) };
    case 1: return { bgR: 25 + r() * 15, bgG: 25 + r() * 15, bgB: 25 + r() * 15,   // black
      fg: rgba(210 + r() * 40, 40 + r() * 30, 30), accent: rgba(220, 50, 40), accent2: rgba(180, 35, 25) };
    case 2: return { bgR: 35 + r() * 25, bgG: 50 + r() * 25, bgB: 75 + r() * 30,   // blue
      fg: rgba(255, 240, 200), accent: rgba(200 + r() * 55, 170 + r() * 40, 50), accent2: rgba(170 + r() * 30, 70 + r() * 30, 35) };
    case 3: return { bgR: 45 + r() * 20, bgG: 40 + r() * 15, bgB: 30 + r() * 15,   // brown
      fg: rgba(240, 220, 160), accent: rgba(220, 180, 60), accent2: rgba(180, 50, 30) };
    case 4: return { bgR: 50 + r() * 20, bgG: 35 + r() * 15, bgB: 45 + r() * 15,   // dark purple
      fg: rgba(255, 230, 200), accent: rgba(240, 190, 50), accent2: rgba(200, 80, 40) };
    default: return { bgR: 80 + r() * 40, bgG: 18 + r() * 15, bgB: 12 + r() * 15,  // crimson
      fg: rgba(255, 255, 230), accent: rgba(255, 190 + r() * 40, 40), accent2: rgba(210, 90 + r() * 30, 35) };
  }
}

/* ── Geometric decorations — noise-driven constructivism ──────── */

function drawStar5(t: Uint32Array, cx: number, cy: number, R: number, col: number, seed: number): void {
  const r = R * (0.30 + noise(0, 0, seed) * 0.15);
  const rot = noise(1, 0, seed) * 0.4 - 0.2;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > R + 0.5) continue;
    const ang = Math.atan2(dy, dx) - Math.PI / 2 + rot;
    const a = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const sector = a / (Math.PI / 5);
    const si = Math.floor(sector);
    const sf = sector - si;
    const r0 = (si & 1) === 0 ? R : r;
    const r1 = (si & 1) === 0 ? r : R;
    if (dist <= r0 + (r1 - r0) * sf) tpx(t, cx + dx, cy + dy, col);
  }
}

function drawGear(t: Uint32Array, cx: number, cy: number, R: number, col: number, seed: number): void {
  const teeth = 6 + Math.floor(noise(0, 0, seed) * 6);
  const innerR = R * (0.45 + noise(1, 0, seed) * 0.2);
  const phase = noise(2, 0, seed) * Math.PI;
  for (let dy = -R - 2; dy <= R + 2; dy++) for (let dx = -R - 2; dx <= R + 2; dx++) {
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx);
    const toothPhase = Math.cos(ang * teeth + phase) * 0.15;
    const edgeR = R * (0.85 + toothPhase);
    if (dist <= edgeR && dist >= innerR) tpx(t, cx + dx, cy + dy, col);
    if (dist < innerR * 0.35) tpx(t, cx + dx, cy + dy, col);
  }
}

function drawFist(t: Uint32Array, cx: number, cy: number, col: number, seed: number): void {
  const scale = 0.8 + noise(0, 0, seed) * 0.5;
  const sx = (v: number) => Math.round(v * scale);
  // Minimalist raised fist (blocky, constructivist)
  const arm: [number, number, number, number][] = [
    [sx(-2), sx(3),  sx(4), sx(10)],
    [sx(-3), sx(-4), sx(6), sx(7)],
    [sx(-4), sx(-5), sx(2), sx(2)],
  ];
  for (const [rx, ry, rw, rh] of arm) {
    for (let dy = 0; dy < rh; dy++) for (let dx = 0; dx < rw; dx++) {
      tpx(t, cx + rx + dx, cy + ry + dy, col);
    }
  }
}

function drawSilhouette(t: Uint32Array, cx: number, cy: number, col: number, seed: number): void {
  const rng_ = seededRng(seed);
  const headR = 3 + Math.floor(rng_() * 4);
  for (let dy = -headR; dy <= headR; dy++) for (let dx = -headR; dx <= headR; dx++) {
    if (dx * dx + dy * dy <= headR * headR) tpx(t, cx + dx, cy + dy, col);
  }
  const shoulderW = 6 + Math.floor(rng_() * 8);
  const shoulderH = 8 + Math.floor(rng_() * 8);
  for (let dy = headR + 1; dy < headR + 1 + shoulderH; dy++) {
    const frac = (dy - headR) / shoulderH;
    const hw = Math.round(1 + frac * shoulderW);
    for (let dx = -hw; dx <= hw; dx++) tpx(t, cx + dx, cy + dy, col);
  }
}

function drawTriangle(t: Uint32Array, cx: number, cy: number, h: number, col: number, seed: number): void {
  const skew = (noise(0, 0, seed) - 0.5) * 4;
  for (let y = 0; y < h; y++) {
    const hw = Math.round((y / h) * (h * 0.6));
    for (let dx = -hw; dx <= hw; dx++) tpx(t, cx + dx + Math.round(skew * (1 - y / h)), cy - h + y, col);
  }
}

function drawDiagonalBars(t: Uint32Array, col: number, seed: number): void {
  const spacing = 6 + Math.floor(noise(0, 0, seed) * 8);
  const dir = noise(1, 0, seed) > 0.5 ? 1 : -1;
  for (let y = 3; y < S - 3; y++) for (let x = 3; x < S - 3; x++) {
    if ((x + dir * y + S * 2) % spacing < 2) tpx(t, x, y, col);
  }
}

function drawHammer(t: Uint32Array, cx: number, cy: number, col: number, seed: number): void {
  const rng_ = seededRng(seed);
  const headW = 6 + Math.floor(rng_() * 4);
  const headH = 3 + Math.floor(rng_() * 2);
  const handleH = 10 + Math.floor(rng_() * 6);
  for (let dy = 0; dy < headH; dy++) for (let dx = -headW; dx <= headW; dx++)
    tpx(t, cx + dx, cy - headH + dy, col);
  for (let dy = 0; dy < handleH; dy++) tpx(t, cx, cy + dy, col);
  tpx(t, cx - 1, cy, col); tpx(t, cx + 1, cy, col);
}

function drawAbstractBlocks(t: Uint32Array, col: number, col2: number, seed: number): void {
  const rng_ = seededRng(seed);
  const count = 3 + Math.floor(rng_() * 5);
  for (let i = 0; i < count; i++) {
    const bx = 6 + Math.floor(rng_() * (S - 18));
    const by = 6 + Math.floor(rng_() * (S / 2 - 8));
    const bw = 4 + Math.floor(rng_() * 12);
    const bh = 4 + Math.floor(rng_() * 10);
    const c = rng_() > 0.5 ? col : col2;
    for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) tpx(t, bx + dx, by + dy, c);
  }
}

/* ── Poster border ───────────────────────────────────────────── */
function drawPosterBorder(t: Uint32Array, col: number, borderW: number): void {
  for (let i = 0; i < S; i++) for (let b = 0; b < borderW; b++) {
    t[b * S + i] = col; t[(S - 1 - b) * S + i] = col;
    t[i * S + b] = col; t[i * S + (S - 1 - b)] = col;
  }
}

/* ── Decoration dispatch ─────────────────────────────────────── */
function drawDecoration(t: Uint32Array, decType: number, cx: number, cy: number,
  accent: number, accent2: number, seed: number): void {
  switch (decType % 8) {
    case 0: drawStar5(t, cx, cy, 6 + (seed & 3), accent, seed); break;
    case 1: drawGear(t, cx, cy, 7 + (seed & 3), accent, seed); break;
    case 2: drawFist(t, cx, cy, accent, seed); break;
    case 3: drawTriangle(t, cx, cy + 6, 10 + (seed & 3), accent2, seed); break;
    case 4: drawDiagonalBars(t, accent2, seed); break;
    case 5: drawSilhouette(t, cx, cy, accent, seed); break;
    case 6: drawHammer(t, cx, cy, accent, seed); break;
    case 7: drawAbstractBlocks(t, accent, accent2, seed); break;
  }
}

/* ── Generate a single poster texture from seed ──────────────── */
function generateSinglePoster(t: Uint32Array, seed: number): void {
  const pal = makePalette(seed);
  const { bgR, bgG, bgB, fg, accent, accent2 } = pal;

  // Background — noise on independent axes (seed per poster, pixel coords independent)
  const bgSeed = seed * 17 + 500;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n1 = noise(x, y, bgSeed) * 14 - 7;
    const n2 = noise(x * 3, y * 3, bgSeed + 99) * 6 - 3;
    t[y * S + x] = rgba(clamp(bgR + n1 + n2), clamp(bgG + n1 + n2), clamp(bgB + n1 + n2));
  }

  // Border — width varies per poster
  const borderW = 1 + Math.floor(noise(0, 0, seed * 3 + 7) * 2.5);
  drawPosterBorder(t, accent, borderW);

  // Decoration (top half)
  const decType = Math.floor(wordHash(seed, 50) * 9);
  const hasDecoration = decType < 8;
  const mid = S >> 1;

  if (hasDecoration) {
    const decCy = 14 + Math.floor(noise(0, 0, seed * 5 + 33) * 8);
    drawDecoration(t, decType, mid, decCy, accent, accent2, seed * 13 + 77);
  }

  // Text — combinatorial word selection via independent hash axes
  // Pick phrases that can wrap within the poster border.
  const maxTextW = S - 2 * (borderW + 1);
  const lineA = pickWrappablePhrase(WORDS_A, seed, 1, maxTextW);
  const lineB = pickWrappablePhrase(WORDS_B, seed, 2, maxTextW);
  const lineC = pickWrappablePhrase(WORDS_C, seed, 3, maxTextW);
  const lineD = pickWrappablePhrase(WORDS_B, seed, 4, maxTextW);

  // Text layout
  if (hasDecoration) {
    const lines = wrapPosterWords([lineA, lineB, lineC], maxTextW, 4);
    const textStart = S - 3 - CELL_H * lines.length;
    drawPosterTextBlock(t, lines, textStart, fg, accent);
  } else {
    // Full text poster — more space for words
    const lines = wrapPosterWords([lineA, lineB, lineD, lineC], maxTextW, 5);
    const totalH = CELL_H * lines.length + 4;
    const startY = Math.floor((S - totalH) / 2);
    drawPosterTextBlock(t, lines, startY, fg, accent);
  }
}

/* ── Main generator — 64 unique posters ──────────────────────── */
export const POSTER_COUNT = 64;

export function generatePosterTextures(textures: Uint32Array[]): void {
  for (let i = 0; i < POSTER_COUNT; i++) {
    generateSinglePoster(textures[Tex.POSTER_BASE + i], i * 137 + 900);
  }
}

/* ── Coordinate-hash poster selection ────────────────────────── */
/* Uses cell (x,y) as input — deterministic, no periodic patterns */
export function pickPosterTex(x: number, y: number): Tex {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1103515245;
  h = (h ^ (h >> 16)) & 0x7fffffff;
  return (Tex.POSTER_BASE + (h % POSTER_COUNT)) as Tex;
}
