import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ZoneFaction } from '../src/core/types';
import { territorySharesForProceduralSpec } from '../src/data/floor_territory';
import type { ProceduralFloorSpec, FloorMajorityId, FloorAnomalyId } from '../src/data/procedural_floors';

function makeSpec(majorityId: FloorMajorityId, anomalyId: FloorAnomalyId): ProceduralFloorSpec {
  return {
    key: 'test',
    z: 0,
    ordinal: 1,
    seed: 0,
    depth: 0,
    danger: 1,
    geometryId: 'test_geom' as any,
    baseFloor: 0,
    majorityId,
    anomalyId,
    title: 'Test',
    lootBiasIds: [],
    monsterBiasKinds: [],
    monsterBiasTags: [],
  };
}

test('territorySharesForProceduralSpec handles citizens + false_safe_block', () => {
  const result = territorySharesForProceduralSpec(makeSpec('citizens', 'false_safe_block'));
  assert.deepEqual(result, [
    { owner: ZoneFaction.CITIZEN, share: 53 },
    { owner: ZoneFaction.LIQUIDATOR, share: 16 },
    { owner: ZoneFaction.CULTIST, share: 12 },
    { owner: ZoneFaction.SCIENTIST, share: 8 },
    { owner: ZoneFaction.WILD, share: 11 },
  ]);
});

test('territorySharesForProceduralSpec handles liquidators + false_safe_block', () => {
  const result = territorySharesForProceduralSpec(makeSpec('liquidators', 'false_safe_block'));
  assert.deepEqual(result, [
    { owner: ZoneFaction.CITIZEN, share: 16 },
    { owner: ZoneFaction.LIQUIDATOR, share: 53 },
    { owner: ZoneFaction.CULTIST, share: 12 },
    { owner: ZoneFaction.SCIENTIST, share: 8 },
    { owner: ZoneFaction.WILD, share: 11 },
  ]);
});

test('territorySharesForProceduralSpec handles cultists + samosbor_seed', () => {
  const result = territorySharesForProceduralSpec(makeSpec('cultists', 'samosbor_seed'));
  assert.deepEqual(result, [
    { owner: ZoneFaction.CITIZEN, share: 15 },
    { owner: ZoneFaction.LIQUIDATOR, share: 11 },
    { owner: ZoneFaction.CULTIST, share: 36 },
    { owner: ZoneFaction.SCIENTIST, share: 7 },
    { owner: ZoneFaction.WILD, share: 22 },
    { owner: ZoneFaction.SAMOSBOR, share: 9 },
  ]);
});

test('territorySharesForProceduralSpec handles citizens + samosbor_seed', () => {
  const result = territorySharesForProceduralSpec(makeSpec('citizens', 'samosbor_seed'));
  assert.deepEqual(result, [
    { owner: ZoneFaction.CITIZEN, share: 51 },
    { owner: ZoneFaction.LIQUIDATOR, share: 15 },
    { owner: ZoneFaction.CULTIST, share: 6 },
    { owner: ZoneFaction.SCIENTIST, share: 7 },
    { owner: ZoneFaction.WILD, share: 11 },
    { owner: ZoneFaction.SAMOSBOR, share: 10 },
  ]);
});

test('territorySharesForProceduralSpec handles other majority + samosbor_seed', () => {
  const result = territorySharesForProceduralSpec(makeSpec('scientists', 'samosbor_seed'));
  assert.deepEqual(result, [
    { owner: ZoneFaction.CITIZEN, share: 15 },
    { owner: ZoneFaction.LIQUIDATOR, share: 11 },
    { owner: ZoneFaction.CULTIST, share: 26 },
    { owner: ZoneFaction.SCIENTIST, share: 7 },
    { owner: ZoneFaction.WILD, share: 31 },
    { owner: ZoneFaction.SAMOSBOR, share: 10 },
  ]);
});

test('territorySharesForProceduralSpec handles zombie_apocalypse', () => {
  const result = territorySharesForProceduralSpec(makeSpec('citizens', 'zombie_apocalypse'));
  assert.deepEqual(result, [
    { owner: ZoneFaction.CITIZEN, share: 25 },
    { owner: ZoneFaction.LIQUIDATOR, share: 12 },
    { owner: ZoneFaction.CULTIST, share: 12 },
    { owner: ZoneFaction.SCIENTIST, share: 9 },
    { owner: ZoneFaction.WILD, share: 42 },
  ]);
});

test('territorySharesForProceduralSpec falls back to procedural majorities', () => {
  const result = territorySharesForProceduralSpec(makeSpec('scientists', 'none'));
  assert.deepEqual(result, [
    { owner: ZoneFaction.CITIZEN, share: 22 },
    { owner: ZoneFaction.LIQUIDATOR, share: 16 },
    { owner: ZoneFaction.CULTIST, share: 8 },
    { owner: ZoneFaction.SCIENTIST, share: 42 },
    { owner: ZoneFaction.WILD, share: 12 },
  ]);
});
