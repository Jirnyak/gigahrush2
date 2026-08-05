import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visualCorridorCoveringById } from '../src/data/visual_corridor_coverings';

test('visualCorridorCoveringById', async (t) => {
  await t.test('returns definition for valid id', () => {
    const def = visualCorridorCoveringById('meat');
    assert.equal(def.id, 'meat');
    assert.equal(def.style, 'organic');
  });

  await t.test('returns concrete definition for undefined id', () => {
    const def = visualCorridorCoveringById(undefined);
    assert.equal(def.id, 'concrete');
    assert.equal(def.style, 'concrete');
  });

  await t.test('returns concrete definition for invalid string id', () => {
    const def = visualCorridorCoveringById('invalid_id_xyz');
    assert.equal(def.id, 'concrete');
    assert.equal(def.style, 'concrete');
  });
});
