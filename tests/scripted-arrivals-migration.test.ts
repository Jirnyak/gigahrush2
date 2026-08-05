import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../src/core/world';
import {
  AIGoal,
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  LiftDirection,
  Occupation,
  QuestType,
  RoomType,
  type Entity,
  type GameState,
  type Quest,
} from '../src/core/types';
import { ALIFE_POPULATION_CAPACITY } from '../src/data/alife_population_plan';
import { getNpcPackageByPlotNpcId, npcPackageDisplayName } from '../src/data/npc_packages';
import { PLOT_CHAIN } from '../src/data/plot';
import { SCRIPTED_ARRIVALS } from '../src/data/scripted_arrivals';
import { initFactionRelations } from '../src/data/relations';
import { recordAlifeNpcDeath, setAlifeState, alifeForSave } from '../src/systems/alife';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { updateScriptedArrivals } from '../src/systems/scripted_arrivals';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

function holdoutStepIndex(): number {
  const stepIndex = PLOT_CHAIN.findIndex(step => step.eventTags?.includes('hell_holdout'));
  assert.ok(stepIndex >= 0, 'hell holdout plot step should exist');
  return stepIndex;
}

function makeHellState(overrides: Partial<GameState> = {}): GameState {
  const state = makeGameState({
    currentFloor: FloorLevel.HELL,
    worldEvents: createWorldEventState(),
    ...overrides,
  });
  setFloorRunState(state, { runSeed: 5, currentZ: -36, specs: {}, visited: {} }, FloorLevel.HELL);
  setAlifeState(state, { seed: 12345, total: 100_000 });
  return state;
}

function makeHoldoutQuest(targetRoom = 1): Quest {
  return {
    id: 1,
    type: QuestType.VISIT,
    giverId: -1,
    giverName: 'сюжет',
    desc: 'holdout',
    targetRoom,
    plotStepIndex: holdoutStepIndex(),
    done: true,
  };
}

function makeHellWorld(): World {
  const world = new World();
  addTestRoom(world, {
    id: 1,
    type: RoomType.HQ,
    x: 20,
    y: 20,
    w: 10,
    h: 10,
    zoneLevel: 5,
  });
  const liftIdx = world.idx(18, 24);
  world.cells[liftIdx] = Cell.LIFT;
  world.liftDir[liftIdx] = LiftDirection.UP;
  world.cells[world.idx(19, 24)] = Cell.FLOOR;
  world.cells[world.idx(19, 25)] = Cell.FLOOR;
  world.zoneMap[world.idx(19, 24)] = 0;
  world.zoneMap[world.idx(19, 25)] = 0;
  return world;
}

function plotNpc(id: string): Entity {
  return {
    id: 77,
    type: EntityType.NPC,
    x: 24.5,
    y: 24.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1.2,
    sprite: Occupation.HUNTER,
    name: 'Громный',
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    hp: 100,
    maxHp: 100,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    plotNpcId: id,
    questId: -1,
  };
}

test('Hell holdout arrivals keep liquidator guards inside A-Life capacity', () => {
  initFactionRelations();
  const arrivalDef = SCRIPTED_ARRIVALS.find(def => def.triggerPlotEventTag === 'hell_holdout');
  assert.equal(arrivalDef?.leaderPlotNpcId, 'major_grom');
  assert.equal(arrivalDef?.sourceFloorKey, 'story:ministry');
  const state = makeHellState();
  state.quests = [makeHoldoutQuest()];
  const world = makeHellWorld();
  const player = makeTestPlayer({ id: 1, x: 24.5, y: 24.5 });
  const entities: Entity[] = [player];
  const nextId = { v: 10 };

  assert.equal(updateScriptedArrivals(world, entities, player, state, nextId), true);

  const major = entities.find(e => e.plotNpcId === 'major_grom');
  const majorPackage = getNpcPackageByPlotNpcId('major_grom');
  assert.ok(major, 'Major Grom should arrive once as a plot NPC');
  assert.ok(majorPackage);
  assert.equal((major as Entity & { npcPackageId?: string }).npcPackageId, majorPackage.id);
  assert.equal(major.name, npcPackageDisplayName(majorPackage));
  assert.equal(major.alifeId !== undefined, true);
  assert.equal(major.persistentNpcId, `alife:${major.alifeId}`);
  const guards = entities.filter(e => e.faction === Faction.LIQUIDATOR && e.plotNpcId === undefined && e.id !== major.id);
  assert.equal(guards.length > 0, true);
  assert.equal(guards.length <= 5, true);
  assert.equal(guards.every(e => e.alifeId !== undefined && e.persistentNpcId === `alife:${e.alifeId}`), true);
  const savedAlife = alifeForSave(state);
  const maxArrivalAlifeId = Math.max(major.alifeId ?? 0, ...guards.map(guard => guard.alifeId ?? 0));
  assert.ok(savedAlife.total >= maxArrivalAlifeId);
  assert.ok(savedAlife.total >= 100_000);
  assert.ok(savedAlife.total <= ALIFE_POPULATION_CAPACITY);

  const event = getRecentEvents(state, { tags: ['scripted_arrival', 'alife_migration'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.data?.arrivalId, arrivalDef?.id);
  assert.equal(event.data?.fromFloorKey, 'story:ministry');
  assert.equal(event.data?.toFloorKey, 'story:hell');
  assert.equal(event.data?.guardCount, guards.length);
});

test('Hell holdout arrivals do not duplicate or replace dead Major Grom', () => {
  initFactionRelations();
  const state = makeHellState();
  state.quests = [makeHoldoutQuest()];
  const world = makeHellWorld();
  const player = makeTestPlayer({ id: 1, x: 24.5, y: 24.5 });
  const existing = plotNpc('major_grom');

  assert.equal(updateScriptedArrivals(world, [player, existing], player, state, { v: 100 }), false);

  recordAlifeNpcDeath(state, existing);
  const entities: Entity[] = [player];
  assert.equal(updateScriptedArrivals(world, entities, player, state, { v: 200 }), false);
  assert.equal(entities.some(e => e.plotNpcId === 'major_grom'), false);
});
