import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { syncNextEntityId } from '../../src/gen/content_manifest_utils';
import { EntityType, type Entity } from '../../src/core/types';

test('syncNextEntityId returns nextId for empty array', () => {
  const result = syncNextEntityId([], 10);
  assert.equal(result, 10);
});

test('syncNextEntityId returns nextId if entities have smaller ids', () => {
  const entities = [
    { id: 1 } as Entity,
    { id: 5 } as Entity,
  ];
  const result = syncNextEntityId(entities, 10);
  assert.equal(result, 10);
});

test('syncNextEntityId returns max entity id + 1 if an entity has id >= nextId', () => {
  const entities = [
    { id: 5 } as Entity,
    { id: 12 } as Entity,
    { id: 10 } as Entity,
  ];
  const result = syncNextEntityId(entities, 10);
  assert.equal(result, 13);
});

test('syncNextEntityId works correctly when max entity id is exactly nextId', () => {
  const entities = [
    { id: 10 } as Entity,
  ];
  const result = syncNextEntityId(entities, 10);
  assert.equal(result, 11);
});
