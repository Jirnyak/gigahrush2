import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Feature, FloorLevel, W, type Room, type World } from '../src/core/types';
import {
  FALSE_SAFE_BLOCK_DISCOVERED,
  FALSE_SAFE_BLOCK_RESOLVED,
  FALSE_SAFE_BLOCK_ROOM_PREFIX,
  FALSE_SAFE_BLOCK_TAG,
  makeProceduralFloorSpec,
  type FloorAnomalyId,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { getRecentEvents } from '../src/systems/events';
import {
  proceduralAnomalyInteractionTargetId,
  tryUseProceduralFloorAnomaly,
} from '../src/systems/procedural_anomalies';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { testGenerationMatrix } from './generator_helpers';
import { makeGameState, makeTestPlayer } from './helpers';

function forcedFalseSafeSpec(seed = 55_028, anomalyId: FloorAnomalyId = 'false_safe_block'): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(seed, 9);
  return {
    ...base,
    seed,
    geometryId: 'communal_knots',
    baseFloor: FloorLevel.KVARTIRY,
    majorityId: 'citizens',
    anomalyId,
    danger: 4,
    title: `${anomalyId}: тест тихого блока`,
  };
}

function citizenShelterName(room: Room): boolean {
  return room.name.startsWith('Гражданское укрытие') || room.name.startsWith('Тихая ниша укрытия');
}

function falseSafeRoom(room: Room): boolean {
  return room.name.startsWith(FALSE_SAFE_BLOCK_ROOM_PREFIX);
}

function findFalseSafeFeature(world: World, feature: Feature): { x: number; y: number; room: Room } {
  for (let i = 0; i < world.features.length; i++) {
    if (world.features[i] !== feature) continue;
    const room = world.rooms[world.roomMap[i]];
    if (!room || !falseSafeRoom(room)) continue;
    return { x: i % W, y: (i / W) | 0, room };
  }
  assert.fail(`missing false-safe feature ${Feature[feature]}`);
}

function installCurrentProceduralSpec(spec: ProceduralFloorSpec) {
  const state = makeGameState({ currentFloor: spec.baseFloor, samosborTimer: 120 });
  setFloorRunState(state, {
    runSeed: spec.seed,
    currentZ: spec.z,
    specs: { [spec.key]: spec },
    visited: {},
  }, spec.baseFloor);
  return state;
}

testGenerationMatrix('false-safe block exposes evidence and player counterplay through anomaly interaction', () => {
  const spec = forcedFalseSafeSpec();
  const gen = generateProceduralFloor(spec);
  const screen = findFalseSafeFeature(gen.world, Feature.SCREEN);
  const marker = findFalseSafeFeature(gen.world, Feature.APPARATUS);
  const hiddenEvidence = gen.world.containers.filter(container =>
    container.tags.includes(FALSE_SAFE_BLOCK_TAG) &&
    container.tags.includes('evidence') &&
    !container.discovered);

  assert.equal(hiddenEvidence.length >= 1, true, 'false-safe evidence stash should start hidden');
  assert.notEqual(
    proceduralAnomalyInteractionTargetId(gen.world, installCurrentProceduralSpec(spec), screen.x + 0.5, screen.y + 0.5),
    null,
    'screen should be a readable E target',
  );

  const state = installCurrentProceduralSpec(spec);
  const player = makeTestPlayer({
    x: screen.x + 0.5,
    y: screen.y + 1.5,
    tool: 'cleaning_kit',
    inventory: [{ defId: 'cleaning_kit', count: 1, data: { dur: 240 } }],
  });

  assert.equal(tryUseProceduralFloorAnomaly(gen.world, player, state, screen.x + 0.5, screen.y + 0.5), true);
  assert.equal(gen.world.rooms.filter(falseSafeRoom).every(room => room.name.includes(FALSE_SAFE_BLOCK_DISCOVERED)), true);
  assert.equal(hiddenEvidence.every(container => container.discovered), true, 'checking the screen should reveal hidden evidence');
  assert.equal(
    getRecentEvents(state, { type: 'rumor_observed', tags: [FALSE_SAFE_BLOCK_TAG], limit: 1 })[0]?.data?.outcome,
    'screen_checked',
  );

  assert.equal(tryUseProceduralFloorAnomaly(gen.world, player, state, marker.x + 0.5, marker.y + 0.5), true);
  assert.equal(gen.world.features[gen.world.idx(marker.x, marker.y)], Feature.NONE);
  assert.equal(gen.world.rooms.filter(falseSafeRoom).every(room => room.name.includes(FALSE_SAFE_BLOCK_RESOLVED)), true);
  assert.equal(state.samosborTimer < 120, true, 'removing the cult marker should cost route time');
  assert.equal(getRecentEvents(state, { tags: ['marker_resolved', FALSE_SAFE_BLOCK_TAG], limit: 1 }).length, 1);
});

testGenerationMatrix('false-safe block does not silently replace existing citizen shelter rooms', () => {
  const baseline = generateProceduralFloor(forcedFalseSafeSpec(55_028, 'none'));
  const falseSafe = generateProceduralFloor(forcedFalseSafeSpec(55_028, 'false_safe_block'));
  const baselineShelters = baseline.world.rooms.filter(citizenShelterName).map(room => room.name).sort();
  const falseSafeShelters = falseSafe.world.rooms.filter(citizenShelterName).map(room => room.name).sort();

  assert.equal(baselineShelters.length >= 3, true, `baseline shelters ${baselineShelters.length}`);
  assert.deepEqual(falseSafeShelters, baselineShelters);
  assert.equal(falseSafe.world.rooms.some(falseSafeRoom), true, 'false-safe room should still be generated');
});
