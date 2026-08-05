import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, Cell, Faction, Feature, FloorLevel, Occupation, RoomType, type Entity, type GameState } from '../src/core/types';
import { World } from '../src/core/world';
import { alifeForSave, captureAlifeFloorState, materializeAlifeFloorPopulation, moveAlifeNpcRecord, setAlifeState } from '../src/systems/alife';
import {
  enqueueAlifeArrival,
  findAlifeArrivalAnchor,
  processAlifePendingArrivals,
  startActiveAlifeDeparture,
  updateActiveAlifeDepartures,
  type ActiveAlifeDeparture,
  type AlifeArrival,
} from '../src/systems/alife_migration';
import { activeActorSoftLimit, setActiveActorSoftLimit } from '../src/data/entity_limits';
import { createWorldEventState } from '../src/systems/events';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { addTestRoom, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

interface TestAlifeState {
  npcs: Array<{ id: number }>;
  floorIndex: Record<string, number[]>;
}

interface TestMigrationHost extends GameState {
  alifeMobility?: {
    pendingArrivals: AlifeArrival[];
    activeDepartures: ActiveAlifeDeparture[];
  };
}

function stateAtLiving(overrides: Partial<GameState> = {}): GameState {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
    ...overrides,
  });
  setFloorRunState(state, { runSeed: 17, currentZ: 0 }, FloorLevel.LIVING);
  setAlifeState(state, { seed: 12345, total: 100_000 });
  return state;
}

function stateAtVoid(): GameState {
  const state = makeGameState({
    currentFloor: FloorLevel.VOID,
    worldEvents: createWorldEventState(),
  });
  setFloorRunState(state, { runSeed: 17, currentZ: -50 }, FloorLevel.VOID);
  setAlifeState(state, { seed: 12345, total: 100_000 });
  return state;
}

function migrationState(state: GameState): TestMigrationHost['alifeMobility'] {
  return (state as TestMigrationHost).alifeMobility;
}

function arrival(
  alifeId: number,
  toFloorKey = 'story:living',
  overrides: Partial<AlifeArrival> = {},
): AlifeArrival {
  return {
    journeyId: `test_journey_${alifeId}`,
    alifeId,
    fromFloorKey: 'story:kvartiry',
    toFloorKey,
    intentId: `test_arrival_${alifeId}`,
    reason: 'routine',
    risk: 1,
    etaAt: 0,
    queuedAt: 0,
    ...overrides,
  };
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

function makeMultiLiftWorld(): World {
  const world = new World();
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * 18;
    const y = 20 + i * 11;
    addTestRoom(world, {
      id: i + 1,
      x,
      y,
      w: 8,
      h: 8,
      type: RoomType.COMMON,
      name: `Лифтовой тестовый узел ${i + 1}`,
      zoneId: i,
    });
    world.zones[i].hasLift = true;
    world.cells[world.idx(x + 3, y + 2)] = Cell.LIFT;
    world.cells[world.idx(x + 4, y + 2)] = Cell.FLOOR;
    world.features[world.idx(x + 4, y + 3)] = Feature.LIFT_BUTTON;
  }
  return world;
}

function makeNoAnchorWorld(): World {
  const world = new World();
  addTestRoom(world, {
    id: 1,
    x: 40,
    y: 40,
    w: 5,
    h: 5,
    type: RoomType.COMMON,
    name: 'Комната без лифта',
  });
  return world;
}

function makeUnreachableLiftWorld(): World {
  const world = new World();
  addTestRoom(world, {
    id: 1,
    x: 10,
    y: 10,
    w: 5,
    h: 5,
    type: RoomType.COMMON,
    name: 'Отрезанная стартовая комната',
    zoneId: 0,
  });
  addTestRoom(world, {
    id: 2,
    x: 80,
    y: 80,
    w: 5,
    h: 5,
    type: RoomType.COMMON,
    name: 'Отрезанный лифтовой узел',
    zoneId: 1,
  });
  world.zones[1].hasLift = true;
  world.cells[world.idx(82, 82)] = Cell.LIFT;
  world.cells[world.idx(83, 82)] = Cell.FLOOR;
  return world;
}

function templateNpc(id: number, x: number, y: number): Entity {
  return makeTestNpc({
    id,
    x,
    y,
    angle: 0,
    speed: 1.2,
    sprite: Occupation.TRAVELER,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    occupation: Occupation.TRAVELER,
    faction: Faction.CITIZEN,
    questId: -1,
    persistentNpcId: undefined,
  });
}

function persistentNpc(id: number, alifeId: number, x: number, y: number): Entity {
  return makeTestNpc({
    id,
    x,
    y,
    angle: 0,
    speed: 1.2,
    sprite: Occupation.TRAVELER,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    occupation: Occupation.TRAVELER,
    faction: Faction.CITIZEN,
    questId: -1,
    alifeId,
    persistentNpcId: `alife:${alifeId}`,
    canGiveQuest: false,
  });
}

function putRecordOnLiving(state: GameState, alifeId: number): void {
  assert.equal(moveAlifeNpcRecord(state, alifeId, 'story:living', { floor: FloorLevel.LIVING }), true);
}

test('floor activation consumes only prefilled A-Life bucket records', () => {
  const state = stateAtLiving();
  const alife = setAlifeState(state, { seed: 12345, total: 100_000 }) as TestAlifeState;
  assert.equal(moveAlifeNpcRecord(state, alife.npcs[0].id, 'story:living', { floor: FloorLevel.LIVING, markTouched: false }), true);
  alife.floorIndex['story:living'] = [0];
  const world = makeNoAnchorWorld();
  world.cells[world.idx(41, 41)] = Cell.FLOOR;
  world.cells[world.idx(42, 41)] = Cell.FLOOR;
  world.cells[world.idx(43, 41)] = Cell.FLOOR;
  const entities = [
    templateNpc(1, 41.5, 41.5),
    templateNpc(2, 42.5, 41.5),
    templateNpc(3, 43.5, 41.5),
  ];

  materializeAlifeFloorPopulation(state, world, entities, { v: 10 }, 'story:living');

  assert.equal(entities.length, 1);
  assert.equal(entities[0].alifeId, 1);
  assert.equal(entities[0].persistentNpcId, 'alife:1');
});

test('pending arrival to the active floor materializes the same A-Life id near a lift', () => {
  const state = stateAtLiving();
  const world = makeLiftWorld();
  const entities: Entity[] = [];
  assert.equal(enqueueAlifeArrival(state, arrival(1, 'story:living', { intentId: 'test_arrival' })), true);

  assert.equal(processAlifePendingArrivals(state, world, entities, { v: 100 }), 1);

  assert.equal(entities.length, 1);
  assert.equal(entities[0].alifeId, 1);
  assert.equal(entities[0].persistentNpcId, 'alife:1');
  assert.equal(world.cells[world.idx(Math.floor(entities[0].x), Math.floor(entities[0].y))], Cell.FLOOR);
  assert.ok(world.dist2(entities[0].x, entities[0].y, 23.5, 22.5) <= 2.1);
  assert.equal(migrationState(state)?.pendingArrivals.length, 0);
});

test('arrival anchor finder prefers passable cells around lift cells over solid cells', () => {
  const world = makeLiftWorld();
  const anchor = findAlifeArrivalAnchor(world, 22.5, 22.5);

  assert.ok(anchor);
  assert.equal(world.cells[world.idx(Math.floor(anchor.x), Math.floor(anchor.y))], Cell.FLOOR);
  assert.notEqual(world.cells[world.idx(Math.floor(anchor.x), Math.floor(anchor.y))], Cell.LIFT);
  assert.ok(world.dist2(anchor.x, anchor.y, 23.5, 22.5) <= 2.1);
});

test('arrival anchor finder rotates unpreferred anchors by A-Life salt', () => {
  const world = makeMultiLiftWorld();
  const chosen = new Set<number>();
  for (let alifeId = 1; alifeId <= 12; alifeId++) {
    const anchor = findAlifeArrivalAnchor(world, undefined, undefined, alifeId);
    assert.ok(anchor);
    chosen.add(world.idx(Math.floor(anchor.x), Math.floor(anchor.y)));
  }

  assert.equal(chosen.size > 1, true, 'unpreferred arrivals must not all use the first cached lift anchor');
});

test('pending arrival is delayed when actor cap fails or no lift anchor exists', () => {
  const previousCap = activeActorSoftLimit();
  try {
    setActiveActorSoftLimit(1024);
    const cappedState = stateAtLiving();
    const cappedWorld = makeLiftWorld();
    const cappedEntities = Array.from({ length: 1024 }, (_, index) =>
      persistentNpc(2000 + index, 10_000 + index, 21.5, 21.5));
    assert.equal(enqueueAlifeArrival(cappedState, arrival(2, 'story:living', { intentId: 'cap_test' })), true);

    assert.equal(processAlifePendingArrivals(cappedState, cappedWorld, cappedEntities, { v: 9000 }), 0);
    assert.equal(migrationState(cappedState)?.pendingArrivals[0]?.tries, 1);

    const noAnchorState = stateAtLiving();
    assert.equal(enqueueAlifeArrival(noAnchorState, arrival(3, 'story:living', { intentId: 'no_anchor_test' })), true);
    assert.equal(processAlifePendingArrivals(noAnchorState, makeNoAnchorWorld(), [], { v: 10 }), 0);
    assert.equal(migrationState(noAnchorState)?.pendingArrivals[0]?.tries, 1);
  } finally {
    setActiveActorSoftLimit(previousCap);
  }
});

test('pending arrival to another floor stays queued for off-floor migration', () => {
  const state = stateAtLiving();
  const world = makeLiftWorld();
  assert.equal(enqueueAlifeArrival(state, arrival(4, 'design:bank_floor', { intentId: 'other_floor' })), true);

  assert.equal(processAlifePendingArrivals(state, world, [], { v: 10 }), 0);
  assert.equal(migrationState(state)?.pendingArrivals.length, 1);
  assert.equal(migrationState(state)?.pendingArrivals[0].toFloorKey, 'design:bank_floor');
});

test('normal pending arrival is delayed while active samosbor is running', () => {
  const state = stateAtLiving({ samosborActive: true });
  assert.equal(enqueueAlifeArrival(state, arrival(5, 'story:living', { intentId: 'samosbor_delay' })), true);

  assert.equal(processAlifePendingArrivals(state, makeLiftWorld(), [], { v: 10 }), 0);
  assert.equal(migrationState(state)?.pendingArrivals[0].tries, 1);
});

test('pending arrival is delayed when the active route disallows NPCs', () => {
  const state = stateAtVoid();
  assert.equal(enqueueAlifeArrival(state, arrival(6, 'story:void', { intentId: 'void_delay' })), true);

  assert.equal(processAlifePendingArrivals(state, makeLiftWorld(), [], { v: 10 }), 0);
  assert.equal(migrationState(state)?.pendingArrivals[0].tries, 1);
});

test('active departure assigns GOTO to a lift anchor', () => {
  const state = stateAtLiving();
  const world = makeLiftWorld();
  putRecordOnLiving(state, 7);
  const npc = persistentNpc(7, 7, 21.5, 22.5);

  assert.equal(startActiveAlifeDeparture(state, world, npc, 'design:bank_floor', 'leave_for_bank', 'routine'), true);

  assert.equal(npc.isTraveler, true);
  assert.equal(npc.ai?.goal, AIGoal.GOTO);
  assert.equal(npc.ai?.tx, 22.5);
  assert.equal(npc.ai?.ty, 22.5);
  assert.ok((npc.ai?.path.length ?? 0) > 0);
  assert.ok((npc.ai?.timer ?? 0) > 0);
  assert.equal(migrationState(state)?.activeDepartures.length, 1);
});

test('active departure does not start without a reachable lift path', () => {
  const state = stateAtLiving();
  const world = makeUnreachableLiftWorld();
  putRecordOnLiving(state, 10);
  const npc = persistentNpc(10, 10, 12.5, 12.5);

  assert.equal(startActiveAlifeDeparture(state, world, npc, 'story:kvartiry', 'unreachable_lift', 'routine'), false);

  assert.equal(migrationState(state)?.activeDepartures.length ?? 0, 0);
  assert.equal(npc.ai?.goal, AIGoal.IDLE);
  assert.equal(npc.isTraveler, undefined);
});

test('departure does not start for player, plot NPC, quest NPC or dead NPC', () => {
  const state = stateAtLiving();
  const world = makeLiftWorld();
  for (const alifeId of [1, 2, 3, 4]) putRecordOnLiving(state, alifeId);
  const player = makeTestPlayer({ id: 1, x: 21.5, y: 22.5, alifeId: 1 });
  const plotNpc = persistentNpc(2, 2, 21.5, 22.5);
  plotNpc.plotNpcId = 'olga';
  const questNpc = persistentNpc(3, 3, 21.5, 22.5);
  questNpc.questId = 99;
  const deadNpc = persistentNpc(4, 4, 21.5, 22.5);
  deadNpc.alive = false;

  assert.equal(startActiveAlifeDeparture(state, world, player, 'story:kvartiry', 'player', 'routine'), false);
  assert.equal(startActiveAlifeDeparture(state, world, plotNpc, 'story:kvartiry', 'plot', 'routine'), false);
  assert.equal(startActiveAlifeDeparture(state, world, questNpc, 'story:kvartiry', 'quest', 'routine'), false);
  assert.equal(startActiveAlifeDeparture(state, world, deadNpc, 'story:kvartiry', 'dead', 'routine'), false);
  assert.equal(migrationState(state)?.activeDepartures?.length ?? 0, 0);
});

test('departure reaching a lift removes live entity and moves the record to target key', () => {
  const state = stateAtLiving();
  const world = makeLiftWorld();
  putRecordOnLiving(state, 8);
  const npc = persistentNpc(8, 8, 22.5, 22.5);
  const entities = [npc];

  assert.equal(startActiveAlifeDeparture(state, world, npc, 'story:kvartiry', 'leave_to_queue', 'routine'), true);
  assert.equal(updateActiveAlifeDepartures(state, world, entities, 1 / 60), 1);

  assert.equal(entities.length, 0);
  assert.equal(migrationState(state)?.activeDepartures.length, 0);
  assert.equal(alifeForSave(state).overrides.some(item => item.id === 8 && item.floorKey === 'story:kvartiry'), true);
});

test('unfinished departure captured before reaching lift does not teleport the record', () => {
  const state = stateAtLiving();
  const world = makeLiftWorld();
  putRecordOnLiving(state, 9);
  const npc = persistentNpc(9, 9, 25.5, 25.5);
  const entities = [npc];

  assert.equal(startActiveAlifeDeparture(state, world, npc, 'story:kvartiry', 'not_reached', 'routine'), true);
  captureAlifeFloorState(state, entities);

  assert.equal(entities.length, 1);
  assert.equal(alifeForSave(state).overrides.some(item => item.id === 9 && item.floorKey === 'story:living'), true);
  assert.equal(alifeForSave(state).overrides.some(item => item.id === 9 && item.floorKey === 'story:kvartiry'), false);
});

test('active departure updates rotate unfinished prefix entries behind deferred departures', () => {
  const state = stateAtLiving();
  const world = makeLiftWorld();
  const entities: Entity[] = [];
  for (let id = 20; id <= 28; id++) {
    putRecordOnLiving(state, id);
    const nearLift = id === 28;
    const npc = persistentNpc(id, id, nearLift ? 22.5 : 25.5, nearLift ? 22.5 : 25.5);
    entities.push(npc);
    assert.equal(startActiveAlifeDeparture(state, world, npc, 'story:kvartiry', `rotate_${id}`, 'routine'), true);
  }

  assert.equal(updateActiveAlifeDepartures(state, world, entities, 1 / 60), 0);
  assert.equal(migrationState(state)?.activeDepartures[0]?.alifeId, 28);
  assert.equal(updateActiveAlifeDepartures(state, world, entities, 1 / 60), 1);

  assert.equal(entities.some(entity => entity.alifeId === 28), false);
  assert.equal(migrationState(state)?.activeDepartures.some(item => item.alifeId === 28), false);
  assert.equal(alifeForSave(state).overrides.some(item => item.id === 28 && item.floorKey === 'story:kvartiry'), true);
});
