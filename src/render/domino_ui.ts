import { type DominoBoardTile, type DominoSnapshot, type DominoTile } from '../systems/domino';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { fitText } from './ui_text';
import { clamp, rect, drawBadge } from './ui_utils';

const PIPS: Record<number, readonly [number, number][]> = {
  0: [],
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

function drawPips(ctx: CanvasRenderingContext2D, value: number, x: number, y: number, w: number, h: number, s: number): void {
  const pipR = Math.max(1.05 * s, Math.min(w, h) * 0.055);
  ctx.fillStyle = '#121512';
  for (const [px, py] of PIPS[value] ?? PIPS[0]) {
    ctx.beginPath();
    ctx.arc(x + w * px, y + h * py, pipR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDominoTile(
  ctx: CanvasRenderingContext2D,
  tile: DominoTile,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  selected = false,
  muted = false,
): void {
  const fill = muted ? '#2d332f' : '#d9d2b8';
  const inner = muted ? '#373f3a' : '#eee4c6';
  const stroke = selected ? '#d6b15d' : muted ? '#697069' : '#3b3327';
  rect(ctx, x, y, w, h, fill, stroke);
  rect(ctx, x + 2 * s, y + 2 * s, w - 4 * s, h - 4 * s, inner, muted ? '#59615c' : '#8b826d');
  rect(ctx, x + w * 0.5 - 0.5, y + 4 * s, 1, h - 8 * s, muted ? '#59615c' : '#504638');
  if (!muted) {
    drawPips(ctx, tile.a, x + 3 * s, y + 3 * s, w * 0.5 - 6 * s, h - 6 * s, s);
    drawPips(ctx, tile.b, x + w * 0.5 + 3 * s, y + 3 * s, w * 0.5 - 6 * s, h - 6 * s, s);
  }
}

function drawHiddenTiles(ctx: CanvasRenderingContext2D, count: number, x: number, y: number, tileW: number, tileH: number, s: number): void {
  const visible = Math.min(count, 10);
  const step = Math.min(tileW * 0.42, 9 * s);
  for (let i = 0; i < visible; i++) {
    drawDominoTile(ctx, { id: -1, a: 0, b: 0 }, x + i * step, y + (i % 2) * 1.5 * s, tileW, tileH, s, false, true);
  }
  if (count > visible) drawBadge(ctx, `+${count - visible}`, x + visible * step + 2 * s, y + 2 * s, 24 * s, tileH - 4 * s, s, '#8d9690');
}

function boardWindow(board: readonly DominoBoardTile[], maxTiles: number): readonly DominoBoardTile[] {
  if (board.length <= maxTiles) return board;
  const tail = board.slice(board.length - maxTiles);
  return tail;
}

function drawBoard(ctx: CanvasRenderingContext2D, snapshot: DominoSnapshot, x: number, y: number, w: number, h: number, s: number): void {
  rect(ctx, x, y, w, h, 'rgba(4,7,6,0.56)', '#2c3732');
  const count = Math.max(1, snapshot.board.length);
  const targetW = (w - 12 * s) / (count + Math.max(0, count - 1) * 0.1);
  const tileW = clamp(targetW, 16 * s, clamp(w / 8.8, 34 * s, 48 * s));
  const tileH = clamp(tileW * 0.58, 10 * s, clamp(h * 0.28, 18 * s, 28 * s));
  const gap = tileW * 0.1;
  const maxTiles = Math.max(1, Math.floor((w - 12 * s) / (tileW + gap)));
  const visible = boardWindow(snapshot.board, maxTiles);
  let tx = x + (w - visible.length * tileW - Math.max(0, visible.length - 1) * gap) * 0.5;
  const ty = y + h * 0.45 - tileH * 0.5;
  if (snapshot.board.length === 0) {
    drawBadge(ctx, 'СТОЛ ПУСТ', x + 8 * s, y + h * 0.5 - 7 * s, w - 16 * s, 14 * s, s, '#6f7a74');
  } else {
    for (const entry of visible) {
      drawDominoTile(ctx, { id: entry.tile.id, a: entry.left, b: entry.right }, tx, ty, tileW, tileH, s, entry.side === 'player');
      tx += tileW + gap;
    }
  }
  const left = snapshot.leftPip >= 0 ? `${snapshot.leftPip}` : '-';
  const right = snapshot.rightPip >= 0 ? `${snapshot.rightPip}` : '-';
  drawBadge(ctx, `КРАЯ ${left} | ${right}`, x + 8 * s, y + 7 * s, Math.min(w - 16 * s, 104 * s), 14 * s, s, '#c4cdc7');
  const sideText = snapshot.selectedEnd === 'left' ? 'КЛАДЕМ ВЛЕВО' : 'КЛАДЕМ ВПРАВО';
  drawBadge(ctx, sideText, x + w - 116 * s, y + 7 * s, 108 * s, 14 * s, s, snapshot.canPlaySelected ? '#8f8' : '#d6b15d');
}

function drawPlayerHand(ctx: CanvasRenderingContext2D, snapshot: DominoSnapshot, x: number, y: number, w: number, h: number, s: number): void {
  const count = Math.max(1, snapshot.playerHand.length);
  const tileW = clamp(w / Math.min(9.2, count + 1.4), 34 * s, 48 * s);
  const tileH = clamp(h * 0.56, 18 * s, 27 * s);
  const step = count > 1 ? Math.min(tileW + 4 * s, (w - tileW) / (count - 1)) : 0;
  let tx = x + (w - (tileW + step * (count - 1))) * 0.5;
  for (let i = 0; i < snapshot.playerHand.length; i++) {
    const selected = i === snapshot.selectedIndex;
    drawDominoTile(ctx, snapshot.playerHand[i], tx, y + (selected ? 0 : 5 * s), tileW, tileH, s, selected);
    tx += step;
  }
}

function resultText(snapshot: DominoSnapshot): string {
  if (!snapshot.finished) {
    if (snapshot.canDrawOrPass) return snapshot.boneyardCount > 0 ? 'ДОБОР ИЗ КОРОБКИ' : 'ПРОПУСК ХОДА';
    return snapshot.canPlaySelected ? 'КОСТЯШКА ПОДХОДИТ' : 'ВЫБЕРИТЕ ХОД';
  }
  if (snapshot.winner === 'draw') return 'НИЧЬЯ';
  return snapshot.winner === 'player' ? 'ВЫИГРЫШ' : 'ПРОИГРЫШ';
}

export function drawDominoInterface(
  ctx: CanvasRenderingContext2D,
  snapshot: DominoSnapshot,
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
  const handH = clamp(ph * 0.18, 34 * sy, 54 * sy);
  const handY = controlsY - handH - 9 * sy;
  const statusH = 15 * sy;
  const statusY = handY - 8 * sy - statusH;
  const topY = headerY + 27 * sy;
  const boardY = topY + 30 * sy;
  const boardH = Math.max(64 * sy, statusY - boardY - 8 * sy);

  ctx.save();
  rect(ctx, px + 4 * sx, py + 32 * sy, pw - 8 * sx, ph - 43 * sy, 'rgba(2,5,5,0.74)', '#27312f');

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#d1aa54';
  ctx.font = `bold ${10 * sy}px monospace`;
  ctx.fillText(fitText(ctx, 'ДОМИНО', pw * 0.24), px + pad, headerY);

  ctx.fillStyle = '#8d9690';
  ctx.font = `${7.2 * sy}px monospace`;
  const turn = snapshot.phase === 'npc_turn' ? `${snapshot.npcName} ХОДИТ` : snapshot.finished ? resultText(snapshot) : 'ВАШ ХОД';
  ctx.fillText(fitText(ctx, `СТАВКА ${snapshot.stakeRubles}Р | КОРОБКА ${snapshot.boneyardCount} | ${turn}`, pw - pad * 2), px + pad, headerY + 13 * sy);

  drawHiddenTiles(ctx, snapshot.npcHandCount, px + pad, topY, 31 * s, 17 * s, s);
  drawBadge(ctx, snapshot.npcName, px + pw - pad - 130 * s, topY + 1 * s, 130 * s, 15 * s, s, '#8d9690');
  drawBoard(ctx, snapshot, px + pad, boardY, pw - pad * 2, boardH, s);

  const status = snapshot.message || snapshot.log[snapshot.log.length - 1] || resultText(snapshot);
  drawBadge(ctx, fitText(ctx, status.toUpperCase(), pw - pad * 2 - 8 * s), px + pad, statusY, pw - pad * 2, statusH, s, '#c4cdc7');
  drawPlayerHand(ctx, snapshot, px + pad, handY, pw - pad * 2, handH, s);

  const action = snapshot.finished
    ? `${controlHint('gameMenu')} ЗАКРЫТЬ  ${menuCloseHint()} ВЫЙТИ`
    : `${controlBindingLabel('menuLeft')}/${controlBindingLabel('menuRight')} КОСТЬ  ${controlHint('gameMenu')} СЫГРАТЬ/ДОБРАТЬ  ${controlBindingLabel('drop')} КРАЙ  ${menuCloseHint()} СДАТЬСЯ`;
  ctx.fillStyle = '#59615d';
  ctx.font = `${7 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, action, pw - pad * 2), Math.round(px + pw * 0.5), controlsY);
  ctx.restore();
}
