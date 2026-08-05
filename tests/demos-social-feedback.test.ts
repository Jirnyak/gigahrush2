import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AIGoal,
  Cell,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  Occupation,
  RoomType,
  type GameState,
  type WorldEvent,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  getAlifeNpcRecordSnapshot,
  moveAlifeNpcRecord,
  setAlifeState,
} from '../src/systems/alife';
import { ensureAlifeMobilityState } from '../src/systems/alife_migration';
import {
  processDemosSocialFeedbackEvents,
  requestDemosSocialJourney,
} from '../src/systems/demos_social_feedback';
import {
  clearDemosNpcSocialEdges,
  getDemosNpcOnlySocialEdges,
  setDemosSocialEdge,
} from '../src/systems/demos_social';
import {
  DEMOS_EDGE_FAMILY,
  DEMOS_EDGE_FRIEND,
} from '../src/data/demos_social';
import { getRecentEvents } from '../src/systems/events';
import { setFloorRunState } from '../src/systems/procedural_floors';
import {
  addTestRoom,
  makeGameState,
  makeTestNpc,
} from './helpers';

function makeDemosSocialState(overrides: Partial<GameState> = {}): GameState {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, ...overrides });
  setFloorRunState(state, { runSeed: 123, currentZ: 0 }, FloorLevel.LIVING);
  setAlifeState(state, { seed: 12345, total: 64, deadIds: overrides.gameOver ? [1] : [] });
  return state;
}

function worldEvent(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: 1,
    type: 'npc_kill_npc',
    time: 10,
    day: 0,
    hour: 8,
    minute: 10,
    floor: FloorLevel.LIVING,
    severity: 3,
    privacy: 'public',
    truth: 'fact',
    tags: [],
    ...overrides,
  };
}

function relationFromTo(state: GameState, fromAlifeId: number, toAlifeId: number): number | undefined {
  return getDemosNpcOnlySocialEdges(state, fromAlifeId)
    .find(edge => edge.targetAlifeId === toAlifeId)
    ?.relation;
}

function makeLiftWorld(): World {
  const world = new World();
  addTestRoom(world, {
    id: 1,
    x: 20,
    y: 20,
    w: 8,
    h: 8,
    type: RoomType.COMMON,
    name: 'Лифтовой тестовый узел',
    zoneId: 0,
  });
  world.zones[0].hasLift = true;
  world.cells[world.idx(23, 22)] = Cell.LIFT;
  world.features[world.idx(24, 23)] = Feature.LIFT_BUTTON;
  return world;
}

test('Demos event feedback caps relation outcomes per tick', () => {
  const state = makeDemosSocialState();
  clearDemosNpcSocialEdges(state, 2);
  for (const id of [3, 4, 5]) {
    clearDemosNpcSocialEdges(state, id);
    setDemosSocialEdge(state, id, 1, 0);
    setDemosSocialEdge(state, 2, id, 90, DEMOS_EDGE_FRIEND);
  }

  const summary = processDemosSocialFeedbackEvents(state, {
    events: [worldEvent({ id: 7, data: { killerAlifeId: 1, victimAlifeId: 2 } })],
    maxOutcomes: 2,
    ignoreCursor: true,
  });

  assert.equal(summary.relationChanges, 2);
  assert.equal(relationFromTo(state, 3, 1), -10);
  assert.equal(relationFromTo(state, 4, 1), -10);
  assert.equal(relationFromTo(state, 5, 1), 0);
});

test('Demos death feedback worsens family relation toward a known killer', () => {
  const state = makeDemosSocialState();
  clearDemosNpcSocialEdges(state, 2);
  clearDemosNpcSocialEdges(state, 3);
  setDemosSocialEdge(state, 2, 3, 104, DEMOS_EDGE_FAMILY | DEMOS_EDGE_FRIEND);
  setDemosSocialEdge(state, 3, 1, 0);

  const summary = processDemosSocialFeedbackEvents(state, {
    events: [worldEvent({ id: 8, data: { killerAlifeId: 1, victimAlifeId: 2 } })],
    ignoreCursor: true,
  });

  assert.equal(summary.relationChanges, 1);
  assert.equal(relationFromTo(state, 3, 1), -16);
  assert.ok(getRecentEvents(state, { tags: ['demos_social'], limit: 1 }).length >= 1);
});

test('Demos help and rescue feedback improves directed relation', () => {
  const state = makeDemosSocialState();
  clearDemosNpcSocialEdges(state, 2);
  setDemosSocialEdge(state, 2, 1, 0);

  processDemosSocialFeedbackEvents(state, {
    events: [worldEvent({
      id: 9,
      type: 'shelter_tally_handled',
      tags: ['help', 'shelter'],
      data: { helperAlifeId: 1, targetAlifeId: 2 },
    })],
    ignoreCursor: true,
  });

  assert.equal(relationFromTo(state, 2, 1), 5);
});

test('Demos social journey rejects dead, NPC-forbidden and player/native actors', () => {
  const deadState = makeDemosSocialState();
  setAlifeState(deadState, { seed: 12345, total: 64, deadIds: [1] });
  assert.equal(requestDemosSocialJourney(deadState, 1, 'story:living', 'social_visit'), false);

  const forbiddenState = makeDemosSocialState();
  assert.equal(requestDemosSocialJourney(forbiddenState, 1, 'story:void', 'social_visit'), false);

  const activeState = makeDemosSocialState();
  const world = makeLiftWorld();
  const playerLike = makeTestNpc({
    id: 10,
    alifeId: 1,
    persistentNpcId: 'player',
    x: 24,
    y: 24,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  });
  assert.equal(requestDemosSocialJourney(activeState, 1, 'design:black_market_88', 'social_visit', {
    world,
    entities: [playerLike],
    activeFloorKey: 'story:living',
  }), false);
});

test('Demos social journey blocks ordinary visits during active samosbor', () => {
  const state = makeDemosSocialState({ samosborActive: true });
  moveAlifeNpcRecord(state, 1, 'story:ministry');

  assert.equal(requestDemosSocialJourney(state, 1, 'story:living', 'social_visit'), false);
  assert.equal(requestDemosSocialJourney(state, 1, 'story:living', 'shelter_rejoin'), true);
});

test('Demos social journey delegates to migration state without direct floor mutation', () => {
  const state = makeDemosSocialState();
  moveAlifeNpcRecord(state, 1, 'story:ministry');

  assert.equal(requestDemosSocialJourney(state, 1, 'story:living', 'family_visit', { travelSeconds: 30 }), true);

  const mobility = ensureAlifeMobilityState(state);
  const journeys = Object.values(mobility.journeys);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].alifeId, 1);
  assert.equal(journeys[0].toFloorKey, 'story:living');
  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.floorKey, 'story:ministry');
});

test('Demos active-floor social journey starts visible departure instead of teleporting', () => {
  const state = makeDemosSocialState();
  moveAlifeNpcRecord(state, 1, 'story:living');
  const world = makeLiftWorld();
  const npc = makeTestNpc({
    id: 11,
    alifeId: 1,
    type: EntityType.NPC,
    x: 24,
    y: 24,
    occupation: Occupation.TRAVELER,
    faction: Faction.CITIZEN,
    questId: -1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  });

  assert.equal(requestDemosSocialJourney(state, 1, 'design:black_market_88', 'social_visit', {
    world,
    entities: [npc],
    activeFloorKey: 'story:living',
  }), true);

  const mobility = ensureAlifeMobilityState(state);
  assert.equal(mobility.activeDepartures.length, 1);
  assert.equal(mobility.activeDepartures[0].alifeId, 1);
  assert.equal(Object.keys(mobility.journeys).length, 0);
  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.floorKey, 'story:living');
});
