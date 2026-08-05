import {
  formatDurakSuit,
  type DurakCard,
  type DurakSnapshot,
  type DurakSuit,
} from '../systems/durak';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { fitText } from './ui_text';
import { clamp, rect, drawBadge } from './ui_utils';

const CARD_ASPECT = 0.70;
const MAX_VISIBLE_NPC_BACKS = 8;
type PixelMask = readonly string[];
type CourtRank = 11 | 12 | 13;

const RANK_LABELS: Record<DurakCard['rank'], string> = {
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'В',
  12: 'Д',
  13: 'К',
  14: 'Т',
};

const SUIT_MASKS: Record<DurakSuit, PixelMask> = {
  diamonds: [
    '000010000',
    '000111000',
    '001111100',
    '011111110',
    '111121111',
    '011111110',
    '001111100',
    '000111000',
    '000010000',
  ],
  hearts: [
    '011000110',
    '111101111',
    '111111111',
    '111121111',
    '011111110',
    '001111100',
    '000111000',
    '000010000',
    '000000000',
  ],
  clubs: [
    '000111000',
    '001111100',
    '001121100',
    '110111011',
    '111111111',
    '011121110',
    '000111000',
    '000121000',
    '001111100',
  ],
  spades: [
    '000010000',
    '000111000',
    '001121100',
    '011111110',
    '111111111',
    '011121110',
    '001111100',
    '000121000',
    '001111100',
  ],
};

const COURT_MASKS: Record<CourtRank, PixelMask> = {
  11: [
    '002222000',
    '022222200',
    '001110000',
    '011111000',
    '001110000',
    '011111100',
    '111121110',
    '001121000',
    '001211000',
    '011110000',
    '111011000',
    '110001100',
    '100000110',
  ],
  12: [
    '000202000',
    '002222200',
    '022222220',
    '001111100',
    '001010100',
    '001111100',
    '000111000',
    '011111110',
    '111121111',
    '011111110',
    '001101100',
    '011000110',
    '110000011',
  ],
  13: [
    '202222202',
    '022222220',
    '002222200',
    '000111000',
    '001111100',
    '001010100',
    '001111100',
    '000121000',
    '011111110',
    '111121111',
    '111111111',
    '001111100',
    '110111011',
    '100000001',
  ],
};

const ACE_MASK: PixelMask = [
  '000020000',
  '000202000',
  '002000200',
  '020000020',
  '200000002',
  '020000020',
  '002000200',
  '000202000',
  '000020000',
];

const SUIT_STYLES: Record<DurakSuit, { primary: string; accent: string; outline: string }> = {
  diamonds: { primary: '#9c302d', accent: '#c8513e', outline: '#6d211d' },
  hearts: { primary: '#9a2e2f', accent: '#c84b48', outline: '#68201f' },
  clubs: { primary: '#111914', accent: '#365541', outline: '#050807' },
  spades: { primary: '#111622', accent: '#33435d', outline: '#05070c' },
};

function maskWidth(mask: PixelMask): number {
  let width = 0;
  for (const row of mask) width = Math.max(width, row.length);
  return width;
}

function drawPixelMask(
  ctx: CanvasRenderingContext2D,
  mask: PixelMask,
  x: number,
  y: number,
  cell: number,
  colors: { primary: string; accent: string; outline?: string },
): void {
  const c = Math.max(1, Math.round(cell));
  const px = Math.round(x);
  const py = Math.round(y);
  if (colors.outline && c > 1) {
    ctx.fillStyle = colors.outline;
    for (let row = 0; row < mask.length; row++) {
      for (let col = 0; col < mask[row].length; col++) {
        const ch = mask[row][col];
        if (ch === '1' || ch === '2') ctx.fillRect(px + col * c - 1, py + row * c - 1, c + 2, c + 2);
      }
    }
  }
  for (let row = 0; row < mask.length; row++) {
    for (let col = 0; col < mask[row].length; col++) {
      const ch = mask[row][col];
      if (ch !== '1' && ch !== '2') continue;
      ctx.fillStyle = ch === '2' ? colors.accent : colors.primary;
      ctx.fillRect(px + col * c, py + row * c, c, c);
    }
  }
}

function suitStyle(suit: DurakSuit): { primary: string; accent: string; outline: string } {
  return SUIT_STYLES[suit];
}

function drawPixelSuit(ctx: CanvasRenderingContext2D, suit: DurakSuit, x: number, y: number, cell: number): void {
  drawPixelMask(ctx, SUIT_MASKS[suit], x, y, cell, suitStyle(suit));
}

function drawCourtIcon(ctx: CanvasRenderingContext2D, card: DurakCard, x: number, y: number, w: number, h: number): void {
  const rank = card.rank as CourtRank;
  const mask = COURT_MASKS[rank];
  const c = Math.max(2, Math.floor(Math.min(w * 0.52 / maskWidth(mask), h * 0.46 / mask.length)));
  const mx = x + w * 0.5 - maskWidth(mask) * c * 0.5;
  const my = y + h * 0.46 - mask.length * c * 0.5;
  drawPixelMask(ctx, mask, mx, my, c, { primary: '#1b211f', accent: '#a88a4b', outline: '#6d654f' });
  const suitCell = Math.max(1, Math.round(c * 0.64));
  drawPixelSuit(ctx, card.suit, x + w * 0.5 - maskWidth(SUIT_MASKS[card.suit]) * suitCell * 0.5, y + h * 0.72 - SUIT_MASKS[card.suit].length * suitCell * 0.5, suitCell);
}

function drawAceIcon(ctx: CanvasRenderingContext2D, card: DurakCard, x: number, y: number, w: number, h: number): void {
  const c = Math.max(2, Math.floor(Math.min(w * 0.60 / maskWidth(ACE_MASK), h * 0.46 / ACE_MASK.length)));
  const mx = x + w * 0.5 - maskWidth(ACE_MASK) * c * 0.5;
  const my = y + h * 0.48 - ACE_MASK.length * c * 0.5;
  drawPixelMask(ctx, ACE_MASK, mx, my, c, { primary: '#6f634e', accent: '#b79851', outline: '#6d654f' });
  const suitCell = Math.max(2, Math.floor(Math.min(w * 0.30 / maskWidth(SUIT_MASKS[card.suit]), h * 0.24 / SUIT_MASKS[card.suit].length)));
  drawPixelSuit(ctx, card.suit, x + w * 0.5 - maskWidth(SUIT_MASKS[card.suit]) * suitCell * 0.5, y + h * 0.48 - SUIT_MASKS[card.suit].length * suitCell * 0.5, suitCell);
}

function drawLargeSuit(ctx: CanvasRenderingContext2D, card: DurakCard, x: number, y: number, w: number, h: number): void {
  const cell = Math.max(2, Math.round(h * 0.034));
  drawPixelSuit(ctx, card.suit, x + w * 0.5 - maskWidth(SUIT_MASKS[card.suit]) * cell * 0.5, y + h * 0.50 - SUIT_MASKS[card.suit].length * cell * 0.5, cell);
}

function drawCardCenter(ctx: CanvasRenderingContext2D, card: DurakCard, x: number, y: number, w: number, h: number, s: number): void {
  if (h < 42 * s) {
    drawLargeSuit(ctx, card, x, y, w, h);
    return;
  }
  if (card.rank >= 11 && card.rank <= 13) {
    drawCourtIcon(ctx, card, x, y, w, h);
    return;
  }
  if (card.rank === 14) {
    drawAceIcon(ctx, card, x, y, w, h);
    return;
  }
  drawLargeSuit(ctx, card, x, y, w, h);
}

function drawCardBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  rect(ctx, x, y, w, h, '#111817', '#55615a');
  rect(ctx, x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, '#182321', '#2f403b');

  ctx.fillStyle = '#61736b';
  const step = Math.max(3, Math.round(4 * s));
  const left = Math.round(x + 5 * s);
  const top = Math.round(y + 5 * s);
  const right = Math.round(x + w - 5 * s);
  const bottom = Math.round(y + h - 5 * s);
  for (let yy = top; yy < bottom; yy += step) ctx.fillRect(left, yy, Math.max(1, right - left), 1);
  for (let xx = left; xx < right; xx += step) ctx.fillRect(xx, top, 1, Math.max(1, bottom - top));

  ctx.fillStyle = '#b79851';
  ctx.font = `bold ${Math.max(6, Math.round(h * 0.16))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ГХ', Math.round(x + w * 0.5), Math.round(y + h * 0.52));
  ctx.restore();
}

function drawCardSlot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number): void {
  rect(ctx, x, y, w, h, 'rgba(7,10,10,0.58)', '#353b39');
  const tick = Math.max(2, Math.round(3 * s));
  ctx.fillStyle = '#59615a';
  const ix = Math.round(x + 4 * s);
  const iy = Math.round(y + 4 * s);
  const iw = Math.max(0, Math.round(w - 8 * s));
  const ih = Math.max(0, Math.round(h - 8 * s));
  for (let xx = ix; xx < ix + iw; xx += tick * 2) {
    ctx.fillRect(xx, iy, tick, 1);
    ctx.fillRect(xx, iy + ih, tick, 1);
  }
  for (let yy = iy; yy < iy + ih; yy += tick * 2) {
    ctx.fillRect(ix, yy, 1, tick);
    ctx.fillRect(ix + iw, yy, 1, tick);
  }
}

function drawPlayingCard(
  ctx: CanvasRenderingContext2D,
  card: DurakCard,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  options: { selected?: boolean; playable?: boolean; dimmed?: boolean; trump?: boolean } = {},
): void {
  ctx.save();
  ctx.globalAlpha *= options.dimmed ? 0.66 : 1;
  const border = options.selected ? '#d6b15d' : options.playable ? '#6fbf7d' : options.trump ? '#a88639' : '#2f2b22';
  rect(ctx, x, y, w, h, '#c7bea1', border);
  rect(ctx, x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, '#d2c8aa', '#8b826d');

  const style = suitStyle(card.suit);
  const rank = RANK_LABELS[card.rank];
  const font = Math.max(7, Math.round(h * 0.15));
  ctx.fillStyle = style.primary;
  ctx.font = `bold ${font}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(rank, Math.round(x + 5 * s), Math.round(y + 4 * s));

  const cornerCell = Math.max(1, Math.round(h * 0.017));
  const cornerW = maskWidth(SUIT_MASKS[card.suit]) * cornerCell;
  const cornerH = SUIT_MASKS[card.suit].length * cornerCell;
  drawPixelSuit(ctx, card.suit, x + 5 * s, y + 6 * s + font, cornerCell);
  drawCardCenter(ctx, card, x, y, w, h, s);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(rank, Math.round(x + w - 5 * s), Math.round(y + h - 4 * s));
  drawPixelSuit(ctx, card.suit, x + w - 5 * s - cornerW, y + h - 6 * s - font - cornerH, cornerCell);

  if (options.selected) {
    const b = Math.max(2, Math.round(2 * s));
    const len = Math.max(8 * s, Math.min(w, h) * 0.22);
    rect(ctx, x - b, y - b, len, b, '#d6b15d');
    rect(ctx, x - b, y - b, b, len, '#d6b15d');
    rect(ctx, x + w - len + b, y - b, len, b, '#d6b15d');
    rect(ctx, x + w, y - b, b, len, '#d6b15d');
    rect(ctx, x - b, y + h, len, b, '#d6b15d');
    rect(ctx, x - b, y + h - len + b, b, len, '#d6b15d');
    rect(ctx, x + w - len + b, y + h, len, b, '#d6b15d');
    rect(ctx, x + w, y + h - len + b, b, len, '#d6b15d');
  }
  if (options.playable && !options.selected) {
    rect(ctx, x + 2 * s, y + 2 * s, 7 * s, 2 * s, '#b79851');
    rect(ctx, x + 2 * s, y + 2 * s, 2 * s, 7 * s, '#b79851');
  }
  ctx.restore();
}

function drawNpcHand(ctx: CanvasRenderingContext2D, snapshot: DurakSnapshot, x: number, y: number, maxW: number, cardW: number, cardH: number, s: number): void {
  const shown = Math.min(MAX_VISIBLE_NPC_BACKS, Math.max(0, snapshot.npcHandCount));
  const step = shown <= 1 ? 0 : Math.min(cardW * 0.36, Math.max(4 * s, (maxW - cardW) / (shown - 1)));
  const totalW = shown <= 0 ? 0 : cardW + step * (shown - 1);
  const startX = x + (maxW - totalW) * 0.5;
  for (let i = 0; i < shown; i++) drawCardBack(ctx, startX + i * step, y, cardW, cardH, s, 0.96);
  drawBadge(ctx, `${snapshot.npcName}: ${snapshot.npcHandCount}`, x, y + cardH + 3 * s, maxW, 13 * s, s, '#8ca7a1');
}

function handLayout(maxW: number, preferredH: number, count: number, s: number): { cardW: number; cardH: number; step: number; totalW: number } {
  let cardH = Math.max(28 * s, preferredH);
  let cardW = cardH * CARD_ASPECT;
  const minStep = cardW * 0.34;
  let step = count <= 1 ? 0 : Math.min(cardW + 2 * s, (maxW - cardW) / (count - 1));
  if (count > 1 && step < minStep) {
    cardW = Math.max(16 * s, maxW / (1 + (count - 1) * 0.34));
    cardH = cardW / CARD_ASPECT;
    step = cardW * 0.34;
  }
  return { cardW, cardH, step, totalW: count <= 0 ? 0 : cardW + step * Math.max(0, count - 1) };
}

function drawPlayerHand(ctx: CanvasRenderingContext2D, snapshot: DurakSnapshot, x: number, y: number, maxW: number, preferredH: number, s: number): void {
  const count = snapshot.playerHand.length;
  if (count <= 0) {
    drawBadge(ctx, 'РУКА ПУСТА', x + maxW * 0.5 - 42 * s, y + 8 * s, 84 * s, 15 * s, s, '#737a75');
    return;
  }
  const layout = handLayout(maxW, preferredH, count, s);
  const startX = x + (maxW - layout.totalW) * 0.5;
  for (let i = 0; i < count; i++) {
    const selected = i === snapshot.selectedIndex;
    const playable = selected && snapshot.canPlaySelected;
    const lift = selected ? 5 * s : 0;
    drawPlayingCard(ctx, snapshot.playerHand[i], startX + i * layout.step, y - lift, layout.cardW, layout.cardH, s, {
      selected,
      playable,
      dimmed: selected && !snapshot.canPlaySelected,
    });
  }
}

function tableStatus(snapshot: DurakSnapshot): string {
  if (snapshot.finished) {
    if (snapshot.winner === 'draw') return 'НИЧЬЯ';
    return snapshot.winner === 'player' ? 'ВЫИГРЫШ' : 'ПРОИГРЫШ';
  }
  if (snapshot.phase === 'player_attack') {
    if (snapshot.defenderTaking) return 'NPC БЕРЕТ: ПОДКИНЬТЕ ИЛИ СТОП';
    return snapshot.table.length === 0 ? 'ВАШ ХОД: АТАКА' : 'ПОДКИНУТЬ ИЛИ ОТБОЙ';
  }
  return 'ЗАЩИТА: КРОЙТЕ ИЛИ БЕРИТЕ';
}

function drawTablePairs(ctx: CanvasRenderingContext2D, snapshot: DurakSnapshot, x: number, y: number, w: number, h: number, s: number): void {
  rect(ctx, x, y, w, h, 'rgba(6,9,9,0.62)', '#343c38');
  drawBadge(ctx, 'ВЫЛОЖЕНО', x + 5 * s, y + 4 * s, 72 * s, 13 * s, s, '#79847d');

  if (snapshot.table.length <= 0) {
    ctx.fillStyle = '#4d5752';
    ctx.font = `${Math.max(8, Math.round(8 * s))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ПУСТО', Math.round(x + w * 0.5), Math.round(y + h * 0.53));
    return;
  }

  const pairCount = snapshot.table.length;
  const cols = Math.min(3, pairCount);
  const rows = Math.ceil(pairCount / cols);
  const gapX = 5 * s;
  const gapY = 5 * s;
  const cardAreaY = y + 23 * s;
  const cardAreaH = Math.max(1, h - 29 * s);
  const usableRowsH = Math.max(1, cardAreaH - gapY * Math.max(0, rows - 1));
  let cardH = Math.min(46 * s, usableRowsH / Math.max(1, rows) / 1.12);
  let cardW = cardH * CARD_ASPECT;
  let pairW = cardW * 1.45;
  const maxPairW = (w - 10 * s - gapX * Math.max(0, cols - 1)) / cols;
  if (pairW > maxPairW) {
    pairW = maxPairW;
    cardW = pairW / 1.45;
    cardH = cardW / CARD_ASPECT;
  }
  const pairH = cardH * 1.12;
  const totalW = pairW * cols + gapX * Math.max(0, cols - 1);
  const totalH = pairH * rows + gapY * Math.max(0, rows - 1);
  const startX = x + (w - totalW) * 0.5;
  const startY = cardAreaY + Math.max(0, (cardAreaH - totalH) * 0.42);

  snapshot.table.forEach((pair, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ax = startX + col * (pairW + gapX);
    const ay = startY + row * (pairH + gapY);
    drawPlayingCard(ctx, pair.attack, ax, ay, cardW, cardH, s);
    const dx = ax + cardW * 0.45;
    const dy = ay + cardH * 0.10;
    if (pair.defense) drawPlayingCard(ctx, pair.defense, dx, dy, cardW, cardH, s);
    else drawCardSlot(ctx, dx, dy, cardW, cardH, s);
  });
}

function drawDeckAndTrump(ctx: CanvasRenderingContext2D, snapshot: DurakSnapshot, x: number, y: number, cardW: number, cardH: number, s: number): void {
  drawCardBack(ctx, x + cardW * 0.42, y, cardW, cardH, s);
  drawPlayingCard(ctx, snapshot.trumpCard, x, y + cardH * 0.18, cardW, cardH, s, { trump: true });
  drawBadge(ctx, `КОЛ ${snapshot.talonCount}`, x - 2 * s, y + cardH + 4 * s, cardW * 1.45, 13 * s, s, '#d1aa54');
  drawBadge(ctx, `ОТБ ${snapshot.discardCount}`, x - 2 * s, y + cardH + 19 * s, cardW * 1.45, 13 * s, s, '#6f7771');
}

export function drawDurakInterface(
  ctx: CanvasRenderingContext2D,
  snapshot: DurakSnapshot,
  px: number,
  py: number,
  pw: number,
  ph: number,
  sx: number,
  sy: number,
  _time: number,
): void {
  const s = Math.max(0.75, Math.min(2.5, Math.min(sx, sy)));
  const pad = 8 * s;
  const headerY = py + 36 * sy;
  const controlsY = py + ph - 17 * sy;
  const handPreferredH = clamp(ph * 0.20, 34 * sy, 60 * sy);
  const playerLayout = handLayout(pw - pad * 2, handPreferredH, Math.max(1, snapshot.playerHand.length), s);
  const selectedLiftReserve = 7 * s;
  const handY = controlsY - playerLayout.cardH - 10 * sy;
  const statusH = 15 * sy;
  const statusY = handY - selectedLiftReserve - 8 * sy - statusH;
  const topCardH = clamp(playerLayout.cardH * 0.64, 24 * sy, 40 * sy);
  const topCardW = topCardH * CARD_ASPECT;
  const topY = headerY + 25 * sy;
  const tableY = topY + topCardH + 20 * sy;
  const tableH = Math.max(1, statusY - tableY - 8 * sy);
  const tableX = px + pad;
  const tableW = pw - pad * 2;

  ctx.save();
  rect(ctx, px + 4 * sx, py + 32 * sy, pw - 8 * sx, ph - 43 * sy, 'rgba(2,5,5,0.74)', '#27312f');

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#d1aa54';
  ctx.font = `bold ${10 * sy}px monospace`;
  ctx.fillText(fitText(ctx, 'ДУРАК', pw * 0.22), px + pad, headerY);

  ctx.fillStyle = '#8d9690';
  ctx.font = `${7.2 * sy}px monospace`;
  const turn = snapshot.attacker === 'player' ? 'ВЫ ХОДИТЕ' : `${snapshot.npcName} ХОДИТ`;
  const meta = `СТАВКА ${snapshot.stakeRubles}Р | КОЗЫРЬ ${formatDurakSuit(snapshot.trumpSuit)} | ${turn}`;
  ctx.fillText(fitText(ctx, meta, pw - pad * 2 - 58 * s), px + pad, headerY + 13 * sy);

  const npcW = Math.min(pw * 0.38, Math.max(92 * s, pw - pad * 2 - 108 * s));
  drawNpcHand(ctx, snapshot, px + pad, topY, npcW, topCardW, topCardH, s);
  drawDeckAndTrump(ctx, snapshot, px + pw - pad - topCardW * 1.45, topY, topCardW, topCardH, s);
  drawTablePairs(ctx, snapshot, tableX, tableY, tableW, tableH, s);

  const status = snapshot.message || snapshot.log[snapshot.log.length - 1] || tableStatus(snapshot);
  drawBadge(ctx, fitText(ctx, status.toUpperCase(), tableW - 8 * s), tableX, statusY, tableW, statusH, s, '#c4cdc7');
  drawPlayerHand(ctx, snapshot, px + pad, handY, pw - pad * 2, handPreferredH, s);

  const action = snapshot.finished
    ? `${controlHint('gameMenu')} ЗАКРЫТЬ  ${menuCloseHint()} ВЫЙТИ`
    : `${controlBindingLabel('menuLeft')}/${controlBindingLabel('menuRight')} КАРТА  ${controlHint('gameMenu')} СЫГРАТЬ  ${controlBindingLabel('drop')} ВЗЯТЬ/СТОП  ${menuCloseHint()} СДАТЬСЯ`;
  ctx.fillStyle = '#59615d';
  ctx.font = `${7 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, action, pw - pad * 2), Math.round(px + pw * 0.5), controlsY);
  ctx.restore();
}
