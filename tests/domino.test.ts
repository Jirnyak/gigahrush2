import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  chooseDominoOpening,
  closeDominoGame,
  createDominoSet,
  dominoStakeFromNpc,
  dominoTileFits,
  dominoWinnerForBlocked,
  getDominoSnapshot,
  handleDominoInput,
  makeDominoTile,
  startDominoGame,
  transferDominoStake,
} from '../src/systems/domino';
import { getRecentEvents } from '../src/systems/events';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function deckWith(front: readonly ReturnType<typeof makeDominoTile>[]): ReturnType<typeof makeDominoTile>[] {
  const used = new Set(front.map(tile => tile.id));
  return [...front, ...createDominoSet().filter(tile => !used.has(tile.id))];
}

test('domino set uses the classic double-six 28 tile box', () => {
  const set = createDominoSet();
  assert.equal(set.length, 28);
  assert.equal(new Set(set.map(tile => tile.id)).size, 28);
  assert.ok(set.some(tile => tile.a === 0 && tile.b === 0));
  assert.ok(set.some(tile => tile.a === 6 && tile.b === 6));
});

test('domino opening prefers the highest double, then highest pip sum', () => {
  assert.deepEqual(
    chooseDominoOpening([makeDominoTile(5, 5)], [makeDominoTile(6, 6)])?.side,
    'npc',
  );
  assert.deepEqual(
    chooseDominoOpening([makeDominoTile(6, 4)], [makeDominoTile(5, 4)])?.side,
    'player',
  );
});

test('domino tile fit checks both exposed board ends', () => {
  const tile = makeDominoTile(2, 5);
  assert.equal(dominoTileFits(tile, 2, 6, 'left'), true);
  assert.equal(dominoTileFits(tile, 1, 5, 'right'), true);
  assert.equal(dominoTileFits(tile, 1, 6, 'left'), false);
});

test('domino starts with seven tiles each and publishes an NPC bet event', () => {
  closeDominoGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 5, name: 'Сосед с домино', money: 100 });
  const deck = deckWith([
    makeDominoTile(6, 6), makeDominoTile(5, 5),
    makeDominoTile(0, 1), makeDominoTile(1, 2),
    makeDominoTile(0, 2), makeDominoTile(1, 3),
    makeDominoTile(0, 3), makeDominoTile(1, 4),
    makeDominoTile(0, 4), makeDominoTile(2, 2),
    makeDominoTile(0, 5), makeDominoTile(2, 3),
    makeDominoTile(1, 1), makeDominoTile(2, 4),
  ]);

  assert.equal(startDominoGame({ state, player, npc }, { deck }), true);
  const snapshot = getDominoSnapshot();
  assert.equal(snapshot.open, true);
  assert.equal(snapshot.npcId, 5);
  assert.equal(snapshot.stakeRubles, 10);
  assert.equal(snapshot.playerHand.length, 7);
  assert.equal(snapshot.npcHandCount, 7);
  assert.equal(snapshot.boneyardCount, 14);
  assert.equal(snapshot.phase, 'player_turn');
  assert.equal(snapshot.selectedTile?.id, makeDominoTile(6, 6).id);
  assert.equal(getRecentEvents(state, { type: 'gambling_bet', tags: ['domino'], limit: 1 }).length, 1);
  assert.equal(player.money, 50);
  assert.equal(npc.money, 100);
  closeDominoGame();
});

test('NPC opens domino automatically when it owns the highest double', () => {
  closeDominoGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 6, name: 'Доминошник', money: 100 });
  const deck = deckWith([
    makeDominoTile(5, 5), makeDominoTile(6, 6),
    makeDominoTile(0, 1), makeDominoTile(1, 6),
    makeDominoTile(0, 2), makeDominoTile(1, 3),
    makeDominoTile(0, 3), makeDominoTile(1, 4),
    makeDominoTile(0, 4), makeDominoTile(2, 2),
    makeDominoTile(0, 5), makeDominoTile(2, 3),
    makeDominoTile(1, 1), makeDominoTile(2, 4),
  ]);

  assert.equal(startDominoGame({ state, player, npc }, { deck }), true);
  const snapshot = getDominoSnapshot();
  assert.equal(snapshot.board.length, 1);
  assert.equal(snapshot.leftPip, 6);
  assert.equal(snapshot.rightPip, 6);
  assert.equal(snapshot.npcHandCount, 6);
  assert.equal(snapshot.phase, 'player_turn');
  closeDominoGame();
});

test('domino blocked round pays the lower pip sum winner', () => {
  closeDominoGame();
  const state = makeGameState();
  const player = makeTestPlayer({ money: 50 });
  const npc = makeTestNpc({ id: 7, name: 'Сухой сосед', money: 100 });
  const deck = [
    makeDominoTile(6, 6), makeDominoTile(1, 1),
    makeDominoTile(0, 0), makeDominoTile(1, 2),
    makeDominoTile(0, 1), makeDominoTile(1, 3),
    makeDominoTile(0, 2), makeDominoTile(1, 4),
    makeDominoTile(0, 3), makeDominoTile(2, 2),
    makeDominoTile(0, 4), makeDominoTile(2, 3),
    makeDominoTile(0, 5), makeDominoTile(2, 4),
  ];

  assert.equal(startDominoGame({ state, player, npc }, { deck }), true);
  handleDominoInput({ state, player, npc, input: { interactEdge: true } });
  const result = handleDominoInput({ state, player, npc, input: { interactEdge: true } });

  assert.equal(result.handled, true);
  const snapshot = getDominoSnapshot();
  assert.equal(snapshot.finished, true);
  assert.equal(snapshot.winner, 'player');
  assert.equal(player.money, 60);
  assert.equal(npc.money, 90);
  assert.equal(getRecentEvents(state, { type: 'gambling_win', tags: ['domino'], limit: 1 })[0]?.itemValue, 10);
  closeDominoGame();
});

test('domino stake is ten percent of NPC money and settlement caps by payer cash', () => {
  const state = makeGameState();
  const player = makeTestPlayer({ money: 3 });
  const npc = makeTestNpc({ money: 107 });

  assert.equal(dominoStakeFromNpc(npc), 10);
  assert.equal(dominoStakeFromNpc(makeTestNpc({ money: 9 })), 1);
  assert.equal(dominoStakeFromNpc(makeTestNpc({ money: 0 })), 0);
  assert.equal(dominoWinnerForBlocked([makeDominoTile(0, 1)], [makeDominoTile(6, 6)]), 'player');
  assert.equal(transferDominoStake(state, player, npc, 'npc', 10), 3);
  assert.equal(player.money, 0);
  assert.equal(npc.money, 110);
  assert.equal(transferDominoStake(state, player, npc, 'player', 10), 10);
  assert.equal(player.money, 10);
  assert.equal(npc.money, 100);
});
