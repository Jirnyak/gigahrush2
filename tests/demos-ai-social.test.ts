import test from 'node:test';
import assert from 'node:assert/strict';

import { Faction, FloorLevel, Occupation } from '../src/core/types';
import { setAlifeState } from '../src/systems/alife';
import { buildDemosAiSocialContext } from '../src/systems/demos_ai_social';
import {
  clearDemosNpcSocialEdges,
  setDemosSocialEdge,
} from '../src/systems/demos_social';
import {
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
} from '../src/data/demos_social';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { makeGameState, makeTestNpc } from './helpers';

function makeSocialState() {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorRunState(state, { runSeed: 123, currentZ: 0 }, FloorLevel.LIVING);
  setAlifeState(state, { seed: 12345, total: 32 });
  return state;
}

test('Demos AI social helper reads outgoing friend and enemy slots from supplied live map', () => {
  const state = makeSocialState();
  clearDemosNpcSocialEdges(state, 1);
  setDemosSocialEdge(state, 1, 2, 92, DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND);
  setDemosSocialEdge(state, 1, 3, -94, DEMOS_EDGE_ENEMY);

  const actor = makeTestNpc({ id: 10, alifeId: 1, x: 10, y: 10, occupation: Occupation.TRAVELER, faction: Faction.CITIZEN });
  const friend = makeTestNpc({ id: 20, alifeId: 2, x: 13, y: 10 });
  const enemy = makeTestNpc({ id: 30, alifeId: 3, x: 16, y: 10 });
  const liveByAlifeId = new Map([
    [2, friend],
    [3, enemy],
  ]);

  const ctx = buildDemosAiSocialContext(state, actor, liveByAlifeId);

  assert.equal(ctx?.actorAlifeId, 1);
  assert.equal(ctx?.friendNearby, true);
  assert.equal(ctx?.familyNearby, true);
  assert.equal(ctx?.enemyNearby, true);
  assert.equal(ctx?.strongestFriendEntityId, 20);
  assert.equal(ctx?.strongestEnemyEntityId, 30);
  assert.ok((ctx?.escortBias ?? 0) > 0);
  assert.ok((ctx?.talkBias ?? 0) > 0);
  assert.ok((ctx?.fleeBias ?? 0) > 0);
  assert.ok((ctx?.targetHostilityBias ?? 0) > 0);
});

test('Demos AI social helper does not search incoming edges', () => {
  const state = makeSocialState();
  clearDemosNpcSocialEdges(state, 1);
  clearDemosNpcSocialEdges(state, 4);
  setDemosSocialEdge(state, 4, 1, 110, DEMOS_EDGE_FRIEND);

  const actor = makeTestNpc({ id: 10, alifeId: 1, x: 10, y: 10 });
  const incomingOnly = makeTestNpc({ id: 40, alifeId: 4, x: 11, y: 10 });
  const ctx = buildDemosAiSocialContext(state, actor, new Map([[4, incomingOnly]]));

  assert.equal(ctx?.friendNearby, false);
  assert.equal(ctx?.strongestFriendEntityId, undefined);
  assert.equal(ctx?.talkBias, 0);
});

test('Demos AI social helper uses caller supplied live map and ignores off-map relations', () => {
  const state = makeSocialState();
  clearDemosNpcSocialEdges(state, 1);
  setDemosSocialEdge(state, 1, 2, 95, DEMOS_EDGE_FRIEND);

  const actor = makeTestNpc({ id: 10, alifeId: 1, x: 10, y: 10 });
  const ctx = buildDemosAiSocialContext(state, actor, new Map());

  assert.equal(ctx?.friendNearby, false);
  assert.equal(ctx?.strongestFriendEntityId, undefined);
  assert.equal(ctx?.escortBias, 0);
});
