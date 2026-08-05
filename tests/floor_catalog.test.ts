import test from 'node:test';
import assert from 'node:assert/strict';
import { FloorLevel } from '../src/core/types';
import { FLOOR_CATALOG } from '../src/data/floor_catalog';
import { queryFloorCatalog, getFloorCatalogDef } from '../src/systems/floor_catalog';

test('getFloorCatalogDef returns the correct definition for a valid ID', () => {
  const target = FLOOR_CATALOG[0];
  const result = getFloorCatalogDef(target.id);
  assert.ok(result);
  assert.equal(result.id, target.id);
  assert.equal(result.displayName, target.displayName);
});

test('getFloorCatalogDef returns undefined for an invalid ID', () => {
  const result = getFloorCatalogDef('non_existent_invalid_id_12345');
  assert.equal(result, undefined);
});

test('queryFloorCatalog returns all items when no query is provided', () => {
  const result = queryFloorCatalog();
  assert.equal(result.length, FLOOR_CATALOG.length);
});

test('queryFloorCatalog filters by baseFloor', () => {
  const query = { baseFloor: FloorLevel.MAINTENANCE };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.baseFloor === FloorLevel.MAINTENANCE);
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.baseFloor === FloorLevel.MAINTENANCE));
});

test('queryFloorCatalog filters by tag', () => {
  const query = { tag: 'elevator' };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.tags.includes('elevator'));
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.tags.includes('elevator')));
});

test('queryFloorCatalog filters by multiple tags (requires ALL tags)', () => {
  const query = { tags: ['numbered', 'map_lie'] };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.tags.includes('numbered') && def.tags.includes('map_lie'));
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.tags.includes('numbered') && def.tags.includes('map_lie')));
});

test('queryFloorCatalog filters by rarity', () => {
  const query = { rarity: 'rare' as const };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.rarity === 'rare');
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.rarity === 'rare'));
});

test('queryFloorCatalog filters by rarity array', () => {
  const query = { rarity: ['rare', 'legendary'] as const };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.rarity === 'rare' || def.rarity === 'legendary');
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.rarity === 'rare' || def.rarity === 'legendary'));
});

test('queryFloorCatalog filters by minDepth', () => {
  const query = { minDepth: 5 };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.minDepth <= 5);
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.minDepth <= 5));
});

test('queryFloorCatalog filters by contentStatus', () => {
  const query = { contentStatus: 'design_doc' as const };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.contentStatus === 'design_doc');
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.contentStatus === 'design_doc'));
});

test('queryFloorCatalog filters by contentStatus array', () => {
  const query = { contentStatus: ['design_doc', 'needs_generator'] as const };
  const result = queryFloorCatalog(query);
  const expected = FLOOR_CATALOG.filter(def => def.contentStatus === 'design_doc' || def.contentStatus === 'needs_generator');
  assert.equal(result.length, expected.length);
  assert.ok(result.every(def => def.contentStatus === 'design_doc' || def.contentStatus === 'needs_generator'));
});

test('queryFloorCatalog filters by search (matches ID, display name, hint, or tags)', () => {
  const firstItem = FLOOR_CATALOG[0];

  // Search by ID substring
  const searchId = firstItem.id.substring(1, 5).toLowerCase();
  const resultId = queryFloorCatalog({ search: searchId });
  assert.ok(resultId.length > 0);
  assert.ok(resultId.some(def => def.id === firstItem.id));

  // Search by display name substring
  const searchName = firstItem.displayName.substring(1, 5).toLowerCase();
  const resultName = queryFloorCatalog({ search: searchName });
  assert.ok(resultName.length > 0);
  assert.ok(resultName.some(def => def.id === firstItem.id));

  // Search by tag substring
  if (firstItem.tags.length > 0) {
    const searchTag = firstItem.tags[0].substring(1, 3).toLowerCase();
    const resultTag = queryFloorCatalog({ search: searchTag });
    assert.ok(resultTag.length > 0);
    assert.ok(resultTag.some(def => def.id === firstItem.id));
  }
});

test('queryFloorCatalog filters by search (empty string returns all)', () => {
  const result = queryFloorCatalog({ search: '   ' });
  assert.equal(result.length, FLOOR_CATALOG.length);
});

test('queryFloorCatalog limits the number of results', () => {
  const limit = 2;
  const result = queryFloorCatalog({ limit });
  assert.ok(result.length <= limit);
});

test('queryFloorCatalog returns empty array when limit is 0', () => {
  const result = queryFloorCatalog({ limit: 0 });
  assert.equal(result.length, 0);
});

test('queryFloorCatalog filters by multiple criteria', () => {
  // Let's find an item to use its properties as filters
  const target = FLOOR_CATALOG[0];

  const query = {
    baseFloor: target.baseFloor,
    rarity: target.rarity,
    contentStatus: target.contentStatus,
    minDepth: target.minDepth,
  };

  const result = queryFloorCatalog(query);
  assert.ok(result.length > 0);
  assert.ok(result.some(def => def.id === target.id));
  assert.ok(result.every(def =>
    def.baseFloor === target.baseFloor &&
    def.rarity === target.rarity &&
    def.contentStatus === target.contentStatus &&
    def.minDepth <= target.minDepth
  ));
});

test('queryFloorCatalog combines tag and tags arrays', () => {
  const target = FLOOR_CATALOG.find(c => c.tags.length >= 2);
  if (!target) return; // Skip if no item with 2+ tags

  const query = {
    tag: target.tags[0],
    tags: [target.tags[1]]
  };

  const result = queryFloorCatalog(query);
  assert.ok(result.length > 0);
  assert.ok(result.some(def => def.id === target.id));
  assert.ok(result.every(def =>
    def.tags.includes(target.tags[0]) &&
    def.tags.includes(target.tags[1])
  ));
});
