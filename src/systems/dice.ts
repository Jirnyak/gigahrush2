import { msg, type Entity, type GameState } from '../core/types';
import { publishEvent } from './events';

export type DiceWinner = 'player' | 'npc' | 'draw' | '';
export type DicePhase = 'player_turn' | 'npc_turn' | 'finished';

export interface DiceRoll {
  dieA: number;
  dieB: number;
  total: number;
}

export interface DiceSnapshot {
  open: boolean;
  npcId: number;
  npcName: string;
  stakeRubles: number;
  playerScore: number;
  npcScore: number;
  playerRolls: readonly DiceRoll[];
  npcRolls: readonly DiceRoll[];
  phase: DicePhase;
  finished: boolean;
  winner: DiceWinner;
  canRoll: boolean;
  canStop: boolean;
  message: string;
  log: readonly string[];
}

export interface DiceInput {
  leftNav?: boolean;
  rightNav?: boolean;
  interactEdge?: boolean;
  dropEdge?: boolean;
  escEdge?: boolean;
}

export interface DiceInputResult {
  handled: boolean;
  closeInterface?: boolean;
}

interface DiceGame {
  open: boolean;
  npcId: number;
  npcName: string;
  stakeRubles: number;
  playerScore: number;
  npcScore: number;
  playerRolls: DiceRoll[];
  npcRolls: DiceRoll[];
  phase: DicePhase;
  winner: DiceWinner;
  settled: boolean;
  message: string;
  log: string[];
}

const MAX_SCORE = 21;
const NPC_HOLD_FLOOR = 16;
const NPC_ROLL_GUARD = 8;
let game: DiceGame | null = null;

function cleanMoney(actor: Entity): number {
  const money = actor.money ?? 0;
  return Number.isFinite(money) ? Math.max(0, Math.floor(money)) : 0;
}

function appendLog(g: DiceGame, line: string): void {
  g.log.push(line);
  if (g.log.length > 6) g.log.splice(0, g.log.length - 6);
  g.message = line;
}

function rollDie(rng: () => number): number {
  return Math.max(1, Math.min(6, Math.floor(rng() * 6) + 1));
}

function addRoll(g: DiceGame, side: 'player' | 'npc', roll: DiceRoll): void {
  if (side === 'player') {
    g.playerRolls.push(roll);
    g.playerScore += roll.total;
    appendLog(g, `Вы бросили ${roll.dieA}+${roll.dieB}. Сумма ${g.playerScore}.`);
    return;
  }
  g.npcRolls.push(roll);
  g.npcScore += roll.total;
  appendLog(g, `${g.npcName} бросает ${roll.dieA}+${roll.dieB}. Сумма ${g.npcScore}.`);
}

function publishDiceSettlementEvent(state: GameState, player: Entity, npc: Entity, winner: DiceWinner, amount: number, stake: number): void {
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
    tags: ['gambling', 'dice', playerWin ? 'win' : 'loss'],
    data: { stake, transfer: amount, winner },
  });
}

export function diceStakeFromNpc(npc: Entity): number {
  const money = cleanMoney(npc);
  return money > 0 ? Math.max(1, Math.floor(money * 0.1)) : 0;
}

export function rollDicePair(rng = Math.random): DiceRoll {
  const dieA = rollDie(rng);
  const dieB = rollDie(rng);
  return { dieA, dieB, total: dieA + dieB };
}

export function diceWinnerFor(playerScore: number, npcScore: number): DiceWinner {
  const playerOk = playerScore <= MAX_SCORE;
  const npcOk = npcScore <= MAX_SCORE;
  if (playerOk && !npcOk) return 'player';
  if (!playerOk && npcOk) return 'npc';
  if (!playerOk && !npcOk) return 'draw';
  if (playerScore > npcScore) return 'player';
  if (npcScore > playerScore) return 'npc';
  return 'draw';
}

export function transferDiceStake(state: GameState, player: Entity, npc: Entity, winner: DiceWinner, stake: number): number {
  if (winner !== 'player' && winner !== 'npc') return 0;
  const payer = winner === 'player' ? npc : player;
  const receiver = winner === 'player' ? player : npc;
  const amount = Math.min(Math.max(0, Math.floor(stake)), cleanMoney(payer));
  payer.money = cleanMoney(payer) - amount;
  receiver.money = cleanMoney(receiver) + amount;
  publishDiceSettlementEvent(state, player, npc, winner, amount, Math.max(0, Math.floor(stake)));
  return amount;
}

function settleDiceGame(g: DiceGame, state: GameState, player: Entity, npc: Entity): void {
  if (g.settled || (g.winner !== 'player' && g.winner !== 'npc' && g.winner !== 'draw')) return;
  g.settled = true;
  g.phase = 'finished';
  if (g.winner === 'draw') {
    appendLog(g, 'Ничья. Деньги остаются в карманах.');
    state.msgs.push(msg('Кости: ничья, ставка не переходит.', state.time, '#8cf'));
    return;
  }
  const amount = transferDiceStake(state, player, npc, g.winner, g.stakeRubles);
  const line = g.winner === 'player'
    ? `Кости: вы выиграли ₽${amount}.`
    : `Кости: вы проиграли ₽${amount}.`;
  appendLog(g, line);
  state.msgs.push(msg(line, state.time, g.winner === 'player' ? '#8f8' : '#f84'));
}

function finishByScore(g: DiceGame, state: GameState, player: Entity, npc: Entity): void {
  g.winner = diceWinnerFor(g.playerScore, g.npcScore);
  settleDiceGame(g, state, player, npc);
}

function playNpcTurn(g: DiceGame, state: GameState, player: Entity, npc: Entity, rng: () => number): void {
  g.phase = 'npc_turn';
  appendLog(g, `${g.npcName} берет кости.`);
  for (let guard = 0; guard < NPC_ROLL_GUARD; guard++) {
    if (g.npcScore > MAX_SCORE) break;
    const needsRoll = g.npcScore <= 0 || g.npcScore < NPC_HOLD_FLOOR || g.npcScore < g.playerScore;
    if (!needsRoll) break;
    addRoll(g, 'npc', rollDicePair(rng));
  }
  finishByScore(g, state, player, npc);
}

export function startDiceGame(
  ctx: { state: GameState; player: Entity; npc: Entity },
): boolean {
  const stake = diceStakeFromNpc(ctx.npc);
  if (stake <= 0 || cleanMoney(ctx.player) < stake) return false;
  game = {
    open: true,
    npcId: ctx.npc.id,
    npcName: ctx.npc.name ?? 'NPC',
    stakeRubles: stake,
    playerScore: 0,
    npcScore: 0,
    playerRolls: [],
    npcRolls: [],
    phase: 'player_turn',
    winner: '',
    settled: false,
    message: '',
    log: [],
  };
  appendLog(game, 'Кости на столе. Бросайте до 21 или остановитесь раньше.');
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
    tags: ['gambling', 'dice', 'bet'],
    data: { stake, npcMoneyAtStart: cleanMoney(ctx.npc) },
  });
  return true;
}

export function closeDiceGame(): void {
  game = null;
}

export function isDiceGameOpen(): boolean {
  return !!game?.open;
}

export function getDiceSnapshot(): DiceSnapshot {
  const g = game;
  if (!g) {
    return {
      open: false,
      npcId: -1,
      npcName: '',
      stakeRubles: 0,
      playerScore: 0,
      npcScore: 0,
      playerRolls: [],
      npcRolls: [],
      phase: 'finished',
      finished: false,
      winner: '',
      canRoll: false,
      canStop: false,
      message: '',
      log: [],
    };
  }
  return {
    open: g.open,
    npcId: g.npcId,
    npcName: g.npcName,
    stakeRubles: g.stakeRubles,
    playerScore: g.playerScore,
    npcScore: g.npcScore,
    playerRolls: [...g.playerRolls],
    npcRolls: [...g.npcRolls],
    phase: g.phase,
    finished: g.phase === 'finished',
    winner: g.winner,
    canRoll: g.phase === 'player_turn' && g.playerScore <= MAX_SCORE,
    canStop: g.phase === 'player_turn' && g.playerScore > 0 && g.playerScore <= MAX_SCORE,
    message: g.message,
    log: [...g.log],
  };
}

export function handleDiceInput(ctx: { state: GameState; player: Entity; npc: Entity; input: DiceInput; rng?: () => number }): DiceInputResult {
  const g = game;
  if (!g?.open || g.npcId !== ctx.npc.id) return { handled: false };
  if (ctx.input.leftNav || ctx.input.rightNav) return { handled: true };
  if (g.phase === 'finished') {
    if (ctx.input.interactEdge || ctx.input.dropEdge || ctx.input.escEdge) return { handled: true, closeInterface: true };
    return { handled: true };
  }
  if (ctx.input.escEdge) {
    g.winner = 'npc';
    settleDiceGame(g, ctx.state, ctx.player, ctx.npc);
    return { handled: true, closeInterface: true };
  }
  if (g.phase !== 'player_turn') return { handled: true };
  const rng = ctx.rng ?? Math.random;
  if (ctx.input.interactEdge) {
    addRoll(g, 'player', rollDicePair(rng));
    if (g.playerScore > MAX_SCORE) {
      appendLog(g, 'Перебор. Бетон забирает лишний счет.');
      g.winner = 'npc';
      settleDiceGame(g, ctx.state, ctx.player, ctx.npc);
    }
    return { handled: true };
  }
  if (ctx.input.dropEdge) {
    if (g.playerScore <= 0) {
      appendLog(g, 'Сначала бросьте хотя бы раз.');
      return { handled: true };
    }
    playNpcTurn(g, ctx.state, ctx.player, ctx.npc, rng);
    return { handled: true };
  }
  return { handled: true };
}
