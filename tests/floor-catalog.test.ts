import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getFloorCatalogDef } from '../src/systems/floor_catalog';
import { FLOOR_CATALOG } from '../src/data/floor_catalog';

test('getFloorCatalogDef returns undefined for unknown ID', () => {
  assert.equal(getFloorCatalogDef('unknown_id_123'), undefined);
});

test('getFloorCatalogDef returns correct catalog entry for existing ID', () => {
  // Use the first item from FLOOR_CATALOG if it exists
  if (FLOOR_CATALOG.length > 0) {
    const expectedDef = FLOOR_CATALOG[0];
    const resultDef = getFloorCatalogDef(expectedDef.id);
    assert.deepEqual(resultDef, expectedDef);
  } else {
    assert.fail('FLOOR_CATALOG is empty, cannot run this test.');
  }
});
