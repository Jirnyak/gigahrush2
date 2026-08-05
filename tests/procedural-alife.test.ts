import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, FloorLevel, type GameState } from '../src/core/types';
import {
  floorRunZAllowsNpcs,
  makeProceduralFloorSpec,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  materializeAlifeFloorPopulation,
  recordAlifeNpcDeath,
  setAlifeState,
} from '../src/systems/alife';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { isFloor69FemaleSprite } from '../src/entities/procedural_visuals';
import { NPC_VISUAL_WORKER69 } from '../src/data/art_sprite_manifest';
import { testGenerationMatrix } from './generator_helpers';

function socialProceduralSpec(): ProceduralFloorSpec {
  return {
    ...makeProceduralFloorSpec(17, 1),
    z: 1,
    key: 'z1',
    danger: 2,
    geometryId: 'communal_knots',
    baseFloor: FloorLevel.KVARTIRY,
    majorityId: 'citizens',
    anomalyId: 'none',
    title: 'тестовый коммунальный процедурный этаж',
    lootBiasIds: [],
    monsterBiasKinds: [],
    monsterBiasTags: [],
  };
}

function stateForSpec(spec: ProceduralFloorSpec): GameState {
  const state = { currentFloor: spec.baseFloor } as GameState;
  const floorKey = `procedural:${spec.key}`;
  setFloorRunState(state, {
    runSeed: 17,
    currentZ: spec.z,
    specs: { [spec.key]: spec },
    visited: { [floorKey]: true },
  }, spec.baseFloor);
  setAlifeState(state, { seed: 12345, total: 100_000 });
  return state;
}

function ordinaryNpcCount(entities: readonly { type: EntityType; plotNpcId?: string; persistentNpcId?: string; alifeId?: number; questId?: number }[]): number {
  return entities.filter(entity =>
    entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1
  ).length;
}

testGenerationMatrix('procedural route NPC templates materialize through A-Life and keep dead slots empty', () => {
  const spec = socialProceduralSpec();
  assert.equal(floorRunZAllowsNpcs(spec.z), true);

  const state = stateForSpec(spec);
  const generated = generateProceduralFloor(spec);
  const templateCount = ordinaryNpcCount(generated.entities);
  assert.equal(templateCount > 0, true, 'procedural generation should provide ordinary NPC slots');

  let nextId = { v: generated.entities.reduce((max, entity) => Math.max(max, entity.id), 0) + 1 };
  materializeAlifeFloorPopulation(state, generated.world, generated.entities, nextId, `procedural:${spec.key}`);
  const materialized = generated.entities.filter(entity => entity.type === EntityType.NPC && entity.alifeId !== undefined);
  assert.equal(materialized.length > 0, true, 'procedural NPC slots should receive A-Life records');
  assert.equal(ordinaryNpcCount(generated.entities), 0, 'ordinary templates should not survive activation');
  assert.equal(materialized.every(entity => entity.persistentNpcId === `alife:${entity.alifeId}`), true);

  const killedId = materialized[0].alifeId;
  assert.ok(killedId);
  recordAlifeNpcDeath(state, materialized[0]);

  const regenerated = generateProceduralFloor(spec);
  nextId = { v: regenerated.entities.reduce((max, entity) => Math.max(max, entity.id), 0) + 1 };
  materializeAlifeFloorPopulation(state, regenerated.world, regenerated.entities, nextId, `procedural:${spec.key}`);
  const rematerialized = regenerated.entities.filter(entity => entity.type === EntityType.NPC && entity.alifeId !== undefined);
  assert.equal(rematerialized.some(entity => entity.alifeId === killedId), false, 'killed procedural A-Life record must stay dead');
  assert.equal(rematerialized.length, materialized.length - 1, 'dead procedural slot should stay empty until explicit migration');
});

testGenerationMatrix('procedural route templates are suppressed when the active floor has no A-Life records', () => {
  const spec = socialProceduralSpec();
  const state = stateForSpec(spec);
  const floorKey = `procedural:${spec.key}`;
  const alife = setAlifeState(state, { seed: 12345, total: 1 }) as {
    floorIndex: Record<string, number[]>;
  };
  alife.floorIndex[floorKey] = [];
  const generated = generateProceduralFloor(spec);
  assert.equal(ordinaryNpcCount(generated.entities) > 0, true, 'procedural generation should provide ordinary NPC slots');

  const nextId = { v: generated.entities.reduce((max, entity) => Math.max(max, entity.id), 0) + 1 };
  materializeAlifeFloorPopulation(state, generated.world, generated.entities, nextId, floorKey);

  assert.equal(ordinaryNpcCount(generated.entities), 0, 'ordinary templates must not survive without A-Life records');
  assert.equal(generated.entities.some(entity => entity.type === EntityType.NPC && entity.alifeId !== undefined), false);
});

testGenerationMatrix('floor 69 adult sprite templates survive A-Life materialization', () => {
  const state = { currentFloor: FloorLevel.MAINTENANCE } as GameState;
  setFloorRunState(state, { runSeed: 17, currentZ: -4 }, FloorLevel.MAINTENANCE);
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const generated = generateDesignFloor('floor_69');
  const templateSprites = generated.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    entity.alifeId === undefined &&
    isFloor69FemaleSprite(entity.sprite)
  );
  const templateWorkers = generated.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    entity.alifeId === undefined &&
    entity.name?.startsWith('Этаж 69: работница ')
  );
  const templateVisitors = generated.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    entity.alifeId === undefined &&
    entity.name?.startsWith('Этаж 69: посетитель ')
  );
  assert.equal(templateSprites.length, templateWorkers.length);
  assert.equal(templateVisitors.every(entity => !isFloor69FemaleSprite(entity.sprite)), true);
  assert.equal(templateSprites.length >= 300, true, 'floor_69 generation should expose adult sprite templates');

  const nextId = { v: generated.entities.reduce((max, entity) => Math.max(max, entity.id), 0) + 1 };
  materializeAlifeFloorPopulation(state, generated.world, generated.entities, nextId, 'design:floor_69');
  const materializedSprites = generated.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    entity.alifeId !== undefined &&
    isFloor69FemaleSprite(entity.sprite)
  );

  assert.equal(ordinaryNpcCount(generated.entities), 0, 'ordinary floor_69 templates should not survive activation');
  assert.equal(materializedSprites.length >= 300, true, 'floor_69 A-Life activation should keep a visible adult sprite cohort');
  assert.equal(materializedSprites.length <= templateSprites.length, true);
  assert.equal(materializedSprites.every(entity =>
    entity.isFemale === true &&
    entity.npcVisualId === NPC_VISUAL_WORKER69 &&
    entity.name?.startsWith('Этаж 69: работница ') &&
    entity.persistentNpcId === `alife:${entity.alifeId}`
  ), true);
});
