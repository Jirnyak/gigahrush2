import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  closeDiceGame,
  diceStakeFromNpc,
  diceWinnerFor,
  getDiceSnapshot,
  handleDiceInput,
  rollDicePair,
  startDiceGame,
  transferDiceStake,
} from '../src/systems/dice';
import { getRecentEvents } from '../src/systems/events';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function rngSeq(values: readonly number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, Math.max(0, values.length - 1))] ?? 0;
}

test('dice stake is ten percent of NPC money with positive minimum', () => {
  assert.equal(diceStakeFromNpc(makeTestNpc({ money: 107 })), 10);
  assert.equal(diceStakeFromNpc(makeTestNpc({ money: 9 })), 1);
  assert.equal(diceStakeFromNpc(makeTestNpc({ money: 0 })), 0);
});

test('dice rolls stay in two six-sided bone dice bounds', () => {
  assert.deepEqual(rollDicePair(rngSeq([0, 0])), { dieA: 1, dieB: 1, total: 2 });
  assert.deepEqual(rollDicePair(rngSeq([0.999, 0.999])), { dieA: 6, dieB: 6, total: 12 });
});

test('dice winner is the highest score at or below twenty one', () => {
  assert.equal(diceWinnerFor(20, 19), 'player');
  assert.equal(diceWinnerFor(20, 21), 'npc');
  assert.equal(diceWinnerFor(22, 19), 'npc');
  assert.equal(diceWinnerFor(18, 22), 'player');
  assert.equal(diceWinnerFor(24, 23), 'draw');
  assert.equal(diceWinnerFor(21, 21), 'draw');
});

test('dice starts as transient NPC game and publishes a bet event', () => {
  closeDiceGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 5, name: 'Сосед с костями', money: 100 });

  assert.equal(startDiceGame({ state, player, npc }), true);
  const snapshot = getDiceSnapshot();
  assert.equal(snapshot.open, true);
  assert.equal(snapshot.npcId, 5);
  assert.equal(snapshot.stakeRubles, 10);
  assert.equal(snapshot.playerScore, 0);
  assert.equal(snapshot.npcScore, 0);
  assert.equal(getRecentEvents(state, { type: 'gambling_bet', tags: ['dice'], limit: 1 }).length, 1);
  assert.equal(player.money, 50);
  assert.equal(npc.money, 100);
  closeDiceGame();
});

test('standing in dice lets NPC roll and pays the player when NPC busts', () => {
  closeDiceGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 6, name: 'Кухонный костист', money: 100 });

  assert.equal(startDiceGame({ state, player, npc }), true);
  handleDiceInput({ state, player, npc, input: { interactEdge: true }, rng: rngSeq([0.999, 0.999]) });
  const result = handleDiceInput({
    state,
    player,
    npc,
    input: { dropEdge: true },
    rng: rngSeq([0.49, 0.49, 0.66, 0.66, 0.66, 0.66]),
  });

  assert.equal(result.handled, true);
  const snapshot = getDiceSnapshot();
  assert.equal(snapshot.finished, true);
  assert.equal(snapshot.winner, 'player');
  assert.equal(snapshot.playerScore, 12);
  assert.equal(snapshot.npcScore, 22);
  assert.equal(player.money, 60);
  assert.equal(npc.money, 90);
  assert.equal(getRecentEvents(state, { type: 'gambling_win', tags: ['dice'], limit: 1 })[0]?.itemValue, 10);
  closeDiceGame();
});

test('dice player bust transfers the stake to NPC', () => {
  closeDiceGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 7, name: 'Сосед у стола', money: 100 });

  assert.equal(startDiceGame({ state, player, npc }), true);
  handleDiceInput({ state, player, npc, input: { interactEdge: true }, rng: rngSeq([0.999, 0.999]) });
  handleDiceInput({ state, player, npc, input: { interactEdge: true }, rng: rngSeq([0.999, 0.999]) });

  const snapshot = getDiceSnapshot();
  assert.equal(snapshot.finished, true);
  assert.equal(snapshot.winner, 'npc');
  assert.equal(snapshot.playerScore, 24);
  assert.equal(player.money, 40);
  assert.equal(npc.money, 110);
  assert.equal(getRecentEvents(state, { type: 'gambling_loss', tags: ['dice'], limit: 1 })[0]?.itemValue, 10);
  closeDiceGame();
});

test('dice draw leaves money in place and publishes no settlement event', () => {
  closeDiceGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 8, name: 'Ровный сосед', money: 100 });

  assert.equal(startDiceGame({ state, player, npc }), true);
  handleDiceInput({ state, player, npc, input: { interactEdge: true }, rng: rngSeq([0.999, 0.999]) });
  handleDiceInput({ state, player, npc, input: { interactEdge: true }, rng: rngSeq([0.66, 0.66]) });
  handleDiceInput({
    state,
    player,
    npc,
    input: { dropEdge: true },
    rng: rngSeq([0.999, 0.999, 0.66, 0.66]),
  });

  const snapshot = getDiceSnapshot();
  assert.equal(snapshot.finished, true);
  assert.equal(snapshot.winner, 'draw');
  assert.equal(snapshot.playerScore, 20);
  assert.equal(snapshot.npcScore, 20);
  assert.equal(player.money, 50);
  assert.equal(npc.money, 100);
  assert.equal(getRecentEvents(state, { type: 'gambling_win', tags: ['dice'], limit: 1 }).length, 0);
  assert.equal(getRecentEvents(state, { type: 'gambling_loss', tags: ['dice'], limit: 1 }).length, 0);
  closeDiceGame();
});

test('dice settlement never makes payer money negative', () => {
  const state = makeGameState();
  const player = makeTestPlayer({ money: 3 });
  const npc = makeTestNpc({ money: 107 });

  assert.equal(transferDiceStake(state, player, npc, 'npc', 10), 3);
  assert.equal(player.money, 0);
  assert.equal(npc.money, 110);
  assert.equal(transferDiceStake(state, player, npc, 'player', 10), 10);
  assert.equal(player.money, 10);
  assert.equal(npc.money, 100);
});
