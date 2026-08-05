import test from 'node:test';
import assert from 'node:assert/strict';
import { SeedRng } from '../src/core/rand';

import { World } from '../src/core/world';
import {
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  Occupation,
  type Entity,
} from '../src/core/types';
import { ALIFE_POPULATION_CAPACITY } from '../src/data/alife_population_plan';
import { SAMOSBOR_VARIANTS, type ActiveSamosborVariant } from '../src/data/samosbor_variants';
import { initFactionRelations } from '../src/data/relations';
import { debugMarkAllAlifeNpcRecordsTouched, setAlifeState } from '../src/systems/alife';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { tickSamosborDirector } from '../src/systems/samosbor_director';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

function classicVariant(): ActiveSamosborVariant {
  const def = SAMOSBOR_VARIANTS.find(variant => variant.id === 'classic');
  assert.ok(def);
  return {
    def,
    modifiers: [],
    durationMult: def.durationMult,
    spawnMult: def.spawnMult,
    fogSeedMult: 1,
    fogSpawnIntervalMult: 1,
    sealTimingDelta: def.sealTimingDelta,
    noSiren: false,
    extraEyes: 0,
    shelterRoomCount: 0,
    fogColor: def.fogColor,
  } as ActiveSamosborVariant;
}

function patrolWorld(): World {
  const world = new World();
  addTestRoom(world, {
    id: 1,
    x: 8,
    y: 8,
    w: 28,
    h: 28,
    zoneLevel: 3,
  });
  world.cells[world.idx(15, 10)] = Cell.FLOOR;
  world.zoneMap[world.idx(15, 10)] = 0;
  return world;
}

function withRandom<T>(value: number, run: () => T): T {
  const originalMath = Math.random;
  const originalSeed = SeedRng.prototype.random;
  try {
    Math.random = () => value;
    SeedRng.prototype.random = () => value;
    return run();
  } finally {
    Math.random = originalMath;
    SeedRng.prototype.random = originalSeed;
  }
}

test('samosbor extra patrol is a fixed-pool A-Life migration, not anonymous refill', () => {
  initFactionRelations();
  const state = makeGameState({
    time: 100,
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 7,
    worldEvents: createWorldEventState(),
  });
  setFloorRunState(state, { runSeed: 7, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);
  setAlifeState(state, { seed: 223344, total: 100_000 });
  const world = patrolWorld();
  const player = makeTestPlayer({ id: 1, x: 10.5, y: 10.5 });
  const entities: Entity[] = [player];
  const nextId = { v: 30 };
  const result = withRandom(0.99, () => 
    tickSamosborDirector(world, entities, state, nextId, classicVariant(), 'active_cadence')
  );

  assert.equal(result.fired, true);
  assert.equal(result.beatId, 'active_liquidator_patrol');
  const patrol = entities.filter(e => e.type === EntityType.NPC && e.faction === Faction.LIQUIDATOR && e.occupation === Occupation.HUNTER);
  assert.equal(patrol.length, 2);
  assert.equal(patrol.every(e => e.alifeId !== undefined && e.persistentNpcId === `alife:${e.alifeId}`), true);

  const event = getRecentEvents(state, { tags: ['samosbor', 'alife_migration'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.data?.fromFloorKey, 'story:ministry');
  assert.equal(event.data?.toFloorKey, 'story:living');
  assert.equal(event.data?.reason, 'samosbor');
  assert.equal(event.data?.intent, 'active_liquidator_patrol');
  assert.deepEqual(event.data?.alifeIds, patrol.map(e => e.alifeId));
});

test('samosbor extra patrol fails instead of spawning when no A-Life identities are reusable', () => {
  initFactionRelations();
  const state = makeGameState({
    time: 100,
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 8,
    worldEvents: createWorldEventState(),
  });
  setFloorRunState(state, { runSeed: 8, currentZ: 0, specs: {}, visited: {} }, FloorLevel.LIVING);
  setAlifeState(state, { seed: 334455, total: ALIFE_POPULATION_CAPACITY });
  debugMarkAllAlifeNpcRecordsTouched(state);
  const world = patrolWorld();
  const player = makeTestPlayer({ id: 1, x: 10.5, y: 10.5 });
  const entities: Entity[] = [player];

  const result = withRandom(0.99, () =>
    tickSamosborDirector(world, entities, state, { v: 30 }, classicVariant(), 'active_cadence')
  );

  assert.equal(result.fired, false);
  assert.equal(result.beatId, 'active_liquidator_patrol');
  assert.equal(result.reasonCode, 'effect_failed');
  assert.equal(entities.filter(e => e.type === EntityType.NPC && e.faction === Faction.LIQUIDATOR).length, 0);
  assert.equal(getRecentEvents(state, { tags: ['alife_migration'] }).length, 0);
});
