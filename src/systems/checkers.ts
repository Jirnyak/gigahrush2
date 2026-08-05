import { msg, type Entity, type GameState } from '../core/types';
import { publishEvent } from './events';

export type CheckersSide = 'player' | 'npc';
export type CheckersWinner = CheckersSide | 'draw' | '';
export type CheckersPhase = 'player_turn' | 'npc_turn' | 'finished';

export interface CheckersPiece {
  id: number;
  side: CheckersSide;
  isKing: boolean;
  x: number;
  y: number;
}

export interface CheckersSnapshot {
  open: boolean;
  npcId: number;
  npcName: string;
  stakeRubles: number;
  pieces: readonly CheckersPiece[];
  phase: CheckersPhase;
  winner: CheckersWinner;
  message: string;
  log: readonly string[];
  selectedPieceId?: number;
  cursorX: number;
  cursorY: number;
}

export interface CheckersInput {
  leftNav?: boolean;
  rightNav?: boolean;
  upNav?: boolean;
  downNav?: boolean;
  interactEdge?: boolean;
  dropEdge?: boolean;
  escEdge?: boolean;
}

export interface CheckersInputResult {
  handled: boolean;
  closeInterface?: boolean;
}

interface CheckersMove {
  pieceId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  isCapture: boolean;
  capturedPieceId?: number;
}

interface CheckersGame {
  open: boolean;
  npcId: number;
  npcName: string;
  stakeRubles: number;
  pieces: CheckersPiece[];
  phase: CheckersPhase;
  winner: CheckersWinner;
  settled: boolean;
  message: string;
  log: string[];
  selectedPieceId?: number;
  cursorX: number;
  cursorY: number;
  mustCaptureWithPieceId?: number;
}

let game: CheckersGame | null = null;
let nextPieceId = 1;

function cleanMoney(actor: Entity): number {
  const money = actor.money ?? 0;
  return Number.isFinite(money) ? Math.max(0, Math.floor(money)) : 0;
}

export function checkersStakeFromNpc(npc: Entity): number {
  const money = cleanMoney(npc);
  return money > 0 ? Math.max(1, Math.floor(money * 0.1)) : 0;
}

function appendLog(g: CheckersGame, line: string): void {
  g.log.push(line);
  if (g.log.length > 6) g.log.splice(0, g.log.length - 6);
  g.message = line;
}

function initPieces(): CheckersPiece[] {
  const pieces: CheckersPiece[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 === 1) {
        if (y <= 2) pieces.push({ id: nextPieceId++, side: 'npc', isKing: false, x, y });
        else if (y >= 5) pieces.push({ id: nextPieceId++, side: 'player', isKing: false, x, y });
      }
    }
  }
  return pieces;
}

function getPieceAt(pieces: readonly CheckersPiece[], x: number, y: number): CheckersPiece | undefined {
  return pieces.find(p => p.x === x && p.y === y);
}

function generateMovesForPiece(pieces: readonly CheckersPiece[], piece: CheckersPiece): CheckersMove[] {
  const moves: CheckersMove[] = [];
  
  if (piece.isKing) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      let d = 1;
      while (true) {
        const nx = piece.x + dx * d;
        const ny = piece.y + dy * d;
        if (nx < 0 || nx >= 8 || ny < 0 || ny >= 8) break;
        if (getPieceAt(pieces, nx, ny)) break;
        moves.push({ pieceId: piece.id, startX: piece.x, startY: piece.y, endX: nx, endY: ny, isCapture: false });
        d++;
      }
      
      d = 1;
      let foundOpponent: CheckersPiece | undefined = undefined;
      while (true) {
        const nx = piece.x + dx * d;
        const ny = piece.y + dy * d;
        if (nx < 0 || nx >= 8 || ny < 0 || ny >= 8) break;
        const mid = getPieceAt(pieces, nx, ny);
        if (mid) {
          if (mid.side === piece.side) break;
          if (foundOpponent) break;
          foundOpponent = mid;
        } else if (foundOpponent) {
          moves.push({ pieceId: piece.id, startX: piece.x, startY: piece.y, endX: nx, endY: ny, isCapture: true, capturedPieceId: foundOpponent.id });
        }
        d++;
      }
    }
  } else {
    const dirs = piece.side === 'player' ? [[-1, -1], [1, -1]] : [[-1, 1], [1, 1]];
    for (const [dx, dy] of dirs) {
      const nx = piece.x + dx;
      const ny = piece.y + dy;
      if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && !getPieceAt(pieces, nx, ny)) {
        moves.push({ pieceId: piece.id, startX: piece.x, startY: piece.y, endX: nx, endY: ny, isCapture: false });
      }
    }
    
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const mx = piece.x + dx;
      const my = piece.y + dy;
      const nx = piece.x + dx * 2;
      const ny = piece.y + dy * 2;
      if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
        const mid = getPieceAt(pieces, mx, my);
        if (mid && mid.side !== piece.side && !getPieceAt(pieces, nx, ny)) {
          moves.push({ pieceId: piece.id, startX: piece.x, startY: piece.y, endX: nx, endY: ny, isCapture: true, capturedPieceId: mid.id });
        }
      }
    }
  }

  return moves;
}

function getAllMovesForSide(pieces: readonly CheckersPiece[], side: CheckersSide): CheckersMove[] {
  let moves: CheckersMove[] = [];
  for (const piece of pieces) {
    if (piece.side === side) {
      moves = moves.concat(generateMovesForPiece(pieces, piece));
    }
  }
  return moves;
}

function applyMove(pieces: CheckersPiece[], move: CheckersMove): CheckersPiece[] {
  let newPieces = pieces.map(p => ({ ...p }));
  const piece = newPieces.find(p => p.id === move.pieceId);
  if (!piece) return newPieces;

  piece.x = move.endX;
  piece.y = move.endY;

  if (move.isCapture && move.capturedPieceId) {
    newPieces = newPieces.filter(p => p.id !== move.capturedPieceId);
  }

  if (piece.side === 'player' && piece.y === 0) piece.isKing = true;
  if (piece.side === 'npc' && piece.y === 7) piece.isKing = true;

  return newPieces;
}

function evaluateBoard(pieces: readonly CheckersPiece[]): number {
  let score = 0;
  for (const piece of pieces) {
    const val = piece.isKing ? 3 : 1;
    if (piece.side === 'npc') score += val;
    else score -= val;
  }
  return score;
}

function minimax(pieces: readonly CheckersPiece[], depth: number, isMaximizing: boolean, alpha: number, beta: number, activePieceId?: number): number {
  if (depth === 0) return evaluateBoard(pieces);
  
  const side = isMaximizing ? 'npc' : 'player';
  let allMoves: CheckersMove[];
  if (activePieceId) {
    const piece = pieces.find(p => p.id === activePieceId);
    allMoves = piece ? generateMovesForPiece(pieces, piece).filter(m => m.isCapture) : [];
  } else {
    allMoves = getAllMovesForSide(pieces, side);
  }
  
  const captureMoves = allMoves.filter(m => m.isCapture);
  const validMoves = captureMoves.length > 0 ? captureMoves : allMoves;

  if (validMoves.length === 0) {
      if (activePieceId) {
          return minimax(pieces, depth - 1, !isMaximizing, alpha, beta);
      }
      return isMaximizing ? -100 : 100;
  }

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of validMoves) {
      const nextPieces = applyMove([...pieces], move);
      
      let nextActiveId: number | undefined = undefined;
      if (move.isCapture) {
         const nextCaps = generateMovesForPiece(nextPieces, nextPieces.find(p => p.id === move.pieceId)!).filter(m => m.isCapture);
         if (nextCaps.length > 0) nextActiveId = move.pieceId;
      }
      
      const ev = minimax(nextPieces, nextActiveId ? depth : depth - 1, nextActiveId ? isMaximizing : false, alpha, beta, nextActiveId);
      maxEval = Math.max(maxEval, ev);
      alpha = Math.max(alpha, ev);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of validMoves) {
      const nextPieces = applyMove([...pieces], move);
      
      let nextActiveId: number | undefined = undefined;
      if (move.isCapture) {
         const nextCaps = generateMovesForPiece(nextPieces, nextPieces.find(p => p.id === move.pieceId)!).filter(m => m.isCapture);
         if (nextCaps.length > 0) nextActiveId = move.pieceId;
      }

      const ev = minimax(nextPieces, nextActiveId ? depth : depth - 1, nextActiveId ? isMaximizing : true, alpha, beta, nextActiveId);
      minEval = Math.min(minEval, ev);
      beta = Math.min(beta, ev);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function chooseNpcMove(pieces: readonly CheckersPiece[], mustCaptureWithPieceId?: number): CheckersMove | null {
  let allMoves: CheckersMove[];
  if (mustCaptureWithPieceId) {
    const piece = pieces.find(p => p.id === mustCaptureWithPieceId);
    allMoves = piece ? generateMovesForPiece(pieces, piece).filter(m => m.isCapture) : [];
  } else {
    allMoves = getAllMovesForSide(pieces, 'npc');
  }
  const captureMoves = allMoves.filter(m => m.isCapture);
  const validMoves = captureMoves.length > 0 ? captureMoves : allMoves;

  if (validMoves.length === 0) return null;

  let bestMove = validMoves[0];
  let maxEval = -Infinity;

  for (const move of validMoves) {
    const nextPieces = applyMove([...pieces], move);
    let nextActiveId: number | undefined = undefined;
    if (move.isCapture) {
       const nextCaps = generateMovesForPiece(nextPieces, nextPieces.find(p => p.id === move.pieceId)!).filter(m => m.isCapture);
       if (nextCaps.length > 0) nextActiveId = move.pieceId;
    }
    
    const ev = minimax(nextPieces, nextActiveId ? 2 : 1, nextActiveId ? true : false, -Infinity, Infinity, nextActiveId);
    if (ev > maxEval) {
      maxEval = ev;
      bestMove = move;
    } else if (ev === maxEval && Math.random() < 0.3) {
      bestMove = move;
    }
  }

  return bestMove;
}

function checkWinCondition(g: CheckersGame): void {
  const playerMoves = getAllMovesForSide(g.pieces, 'player');
  const npcMoves = getAllMovesForSide(g.pieces, 'npc');
  
  if (playerMoves.length === 0 && npcMoves.length === 0) g.winner = 'draw';
  else if (playerMoves.length === 0) g.winner = 'npc';
  else if (npcMoves.length === 0) g.winner = 'player';
}

function publishCheckersSettlementEvent(state: GameState, player: Entity, npc: Entity, winner: CheckersWinner, amount: number, stake: number): void {
  if (winner !== 'player' && winner !== 'npc') return;
  const playerWin = winner === 'player';
  publishEvent(state, {
    type: playerWin ? 'gambling_win' : 'gambling_loss',
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name,
    actorFaction: player.faction,
    targetId: npc.id,
    targetName: npc.name,
    targetFaction: npc.faction,
    itemValue: amount,
    severity: playerWin ? 2 : 1,
    privacy: 'local',
    tags: ['gambling', 'checkers', playerWin ? 'win' : 'loss'],
    data: { stake, transfer: amount, winner },
  });
}

function transferCheckersStake(state: GameState, player: Entity, npc: Entity, winner: CheckersWinner, stake: number): number {
  if (winner !== 'player' && winner !== 'npc') return 0;
  const payer = winner === 'player' ? npc : player;
  const receiver = winner === 'player' ? player : npc;
  const amount = Math.min(Math.max(0, Math.floor(stake)), cleanMoney(payer));
  payer.money = cleanMoney(payer) - amount;
  receiver.money = cleanMoney(receiver) + amount;
  publishCheckersSettlementEvent(state, player, npc, winner, amount, Math.max(0, Math.floor(stake)));
  return amount;
}

function settleCheckersGame(g: CheckersGame, state: GameState, player: Entity, npc: Entity): void {
  if (g.settled || (g.winner !== 'player' && g.winner !== 'npc' && g.winner !== 'draw')) return;
  g.settled = true;
  g.phase = 'finished';
  if (g.winner === 'draw') {
    appendLog(g, 'Ничья. Деньги остаются в карманах.');
    state.msgs.push(msg('Шашки: ничья, ставка не переходит.', state.time, '#8cf'));
    return;
  }
  const amount = transferCheckersStake(state, player, npc, g.winner, g.stakeRubles);
  const line = g.winner === 'player'
    ? `Шашки: вы выиграли ₽${amount}.`
    : `Шашки: вы проиграли ₽${amount}.`;
  appendLog(g, line);
  state.msgs.push(msg(line, state.time, g.winner === 'player' ? '#8f8' : '#f84'));
}

export function startCheckersGame(
  ctx: { state: GameState; player: Entity; npc: Entity },
): boolean {
  const stake = checkersStakeFromNpc(ctx.npc);
  if (stake <= 0 || cleanMoney(ctx.player) < stake) return false;
  game = {
    open: true,
    npcId: ctx.npc.id,
    npcName: ctx.npc.name ?? 'NPC',
    stakeRubles: stake,
    pieces: initPieces(),
    phase: 'player_turn',
    winner: '',
    settled: false,
    message: '',
    log: [],
    cursorX: 3,
    cursorY: 5,
  };
  appendLog(game, 'Доска расставлена. Ваш ход первый.');
  publishEvent(ctx.state, {
    type: 'gambling_bet',
    x: ctx.player.x,
    y: ctx.player.y,
    actorId: ctx.player.id,
    actorName: ctx.player.name,
    actorFaction: ctx.player.faction,
    targetId: ctx.npc.id,
    targetName: ctx.npc.name,
    targetFaction: ctx.npc.faction,
    itemValue: stake,
    severity: 1,
    privacy: 'local',
    tags: ['gambling', 'checkers', 'bet'],
    data: { stake, npcMoneyAtStart: cleanMoney(ctx.npc) },
  });
  return true;
}

export function closeCheckersGame(): void {
  game = null;
}

export function isCheckersGameOpen(): boolean {
  return !!game?.open;
}

export function getCheckersSnapshot(): CheckersSnapshot {
  const g = game;
  if (!g) {
    return {
      open: false,
      npcId: -1,
      npcName: '',
      stakeRubles: 0,
      pieces: [],
      phase: 'finished',
      winner: '',
      message: '',
      log: [],
      cursorX: 0,
      cursorY: 0,
    };
  }
  return {
    open: g.open,
    npcId: g.npcId,
    npcName: g.npcName,
    stakeRubles: g.stakeRubles,
    pieces: [...g.pieces],
    phase: g.phase,
    winner: g.winner,
    message: g.message,
    log: [...g.log],
    selectedPieceId: g.selectedPieceId,
    cursorX: g.cursorX,
    cursorY: g.cursorY,
  };
}

export function handleCheckersInput(ctx: { state: GameState; player: Entity; npc: Entity; input: CheckersInput }): CheckersInputResult {
  const g = game;
  if (!g?.open || g.npcId !== ctx.npc.id) return { handled: false };
  if (g.phase === 'finished') {
    if (ctx.input.interactEdge || ctx.input.dropEdge || ctx.input.escEdge) return { handled: true, closeInterface: true };
    return { handled: true };
  }
  if (ctx.input.escEdge) {
    g.winner = 'npc';
    settleCheckersGame(g, ctx.state, ctx.player, ctx.npc);
    return { handled: true, closeInterface: true };
  }

  if (g.phase === 'npc_turn') {
    const move = chooseNpcMove(g.pieces, g.mustCaptureWithPieceId);
    if (move) {
      g.pieces = applyMove(g.pieces, move);
      
      if (move.isCapture) {
        const nextMoves = generateMovesForPiece(g.pieces, g.pieces.find(p => p.id === move.pieceId)!).filter(m => m.isCapture);
        if (nextMoves.length > 0) {
          g.mustCaptureWithPieceId = move.pieceId;
          appendLog(g, `${g.npcName} бьет дальше.`);
          return { handled: true };
        }
      }
      
      appendLog(g, `${g.npcName} сделал ход.`);
    } else {
      appendLog(g, `${g.npcName} не может ходить. Вы выиграли.`);
      g.winner = 'player';
    }
    g.phase = 'player_turn';
    g.mustCaptureWithPieceId = undefined;
    checkWinCondition(g);
    if (g.winner) settleCheckersGame(g, ctx.state, ctx.player, ctx.npc);
    return { handled: true };
  }

  // Player turn navigation
  if (ctx.input.leftNav) g.cursorX = Math.max(0, g.cursorX - 1);
  if (ctx.input.rightNav) g.cursorX = Math.min(7, g.cursorX + 1);
  if (ctx.input.upNav) g.cursorY = Math.max(0, g.cursorY - 1);
  if (ctx.input.downNav) g.cursorY = Math.min(7, g.cursorY + 1);

  if (ctx.input.dropEdge) {
    if (g.selectedPieceId && !g.mustCaptureWithPieceId) {
      g.selectedPieceId = undefined;
    }
    return { handled: true };
  }

  if (ctx.input.interactEdge) {
    if (g.selectedPieceId) {
      const piece = g.pieces.find(p => p.id === g.selectedPieceId);
      if (piece) {
        const moves = generateMovesForPiece(g.pieces, piece);
        
        let allPlayerMoves = getAllMovesForSide(g.pieces, 'player');
        if (g.mustCaptureWithPieceId) {
            allPlayerMoves = moves.filter(m => m.isCapture);
        }

        const hasAnyCaptures = allPlayerMoves.some(m => m.isCapture);
        
        const move = moves.find(m => m.endX === g.cursorX && m.endY === g.cursorY);
        
        if (move) {
          if (hasAnyCaptures && !move.isCapture) {
             appendLog(g, 'Бить обязательно!');
          } else {
            g.pieces = applyMove(g.pieces, move);
            
            if (move.isCapture) {
              const pieceAfter = g.pieces.find(p => p.id === move.pieceId);
              if (pieceAfter) {
                const nextCaptures = generateMovesForPiece(g.pieces, pieceAfter).filter(m => m.isCapture);
                if (nextCaptures.length > 0) {
                  g.mustCaptureWithPieceId = move.pieceId;
                  appendLog(g, 'Продолжайте бить!');
                  return { handled: true };
                }
              }
            }
            
            g.selectedPieceId = undefined;
            g.mustCaptureWithPieceId = undefined;
            g.phase = 'npc_turn';
            checkWinCondition(g);
            if (g.winner) settleCheckersGame(g, ctx.state, ctx.player, ctx.npc);
          }
        } else {
          if (!g.mustCaptureWithPieceId) g.selectedPieceId = undefined; // deselect if invalid move
        }
      }
    } else {
      const piece = getPieceAt(g.pieces, g.cursorX, g.cursorY);
      if (piece && piece.side === 'player') {
        const allPlayerMoves = getAllMovesForSide(g.pieces, 'player');
        const hasCaptures = allPlayerMoves.some(m => m.isCapture);
        const pieceMoves = generateMovesForPiece(g.pieces, piece);
        
        if (hasCaptures && !pieceMoves.some(m => m.isCapture)) {
           appendLog(g, 'Вы должны выбрать шашку, которая может бить!');
        } else if (pieceMoves.length > 0) {
           g.selectedPieceId = piece.id;
        }
      }
    }
  }

  return { handled: true };
}
