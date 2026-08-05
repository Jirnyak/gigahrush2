import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, FloorLevel, LiftDirection, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { FLOOR_INSTANCES, floorInstanceAllowsNpcs } from '../src/data/floor_instances';
import {
  floorKeyAllowsNpcs,
  floorKeyBaseFloor,
  floorKeyForFloorInstance,
  floorKeyKind,
  floorKeyKnown,
  floorKeyZ,
} from '../src/data/floor_keys';
import {
  floorInstanceGenerationExtrasForKey,
  floorInstanceGenerationSeed,
  floorInstanceGeneratorIds,
  generateFloorInstance,
  validateFloorInstanceGenerators,
} from '../src/gen/floor_instances/manifest';
import {
  captureFloorMemory,
  clearFloorMemory,
  floorMemoryStateForSave,
  restoreFloorMemoryFromSave,
  takeFloorMemory,
} from '../src/systems/floor_memory';
import { floorInstanceStateForSave, floorInstanceWorldKey, setFloorInstanceState } from '../src/systems/floor_instances';
import { makeGameState } from './helpers';

function memoryEntity(id: number): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x: 20.5,
    y: 20.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
  };
}

test('floor instance registry has package generators without ordinary route z collision', () => {
  validateFloorInstanceGenerators(FLOOR_INSTANCES);
  assert.deepEqual(floorInstanceGeneratorIds(), ['story_pocket']);
  assert.equal(floorKeyKnown('floor_instance:not_registered'), false);

  for (const def of FLOOR_INSTANCES) {
    const key = floorKeyForFloorInstance(def.id);
    assert.equal(floorKeyKind(key), 'floor_instance', `${def.id} key kind`);
    assert.equal(floorKeyKnown(key), true, `${def.id} known key`);
    assert.equal(floorKeyZ(key), undefined, `${def.id} should not occupy route z`);
    assert.equal(floorKeyBaseFloor(key), def.baseFloor, `${def.id} base floor`);
    assert.equal(floorKeyAllowsNpcs(key), floorInstanceAllowsNpcs(def), `${def.id} npc policy`);
    assert.equal(def.exitRule, 'next_lift_returns', `${def.id} exit rule`);
    assert.equal(def.debugCommandId, 'arm_floor_instance', `${def.id} debug command`);
    assert.equal(def.tags.includes('numbered_lift'), true, `${def.id} route tag`);
  }
});

test('floor instance generator builds an id-keyed hidden world package', () => {
  const first = generateFloorInstance('loop_404', 1234, 5678);
  const spawnIdx = first.world.idx(Math.floor(first.spawnX), Math.floor(first.spawnY));

  assert.equal(first.floorInstanceId, 'loop_404');
  assert.equal(first.floorInstanceKey, floorInstanceWorldKey('loop_404'));
  assert.equal(first.floorInstanceGeneratorId, 'story_pocket');
  assert.equal(first.floorInstanceNpcPolicy, 'none');
  assert.equal(first.floorInstanceExitRule, 'next_lift_returns');
  assert.equal(first.world.cells[spawnIdx], Cell.FLOOR);
  assert.equal(first.entities.some(entity => entity.type === EntityType.NPC), false, 'loop_404 package strips ordinary NPCs');
  assert.equal(floorInstanceGenerationSeed('loop_404', 1234, 5678), floorInstanceGenerationSeed('loop_404', 1234, 5678));
  assert.notEqual(floorInstanceGenerationSeed('loop_404', 1234, 5678), floorInstanceGenerationSeed('loop_404', 1234, 5679));
});

test('floor memory saves and restores floor instance worlds by instance key', () => {
  clearFloorMemory();
  const key = floorKeyForFloorInstance('loop_404');
  const world = new World();
  const idx = world.idx(20, 20);
  world.cells[idx] = Cell.FLOOR;
  const extras = floorInstanceGenerationExtrasForKey(key);
  assert.ok(extras);

  assert.equal(captureFloorMemory(key, world, [memoryEntity(9)], 20.5, 20.5, 44, 1, extras), true);
  const saved = floorMemoryStateForSave();
  clearFloorMemory();

  const restored = restoreFloorMemoryFromSave(saved, {
    generationExtrasForKey: floorInstanceGenerationExtrasForKey,
  });
  assert.equal(restored.restored, 1);
  assert.deepEqual(restored.keys, [key]);

  const loaded = takeFloorMemory(key);
  assert.ok(loaded);
  assert.equal(loaded.fromMemory, true);
  assert.equal(loaded.generation.world.cells[idx], Cell.FLOOR);
  assert.deepEqual(loaded.generation.entities.map(entity => entity.id), [9]);
  assert.equal((loaded.generation as { floorInstanceId?: string }).floorInstanceId, 'loop_404');
  assert.equal((loaded.generation as { floorInstanceKey?: string }).floorInstanceKey, key);
  clearFloorMemory();
});

test('active floor instance state round-trips a floor instance world key', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 12 });
  setFloorInstanceState(state, {
    current: {
      id: 'loop_404',
      fromFloor: FloorLevel.LIVING,
      intendedFloor: FloorLevel.MAINTENANCE,
      returnFloor: FloorLevel.MAINTENANCE,
      direction: LiftDirection.DOWN,
    },
  }, FloorLevel.LIVING);

  const saved = floorInstanceStateForSave(state);
  assert.equal(saved.current?.worldKey, floorInstanceWorldKey('loop_404'));

  const loaded = makeGameState({ currentFloor: FloorLevel.LIVING });
  setFloorInstanceState(loaded, saved, FloorLevel.LIVING);
  assert.equal(floorInstanceStateForSave(loaded).current?.worldKey, floorInstanceWorldKey('loop_404'));
});
