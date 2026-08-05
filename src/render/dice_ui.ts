import { type DiceRoll, type DiceSnapshot } from '../systems/dice';
import { controlBindingLabel, controlHint, menuCloseHint } from '../systems/controls';
import { fitText } from './ui_text';
import { clamp, rect, drawBadge } from './ui_utils';

const PIPS: Record<number, readonly [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};

function drawDie(ctx: CanvasRenderingContext2D, value: number, x: number, y: number, size: number, s: number, active: boolean): void {
  const border = active ? '#d6b15d' : '#2f2b22';
  rect(ctx, x, y, size, size, '#c7bea1', border);
  rect(ctx, x + 2 * s, y + 2 * s, size - 4 * s, size - 4 * s, '#d7caa9', '#8b826d');
  const pipR = Math.max(1.3 * s, size * 0.052);
  ctx.fillStyle = '#101613';
  for (const [px, py] of PIPS[value] ?? PIPS[1]) {
    const cx = x + size * px;
    const cy = y + size * py;
    ctx.beginPath();
    ctx.arc(cx, cy, pipR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function lastRoll(rolls: readonly DiceRoll[]): DiceRoll | undefined {
  return rolls[rolls.length - 1];
}

function rollLine(rolls: readonly DiceRoll[], fallback: string): string {
  if (rolls.length <= 0) return fallback;
  const last = rolls[rolls.length - 1];
  return `${rolls.length} бр. | ${last.dieA}+${last.dieB}=${last.total}`;
}

function resultText(snapshot: DiceSnapshot): string {
  if (!snapshot.finished) {
    if (snapshot.playerScore <= 0) return 'БРОСАЙТЕ ИЛИ СДАВАЙТЕСЬ';
    return 'БРОСИТЬ ЕЩЕ ИЛИ СТОП';
  }
  if (snapshot.winner === 'draw') return 'НИЧЬЯ';
  return snapshot.winner === 'player' ? 'ВЫИГРЫШ' : 'ПРОИГРЫШ';
}

function scoreColor(score: number, active: boolean): string {
  if (score > 21) return '#f84';
  if (score === 21) return '#d6b15d';
  return active ? '#8f8' : '#c4cdc7';
}

function drawSide(
  ctx: CanvasRenderingContext2D,
  label: string,
  score: number,
  rolls: readonly DiceRoll[],
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  active: boolean,
): void {
  rect(ctx, x, y, w, h, 'rgba(6,9,9,0.62)', active ? '#d6b15d' : '#343c38');
  ctx.fillStyle = active ? '#d6b15d' : '#8d9690';
  ctx.font = `bold ${9 * s}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, label, w - 8 * s), x + 5 * s, y + 5 * s);

  const roll = lastRoll(rolls);
  const dieSize = clamp(Math.min(w * 0.32, h * 0.40), 22 * s, 48 * s);
  const diceY = y + h * 0.36;
  const diceX = x + (w - dieSize * 2 - 7 * s) * 0.5;
  drawDie(ctx, roll?.dieA ?? 1, diceX, diceY, dieSize, s, active);
  drawDie(ctx, roll?.dieB ?? 1, diceX + dieSize + 7 * s, diceY, dieSize, s, active);
  if (!roll) {
    ctx.fillStyle = 'rgba(4,6,6,0.56)';
    ctx.fillRect(Math.round(diceX), Math.round(diceY), Math.round(dieSize * 2 + 7 * s), Math.round(dieSize));
  }

  drawBadge(ctx, `СЧЕТ ${score}`, x + 5 * s, y + h - 33 * s, w - 10 * s, 13 * s, s, scoreColor(score, active));
  drawBadge(ctx, rollLine(rolls, 'КОСТИ ЖДУТ'), x + 5 * s, y + h - 17 * s, w - 10 * s, 12 * s, s, '#7f8d86');
}

export function drawDiceInterface(
  ctx: CanvasRenderingContext2D,
  snapshot: DiceSnapshot,
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
  const bodyY = headerY + 30 * sy;
  const statusH = 16 * sy;
  const statusY = controlsY - 22 * sy;
  const sideY = bodyY;
  const sideH = Math.max(80 * sy, statusY - sideY - 10 * sy);
  const gap = 8 * s;
  const sideW = (pw - pad * 2 - gap) * 0.5;

  ctx.save();
  rect(ctx, px + 4 * sx, py + 32 * sy, pw - 8 * sx, ph - 43 * sy, 'rgba(2,5,5,0.74)', '#27312f');

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#d1aa54';
  ctx.font = `bold ${10 * sy}px monospace`;
  ctx.fillText(fitText(ctx, 'КОСТИ', pw * 0.22), px + pad, headerY);

  ctx.fillStyle = '#8d9690';
  ctx.font = `${7.2 * sy}px monospace`;
  const turn = snapshot.phase === 'npc_turn' ? `${snapshot.npcName} БРОСАЕТ` : snapshot.finished ? resultText(snapshot) : 'ВАШ БРОСОК';
  ctx.fillText(fitText(ctx, `СТАВКА ${snapshot.stakeRubles}Р | ЦЕЛЬ ДО 21 | ${turn}`, pw - pad * 2), px + pad, headerY + 13 * sy);

  drawSide(ctx, 'ВЫ', snapshot.playerScore, snapshot.playerRolls, px + pad, sideY, sideW, sideH, s, snapshot.phase === 'player_turn' && !snapshot.finished);
  drawSide(ctx, snapshot.npcName, snapshot.npcScore, snapshot.npcRolls, px + pad + sideW + gap, sideY, sideW, sideH, s, snapshot.phase === 'npc_turn');

  const status = snapshot.message || snapshot.log[snapshot.log.length - 1] || resultText(snapshot);
  drawBadge(ctx, fitText(ctx, status.toUpperCase(), pw - pad * 2 - 8 * s), px + pad, statusY, pw - pad * 2, statusH, s, '#c4cdc7');

  const action = snapshot.finished
    ? `${controlHint('gameMenu')} ЗАКРЫТЬ  ${menuCloseHint()} ВЫЙТИ`
    : `${controlHint('gameMenu')} БРОСИТЬ  ${controlBindingLabel('drop')} СТОП  ${menuCloseHint()} СДАТЬСЯ`;
  ctx.fillStyle = '#59615d';
  ctx.font = `${7 * sy}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, action, pw - pad * 2), Math.round(px + pw * 0.5), controlsY);
  ctx.restore();
}
