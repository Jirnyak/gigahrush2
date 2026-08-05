import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  canDurakCover,
  chooseDurakFirstAttacker,
  chooseNpcDefenseCard,
  createDurakDeck,
  durakStakeFromNpc,
  getDurakSnapshot,
  handleDurakInput,
  isDurakAttackLegal,
  makeDurakCard,
  startDurakGame,
  transferDurakStake,
  closeDurakGame,
  type DurakCard,
  type DurakRank,
  type DurakSuit,
} from '../src/systems/durak';
import { getRecentEvents } from '../src/systems/events';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function c(suit: DurakSuit, rank: DurakRank): DurakCard {
  return makeDurakCard(suit, rank);
}

function deckWith(front: readonly DurakCard[]): DurakCard[] {
  const used = new Set(front.map(card => card.id));
  return [...front, ...createDurakDeck().filter(card => !used.has(card.id))];
}

test('durak cover rules follow suit and trump hierarchy', () => {
  assert.equal(canDurakCover(c('spades', 7), c('spades', 8), 'hearts'), true);
  assert.equal(canDurakCover(c('spades', 8), c('spades', 7), 'hearts'), false);
  assert.equal(canDurakCover(c('spades', 8), c('diamonds', 14), 'hearts'), false);
  assert.equal(canDurakCover(c('spades', 14), c('hearts', 6), 'hearts'), true);
  assert.equal(canDurakCover(c('hearts', 8), c('hearts', 9), 'hearts'), true);
  assert.equal(canDurakCover(c('hearts', 9), c('hearts', 8), 'hearts'), false);
});

test('lowest trump holder becomes first attacker with deterministic no-trump fallback', () => {
  assert.equal(chooseDurakFirstAttacker(
    [c('hearts', 9), c('clubs', 6)],
    [c('hearts', 7), c('spades', 6)],
    'hearts',
    () => 0.9,
  ), 'npc');
  assert.equal(chooseDurakFirstAttacker(
    [c('clubs', 9), c('diamonds', 8)],
    [c('clubs', 7), c('diamonds', 14)],
    'hearts',
    () => 0.9,
  ), 'npc');
  assert.equal(chooseDurakFirstAttacker(
    [c('clubs', 7)],
    [c('diamonds', 7)],
    'hearts',
    () => 0.1,
  ), 'player');
});

test('npc defense chooses the cheapest same-suit cover before spending trump', () => {
  const hand = [c('hearts', 6), c('spades', 10), c('spades', 8), c('hearts', 14)];
  assert.deepEqual(chooseNpcDefenseCard(hand, c('spades', 7), 'hearts'), c('spades', 8));
  assert.deepEqual(chooseNpcDefenseCard(hand, c('diamonds', 14), 'hearts'), c('hearts', 6));
  assert.equal(chooseNpcDefenseCard([c('clubs', 6)], c('diamonds', 14), 'hearts'), null);
});

test('attacks can only add table ranks and respect defender starting hand cap', () => {
  const base = {
    attacker: 'player' as const,
    defenderStartCards: 6,
    table: [{ attack: c('clubs', 8), defense: c('clubs', 9) }],
    trumpSuit: 'hearts' as const,
  };
  assert.equal(isDurakAttackLegal(base, 'player', c('diamonds', 8)), true);
  assert.equal(isDurakAttackLegal(base, 'player', c('diamonds', 9)), true);
  assert.equal(isDurakAttackLegal(base, 'player', c('diamonds', 10)), false);
  assert.equal(isDurakAttackLegal({ ...base, defenderStartCards: 1 }, 'player', c('diamonds', 8)), false);
});

test('durak starts with six-card hands, fixed trump and an NPC menu session', () => {
  closeDurakGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 5, name: 'Игрок у кухни', money: 100 });
  const deck = deckWith([
    c('clubs', 6), c('clubs', 7),
    c('diamonds', 9), c('diamonds', 10),
    c('spades', 9), c('spades', 10),
    c('hearts', 9), c('hearts', 10),
    c('clubs', 8), c('clubs', 9),
    c('diamonds', 8), c('diamonds', 7),
    c('clubs', 14),
  ]);

  assert.equal(startDurakGame({ state, player, npc }, { deck, rng: () => 0.8 }), true);
  const snapshot = getDurakSnapshot();
  assert.equal(snapshot.open, true);
  assert.equal(snapshot.stakeRubles, 10);
  assert.equal(snapshot.trumpSuit, 'clubs');
  assert.equal(snapshot.playerHand.length, 6);
  assert.equal(snapshot.npcHandCount, 6);
  assert.equal(snapshot.talonCount, 24);
  assert.equal(snapshot.attacker, 'player');
  assert.equal(getRecentEvents(state, { type: 'gambling_bet', tags: ['durak'], limit: 1 }).length, 1);
  closeDurakGame();
});

test('forfeiting durak transfers the fixed stake to NPC and publishes gambling loss', () => {
  closeDurakGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 6, name: 'Сосед с картами', money: 100 });

  assert.equal(startDurakGame({ state, player, npc }, { rng: () => 0.2 }), true);
  const result = handleDurakInput({ state, player, npc, input: { escEdge: true } });
  assert.equal(result.closeInterface, true);
  assert.equal(player.money, 40);
  assert.equal(npc.money, 110);
  assert.equal(getRecentEvents(state, { type: 'gambling_loss', tags: ['durak'], limit: 1 })[0]?.itemValue, 10);
  closeDurakGame();
});

test('durak stake is fixed from NPC money and settlement never makes payer negative', () => {
  const state = makeGameState();
  const player = makeTestPlayer({ money: 3 });
  const npc = makeTestNpc({ money: 107 });

  assert.equal(durakStakeFromNpc(npc), 10);
  assert.equal(transferDurakStake(state, player, npc, 'npc', 10), 3);
  assert.equal(player.money, 0);
  assert.equal(npc.money, 110);
  assert.equal(transferDurakStake(state, player, npc, 'player', 10), 10);
  assert.equal(player.money, 10);
  assert.equal(npc.money, 100);
});
