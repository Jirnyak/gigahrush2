import { type CheckersSnapshot, type CheckersPiece } from '../systems/checkers';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { fitText } from './ui_text';
import { rect, drawBadge } from './ui_utils';

function resultText(snapshot: CheckersSnapshot): string {
  if (snapshot.phase !== 'finished') {
    return snapshot.phase === 'player_turn' ? 'ВАШ ХОД' : 'ХОД ПРОТИВНИКА';
  }
  if (snapshot.winner === 'draw') return 'НИЧЬЯ';
  return snapshot.winner === 'player' ? 'ВЫИГРЫШ' : 'ПРОИГРЫШ';
}

function drawPiece(ctx: CanvasRenderingContext2D, piece: CheckersPiece, cx: number, cy: number, radius: number, isSelected: boolean) {
  const fill = piece.side === 'player' ? '#d6b15d' : '#8d9690';
  const stroke = isSelected ? '#ffffff' : (piece.side === 'player' ? '#8b826d' : '#59615d');
  
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  
  ctx.lineWidth = isSelected ? 3 : 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.stroke();

  if (piece.isKing) {
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawCheckersInterface(
  ctx: CanvasRenderingContext2D,
  snapshot: CheckersSnapshot,
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
  
  ctx.save();
  rect(ctx, px + 4 * sx, py + 32 * sy, pw - 8 * sx, ph - 43 * sy, 'rgba(2,5,5,0.74)', '#27312f');

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#d1aa54';
  ctx.font = `bold ${10 * sy}px monospace`;
  ctx.fillText(fitText(ctx, 'ШАШКИ', pw * 0.22), px + pad, headerY);

  ctx.fillStyle = '#8d9690';
  ctx.font = `${7.2 * sy}px monospace`;
  const turn = snapshot.phase === 'npc_turn' ? `${snapshot.npcName} ДУМАЕТ` : snapshot.phase === 'finished' ? resultText(snapshot) : 'ВАШ ХОД';
  ctx.fillText(fitText(ctx, `СТАВКА ${snapshot.stakeRubles}Р | ${turn}`, pw - pad * 2), px + pad, headerY + 13 * sy);

  // Draw Board
  const boardSize = Math.min(pw - pad * 2, ph - 120 * sy);
  const boardX = px + (pw - boardSize) / 2;
  const boardY = headerY + 30 * sy;
  const cellSize = boardSize / 8;

  rect(ctx, boardX - 2, boardY - 2, boardSize + 4, boardSize + 4, '#1c2422', '#343c38');

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const isDark = (x + y) % 2 === 1;
      const cellFill = isDark ? '#27312f' : '#3a4441';
      rect(ctx, boardX + x * cellSize, boardY + y * cellSize, cellSize, cellSize, cellFill);
      
      // Cursor
      if (snapshot.phase === 'player_turn' && snapshot.cursorX === x && snapshot.cursorY === y) {
        rect(ctx, boardX + x * cellSize, boardY + y * cellSize, cellSize, cellSize, 'rgba(214, 177, 93, 0.3)', '#d6b15d');
      }

      const piece = snapshot.pieces.find(p => p.x === x && p.y === y);
      if (piece) {
        drawPiece(ctx, piece, boardX + x * cellSize + cellSize / 2, boardY + y * cellSize + cellSize / 2, cellSize * 0.35, piece.id === snapshot.selectedPieceId);
      }
    }
  }

  const statusY = boardY + boardSize + 10 * sy;
  const statusH = 16 * sy;
  const status = snapshot.message || snapshot.log[snapshot.log.length - 1] || resultText(snapshot);
  drawBadge(ctx, fitText(ctx, status.toUpperCase(), pw - pad * 2 - 8 * s), px + pad, statusY, pw - pad * 2, statusH, s, '#c4cdc7');

  const action = snapshot.phase === 'finished'
    ? `${controlHint('gameMenu')} ЗАКРЫТЬ  ${menuCloseHint()} ВЫЙТИ`
    : `${controlHint('gameMenu')} ВЫБРАТЬ/ХОДИТЬ  ${controlBindingLabel('drop')} ОТМЕНА/СТОП  ${menuCloseHint()} СДАТЬСЯ`;
  ctx.fillStyle = '#59615d';
  ctx.font = `${7 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, action, pw - pad * 2), Math.round(px + pw * 0.5), controlsY);
  ctx.restore();
}
